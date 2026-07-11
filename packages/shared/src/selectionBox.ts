/**
 * Selection-box math for the transform engine.
 *
 * A SelectionBox is a rotated rectangle expressed in world coordinates as
 * `{ cx, cy, w, h, rotation }` where `w` and `h` are the un-rotated side lengths
 * and `rotation` is the angle of the local x-axis in radians (Y-down, so
 * positive angles appear clockwise on screen).
 *
 * The transform engine uses a single delta matrix: `M_new · M_old⁻¹`, where
 * `M = T(center) · R(rotation) · S(w, h)` maps the unit centered square to the
 * selection box. That delta is applied to each node's initial world transform.
 * This is the same pattern used by Konva's `Transformer` and `pixi-transformer`;
 * it unifies resize, rotate, and multi-select scaling into one matrix operation.
 *
 * Research basis:
 * - Konva Transformer: "Instead it changes scaleX and scaleY properties."
 * - pixi-transformer: "computes a delta matrix from the old selection box to
 *   the new selection box and applies that delta to each selected target."
 * - Figma relativeTransform docs: node transform carries rotation/translation,
 *   width/height are separate resize-driven fields.
 */

import type { Affine, Point, Rect } from './affine';
import {
  applyAffine,
  identity,
  multiplyAffine,
  rotateRad,
  scaleXY,
  translate,
  tryInvertAffine,
} from './affine';

/** The eight resize handles plus a rotation handle. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotation';

/** A rotated rectangle in world coordinates. */
export interface SelectionBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Rotation of the local x-axis in radians (Y-down coordinate space). */
  rotation: number;
}

/** What is needed to derive one node's contribution to a selection box. */
export interface BoxCandidate {
  /** The node's geometry bounds in its own local space. */
  localRect: Rect;
  /** The node's world transform (local → world). */
  worldTransform: Affine;
}

/** Options controlling resize behavior. */
export interface ResizeOptions {
  /** When true, scale from the box center (Alt/Option). */
  centered?: boolean;
  /** When true, lock the aspect ratio (Shift). */
  proportional?: boolean;
  /** Minimum allowed width/height in world px. */
  minSize?: number;
}

const MIN_SIZE_DEFAULT = 1e-3;

/** Map each handle to the sign of the side it moves. */
const HANDLE_SIGNS: Record<ResizeHandle, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  rotation: { x: 0, y: 0 },
};

/**
 * Compute the selection box for one or more nodes.
 *
 * Single node: oriented bounding box (OBB) of the transformed local rect.
 * Multi node: axis-aligned union of the OBBs of all candidates (rotation = 0).
 */
export function computeSelectionBox(candidates: BoxCandidate[]): SelectionBox | null {
  if (candidates.length === 0) return null;
  const boxes = candidates.map((c) => boxFromCandidate(c)).filter(Boolean) as SelectionBox[];
  if (boxes.length === 0) return null;
  if (boxes.length === 1) return boxes[0]!;

  // Multi-select: AABB of all OBB corners.
  const corners: Point[] = boxes.flatMap((b) => selectionBoxCorners(b));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    cx: minX + w / 2,
    cy: minY + h / 2,
    w,
    h,
    rotation: 0,
  };
}

/** Build a single-node OBB from the world transform and local rect. */
function boxFromCandidate(candidate: BoxCandidate): SelectionBox | null {
  const { localRect, worldTransform } = candidate;
  if (localRect.w <= 0 || localRect.h <= 0) return null;

  // The x-axis of the world matrix gives the box orientation.
  const [a, b] = worldTransform;
  const theta = Math.atan2(b, a);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const vx = -uy;
  const vy = ux;

  // Transform the four corners of the local rect.
  const corners: Point[] = [
    applyAffine(worldTransform, [localRect.x, localRect.y]),
    applyAffine(worldTransform, [localRect.x + localRect.w, localRect.y]),
    applyAffine(worldTransform, [localRect.x, localRect.y + localRect.h]),
    applyAffine(worldTransform, [localRect.x + localRect.w, localRect.y + localRect.h]),
  ];

  // Project onto the oriented axes and build the OBB.
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const [x, y] of corners) {
    const u = x * ux + y * uy;
    const v = x * vx + y * vy;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const w = Math.max(maxU - minU, 0);
  const h = Math.max(maxV - minV, 0);
  if (w === 0 || h === 0) return null;

  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    cx: cu * ux + cv * vx,
    cy: cu * uy + cv * vy,
    w,
    h,
    rotation: theta,
  };
}

/**
 * Return the affine that maps the unit centered square to the selection box.
 * `M = T(center) · R(rotation) · S(w, h)`.
 */
export function selectionBoxMatrix(box: SelectionBox): Affine {
  return multiplyAffine(
    translate(box.cx, box.cy),
    multiplyAffine(rotateRad(box.rotation), scaleXY(box.w, box.h)),
  );
}

/** The four box corners in world space, ordered clockwise from top-left. */
export function selectionBoxCorners(box: SelectionBox): Point[] {
  const m = selectionBoxMatrix(box);
  return [
    applyAffine(m, [-0.5, -0.5]),
    applyAffine(m, [0.5, -0.5]),
    applyAffine(m, [0.5, 0.5]),
    applyAffine(m, [-0.5, 0.5]),
  ];
}

/**
 * Compute the delta matrix that maps points from one selection box to another.
 * `p_new = delta · p_old`. Returns identity on a degenerate old box.
 */
