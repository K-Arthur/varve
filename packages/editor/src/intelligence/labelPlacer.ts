/**
 * Smart label placement — positions text labels near target nodes
 * while avoiding overlaps.
 *
 * Uses a greedy placement strategy: for each label, try 8 candidate
 * positions (N, NE, E, SE, S, SW, W, NW) and pick the one with the
 * highest score (least overlap with other labels and other nodes).
 */

export interface LabelTarget {
  nodeId: string;
  /** World-space center of the target */
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  labelText: string;
  /** Approximate label dimensions (estimated from text length and font size) */
  labelW: number;
  labelH: number;
}

export interface PlacedLabel {
  nodeId: string;
  labelText: string;
  /** World-space position of the label (top-left) */
  x: number;
  y: number;
  /** Which direction the label was placed relative to target */
  direction: LabelDirection;
  /** Whether this label overlaps with another placed label */
  overlaps: boolean;
}

export type LabelDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const DIRECTIONS: LabelDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Offset of label from target edge, as a fraction of target size */
const EDGE_OFFSET_FACTOR = 0.15;

/**
 * Place labels greedily to minimise overlap.
 */
export function placeLabels(
  targets: LabelTarget[],
  /** Width/height of the viewport for bounding */
  viewportW = 4000,
  viewportH = 4000,
): PlacedLabel[] {
  if (targets.length === 0) return [];

  const placed: PlacedLabel[] = [];
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const target of targets) {
    let bestCandidate: { x: number; y: number; direction: LabelDirection; score: number } | null =
      null;

    for (const dir of DIRECTIONS) {
      const pos = computeLabelPosition(target, dir, EDGE_OFFSET_FACTOR);

      // Clamp to viewport
      pos.x = Math.max(0, Math.min(viewportW - target.labelW, pos.x));
      pos.y = Math.max(0, Math.min(viewportH - target.labelH, pos.y));

      // Compute overlap score
      const labelBox = { x: pos.x, y: pos.y, w: target.labelW, h: target.labelH };
      let overlapScore = 0;

      // Penalise overlap with other placed labels
      for (const occ of occupied) {
        const overlap = rectOverlapArea(labelBox, occ);
        overlapScore += overlap;
      }

      // Penalise overlap with target node itself
      const targetBox = {
        x: target.targetX,
        y: target.targetY,
        w: target.targetW,
        h: target.targetH,
      };
      overlapScore += rectOverlapArea(labelBox, targetBox) * 2;

      // Penalise positions outside viewport
      if (pos.x < 0) overlapScore += 100;
      if (pos.y < 0) overlapScore += 100;
      if (pos.x + target.labelW > viewportW) overlapScore += 100;
      if (pos.y + target.labelH > viewportH) overlapScore += 100;

      // Prefer positions that don't cross target edges (intuitive direction)
      const directionBonus = dir === 'e' || dir === 'w' ? 0 : 10;

      const score = -overlapScore - directionBonus;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { x: pos.x, y: pos.y, direction: dir, score };
      }
    }

    if (bestCandidate) {
      occupied.push({
        x: bestCandidate.x,
        y: bestCandidate.y,
        w: target.labelW,
        h: target.labelH,
      });

      const overlaps =
        occupied.length > 1 &&
        occupied
          .slice(0, -1)
          .some((occ) =>
            rectsOverlap(
              { x: bestCandidate!.x, y: bestCandidate!.y, w: target.labelW, h: target.labelH },
              occ,
            ),
          );

      placed.push({
        nodeId: target.nodeId,
        labelText: target.labelText,
        x: bestCandidate.x,
        y: bestCandidate.y,
        direction: bestCandidate.direction,
        overlaps,
      });
    }
  }

  return placed;
}

function computeLabelPosition(
  target: LabelTarget,
  direction: LabelDirection,
  offsetFactor: number,
): { x: number; y: number } {
  const cx = target.targetX + target.targetW / 2;
  const cy = target.targetY + target.targetH / 2;
  const offsetX = target.targetW * offsetFactor;
  const offsetY = target.targetH * offsetFactor;

  switch (direction) {
    case 'n':
      return { x: cx - target.labelW / 2, y: target.targetY - target.labelH - offsetY };
    case 'ne':
      return {
        x: target.targetX + target.targetW + offsetX,
        y: target.targetY - target.labelH - offsetY,
      };
    case 'e':
      return { x: target.targetX + target.targetW + offsetX, y: cy - target.labelH / 2 };
    case 'se':
      return {
        x: target.targetX + target.targetW + offsetX,
        y: target.targetY + target.targetH + offsetY,
      };
    case 's':
      return { x: cx - target.labelW / 2, y: target.targetY + target.targetH + offsetY };
    case 'sw':
      return {
        x: target.targetX - target.labelW - offsetX,
        y: target.targetY + target.targetH + offsetY,
      };
    case 'w':
      return { x: target.targetX - target.labelW - offsetX, y: cy - target.labelH / 2 };
    case 'nw':
      return {
        x: target.targetX - target.labelW - offsetX,
        y: target.targetY - target.labelH - offsetY,
      };
  }
}

function rectOverlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
