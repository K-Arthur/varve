import type { RasterAsset } from '@varve/codegen';
import { gpuEffectProvider } from '@varve/compositor';
import {
  adjustmentsToFilters,
  anyRequiresRasterExport,
  applyFilterWithCompositing as applyFilters,
  blendPixels,
  createRasterSurface,
  encodeRasterSurface,
  totalEffectExpansion,
} from '@varve/engine';
import {
  buildEffectChain,
  dispatchLiveEffect,
  LIVE_EFFECT_KINDS,
  type LiveEffectKind,
} from '@varve/engine/liveEffects';
import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import { textNodeLocalBounds } from '@varve/scene';

// Accelerated live-effect dispatch chain: native (Tauri) → WebGPU (web) →
// CPU reference kernels. Interactive preview stays synchronous CPU; export
// is async and uses the chain. Built once per process.
const EFFECT_CHAIN = buildEffectChain(gpuEffectProvider);

/**
 * Composite an accelerated effect result back over the pre-effect pixels.
 * Providers return the fully transformed surface, so applying the result with
 * putImageData alone would discard the adjustment's mix and blend mode.
 */
export function compositeDispatchedEffect(
  source: ImageData,
  result: ImageData,
  opacity: number,
  blendMode: string,
): ImageData {
  const amount = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  const mode = blendMode === 'passThrough' ? 'normal' : blendMode || 'normal';
  if (amount >= 1 && mode === 'normal') return result;
  return blendPixels(source, result, mode, amount);
}

export interface FlattenForExportOptions {
  scale: number;
  dpi?: number;
  signal?: AbortSignal;
  background?: readonly [number, number, number, number];
}

export interface FlattenResult {
  assets: Record<string, RasterAsset>;
}

function collectAdjustmentNodes(nodes: SceneNode[], doc: Document, out: SceneNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'adjustment') {
      const adjFilters =
        (
          node as unknown as {
            adjustments?: Array<{ visible: boolean; opacity: number; kind: string }>;
          }
        ).adjustments ?? [];
      const visibleFilters = adjFilters.filter((a) => a.visible && a.opacity > 0);
      const irFilters = adjustmentsToFilters(
        visibleFilters as unknown as Parameters<typeof adjustmentsToFilters>[0],
      );
      if (anyRequiresRasterExport(irFilters)) {
        out.push(node);
      }
    }
    if (node.kind === 'frame' || node.kind === 'group') {
      const children = (node.children ?? [])
        .map((cid: string) => doc.nodes[cid])
        .filter(Boolean) as SceneNode[];
      collectAdjustmentNodes(children, doc, out);
    }
  }
}

function computeSubtreeBounds(
  node: SceneNode,
  doc: Document,
): { x: number; y: number; w: number; h: number } {
  if (node.kind === 'adjustment') {
    const scope = (
      node as unknown as {
        scope?: { mode: string; targetNodeId?: string; targetNodeIds?: string[] };
      }
    ).scope;
    if (scope?.mode === 'image-local' && scope.targetNodeId) {
      const target = doc.nodes[scope.targetNodeId];
      if (target) return computeSubtreeBounds(target, doc);
    }
    if (scope?.mode === 'explicit-targets' && scope.targetNodeIds?.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const tid of scope.targetNodeIds) {
        const t = doc.nodes[tid];
        if (t) {
          const b = computeSubtreeBounds(t, doc);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
      }
      if (Number.isFinite(minX)) return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }

  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    switch (s.kind) {
      case 'rect':
        return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 1,
          h: Math.abs(s.to[1] - s.from[1]) || 1,
        };
      }
      case 'polygon':
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      case 'star': {
        const starS = s as typeof s & { outerRadius: number; innerRadius: number };
        return {
          x: tx + starS.cx - starS.outerRadius,
          y: ty + starS.cy - starS.outerRadius,
          w: starS.outerRadius * 2,
          h: starS.outerRadius * 2,
        };
      }
      case 'path': {
        if (s.points.length === 0) return { x: tx, y: ty, w: 1, h: 1 };
        const xs = s.points.map((p: { x: number }) => p.x);
        const ys = s.points.map((p: { y: number }) => p.y);
        return {
          x: tx + Math.min(...xs),
          y: ty + Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs) || 1,
          h: Math.max(...ys) - Math.min(...ys) || 1,
        };
      }
      default:
        return { x: tx, y: ty, w: 200, h: 160 };
    }
  }

  if (node.kind === 'text') {
    // Export must crop to the same rectangle the canvas draws into. A
    // character-count estimate with a single line's height cut multi-line text
    // off at the first line and mis-sized every non-average face.
    const bounds = textNodeLocalBounds(node);
    return { x: tx, y: ty, w: bounds.w, h: bounds.h };
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = (node.children ?? [])
      .map((cid: string) => doc.nodes[cid])
      .filter(Boolean) as SceneNode[];
    const childBounds = children.map((c) => computeSubtreeBounds(c, doc));
    if (childBounds.length === 0) return { x: tx, y: ty, w: 200, h: 160 };
    const minX = Math.min(...childBounds.map((b) => b.x));
    const minY = Math.min(...childBounds.map((b) => b.y));
    const maxX = Math.max(...childBounds.map((b) => b.x + b.w));
    const maxY = Math.max(...childBounds.map((b) => b.y + b.h));
    return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }

  return { x: tx, y: ty, w: 200, h: 160 };
}

