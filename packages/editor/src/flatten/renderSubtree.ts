/**
 * Subtree rasterization — renders a set of scene nodes to a raster surface
 * using the same IR-replay pipeline as the live canvas. Lives in the editor
 * package because it needs both scene (node transforms) and engine (canvas
 * rendering) — importing scene from engine would be circular.
 *
 * Research basis: ADR-0001 IR-replay; offscreen canvas compositing.
 */

import {
  applyRasterizationTransform,
  createRasterSurface,
  encodeRasterSurface,
  fitRasterDimensions,
  type RasterSurface,
} from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import {
  computeFlattenBounds,
  createEmbeddedAsset,
  findCommonAncestor,
  nodeWorldTransform,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { resolveFlattenRasterDimensions } from './resolution';
import type { FlattenOptions, FlattenResult, FlattenWarning } from './types';

const MAX_FLATTEN_DIMENSION = 16_384;
const MAX_FLATTEN_PIXELS = 33_554_432;

/**
 * Flatten a set of nodes to a raster image.
 */
export async function flattenNodes(
  doc: Document,
  nodeIds: readonly NodeId[],
  options: FlattenOptions,
): Promise<FlattenResult> {
  const warnings: FlattenWarning[] = [];
  const mode = options.mode;

  if (options.signal?.aborted) {
    throw new Error('Flatten operation was cancelled');
  }

  options.onProgress?.('bounds', 0);

  const sourceBounds = computeFlattenBounds(doc, nodeIds, options.includeEffectOverflow !== false);

  if (!sourceBounds) {
    throw new Error('Cannot compute bounds for flatten: no valid nodes');
  }

  options.onProgress?.('bounds', 1);

  const cssW = sourceBounds.w;
  const cssH = sourceBounds.h;
  const resolved = resolveFlattenRasterDimensions(cssW, cssH, options);
  const requestedPixelW = resolved.requestedPixelWidth;
  const requestedPixelH = resolved.requestedPixelHeight;

  const fitted = fitRasterDimensions(requestedPixelW, requestedPixelH, {
    maxDimension: MAX_FLATTEN_DIMENSION,
    maxPixels: MAX_FLATTEN_PIXELS,
  });

  const pixelW = fitted.width;
  const pixelH = fitted.height;

  if (fitted.constrainedBy.length > 0) {
    warnings.push({
      code: 'resolution-constrained',
      message: `Output constrained by ${fitted.constrainedBy.join(', ')}. Requested ${requestedPixelW}×${requestedPixelH}, got ${pixelW}×${pixelH}.`,
      severity: 'warning',
    });
  }

  options.onProgress?.('render', 0);

  if (options.signal?.aborted) {
    throw new Error('Flatten operation was cancelled');
  }

  const surface = createRasterSurface(pixelW, pixelH);

  const bg = options.backgroundColor;
  if (options.background === 'opaque' && bg && bg[3] > 0) {
    surface.context.save();
    surface.context.setTransform(1, 0, 0, 1, 0, 0);
    surface.context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`;
    surface.context.fillRect(0, 0, pixelW, pixelH);
    surface.context.restore();
  }

  surface.context.save();
  // The target dimensions are independently rounded. Map the source bounds
  // onto the allocated raster extent exactly instead of deriving one scale
  // from width and accidentally leaving a bottom/right seam.
  applyRasterizationTransform(
    surface.context,
    {
      x: sourceBounds.x,
      y: sourceBounds.y,
      width: cssW,
      height: cssH,
    },
    { width: pixelW, height: pixelH },
  );

  for (const nodeId of nodeIds) {
    if (options.signal?.aborted) {
      surface.context.restore();
      throw new Error('Flatten operation was cancelled');
    }
    renderNodeToContext(surface, doc, nodeId, mode, warnings);
  }

  surface.context.restore();

  options.onProgress?.('render', 1);
  options.onProgress?.('encode', 0);

  const blob = await encodeRasterSurface(surface, 'image/png');
  const dataUrl = await blobToDataUrl(blob);

  options.onProgress?.('encode', 1);

  const asset = createEmbeddedAsset({
    dataUrl,
    mimeType: 'image/png',
    naturalWidth: pixelW,
    naturalHeight: pixelH,
  });

  const commonAncestor = findCommonAncestor(doc, nodeIds);
  let placement: { dx: number; dy: number } = { dx: sourceBounds.x, dy: sourceBounds.y };

  if (commonAncestor) {
    const ancestorNode = doc.nodes[commonAncestor];
    if (ancestorNode) {
      const inv = invertAffine(ancestorNode.transform as Affine);
      if (inv) {
        const local = applyAffineLocal(inv, [sourceBounds.x, sourceBounds.y]);
        placement = { dx: local[0], dy: local[1] };
      }
    }
  }

  return {
    dataUrl,
    pixelWidth: pixelW,
    pixelHeight: pixelH,
    cssWidth: cssW,
    cssHeight: cssH,
    sourceBounds,
    outputBounds: { x: 0, y: 0, w: pixelW, h: pixelH },
    assetId: asset.id,
    placement,
    warnings,
    flattenedNodeIds: [...nodeIds],
  };
}

function renderNodeToContext(
  surface: RasterSurface,
  doc: Document,
  nodeId: NodeId,
  mode: string,
  warnings: FlattenWarning[],
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if (node.visible === false) return;

  if (node.kind === 'group' || node.kind === 'frame') {
    for (const childId of node.children) {
      renderNodeToContext(surface, doc, childId, mode, warnings);
    }
    return;
  }

  if (node.kind === 'adjustment') {
    warnings.push({
      code: 'adjustment-skipped',
      message: `Adjustment layer "${node.name}" included via rendered appearance.`,
      nodeId,
      severity: 'info',
    });
    return;
  }

  surface.context.save();

  const worldTransform = nodeWorldTransform(doc, nodeId);
  surface.context.transform(
    worldTransform[0],
    worldTransform[1],
    worldTransform[2],
    worldTransform[3],
    worldTransform[4],
    worldTransform[5],
  );

  if (node.kind === 'shape') {
    renderShapeNode(surface, node as import('@varve/scene').ShapeNode);
  } else if (node.kind === 'text') {
    renderTextNode(surface, node as import('@varve/scene').TextNode, warnings, nodeId);
  }

  surface.context.restore();
}

function renderShapeNode(surface: RasterSurface, node: import('@varve/scene').ShapeNode): void {
  const ctx = surface.context;
  const shape = node.shape;
  const fills = node.fills ?? [];
  const fillColor = fills[0];

  ctx.beginPath();
  switch (shape.kind) {
    case 'rect':
      ctx.rect(shape.x, shape.y, shape.w, shape.h);
      break;
    case 'ellipse':
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
      break;
    case 'circle':
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      break;
    case 'line':
    case 'arrow':
      ctx.moveTo(shape.from[0], shape.from[1]);
      ctx.lineTo(shape.to[0], shape.to[1]);
      break;
    case 'polygon':
    case 'star': {
      const sides = shape.kind === 'polygon' ? shape.sides : shape.points * 2;
      const getRadius = (i: number): number => {
        if (shape.kind === 'polygon') return shape.radius;
        return i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
      };
      const rotation = shape.rotation ?? 0;
      if (sides > 0) {
        const a0 = -Math.PI / 2 + rotation;
        const r0 = getRadius(0);
        ctx.moveTo(shape.cx + r0 * Math.cos(a0), shape.cy + r0 * Math.sin(a0));
        for (let i = 1; i < sides; i++) {
          const a = (Math.PI * 2 * i) / sides - Math.PI / 2 + rotation;
          const r = getRadius(i);
          ctx.lineTo(shape.cx + r * Math.cos(a), shape.cy + r * Math.sin(a));
        }
        ctx.closePath();
      }
      break;
    }
    case 'path':
      if (shape.points.length > 0) {
        const first = shape.points[0]!;
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < shape.points.length; i++) {
          const prev = shape.points[i - 1]!;
          const curr = shape.points[i]!;
          if (prev.handleOut || curr.handleIn) {
            ctx.bezierCurveTo(
              prev.x + (prev.handleOut?.[0] ?? 0),
              prev.y + (prev.handleOut?.[1] ?? 0),
              curr.x + (curr.handleIn?.[0] ?? 0),
              curr.y + (curr.handleIn?.[1] ?? 0),
              curr.x,
              curr.y,
            );
          } else {
            ctx.lineTo(curr.x, curr.y);
          }
        }
        if (shape.closed) ctx.closePath();
      }
      break;
  }

  if (fillColor?.type === 'solid') {
    const c = fillColor.color as { r: number; g: number; b: number; a: number };
    ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${(c.a ?? 255) / 255})`;
    if (shape.kind === 'line' || shape.kind === 'arrow') {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fill();
  }
}

function renderTextNode(
  surface: RasterSurface,
  node: import('@varve/scene').TextNode,
  _warnings: FlattenWarning[],
  _nodeId: NodeId,
): void {
  const ctx = surface.context;
  const text = node.text ?? '';
  const fontSize = node.fontSize ?? 16;
  const fontFamily = node.fontFamily ?? 'sans-serif';

  ctx.font = `${node.fontWeight ?? 400} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  const fills = node.fills ?? [];
  const fillColor = fills[0];
  if (fillColor?.type === 'solid') {
    const c = fillColor.color as { r: number; g: number; b: number; a: number };
    ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${(c.a ?? 255) / 255})`;
  } else {
    ctx.fillStyle = '#000000';
  }

  ctx.fillText(text, 0, 0);
}

function invertAffine(affine: Affine): Affine | null {
  const [a, b, c, d, e, f] = affine;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * f - d * e) * invDet,
    (b * e - a * f) * invDet,
  ];
}

function applyAffineLocal(affine: Affine, point: readonly [number, number]): [number, number] {
  return [
    affine[0] * point[0] + affine[2] * point[1] + affine[4],
    affine[1] * point[0] + affine[3] * point[1] + affine[5],
  ];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to encode flattened image'));
    reader.readAsDataURL(blob);
  });
}
