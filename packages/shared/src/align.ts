/**
 * Axis-aligned alignment and distribution for 2D bounding boxes.
 *
 * Pure functions — no React, no editor context, no world transforms.
 * Operates entirely on bounding-box math.
 *
 * Research basis: Figma align/distribute, Sketch align/distribute,
 * Adobe Illustrator align panel.
 */

import { applyAffine } from './affine';

// ─── Types ────────────────────────────────────────────────────────────────

export type AlignAxis = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type DistributeMode = 'equalGap' | 'equalCenter';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 4 corners of an oriented bounding box: [topLeft, topRight, bottomRight, bottomLeft] */
export type OBB = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
];

export interface TidyLayoutResult {
  rows: number;
  cols: number;
  assignments: Array<[number, number]>;
  colWidth: number;
  rowHeight: number;
}

// ─── Core functions ───────────────────────────────────────────────────────

/** Union of multiple bboxes. Returns `null` if empty. */
export function bboxUnion(bboxes: BBox[]): BBox | null {
  if (bboxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bboxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export interface AlignmentTarget {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/**
 * Compute the target alignment frame from ≥2 bounding boxes.
 * Returns `null` if <2 items.
 */
export function computeAlignmentTarget(_axis: AlignAxis, bounds: BBox[]): AlignmentTarget | null {
  if (bounds.length < 2) return null;
  const u = bboxUnion(bounds);
  if (!u) return null;
  return {
    left: u.x,
    right: u.x + u.w,
    top: u.y,
    bottom: u.y + u.h,
    centerX: u.x + u.w / 2,
    centerY: u.y + u.h / 2,
  };
}

/**
 * Given a single bbox, alignment axis, and the target frame,
 * return the new (x, y) for the bbox's top-left corner.
 */
export function alignBBox(
  bbox: BBox,
  axis: AlignAxis,
  target: AlignmentTarget,
): { x: number; y: number } {
  let x = bbox.x;
  let y = bbox.y;
  switch (axis) {
    case 'left':
      x = target.left;
      break;
    case 'centerH':
      x = target.centerX - bbox.w / 2;
      break;
    case 'right':
      x = target.right - bbox.w;
      break;
    case 'top':
      y = target.top;
      break;
    case 'centerV':
      y = target.centerY - bbox.h / 2;
      break;
    case 'bottom':
      y = target.bottom - bbox.h;
      break;
  }
  return { x, y };
}

/**
 * Compute evenly-spaced distribution positions for ≥3 bounding boxes.
 *
 * If `fixedGap` is provided, items are placed with that exact gap between adjacent edges.
 * `fixedGap` is clamped to 0 for negative values (overlapping items produce zero-gap,
 * not a visually broken negative gap or NaN).
 *
 * Otherwise, gaps are computed to fill the span evenly. When the span is smaller than
 * the total content size (overlapping items), gap is 0 and the span is preserved.
 *
 * Returns array of positions (X for horizontal, Y for vertical) in sorted order,
 * or `null` if <3 items.
 */
export function computeDistribution(
  axis: DistributeAxis,
  bounds: BBox[],
  fixedGap?: number,
): number[] | null {
  if (bounds.length < 3) return null;

  const sorted = [...bounds].sort((a, b) => {
    const posA = axis === 'horizontal' ? a.x : a.y;
    const posB = axis === 'horizontal' ? b.x : b.y;
    return posA - posB;
  });

  const getPos = (b: BBox) => (axis === 'horizontal' ? b.x : b.y);
  const getSize = (b: BBox) => (axis === 'horizontal' ? b.w : b.h);

  const positions: number[] = [];

  if (fixedGap !== undefined) {
    const safeGap = Math.max(0, fixedGap);
    let cursor = getPos(sorted[0]!);
    for (let i = 0; i < sorted.length; i++) {
      positions.push(cursor);
      if (i < sorted.length - 1) {
        cursor += getSize(sorted[i]!) + safeGap;
      }
    }
    return positions;
  }

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const start = getPos(first);
  const end = getPos(last) + getSize(last);
  const totalSize = sorted.reduce((s, b) => s + getSize(b), 0);
  const gap = Math.max(0, (end - start - totalSize) / (sorted.length - 1));

  let cursor = start;
  for (let i = 0; i < sorted.length; i++) {
    positions.push(cursor);
    cursor += getSize(sorted[i]!) + gap;
  }
  return positions;
}

/**
 * Compute distribution positions using equal center-to-center spacing.
 *
 * Unlike `computeDistribution` (which spaces adjacent edges equally), this
 * spaces the centers of each object equally within the overall span.
 *
 * Returns array of center positions (X for horizontal, Y for vertical) in
 * sorted order, or `null` if <3 items.
 */
export function computeDistributionCenters(axis: DistributeAxis, bounds: BBox[]): number[] | null {
  if (bounds.length < 3) return null;

  const sorted = [...bounds].sort((a, b) => {
    const posA = axis === 'horizontal' ? a.x + a.w / 2 : a.y + a.h / 2;
    const posB = axis === 'horizontal' ? b.x + b.w / 2 : b.y + b.h / 2;
    return posA - posB;
  });

  const getCenter = (b: BBox) => (axis === 'horizontal' ? b.x + b.w / 2 : b.y + b.h / 2);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const startC = getCenter(first);
  const endC = getCenter(last);
  const totalSpan = endC - startC;
  const step = sorted.length > 1 ? totalSpan / (sorted.length - 1) : 0;

  const centers: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    centers.push(startC + step * i);
  }
  return centers;
}

/**
 * Compute 4 corners of an OBB given local rect `(0, 0, w, h)` transformed by affine.
 */
export function orientedBBox(
  affine: readonly [number, number, number, number, number, number],
  w: number,
  h: number,
): OBB {
  const tl = applyAffine(affine, [0, 0]);
  const tr = applyAffine(affine, [w, 0]);
  const br = applyAffine(affine, [w, h]);
  const bl = applyAffine(affine, [0, h]);
  return [tl, tr, br, bl];
}

/**
 * Convert OBB back to axis-aligned bbox (min/max of all 4 corners).
 */
export function obbToAABB(obb: OBB): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of obb) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Compute alignment position on a single axis using ALL 4 corners of each OBB.
 *
 * - `left`: minimum X across all corners
 * - `centerH`: average of all center X values
 * - `right`: maximum X
 * - `top`: minimum Y
 * - `centerV`: average of all center Y values
 * - `bottom`: maximum Y
 *
 * Returns `null` if empty array.
 */
export function obbAlignmentTarget(axis: AlignAxis, obbs: OBB[]): number | null {
  if (obbs.length === 0) return null;

  if (axis === 'left') {
    let min = Infinity;
    for (const obb of obbs) {
      for (const p of obb) {
        if (p[0] < min) min = p[0];
      }
    }
    return min;
  }

  if (axis === 'right') {
    let max = -Infinity;
    for (const obb of obbs) {
      for (const p of obb) {
        if (p[0] > max) max = p[0];
      }
    }
    return max;
  }

  if (axis === 'top') {
    let min = Infinity;
    for (const obb of obbs) {
      for (const p of obb) {
        if (p[1] < min) min = p[1];
      }
    }
    return min;
  }

  if (axis === 'bottom') {
    let max = -Infinity;
    for (const obb of obbs) {
      for (const p of obb) {
        if (p[1] > max) max = p[1];
      }
    }
    return max;
  }

  if (axis === 'centerH') {
    let sum = 0;
    let count = 0;
    for (const obb of obbs) {
      const cx = (obb[0][0] + obb[1][0] + obb[2][0] + obb[3][0]) / 4;
      sum += cx;
      count++;
    }
    return sum / count;
  }

  if (axis === 'centerV') {
    let sum = 0;
    let count = 0;
    for (const obb of obbs) {
      const cy = (obb[0][1] + obb[1][1] + obb[2][1] + obb[3][1]) / 4;
      sum += cy;
      count++;
    }
    return sum / count;
  }

  return null;
}

/**
 * Simple 2D proximity grid sort:
 * - Compute each item's center
 * - Average item height for row detection threshold
 * - Group into rows where center Y differences < average height
 * - Sort each row by X
 * - Assign grid positions, respecting maxCols
 * - Compute uniform cell size from max item in each cell
 */
export function computeTidyLayout(items: BBox[], maxCols: number): TidyLayoutResult {
  if (items.length === 0) {
    return { rows: 0, cols: 0, assignments: [], colWidth: 0, rowHeight: 0 };
  }

  // Compute centers
  const centers = items.map((b) => ({
    cx: b.x + b.w / 2,
    cy: b.y + b.h / 2,
    w: b.w,
    h: b.h,
  }));

  // Average height for row threshold
  const avgH = centers.reduce((s, c) => s + c.h, 0) / centers.length;
  const threshold = avgH * 0.8;

  // Index each item and sort by Y first, then X for tie-breaking (deterministic)
  const indexed = centers.map((c, i) => ({ ...c, idx: i }));
  const sortedByY = [...indexed].sort((a, b) => {
    const dy = a.cy - b.cy;
    if (Math.abs(dy) > 1e-9) return dy;
    return a.cx - b.cx;
  });

  // Group into rows
  const rows: Array<Array<{ idx: number; cx: number; cy: number; w: number; h: number }>> = [];
  for (const item of sortedByY) {
    let placed = false;
    for (const row of rows) {
      const rowCenterY = row.reduce((s, r) => s + r.cy, 0) / row.length;
      if (Math.abs(item.cy - rowCenterY) < threshold) {
        row.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([item]);
    }
  }

  // Sort each row by X
  for (const row of rows) {
    row.sort((a, b) => a.cx - b.cx);
  }

  // Assign grid positions, respecting maxCols
  const assignments: Array<[number, number]> = new Array(items.length);
  let gridRow = 0;
  for (const row of rows) {
    let gridCol = 0;
    for (const item of row) {
      assignments[item.idx] = [gridRow, gridCol];
      gridCol++;
      if (gridCol >= maxCols) {
        gridRow++;
        gridCol = 0;
      }
    }
    if (gridCol > 0) {
      gridRow++;
    }
  }

  // Compute uniform cell size and actual column count
  let maxW = 0;
  let maxH = 0;
  let actualCols = 0;
  for (const c of centers) {
    if (c.w > maxW) maxW = c.w;
    if (c.h > maxH) maxH = c.h;
  }
  for (const a of assignments) {
    if (a[1] + 1 > actualCols) actualCols = a[1] + 1;
  }

  return {
    rows: gridRow,
    cols: actualCols,
    assignments,
    colWidth: maxW,
    rowHeight: maxH,
  };
}

/**
 * Convenience: given a computed distribution position, return the full (x, y)
 * for a bbox. The position is the left edge for horizontal, top edge for vertical.
 */
export function distributeToPosition(
  pos: number,
  index: number,
  _bbox: BBox,
  axis: DistributeAxis,
  sortedBounds: BBox[],
): { x: number; y: number } {
  const original = sortedBounds[index];
  if (!original) return { x: 0, y: 0 };
  if (axis === 'horizontal') {
    return { x: pos, y: original.y };
  }
  return { x: original.x, y: pos };
}