function renderSubtreeToCtx(ctx: CanvasRenderingContext2D, node: SceneNode, doc: Document): void {
  if (node.kind === 'adjustment') return;

  ctx.save();
  ctx.translate(node.transform[4] ?? 0, node.transform[5] ?? 0);
  ctx.transform(
    node.transform[0] ?? 1,
    node.transform[1] ?? 0,
    node.transform[2] ?? 0,
    node.transform[3] ?? 1,
    0,
    0,
  );

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    const fills = node.fills ?? [];
    const fillColor = fills[0];
    if (fillColor?.type === 'solid') {
      const c = (fillColor as unknown as { color: readonly [number, number, number, number] })
        .color;
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0)';
    }

    ctx.beginPath();
    switch (s.kind) {
      case 'rect':
        ctx.rect(s.x, s.y, s.w, s.h);
        break;
      case 'ellipse':
        ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
        break;
      case 'circle':
        ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
        break;
      case 'line':
      case 'arrow':
        ctx.moveTo(s.from[0], s.from[1]);
        ctx.lineTo(s.to[0], s.to[1]);
        break;
      case 'polygon':
      case 'star': {
        const sides =
          s.kind === 'polygon' ? s.sides : (s as unknown as { points: number }).points * 2;
        const getRadius = (i: number): number => {
          if (s.kind === 'polygon') return s.radius;
          const starS = s as unknown as { outerRadius: number; innerRadius: number };
          return i % 2 === 0 ? starS.outerRadius : starS.innerRadius;
        };
        const rotation =
          s.kind === 'polygon'
            ? (s.rotation ?? 0)
            : ((s as unknown as { rotation?: number }).rotation ?? 0);
        const vertexCount = sides;
        if (vertexCount > 0) {
          const a0 = (Math.PI * 2 * 0) / vertexCount - Math.PI / 2 + rotation;
          const r0 = getRadius(0);
          ctx.moveTo(s.cx + r0 * Math.cos(a0), s.cy + r0 * Math.sin(a0));
          for (let i = 1; i < vertexCount; i++) {
            const a = (Math.PI * 2 * i) / vertexCount - Math.PI / 2 + rotation;
            const r = getRadius(i);
            ctx.lineTo(s.cx + r * Math.cos(a), s.cy + r * Math.sin(a));
          }
          ctx.closePath();
        }
        break;
      }
      case 'path':
        if (s.points.length > 0) {
          type Pt = {
            x: number;
            y: number;
            handleIn?: [number, number] | null;
            handleOut?: [number, number] | null;
          };
          const pts = s.points as unknown as Pt[];
          const first = pts[0];
          if (!first) break;
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];
            if (prev && curr && (prev.handleOut || curr.handleIn)) {
              const c1x = prev.x + (prev.handleOut?.[0] ?? 0);
              const c1y = prev.y + (prev.handleOut?.[1] ?? 0);
              const c2x = curr.x + (curr.handleIn?.[0] ?? 0);
              const c2y = curr.y + (curr.handleIn?.[1] ?? 0);
              ctx.bezierCurveTo(c1x, c1y, c2x, c2y, curr.x, curr.y);
            } else if (curr) {
              ctx.lineTo(curr.x, curr.y);
            }
          }
          if ((s as unknown as { closed?: boolean }).closed) ctx.closePath();
        }
        break;
    }
    ctx.fill();
  }

  if (node.kind === 'text') {
    const text = (node as unknown as { text?: string }).text ?? '';
    const fontSize = node.fontSize ?? 16;
    const fontFamily = node.fontFamily ?? 'sans-serif';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, 0, 0);
  }

  if (node.kind === 'frame' || node.kind === 'group') {
    const children = (node.children ?? [])
      .map((cid: string) => doc.nodes[cid])
      .filter(Boolean) as SceneNode[];
    for (const child of children) {
      renderSubtreeToCtx(ctx, child, doc);
    }
  }

  ctx.restore();
}

