/**
 * Compatibility adapter for the editor's historical line-only callers.
 * Canonical geometry lives in @varve/scene so rendering and snapping can use
 * the richer segment/region contract without duplicating arithmetic here.
 */
import type { LayoutGrid } from '@varve/scene';
import { resolveLayoutGuideGeometry as resolveCanonicalLayoutGuideGeometry } from '@varve/scene';

export interface LayoutGuideGeometry {
  vertical: number[];
  horizontal: number[];
  valid: boolean;
  reason?: string;
}

export { resolveCanonicalLayoutGuideGeometry };

/** Resolve line coordinates for legacy editor consumers and existing tests. */
export function resolveLayoutGuideGeometry(
  grid: LayoutGrid,
  frameWidth: number,
  frameHeight: number,
): LayoutGuideGeometry {
  const resolved = resolveCanonicalLayoutGuideGeometry(grid, frameWidth, frameHeight);
  if (!resolved.valid) {
    return {
      vertical: [],
      horizontal: [],
      valid: false,
      reason: resolved.issues[0]?.message ?? 'Invalid layout guide geometry.',
    };
  }
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (const segment of resolved.segments) {
    const value = segment.axis === 'vertical' ? segment.start.x : segment.start.y;
    const lines = segment.axis === 'vertical' ? vertical : horizontal;
    if (!lines.some((entry) => Math.abs(entry - value) < 1e-6)) lines.push(value);
  }
  return { vertical, horizontal, valid: true };
}
