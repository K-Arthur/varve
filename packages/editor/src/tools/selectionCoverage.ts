import { type AreaSelection, applyAffine, areaSelectionCoverageAt } from '@varve/engine';
import { type BrushDab, type CoverageMask, makeCoverageMask } from '@varve/scene';
import type { ToolContext } from './types';

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

function expressionUsesAntialias(expression: AreaSelection['expression']): boolean {
  if (expression.kind === 'shape') return expression.shape.antialias;
  return expressionUsesAntialias(expression.left) || expressionUsesAntialias(expression.right);
}
