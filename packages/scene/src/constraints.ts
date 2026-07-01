/**
 * Figma-style constraints for responsive child positioning within frames.
 *
 * Constraints define how a child object responds when its parent frame is
 * resized. Each axis (horizontal, vertical) independently specifies one of
 * six modes:
 *
 *   - 'min' (default): pinned to the left/top edge
 *   - 'max': pinned to the right/bottom edge
 *   - 'center': stays centered between the edges
 *   - 'stretch': resizes to maintain distance from both edges
 *   - 'scale': proportionally scales with the parent
 *
 * Research basis: Figma Constraints model, Sketch Resizing model.
 */
import type { ConstraintAxis, Constraints } from './types';

export function defaultConstraints(): Constraints {
  return { horizontal: 'min', vertical: 'min' };
}

export interface ConstraintResult {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Given a child node's original bounds (relative to the old parent size)
 * and the new parent dimensions, compute the new child bounds according
 * to the child's constraints.
 */
export function applyConstraints(
  constraints: Constraints,
  childOrig: { x: number; y: number; w: number; h: number },
  oldParentW: number,
  oldParentH: number,
  newParentW: number,
  newParentH: number,
): ConstraintResult {
  const h = resolveAxis(
    constraints.horizontal,
    childOrig.x,
    childOrig.w,
    oldParentW,
    newParentW,
  );
  const v = resolveAxis(
    constraints.vertical,
    childOrig.y,
    childOrig.h,
    oldParentH,
    newParentH,
  );
  return { x: h.pos, y: v.pos, w: h.size, h: v.size };
}

interface AxisResult {
  pos: number;
  size: number;
}

function resolveAxis(
  mode: ConstraintAxis,
  origPos: number,
  origSize: number,
  oldSize: number,
  newSize: number,
): AxisResult {
  // Cannot scale from zero-size parent — preserve original position/size.
  if (oldSize <= 0) return { pos: origPos, size: origSize };
  switch (mode) {
    case 'min':
      // Pinned to left/top: position stays the same
      return { pos: origPos, size: origSize };
    case 'max': {
      // Pinned to right/bottom: distance from right edge stays the same
      const rightDist = oldSize - (origPos + origSize);
      return { pos: newSize - origSize - rightDist, size: origSize };
    }
    case 'center': {
      // Centered: position scales proportionally
      const ratio = origPos / Math.max(1, oldSize - origSize);
      const newPos = ratio * Math.max(1, newSize - origSize);
      return { pos: newPos, size: origSize };
    }
    case 'stretch': {
      // Stretch: both edges pinned, size computed from distance between them
      const marginLeft = origPos;
      const marginRight = oldSize - (origPos + origSize);
      return { pos: marginLeft, size: Math.max(0, newSize - marginLeft - marginRight) };
    }
    case 'scale': {
      // Scale: position and size both scale proportionally
      const ratioX = origPos / Math.max(1, oldSize);
      const ratioW = origSize / Math.max(1, oldSize);
      return { pos: ratioX * newSize, size: Math.max(0, ratioW * newSize) };
    }
    default: {
      const _exhaustiveCheck: never = mode;
      return { pos: origPos, size: origSize };
    }
  }
}
