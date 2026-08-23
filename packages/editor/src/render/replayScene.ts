/**
 * Structural scene replay shared by deterministic exports and previews.
 *
 * Render IR intentionally contains leaf drawing commands, while frames,
 * groups, and masks remain scene-graph semantics. This module applies those
 * semantics without flattening descendants into an un-clipped paint list.
 *
 * Supports enhanced masks: clip, alpha, luminance, inversion, feather, density.
 *
 * Research basis: W3C Compositing and Blending Level 1 group isolation;
 * WHATWG Canvas 2D clipping and state-stack behavior; Varve ADR-0001.
 */

import {
  acquireMaskSurface,
  adjustmentsToFilters,
  applyFilterWithCompositing,
  applyLayerBlur,
  applyMaskAlpha,
  CompositeCanvas,
  createRasterSurface,
  type EffectMaskResolver,
  gaussianBlurSeparable,
  getImageCache,
  mapBlendMode,
  primitiveBounds,
  type RenderItem,
  type ReplayTarget,
  releaseMaskSurface,
  replayIr,
  totalEffectExpansion,
  traceSceneNodeOutline,
} from '@varve/engine';
import { isRasterPyramidEnabled, setRasterPyramidEnabled } from '@varve/engine/rasterPyramid';
import type { Document, Effect, ManagedColor, Mask, NodeId } from '@varve/scene';
import { activeSmartFilters, nodeEffectPadding, resolveAdjustmentScope } from '@varve/scene';
import { managedColorToRgba, tryInvertAffine } from '@varve/shared';
import { nodeWorldTransform } from '../scene/world';
import { alphaBounds } from './surfaceBounds';

type SceneContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StructuredReplayInput {
  document: Document;
  rootIds: readonly NodeId[];
  flattenedIds: readonly NodeId[];
  items: readonly RenderItem[];
  /** Extra items painted right after a frame's own item (mockup surfaces). */
  extrasByNodeId?: ReadonlyMap<NodeId, readonly RenderItem[]>;
}

function setMatrix(context: SceneContext, matrix: DOMMatrix): void {
  context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
}

