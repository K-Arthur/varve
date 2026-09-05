/**
 * Path helpers for compound rings (outer + holes) with Canvas/SVG fill rules.
 */

import type { PathPoint } from './types';

export type FillRule = 'nonzero' | 'evenodd';

export interface PathShapeLike {
  kind: 'path';
  points: PathPoint[];
  closed: boolean;
  tolerance: number;
  /** Canonical compound-path rings in authored order (outer first). */
  contours?: PathPoint[][];
  /** Additional closed rings retained for legacy documents. */
  holes?: PathPoint[][];
  fillRule?: FillRule;
}

/** Rings to draw: outer first, then holes. */
export function pathRings(shape: PathShapeLike): PathPoint[][] {
  if (shape.contours?.length) {
    return shape.contours.filter((ring) => ring.length >= 2);
  }
  const rings = [shape.points];
  if (shape.holes?.length) rings.push(...shape.holes);
  return rings.filter((ring) => ring.length >= 2);
}

export function pathFillRule(shape: PathShapeLike): FillRule {
  if (shape.fillRule) return shape.fillRule;
  if (shape.contours && shape.contours.length > 1) return 'evenodd';
  return shape.holes && shape.holes.length > 0 ? 'evenodd' : 'nonzero';
}