export function boxDeltaMatrix(oldBox: SelectionBox, newBox: SelectionBox): Affine {
  const oldM = selectionBoxMatrix(oldBox);
  const invOld = tryInvertAffine(oldM);
  if (!invOld) return identity;
  const newM = selectionBoxMatrix(newBox);
  return multiplyAffine(newM, invOld);
}

/**
 * Resize a selection box by dragging a handle.
 *
 * `pointerDelta` is the drag vector in the box's own local coordinate space
 * (x right, y down, before rotation). The handle is one of the eight resize
 * handles. Returns a new box with width/height clamped to `minSize`.
 */
export function resizeSelectionBox(
  box: SelectionBox,
  handle: ResizeHandle,
  pointerDelta: Point,
  opts: ResizeOptions = {},
): SelectionBox {
  if (handle === 'rotation') return box;

  const { x: sx, y: sy } = HANDLE_SIGNS[handle];
  const minSize = Math.max(opts.minSize ?? MIN_SIZE_DEFAULT, 0);
  const centered = opts.centered ?? false;
  const proportional = opts.proportional ?? false;
  const [dx, dy] = pointerDelta;

  let newW = box.w;
  let newH = box.h;
  let newCx = box.cx;
  let newCy = box.cy;

  if (proportional && sx !== 0 && sy !== 0) {
    // Corner handle: uniform scale from the opposite corner.
    const rawW = box.w + (centered ? 2 : 1) * sx * dx;
    const rawH = box.h + (centered ? 2 : 1) * sy * dy;
    const s = clampScale(Math.max(rawW / box.w, rawH / box.h), minSize, box.w, box.h);
    newW = box.w * s;
    newH = box.h * s;
    if (!centered) {
      newCx = box.cx + (sx * (newW - box.w)) / 2;
      newCy = box.cy + (sy * (newH - box.h)) / 2;
    }
  } else if (proportional) {
    // Edge handle: the dragged edge changes; the opposite dimension follows.
    if (sx !== 0) {
      newW = box.w + (centered ? 2 : 1) * sx * dx;
      if (!centered && newW < 0) {
        // Flip on X: use the raw negative value for center, then take absolute width
        const rawW = newW;
        newW = Math.max(-newW, minSize);
        newH = box.h * (newW / box.w);
        newCx = box.cx + (sx * (rawW - box.w)) / 2;
      } else {
        newW = clampDim(newW, minSize);
        newH = box.h * (newW / box.w);
        if (!centered) newCx = box.cx + (sx * (newW - box.w)) / 2;
      }
    } else if (sy !== 0) {
      newH = box.h + (centered ? 2 : 1) * sy * dy;
      if (!centered && newH < 0) {
        const rawH = newH;
        newH = Math.max(-newH, minSize);
        newW = box.w * (newH / box.h);
        newCy = box.cy + (sy * (rawH - box.h)) / 2;
      } else {
        newH = clampDim(newH, minSize);
        newW = box.w * (newH / box.h);
        if (!centered) newCy = box.cy + (sy * (newH - box.h)) / 2;
      }
    }
  } else {
    // Free resize.
    if (sx !== 0) {
      newW = box.w + (centered ? 2 : 1) * sx * dx;
      if (!centered && newW < 0) {
        const rawW = newW;
        newW = Math.max(-newW, minSize);
        newCx = box.cx + (sx * (rawW - box.w)) / 2;
      } else {
        newW = clampDim(newW, minSize);
        if (!centered) newCx = box.cx + (sx * (newW - box.w)) / 2;
      }
    }
    if (sy !== 0) {
      newH = box.h + (centered ? 2 : 1) * sy * dy;
      if (!centered && newH < 0) {
        const rawH = newH;
        newH = Math.max(-newH, minSize);
        newCy = box.cy + (sy * (rawH - box.h)) / 2;
      } else {
        newH = clampDim(newH, minSize);
        if (!centered) newCy = box.cy + (sy * (newH - box.h)) / 2;
      }
    }
  }

  return { cx: newCx, cy: newCy, w: newW, h: newH, rotation: box.rotation };
}

/**
 * Rotate a selection box around a pivot.
 *
 * `angleDelta` is added to `box.rotation`. The box center is rotated around the
 * pivot so that the pivot stays fixed. If `pivot` is omitted, the box center is
 * the pivot (center of rotation).
 */
export function rotateSelectionBox(
  box: SelectionBox,
  angleDelta: number,
  pivot?: Point,
): SelectionBox {
  const center: Point = [box.cx, box.cy];
  const p = pivot ?? center;
  const r = rotateRad(angleDelta);
  const offset = applyAffine(r, [center[0] - p[0], center[1] - p[1]]);
  return {
    cx: p[0] + offset[0],
    cy: p[1] + offset[1],
    w: box.w,
    h: box.h,
    rotation: box.rotation + angleDelta,
  };
}

/** Return the 8 resize handle positions plus the rotation handle origin. */
export function handlePositions(box: SelectionBox): Record<ResizeHandle, Point> {
  const m = selectionBoxMatrix(box);
  const p = (x: number, y: number): Point => applyAffine(m, [x, y]);
  return {
    nw: p(-0.5, -0.5),
    n: p(0, -0.5),
    ne: p(0.5, -0.5),
    e: p(0.5, 0),
    se: p(0.5, 0.5),
    s: p(0, 0.5),
    sw: p(-0.5, 0.5),
    w: p(-0.5, 0),
    rotation: p(0, -0.5),
  };
}

function clampDim(value: number, min: number): number {
  return Math.max(value, min);
}

function clampScale(s: number, min: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1;
  // Ensure both new dimensions stay >= min.
  const minS = Math.max(min / w, min / h);
  return Math.max(s, minS);
}