function traceEffectVectorMask(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  vector: {
    points: readonly {
      x: number;
      y: number;
      handleIn?: readonly [number, number] | null;
      handleOut?: readonly [number, number] | null;
    }[];
    closed: boolean;
    fillRule: 'nonzero' | 'evenodd';
  },
): void {
  const first = vector.points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < vector.points.length; index++) {
    const point = vector.points[index]!;
    const previous = vector.points[index - 1]!;
    if (previous.handleOut || point.handleIn) {
      ctx.bezierCurveTo(
        previous.handleOut?.[0] ?? previous.x,
        previous.handleOut?.[1] ?? previous.y,
        point.handleIn?.[0] ?? point.x,
        point.handleIn?.[1] ?? point.y,
        point.x,
        point.y,
      );
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  if (vector.closed) ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill(vector.fillRule);
}

// ── Group-level effects (parity with the live canvas) ─────────────────────────

/** Maximum effect expansion over a subtree, used to pad the flatten surface. */
function subtreeEffectPadding(document: Document, rootIds: readonly NodeId[]): number {
  let padding = 2;
  const stack = [...rootIds];
  while (stack.length > 0) {
    const node = document.nodes[stack.pop()!];
    if (!node) continue;
    if ('effects' in node && node.effects) {
      const p = nodeEffectPadding(node as { effects?: Array<Record<string, unknown>> });
      padding = Math.max(padding, p.left, p.right, p.top, p.bottom);
    }
    if ('children' in node) stack.push(...node.children);
  }
  return Math.ceil(padding);
}

/** Convert a managed effect colour to an rgba() string. */
function effectColorToCss(color: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/**
 * Composite a group-level drop shadow or outer glow in front of the target's
 * backdrop but behind the group content. The flattened group canvas is drawn
 * with the Canvas shadow API onto a scratch canvas, the content is erased
 * (`destination-out`), and the remaining shadow-only pixels are composited
 * with the effect's own blend mode. This is the same technique the live
 * canvas uses, so exported output matches the editor preview.
 */
function compositeGroupOuterEffect(
  target: SceneContext,
  effect: Effect,
  gCanvas: CompositeCanvas,
  renderScale: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  groupOpacity: number,
): void {
  if (effect.type !== 'dropShadow' && effect.type !== 'outerGlow') return;
  const w = gCanvas.canvas.width;
  const h = gCanvas.canvas.height;
  if (w <= 0 || h <= 0) return;

  const effectCanvas = document.createElement('canvas');
  effectCanvas.width = w;
  effectCanvas.height = h;
  const effectCtx = effectCanvas.getContext('2d');
  if (!effectCtx) return;

  const offsetX = effect.type === 'dropShadow' ? (effect.x ?? 0) : 0;
  const offsetY = effect.type === 'dropShadow' ? (effect.y ?? 0) : 0;

  effectCtx.save();
  effectCtx.shadowColor = effectColorToCss(effect.color);
  effectCtx.shadowBlur = (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
  effectCtx.shadowOffsetX = offsetX * renderScale;
  effectCtx.shadowOffsetY = offsetY * renderScale;
  effectCtx.drawImage(gCanvas.canvas as unknown as CanvasImageSource, 0, 0);
  effectCtx.globalCompositeOperation = 'destination-out';
  effectCtx.shadowColor = 'transparent';
  effectCtx.drawImage(gCanvas.canvas as unknown as CanvasImageSource, 0, 0);
  effectCtx.restore();

  target.save();
  target.globalAlpha = (effect.opacity ?? 1) * groupOpacity;
  target.globalCompositeOperation = mapBlendMode(effect.blendMode) as GlobalCompositeOperation;
  target.drawImage(effectCanvas as unknown as CanvasImageSource, dx, dy, dw, dh);
  target.restore();
}

/**
 * Apply a group-level inner shadow or inner glow to the flattened group
 * canvas in place, using the same silhouette-difference algorithm as the live
 * canvas (`renderGroupInsetEffect` in CanvasArea.tsx).
 */
function applyGroupInsetEffect(
  effect: Effect,
  gCanvas: CompositeCanvas,
  renderScale: number,
  mode: 'shadow' | 'glow',
): void {
  if (effect.type !== 'innerShadow' && effect.type !== 'innerGlow') return;
  const w = gCanvas.canvas.width;
  const h = gCanvas.canvas.height;
  if (w <= 0 || h <= 0) return;

  const blur = effect.blur * renderScale;
  const spread = effect.spread * renderScale;
  const ctx = gCanvas.ctx;

  const silhouetteData = ctx.getImageData(0, 0, w, h);
  const insetCanvas = document.createElement('canvas');
  insetCanvas.width = w;
  insetCanvas.height = h;
  const insetCtx = insetCanvas.getContext('2d');
  if (!insetCtx) return;
  insetCtx.putImageData(silhouetteData, 0, 0);

  const [r, g, b] = managedColorToRgba(effect.color);

  if (mode === 'shadow') {
    // Inner shadow: colour the silhouette, blur, then cut the offset hole.
    insetCtx.save();
    insetCtx.globalCompositeOperation = 'source-in';
    insetCtx.fillStyle = `rgba(${r},${g},${b},1)`;
    insetCtx.fillRect(0, 0, w, h);
    insetCtx.restore();
    if (blur > 0) {
      const blurred = gaussianBlurSeparable(insetCtx.getImageData(0, 0, w, h), Math.max(1, blur));
      insetCtx.putImageData(blurred, 0, 0);
    }
    insetCtx.save();
    insetCtx.globalCompositeOperation = 'destination-out';
    insetCtx.translate(
      -('x' in effect ? (effect.x ?? 0) : 0) * renderScale,
      -('y' in effect ? (effect.y ?? 0) : 0) * renderScale,
    );
    insetCtx.putImageData(silhouetteData, 0, 0);
    insetCtx.restore();
    const insetData = insetCtx.getImageData(0, 0, w, h).data;
    const dst = ctx.getImageData(0, 0, w, h);
    const opacity = effect.opacity ?? 1;
    for (let i = 3; i < dst.data.length; i += 4) {
      const sa = insetData[i]! / 255;
      dst.data[i - 3] = dst.data[i - 3]! * (1 - sa * opacity);
      dst.data[i - 2] = dst.data[i - 2]! * (1 - sa * opacity);
      dst.data[i - 1] = dst.data[i - 1]! * (1 - sa * opacity);
      dst.data[i] = Math.max(dst.data[i]!, insetData[i]! * opacity);
    }
    ctx.putImageData(dst, 0, 0);
    return;
  }

  // Inner glow: erode by spread, colourise, blur, then keep only where the
  // original silhouette had content.
  const shrinkPx = Math.max(1, Math.round(spread));
  if (spread > 0) {
    const erodeCanvas = document.createElement('canvas');
    erodeCanvas.width = w;
    erodeCanvas.height = h;
    const erodeCtx = erodeCanvas.getContext('2d');
    if (erodeCtx) {
      erodeCtx.putImageData(silhouetteData, 0, 0);
      erodeCtx.filter = `blur(${shrinkPx}px)`;
      erodeCtx.globalCompositeOperation = 'source-over';
      erodeCtx.drawImage(insetCanvas, 0, 0);
      const erodeResult = erodeCtx.getImageData(0, 0, w, h);
      insetCtx.putImageData(erodeResult, 0, 0);
    }
  }
  insetCtx.save();
  insetCtx.globalCompositeOperation = 'source-in';
  insetCtx.fillStyle = `rgba(${r},${g},${b},1)`;
  insetCtx.fillRect(0, 0, w, h);
  insetCtx.restore();
  if (blur > 0) {
    const blurred = gaussianBlurSeparable(insetCtx.getImageData(0, 0, w, h), Math.max(1, blur));
    insetCtx.putImageData(blurred, 0, 0);
  }
  insetCtx.save();
  insetCtx.globalCompositeOperation = 'destination-in';
  insetCtx.putImageData(silhouetteData, 0, 0);
  insetCtx.restore();

  const glowData = insetCtx.getImageData(0, 0, w, h);
  const dst = ctx.getImageData(0, 0, w, h);
  const opacity = effect.opacity ?? 1;
  for (let i = 0; i < dst.data.length; i += 4) {
    const ga = glowData.data[i + 3]! / 255;
    dst.data[i] = dst.data[i]! * (1 - ga * opacity) + glowData.data[i]! * ga * opacity;
    dst.data[i + 1] = dst.data[i + 1]! * (1 - ga * opacity) + glowData.data[i + 1]! * ga * opacity;
    dst.data[i + 2] = dst.data[i + 2]! * (1 - ga * opacity) + glowData.data[i + 2]! * ga * opacity;
    dst.data[i + 3] = Math.max(dst.data[i + 3]!, glowData.data[i + 3]!);
  }
  ctx.putImageData(dst, 0, 0);
}

export function replayStructuredScene(context: SceneContext, input: StructuredReplayInput): void {
  // Export/print/preview replay must never consume display LOD (ADR-0214
  // D12): the interactive pyramid is a display acceleration structure, and
  // exported pixels come from authoritative source data at target
  // resolution. The editor enables the pyramid for the session; this replay
  // path suspends it for its duration and restores the prior state.
  const pyramidWasEnabled = isRasterPyramidEnabled();
  if (pyramidWasEnabled) setRasterPyramidEnabled(false);
  try {
    replayStructuredSceneInner(context, input);
  } finally {
    if (pyramidWasEnabled) setRasterPyramidEnabled(true);
  }
}

function replayStructuredSceneInner(context: SceneContext, input: StructuredReplayInput): void {
  const itemById = new Map<NodeId, RenderItem>();
  for (let index = 0; index < input.flattenedIds.length; index++) {
    const id = input.flattenedIds[index];
    const item = input.items[index];
    if (id && item) itemById.set(id, item);
  }

  const replayChildren = (nodeId: NodeId, target: SceneContext): void => {
    const node = input.document.nodes[nodeId];
    if (!node || !('children' in node)) return;
    for (const childId of node.children) replayNode(childId, target);
  };

  const resolveEffectMask: EffectMaskResolver = (binding, item, target, width, height) => {
    if (binding.source.kind === 'raster-asset') return undefined;
    let maskSurface: ReturnType<typeof createRasterSurface>;
    try {
      maskSurface = createRasterSurface(width, height);
    } catch {
      return undefined;
    }
    const maskCtx = maskSurface.context;
    const current = target.getTransform?.();
    if (current) {
      maskCtx.setTransform(current.a, current.b, current.c, current.d, current.e, current.f);
    }
    const inverse = tryInvertAffine(item.transform);
    if (!inverse) return undefined;
    maskCtx.save();
    try {
      // Rendered scene-node mattes are world-space output. The effect surface
      // is target-local, so project the matte through the inverse target
      // transform before sampling it.
      maskCtx.transform(...inverse);
      if (binding.source.kind === 'scene-node') {
        if (!input.document.nodes[binding.source.nodeId]) return undefined;
        replayNode(binding.source.nodeId, maskCtx as unknown as SceneContext);
      } else {
        traceEffectVectorMask(maskCtx, binding.source.vectorMask);
      }
    } finally {
      maskCtx.restore();
    }
    return maskCtx.getImageData(0, 0, width, height);
  };

  const compositeIsolated = (
    target: SceneContext,
    draw: (isolated: SceneContext) => void,
    opacity: number,
    blendMode: string,
  ): void => {
    const surface = createRasterSurface(target.canvas.width, target.canvas.height);
    setMatrix(surface.context, target.getTransform());
    draw(surface.context);
    target.save();
    try {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalAlpha = opacity;
      target.globalCompositeOperation = mapBlendMode(blendMode) as GlobalCompositeOperation;
      target.drawImage(surface.canvas as CanvasImageSource, 0, 0);
    } finally {
      target.restore();
    }
  };

  const replayNode = (nodeId: NodeId, target: SceneContext): void => {
    const node = input.document.nodes[nodeId];
    if (!node || node.visible === false) return;
    const item = itemById.get(nodeId);

    const mask: Mask | null = 'mask' in node && node.mask?.visible ? node.mask : null;
    const maskSourceId =
      mask?.sourceNodeId ??
      (mask?.matteSource?.kind === 'scene-node' ? mask.matteSource.nodeId : undefined);
    const maskSource = maskSourceId ? input.document.nodes[maskSourceId] : undefined;
    // Adjustment nodes have no children to clip — their spatial mask is
    // applied inside the adjustment branch below. A mask whose source is an
    // adjustment node contributes no geometry and is ignored.
    const maskUsableSource =
      maskSourceId === undefined || maskSource === undefined || maskSource.kind !== 'adjustment';
    const maskHasVector = !!mask?.vectorMask && mask.vectorMask.points.length > 0;
    const maskHasRaster = mask?.rasterMask !== undefined;
    if (
      node.kind !== 'adjustment' &&
      'children' in node &&
      mask &&
      (maskSourceId || maskHasVector || maskHasRaster || mask?.matteSource) &&
      maskUsableSource
    ) {
      const clipFrameQuad = (ctx: SceneContext): void => {
        if (node.kind !== 'frame' || node.clipContent === false) return;
        const quad = item?.transform ?? nodeWorldTransform(input.document, nodeId);
        const [a, b, c, d, e, f] = quad;
        const fw = node.w;
        const fh = node.h;
        ctx.beginPath();
        ctx.moveTo(e, f);
        ctx.lineTo(a * fw + e, b * fw + f);
        ctx.lineTo(a * fw + c * fh + e, b * fw + d * fh + f);
        ctx.lineTo(c * fh + e, d * fh + f);
        ctx.closePath();
        ctx.clip();
      };
      const traceVectorMaskPoints = (ctx: SceneContext, maskData: Mask): void => {
        const points = maskData.vectorMask!.points;
        const closed = maskData.vectorMask!.closed;
        if (points.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) {
          const p = points[i]!;
          const prev = points[i - 1]!;
          if (p.handleIn || p.handleOut) {
            ctx.bezierCurveTo(
              prev.handleOut?.[0] ?? prev.x,
              prev.handleOut?.[1] ?? prev.y,
              p.handleIn?.[0] ?? p.x,
              p.handleIn?.[1] ?? p.y,
              p.x,
              p.y,
            );
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        if (closed) ctx.closePath();
      };
      // A clip mask with inversion/feather/density requires per-pixel mask
      // alpha and routes through the alpha-compositing path (parity with the
      // live canvas). Plain hard clips keep the fast ctx.clip() path.
      const clipNeedsAlphaPath =
        mask.type === 'clip' &&
        (mask.inverted === true || (mask.feather ?? 0) > 0 || (mask.density ?? 1) < 1);
      if (mask.type === 'alpha' || mask.type === 'luminance' || clipNeedsAlphaPath) {
        const w = target.canvas.width;
        const h = target.canvas.height;
        const maskSurface = acquireMaskSurface(w, h);
        const contentSurface = acquireMaskSurface(w, h);
        try {
          const maskSurfaceCtx = maskSurface.getContext('2d');
          const contentSurfaceCtx = contentSurface.getContext('2d');
          if (!maskSurfaceCtx || !contentSurfaceCtx) return;
          // Apply unlinked mask transform for the mask source rendering
          setMatrix(maskSurfaceCtx, target.getTransform());
          if (mask.linked === false && mask.transform) {
            maskSurfaceCtx.setTransform(
              mask.transform[0],
              mask.transform[1],
              mask.transform[2],
              mask.transform[3],
              mask.transform[4],
              mask.transform[5],
            );
          }
          if (maskSourceId && maskSource) {
            replayNode(maskSourceId, maskSurfaceCtx);
          } else if (maskHasVector) {
            // Vector masks live in mask-local coordinates: their own
            // independent transform (mask.transform) or identity — parity
            // with the live canvas, which does not fold the container
            // transform into vector-mask geometry.
            const t = mask.transform ?? ([1, 0, 0, 1, 0, 0] as const);
            maskSurfaceCtx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
            traceVectorMaskPoints(maskSurfaceCtx, mask);
            maskSurfaceCtx.fillStyle = 'rgba(255,255,255,1)';
            maskSurfaceCtx.fill(mask.vectorMask!.fillRule ?? 'nonzero');
          } else if (maskHasRaster && mask.rasterMask && 'w' in node) {
            // Container-local painted mask: the asset stretches over the
            // frame's local box under the container's world transform.
            const asset = input.document.rasterMaskAssets?.[mask.rasterMask.assetId];
            const img = asset ? getImageCache().getImage(asset.dataUrl) : null;
            if (asset && !img) {
              getImageCache()
                .load(asset.dataUrl)
                .catch(() => undefined);
            }
            if (img) {
              const cw = nodeWorldTransform(input.document, nodeId);
              maskSurfaceCtx.setTransform(cw[0], cw[1], cw[2], cw[3], cw[4], cw[5]);
              maskSurfaceCtx.drawImage(img, 0, 0, node.w, node.h);
            }
          }
          setMatrix(contentSurfaceCtx, target.getTransform());
          // Frame quad clip composes with the mask (intersection).
          contentSurfaceCtx.save();
          clipFrameQuad(contentSurfaceCtx);
          // Render content: all children including mask source (unless hidden)
          for (const childId of node.children) {
            if (childId !== maskSourceId) replayNode(childId, contentSurfaceCtx);
          }
          // Render mask source on top of content unless hideMaskSource
          if (!mask.hideMaskSource && maskSourceId) {
            replayNode(maskSourceId, contentSurfaceCtx);
          }
          contentSurfaceCtx.restore();

          // The content surface has already been rendered above. Applying
          // renderEnhancedMask here would render its separate `content`
          // callback into a fresh surface; the no-op callback used to leave
          // the actual content unmasked during export. Apply the rendered
          // mask directly to the existing surface instead.
          contentSurfaceCtx.save();
          contentSurfaceCtx.setTransform(1, 0, 0, 1, 0, 0);
          try {
            applyMaskAlpha(
              contentSurfaceCtx as CanvasRenderingContext2D,
              (maskCtx) => maskCtx.drawImage(maskSurface as CanvasImageSource, 0, 0),
              {
                luminance: mask.type === 'luminance',
                inverted: mask.inverted === true,
                feather: mask.feather,
                density: mask.density,
              },
            );
          } finally {
            contentSurfaceCtx.restore();
          }

          target.save();
          try {
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.globalAlpha = node.kind === 'group' ? (node.opacity ?? 1) : 1;
            const blendMode = node.kind === 'group' ? (node.blendMode ?? 'passThrough') : 'normal';
            target.globalCompositeOperation = mapBlendMode(
              blendMode === 'passThrough' ? 'normal' : blendMode,
            ) as GlobalCompositeOperation;
            target.drawImage(contentSurface as CanvasImageSource, 0, 0);
          } finally {
            target.restore();
          }
        } finally {
          releaseMaskSurface(contentSurface);
          releaseMaskSurface(maskSurface);
        }
        return;
      }

      // Clip mask (type === 'clip')
      const world =
        mask.linked !== false
          ? nodeWorldTransform(input.document, maskSourceId!)
          : (mask.transform ?? nodeWorldTransform(input.document, maskSourceId!));
      const inverse = tryInvertAffine(world);
      if (inverse) {
        const drawClippedChildren = (clipTarget: SceneContext): void => {
          clipTarget.save();
          try {
            clipFrameQuad(clipTarget);
            clipTarget.transform(...world);
            if (maskHasVector) {
              traceVectorMaskPoints(clipTarget, mask);
              clipTarget.clip(mask.vectorMask!.fillRule ?? 'nonzero');
            } else {
              clipTarget.beginPath();
              traceSceneNodeOutline(
                clipTarget as CanvasRenderingContext2D,
                maskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
              );
              clipTarget.closePath();
              clipTarget.clip(mask.fillRule ?? 'nonzero');
            }
            clipTarget.transform(...inverse);
            for (const childId of node.children) {
              if (childId !== maskSourceId) replayNode(childId, clipTarget);
            }
            // Render mask source on top of clipped children unless hideMaskSource
            if (!mask.hideMaskSource && maskSourceId) {
              clipTarget.transform(...inverse);
              replayNode(maskSourceId, clipTarget);
            }
          } finally {
            clipTarget.restore();
          }
        };
        if (node.kind === 'group') {
          const blendMode = node.blendMode ?? 'passThrough';
          const needsIsolation =
            node.isolated === true ||
            (blendMode !== 'normal' && blendMode !== 'passThrough') ||
            (node.opacity ?? 1) < 1;
          if (needsIsolation) {
            compositeIsolated(
              target,
              drawClippedChildren,
              node.opacity ?? 1,
              blendMode === 'passThrough' ? 'normal' : blendMode,
            );
          } else {
            drawClippedChildren(target);
          }
        } else {
          drawClippedChildren(target);
        }
        return;
      }
    }

    if (node.kind === 'frame') {
      if (item) replayIr(target as unknown as ReplayTarget, [item], undefined, resolveEffectMask);
      const extras = input.extrasByNodeId?.get(nodeId);
      if (extras) {
        for (const extra of extras) replayIr(target as unknown as ReplayTarget, [extra]);
      }
      if (node.children.length === 0) return;

      const smartFilters = adjustmentsToFilters(activeSmartFilters(node));
      if (smartFilters.length > 0) {
        // Frame filters operate on the frame's already-composited children.
        // Render only the transformed frame bounds to an intermediate surface
        // so the editable frame and its descendants remain scene nodes.
        const frameTransform = item?.transform ?? nodeWorldTransform(input.document, nodeId);
        const sourceBounds = item
          ? primitiveBounds(item.primitive)
          : { x: 0, y: 0, w: node.w, h: node.h };
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = frameTransform;
        const corners: Array<[number, number]> = [
          [sourceBounds.x, sourceBounds.y],
          [sourceBounds.x + sourceBounds.w, sourceBounds.y],
          [sourceBounds.x, sourceBounds.y + sourceBounds.h],
          [sourceBounds.x + sourceBounds.w, sourceBounds.y + sourceBounds.h],
        ];
        const worldCorners: Array<[number, number]> = corners.map(([x, y]) => [
          a * x + c * y + e,
          b * x + d * y + f,
        ]);
        const minX = Math.min(...worldCorners.map(([x]) => x));
        const minY = Math.min(...worldCorners.map(([, y]) => y));
        const maxX = Math.max(...worldCorners.map(([x]) => x));
        const maxY = Math.max(...worldCorners.map(([, y]) => y));
        const [expL, expT, expR, expB] = totalEffectExpansion(smartFilters);
        const width = Math.max(1, maxX - minX + expL + expR);
        const height = Math.max(1, maxY - minY + expT + expB);
        const renderScale = Math.max(
          1,
          Math.hypot(target.getTransform().a, target.getTransform().b),
        );
        let surface: CompositeCanvas;
        try {
          surface = new CompositeCanvas({
            width,
            height,
            devicePixelRatio: renderScale,
            testCanvas: document.createElement('canvas'),
          });
        } catch {
          // A missing intermediate surface must not hide the source content.
          replayChildren(nodeId, target);
          return;
        }

        const surfaceContext = surface.ctx;
        surfaceContext.save();
        surfaceContext.translate(-minX + expL, -minY + expT);
        if (node.clipContent !== false) {
          surfaceContext.beginPath();
          surfaceContext.moveTo(a * 0 + c * 0 + e, b * 0 + d * 0 + f);
          surfaceContext.lineTo(a * node.w + c * 0 + e, b * node.w + d * 0 + f);
          surfaceContext.lineTo(a * node.w + c * node.h + e, b * node.w + d * node.h + f);
          surfaceContext.lineTo(a * 0 + c * node.h + e, b * 0 + d * node.h + f);
          surfaceContext.closePath();
          surfaceContext.clip();
        }
        replayChildren(nodeId, surfaceContext as unknown as SceneContext);
        surfaceContext.restore();
        applyFilterWithCompositing(
          surfaceContext as unknown as CanvasRenderingContext2D,
          smartFilters,
          surface.width,
          surface.height,
        );

        target.save();
        try {
          target.globalAlpha = node.opacity ?? 1;
          target.globalCompositeOperation =
            node.blendMode && node.blendMode !== 'passThrough'
              ? (mapBlendMode(node.blendMode) as GlobalCompositeOperation)
              : 'source-over';
          target.drawImage(
            surface.canvas as CanvasImageSource,
            minX - expL,
            minY - expT,
            width,
            height,
          );
        } finally {
          target.restore();
        }
        return;
      }

      if (node.clipContent === false) {
        replayChildren(nodeId, target);
        return;
      }
      const transform = item?.transform ?? nodeWorldTransform(input.document, nodeId);
      const [a, b, c, d, e, f] = transform;
      target.save();
      try {
        target.beginPath();
        target.moveTo(e, f);
        target.lineTo(a * node.w + e, b * node.w + f);
        target.lineTo(a * node.w + c * node.h + e, b * node.w + d * node.h + f);
        target.lineTo(c * node.h + e, d * node.h + f);
        target.closePath();
        target.clip();
        replayChildren(nodeId, target);
      } finally {
        target.restore();
      }
      return;
    }

    if (node.kind === 'group') {
      const blendMode = node.blendMode ?? 'passThrough';
      const smartFilters = adjustmentsToFilters(activeSmartFilters(node));
      const needsIsolation =
        node.isolated === true ||
        (blendMode !== 'normal' && blendMode !== 'passThrough') ||
        (node.opacity ?? 1) < 1 ||
        smartFilters.length > 0;
      const visibleEffects = (node.effects ?? []).filter((effect) => effect.visible);
      if ((needsIsolation || visibleEffects.length > 0) && node.children.length > 0) {
        const gopacity = node.opacity ?? 1;

        // Flatten the subtree to a bounded surface so group-level effects can
        // shadow the composited silhouette (matching the live canvas).
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const childId of node.children) {
          const childItem = itemById.get(childId);
          if (!childItem) continue;
          const childBounds = primitiveBounds(childItem.primitive);
          const t = childItem.transform ?? nodeWorldTransform(input.document, childId);
          const a = t[0];
          const b = t[1];
          const c = t[2];
          const d = t[3];
          const e = t[4];
          const f = t[5];
          const corners: Array<[number, number]> = [
            [childBounds.x, childBounds.y],
            [childBounds.x + childBounds.w, childBounds.y],
            [childBounds.x, childBounds.y + childBounds.h],
            [childBounds.x + childBounds.w, childBounds.y + childBounds.h],
          ];
          for (const corner of corners) {
            const wx = a * corner[0] + c * corner[1] + e;
            const wy = b * corner[0] + d * corner[1] + f;
            minX = Math.min(minX, wx);
            minY = Math.min(minY, wy);
            maxX = Math.max(maxX, wx);
            maxY = Math.max(maxY, wy);
          }
        }
        if (Number.isFinite(minX)) {
          const padding = subtreeEffectPadding(input.document, node.children);
          const groupWidth = Math.max(1, maxX - minX + padding * 2);
          const groupHeight = Math.max(1, maxY - minY + padding * 2);
          const m = target.getTransform();
          const renderScale = Math.max(1, Math.hypot(m.a, m.b));
          let gCanvas: CompositeCanvas;
          try {
            gCanvas = new CompositeCanvas({
              width: groupWidth,
              height: groupHeight,
              devicePixelRatio: renderScale,
              testCanvas: document.createElement('canvas'),
            });
          } catch {
            replayChildren(nodeId, target);
            return;
          }
          const gCtx = gCanvas.ctx;
          gCtx.save();
          gCtx.translate(-minX + padding, -minY + padding);
          replayChildren(nodeId, gCtx as unknown as SceneContext);
          gCtx.restore();

          // A container Object Filter evaluates the fully composited subtree,
          // before the node's outer effects and parent opacity/blend. This is
          // intentionally separate from adjustment-layer backdrop capture.
          if (smartFilters.length > 0) {
            applyFilterWithCompositing(
              gCtx as unknown as CanvasRenderingContext2D,
              smartFilters,
              gCanvas.width,
              gCanvas.height,
            );
          }

          const dx = minX - padding;
          const dy = minY - padding;
          for (const effect of visibleEffects) {
            if (effect.type === 'dropShadow' || effect.type === 'outerGlow') {
              compositeGroupOuterEffect(
                target,
                effect,
                gCanvas,
                renderScale,
                dx,
                dy,
                groupWidth,
                groupHeight,
                gopacity,
              );
            }
          }
          for (const effect of visibleEffects) {
            if (effect.type === 'innerShadow') {
              applyGroupInsetEffect(effect, gCanvas, renderScale, 'shadow');
            } else if (effect.type === 'innerGlow') {
              applyGroupInsetEffect(effect, gCanvas, renderScale, 'glow');
            }
          }

          target.save();
          if (blendMode !== 'passThrough') {
            target.globalCompositeOperation = mapBlendMode(blendMode) as GlobalCompositeOperation;
          }
          target.globalAlpha = gopacity;
          const layerBlur = visibleEffects.find((effect) => effect.type === 'layerBlur');
          if (layerBlur && layerBlur.type === 'layerBlur' && layerBlur.radius > 0) {
            applyLayerBlur(
              target as unknown as {
                drawImage?: (
                  src: CanvasImageSource,
                  dx: number,
                  dy: number,
                  dw: number,
                  dh: number,
                ) => void;
                save?: () => void;
                restore?: () => void;
                filter?: string;
              },
              gCanvas,
              layerBlur.radius,
              dx,
              dy,
              groupWidth,
              groupHeight,
            );
          } else {
            target.drawImage(
              gCanvas.canvas as unknown as CanvasImageSource,
              0,
              0,
              gCanvas.canvas.width,
              gCanvas.canvas.height,
              dx,
              dy,
              groupWidth,
              groupHeight,
            );
          }
          target.restore();
          return;
        }
      }
      if (needsIsolation) {
        compositeIsolated(
          target,
          (isolated) => replayChildren(nodeId, isolated),
          node.opacity ?? 1,
          blendMode === 'passThrough' ? 'normal' : blendMode,
        );
      } else {
        replayChildren(nodeId, target);
      }
      return;
    }

    if (node.kind === 'adjustment') {
      // Adjustments paint no pixels of their own — they filter the backdrop
      // behind their scope targets. Mirrors the live canvas adjustment
      // replay (CanvasArea.tsx): resolve the scope, capture the region of
      // the canvas behind the targets (padded by effect expansion), filter
      // it, optionally apply the adjustment's own spatial mask, and
      // composite the result back with the adjustment's opacity/blend mode.
      const adjNode = node as import('@varve/scene').AdjustmentNode;
      const adjFilters = adjustmentsToFilters(adjNode.adjustments ?? []);
      if (adjFilters.length === 0) return;

      const scope = adjNode.scope;
      let targetIds: NodeId[];
      if (scope) {
        targetIds = resolveAdjustmentScope(input.document, scope, nodeId);
      } else {
        // Legacy (no scope): retain the historical sibling-below behavior
        // through the central resolver rather than replaying every flattened
        // node into the adjustment surface.
        targetIds = resolveAdjustmentScope(input.document, undefined, nodeId);
      }
      if (targetIds.length === 0) return;

      const cw = target.canvas.width;
      const ch = target.canvas.height;
      if (cw === 0 || ch === 0) return;

      // Union the world bounds of every target's rendered subtree (items are
      // world-transformed by flattenSceneToEngine, so primitiveBounds +
      // item.transform yields device-space corners — same construction the
      // group flatten path uses).
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const subtreeIds = new Set<NodeId>();
      const collectSubtree = (id: NodeId): void => {
        if (subtreeIds.has(id)) return;
        subtreeIds.add(id);
        const n = input.document.nodes[id];
        if (n && 'children' in n) {
          for (const childId of n.children) collectSubtree(childId);
        }
      };
      for (const tid of targetIds) collectSubtree(tid);
      for (const id of subtreeIds) {
        const childItem = itemById.get(id);
        if (!childItem) continue;
        const childBounds = primitiveBounds(childItem.primitive);
        if (childBounds.w <= 0 && childBounds.h <= 0) continue;
        const t = childItem.transform ?? nodeWorldTransform(input.document, id);
        const a = t[0];
        const b = t[1];
        const c = t[2];
        const d = t[3];
        const e = t[4];
        const f = t[5];
        const corners: Array<[number, number]> = [
          [childBounds.x, childBounds.y],
          [childBounds.x + childBounds.w, childBounds.y],
          [childBounds.x, childBounds.y + childBounds.h],
          [childBounds.x + childBounds.w, childBounds.y + childBounds.h],
        ];
        for (const corner of corners) {
          const wx = a * corner[0] + c * corner[1] + e;
          const wy = b * corner[0] + d * corner[1] + f;
          minX = Math.min(minX, wx);
          minY = Math.min(minY, wy);
          maxX = Math.max(maxX, wx);
          maxY = Math.max(maxY, wy);
        }
      }
      if (!Number.isFinite(minX)) return;

      // Effect expansion pads the backdrop so bloom/streak pixels are not
      // clipped at the region rectangle. Export uses the full, uncapped
      // expansion (the live preview caps at 512 px for memory safety).
      const cam = target.getTransform();
      const camScale = Math.abs(cam.a) || 1;
      let effectPad = 80;
      try {
        const [expL, expT, expR, expB] = totalEffectExpansion(adjFilters);
        effectPad = Math.max(80, Math.ceil(Math.max(expL, expT, expR, expB) * camScale));
      } catch {
        effectPad = 80;
      }
      const devMinX = minX * camScale + cam.e;
      const devMinY = minY * camScale + cam.f;
      const devW = (maxX - minX) * camScale;
      const devH = (maxY - minY) * camScale;
      let bx = devMinX - effectPad;
      let by = devMinY - effectPad;
      let bw = devW + effectPad * 2;
      let bh = devH + effectPad * 2;
      if (bw <= 0 || bh <= 0) return;

      const coordSpace = {
        scale: camScale,
        originX: cam.e,
        originY: cam.f,
        regionX: bx,
        regionY: by,
      };

      let backdrop: ReturnType<typeof createRasterSurface>;
      try {
        backdrop = createRasterSurface(Math.ceil(bw), Math.ceil(bh));
        const bCtx = backdrop.context;
        // Build the filter input from the resolved target set. Capturing the
        // whole export surface would let an explicit adjustment scope process
        // unrelated pixels that happen to share the target bounds.
        const camera = target.getTransform();
        const targetSurface = acquireMaskSurface(cw, ch);
        try {
          const targetSurfaceCtx = targetSurface.getContext('2d');
          if (!targetSurfaceCtx) return;
          targetSurfaceCtx.setTransform(camera.a, camera.b, camera.c, camera.d, camera.e, camera.f);
          for (const targetId of targetIds) {
            replayNode(targetId, targetSurfaceCtx as unknown as SceneContext);
          }
          const actual = alphaBounds(targetSurfaceCtx, targetSurface.width, targetSurface.height);
          if (actual) {
            bx = actual.x - effectPad;
            by = actual.y - effectPad;
            bw = actual.w + effectPad * 2;
            bh = actual.h + effectPad * 2;
            coordSpace.regionX = bx;
            coordSpace.regionY = by;
          }
          bCtx.setTransform(1, 0, 0, 1, 0, 0);
          bCtx.translate(-bx, -by);
          bCtx.drawImage(targetSurface, 0, 0);
        } finally {
          releaseMaskSurface(targetSurface);
        }
      } catch {
        return;
      }

      const bCtx = backdrop.context;
      applyFilterWithCompositing(
        bCtx as CanvasRenderingContext2D,
        adjFilters,
        backdrop.canvas.width,
        backdrop.canvas.height,
        { coordSpace },
      );

      // Spatial mask: limits WHERE the adjustment result is visible (scope
      // limits WHAT content is processed). Applied to the filtered backdrop
      // in place — transparent mask regions keep the original backdrop, so
      // the unfiltered content shows through. Parity with the live canvas.
      const adjMask = adjNode.mask && adjNode.mask.visible !== false ? adjNode.mask : null;
      if (adjMask) {
        const adjMaskSrcId = adjMask.sourceNodeId;
        const adjMaskSource = adjMaskSrcId ? input.document.nodes[adjMaskSrcId] : undefined;
        const adjMaskHasVector = !!adjMask.vectorMask && adjMask.vectorMask.points.length > 0;
        const adjMaskUsable =
          adjMaskHasVector ||
          (adjMaskSrcId !== undefined &&
            adjMaskSource !== undefined &&
            adjMaskSource.kind !== 'adjustment');
        if (adjMaskUsable) {
          const adjMaskWorldTransform = adjMaskSrcId
            ? adjMask.linked !== false
              ? nodeWorldTransform(input.document, adjMaskSrcId)
              : (adjMask.transform ?? nodeWorldTransform(input.document, adjMaskSrcId))
            : (adjMask.transform ?? ([1, 0, 0, 1, 0, 0] as const));
          const traceAdjMaskPath = (ctx: SceneContext): void => {
            if (adjMaskHasVector && adjMask.vectorMask) {
              const points = adjMask.vectorMask.points;
              if (points.length > 0) {
                ctx.beginPath();
                ctx.moveTo(points[0]!.x, points[0]!.y);
                for (let i = 1; i < points.length; i++) {
                  const p = points[i]!;
                  const prev = points[i - 1]!;
                  if (p.handleIn || p.handleOut) {
                    ctx.bezierCurveTo(
                      prev.handleOut?.[0] ?? prev.x,
                      prev.handleOut?.[1] ?? prev.y,
                      p.handleIn?.[0] ?? p.x,
                      p.handleIn?.[1] ?? p.y,
                      p.x,
                      p.y,
                    );
                  } else {
                    ctx.lineTo(p.x, p.y);
                  }
                }
                if (adjMask.vectorMask.closed) ctx.closePath();
              }
            } else if (adjMaskSrcId && adjMaskSource) {
              ctx.beginPath();
              traceSceneNodeOutline(
                ctx as CanvasRenderingContext2D,
                adjMaskSource as unknown as Parameters<typeof traceSceneNodeOutline>[1],
              );
              ctx.closePath();
            }
          };
          const hardClip =
            adjMask.type === 'clip' &&
            adjMask.inverted !== true &&
            (adjMask.feather ?? 0) <= 0 &&
            (adjMask.density ?? 1) >= 1;
          bCtx.save();
          bCtx.setTransform(1, 0, 0, 1, 0, 0);
          if (hardClip) {
            bCtx.globalCompositeOperation = 'destination-in';
            if (adjMaskHasVector) {
              bCtx.transform(...adjMaskWorldTransform);
              traceAdjMaskPath(bCtx);
              bCtx.fillStyle = 'rgba(255,255,255,1)';
              bCtx.fill(adjMask.vectorMask!.fillRule ?? 'nonzero');
            } else if (adjMaskSrcId) {
              bCtx.transform(cam.a, cam.b, cam.c, cam.d, cam.e, cam.f);
              bCtx.transform(...adjMaskWorldTransform);
              traceAdjMaskPath(bCtx);
              bCtx.fillStyle = 'rgba(255,255,255,1)';
              bCtx.fill(adjMask.fillRule ?? 'nonzero');
            }
          } else {
            applyMaskAlpha(
              bCtx as CanvasRenderingContext2D,
              (maskCtx) => {
                if (adjMaskHasVector && adjMask.vectorMask) {
                  maskCtx.transform(...adjMaskWorldTransform);
                  traceAdjMaskPath(maskCtx);
                  maskCtx.fillStyle = 'rgba(255,255,255,1)';
                  maskCtx.fill(adjMask.vectorMask.fillRule ?? 'nonzero');
                } else if (adjMaskSrcId) {
                  maskCtx.setTransform(cam.a, cam.b, cam.c, cam.d, cam.e, cam.f);
                  replayNode(adjMaskSrcId, maskCtx);
                }
              },
              {
                luminance: adjMask.type === 'luminance',
                inverted: adjMask.inverted === true,
                feather: adjMask.feather,
                density: adjMask.density,
              },
            );
          }
          bCtx.restore();
        }
      }

      target.save();
      try {
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.globalAlpha = adjNode.opacity ?? 1;
        const adjBm = adjNode.blendMode ?? 'normal';
        if (adjBm !== 'normal') {
          target.globalCompositeOperation = mapBlendMode(adjBm) as GlobalCompositeOperation;
        }
        target.drawImage(
          backdrop.canvas as CanvasImageSource,
          0,
          0,
          backdrop.canvas.width,
          backdrop.canvas.height,
          bx,
          by,
          bw,
          bh,
        );
      } finally {
        target.restore();
      }
      return;
    }

    if (item) replayIr(target as unknown as ReplayTarget, [item], undefined, resolveEffectMask);
  };

  for (const rootId of input.rootIds) replayNode(rootId, context);
}
