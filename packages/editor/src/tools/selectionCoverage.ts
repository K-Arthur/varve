import {
  type AreaSelection,
  applyAffine,
  areaSelectionBounds,
  areaSelectionCoverageAt,
} from '@varve/engine';
import { type BrushDab, type CoverageMask, makeCoverageMask } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { tryInvertAffine } from '@varve/shared';
import type { ToolContext } from './types';

const MAX_RASTER_SELECTION_PIXELS = 16_777_216;

/**
 * Convert a bounded brush dab from document-space selection coverage into the
 * target raster layer's local pixel space. The mask is deliberately limited
 * to the dab bounds, so a large document selection never allocates a full
 * canvas bitmap for a single stroke.
 */
export function selectionCoverageForDab(
  ctx: Pick<ToolContext, 'areaSelection' | 'getWorldTransform'>,
  nodeId: string,
  dab: Pick<BrushDab, 'x' | 'y' | 'radius'>,
  selection: AreaSelection | null | undefined = ctx.areaSelection,
): CoverageMask | null {
  if (!selection || !Number.isFinite(dab.radius) || dab.radius <= 0) return null;

  const x = Math.floor(dab.x - dab.radius);
  const y = Math.floor(dab.y - dab.radius);
  const width = Math.max(0, Math.ceil(dab.x + dab.radius) - x);
  const height = Math.max(0, Math.ceil(dab.y + dab.radius) - y);
  const mask = makeCoverageMask(x, y, width, height);
  if (mask.width === 0 || mask.height === 0) return mask;

  const worldTransform = ctx.getWorldTransform?.(nodeId);
  const antialias = expressionUsesAntialias(selection.expression);
  for (let row = 0; row < mask.height; row++) {
    for (let col = 0; col < mask.width; col++) {
      const sample = (offsetX: number, offsetY: number): number => {
        const localPoint = { x: x + col + offsetX, y: y + row + offsetY };
        const transformed = worldTransform
          ? applyAffine(worldTransform, [localPoint.x, localPoint.y])
          : [localPoint.x, localPoint.y];
        const point = { x: transformed[0], y: transformed[1] };
        return areaSelectionCoverageAt(selection, point);
      };
      const coverage = antialias
        ? (sample(0.25, 0.25) + sample(0.75, 0.25) + sample(0.25, 0.75) + sample(0.75, 0.75)) / 4
        : sample(0.5, 0.5);
      mask.data[row * mask.width + col] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
    }
  }
  return mask;
}

/**
 * Rasterise a document-space selection only over the affected portion of a
 * raster layer.  The result stays in that layer's local pixel coordinates so
 * the canonical tile compositor can apply it without changing the selection
 * model or allocating a full document-sized canvas.
 */
export function selectionCoverageForRasterNode(
  selection: AreaSelection,
  dimensions: { width: number; height: number },
  worldTransform: Affine = [1, 0, 0, 1, 0, 0],
): CoverageMask | null {
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return null;
  }
  const inverse = tryInvertAffine(worldTransform);
  if (!inverse) return null;

  const bounds = areaSelectionBounds(selection.expression);
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
  const corners = [
    applyAffine(inverse, [bounds.x, bounds.y]),
    applyAffine(inverse, [bounds.x + bounds.w, bounds.y]),
    applyAffine(inverse, [bounds.x, bounds.y + bounds.h]),
    applyAffine(inverse, [bounds.x + bounds.w, bounds.y + bounds.h]),
  ];
  const x = Math.max(0, Math.floor(Math.min(...corners.map(([px]) => px))));
  const y = Math.max(0, Math.floor(Math.min(...corners.map(([, py]) => py))));
  const maxX = Math.min(dimensions.width, Math.ceil(Math.max(...corners.map(([px]) => px))));
  const maxY = Math.min(dimensions.height, Math.ceil(Math.max(...corners.map(([, py]) => py))));
  const width = maxX - x;
  const height = maxY - y;
  if (width <= 0 || height <= 0 || width * height > MAX_RASTER_SELECTION_PIXELS) return null;

  const mask = makeCoverageMask(x, y, width, height);
  const antialias = expressionUsesAntialias(selection.expression);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const sample = (offsetX: number, offsetY: number): number => {
        const world = applyAffine(worldTransform, [x + col + offsetX, y + row + offsetY]);
        return areaSelectionCoverageAt(selection, { x: world[0], y: world[1] });
      };
      const coverage = antialias
        ? (sample(0.25, 0.25) + sample(0.75, 0.25) + sample(0.25, 0.75) + sample(0.75, 0.75)) / 4
        : sample(0.5, 0.5);
      mask.data[row * width + col] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
    }
  }
  return mask;
}

function expressionUsesAntialias(expression: AreaSelection['expression']): boolean {
  if (expression.kind === 'shape') return expression.shape.antialias;
  return expressionUsesAntialias(expression.left) || expressionUsesAntialias(expression.right);
}
