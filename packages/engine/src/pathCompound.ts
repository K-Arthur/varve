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
  /** Additional closed rings treated as holes when fillRule is evenodd. */
  holes?: PathPoint[][];
  fillRule?: FillRule;
}

/** Rings to draw: outer first, then holes. */
export function pathRings(shape: PathShapeLike): PathPoint[][] {
  const rings = [shape.points];
  if (shape.holes?.length) rings.push(...shape.holes);
  return rings.filter((ring) => ring.length >= 2);
}

export function pathFillRule(shape: PathShapeLike): FillRule {
  if (shape.fillRule) return shape.fillRule;
  return shape.holes && shape.holes.length > 0 ? 'evenodd' : 'nonzero';
}