export async function flattenForExport(
  nodes: SceneNode[],
  doc: Document,
  opts: FlattenForExportOptions,
): Promise<FlattenResult> {
  const assets: Record<string, RasterAsset> = {};
  const adjustmentNodes: SceneNode[] = [];
  collectAdjustmentNodes(nodes, doc, adjustmentNodes);

  if (adjustmentNodes.length === 0) return { assets };

  const scale = Math.max(0.01, opts.scale);

  for (const adjNode of adjustmentNodes) {
    if (opts.signal?.aborted) break;

    const rawFilters =
      (adjNode as unknown as { adjustments?: Array<Record<string, unknown>> }).adjustments ?? [];
    const filters = rawFilters.filter((a) => a.visible !== false && (a.opacity as number) > 0);
    if (filters.length === 0) continue;

    const irFilters = adjustmentsToFilters(
      filters as unknown as Parameters<typeof adjustmentsToFilters>[0],
    );
    const bounds = computeSubtreeBounds(adjNode, doc);
    const [expL, expT, expR, expB] = totalEffectExpansion(irFilters);

    const cssWidth = Math.max(1, bounds.w);
    const cssHeight = Math.max(1, bounds.h);
    const expandedCssW = cssWidth + expL + expR;
    const expandedCssH = cssHeight + expT + expB;
    const pixelW = Math.max(1, Math.round(expandedCssW * scale));
    const pixelH = Math.max(1, Math.round(expandedCssH * scale));

    if (pixelW * pixelH > 33_554_432) {
      assets[adjNode.id] = {
        nodeId: adjNode.id,
        dataUrl: '',
        pixelWidth: 0,
        pixelHeight: 0,
        cssWidth,
        cssHeight,
        dpi: opts.dpi,
      };
      continue;
    }

    let surface: ReturnType<typeof createRasterSurface>;
    try {
      surface = createRasterSurface(pixelW, pixelH);
    } catch {
      continue;
    }

    const { context } = surface;

    const bg = opts.background;
    if (bg && bg[3] > 0) {
      context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`;
      context.fillRect(0, 0, pixelW, pixelH);
    }

    context.save();
    context.translate(expL * scale, expT * scale);
    context.scale(scale, scale);
    context.translate(-bounds.x, -bounds.y);

    renderSubtreeToCtx(context as CanvasRenderingContext2D, adjNode, doc);

    context.restore();

    // Apply the filter stack in order. Live effects route through the
    // accelerated dispatch chain (native → WebGPU → CPU reference); all
    // other filters use the sync software path. Order is preserved by
    // interleaving per-filter.
    for (const filter of irFilters) {
      if (LIVE_EFFECT_KINDS.has(filter.kind as LiveEffectKind)) {
        try {
          const imageData = context.getImageData(0, 0, pixelW, pixelH);
          const rgba = new Uint8ClampedArray(imageData.data);
          const out = await dispatchLiveEffect(
            {
              effect: filter.kind as LiveEffectKind,
              width: pixelW,
              height: pixelH,
              quality: 'export',
              params: { ...filter },
            },
            rgba,
            EFFECT_CHAIN,
          );
          const result = new ImageData(
            out as unknown as Uint8ClampedArray<ArrayBuffer>,
            pixelW,
            pixelH,
          );
          context.putImageData(
            compositeDispatchedEffect(
              imageData,
              result,
              filter.opacity ?? 1,
              filter.blendMode ?? 'normal',
            ),
            0,
            0,
          );
        } catch {
          // Dispatch failure falls back to the software path for this filter
          // (the chain already tried every provider; a failure here means
          // the reference kernel itself is unavailable — leave unchanged).
        }
      } else {
        applyFilters(context as CanvasRenderingContext2D, [filter], pixelW, pixelH, {
          quality: 'export',
        });
      }
    }

    let dataUrl: string;
    try {
      const blob = await encodeRasterSurface(surface, 'image/png');
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to encode flattened export'));
        reader.readAsDataURL(blob);
      });
    } catch {
      continue;
    }

    const expansion =
      expL > 0 || expT > 0 || expR > 0 || expB > 0
        ? { left: expL, top: expT, right: expR, bottom: expB }
        : undefined;

    assets[adjNode.id] = {
      nodeId: adjNode.id,
      dataUrl,
      pixelWidth: Math.round(expandedCssW * scale),
      pixelHeight: Math.round(expandedCssH * scale),
      cssWidth,
      cssHeight,
      dpi: opts.dpi,
      ...(expansion ? { expansion } : {}),
    };
  }

  return { assets };
}
