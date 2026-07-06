/**
 * Content-Aware Smart Spacing Harmonizer.
 *
 * A deterministic, math-only intelligence feature that detects dominant spacing
 * units from a set of selected nodes and equalises their gaps.
 *
 * Algorithm:
 *   1. Compute world bounds for each node via nodeWorldBounds.
 *   2. Filter overlapping nodes (keep the first in each overlapping group).
 *   3. Sort by X then Y (spatial adjacency).
 *   4. For each adjacent pair compute the gap along the dominant separation axis.
 *   5. Build a 4-px-bin histogram of gaps.
 *   6. Find the mode bin (highest individual frequency).
 *   7. Compute the weighted mean of gaps in a 3-bin window around the mode bin.
 *   8. Confidence = mode bin frequency / total gap count.
 *   9. suggestedGap = nearest multiple of 4 to the weighted mean.
 *  10. detectedBaseUnit = suggestedGap when confidence >= 0.8.
 */

import type { Document, NodeId } from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';
import { nodeWorldBounds } from '../scene/world';

export interface SpacingAnalysis {
  /** Detected base unit (nearest 4 px to mode), null when confidence < 0.8. */
  detectedBaseUnit: number | null;
  /** Confidence value 0-1 (mode bin frequency / total gaps). */
  confidence: number;
  /** All detected gaps between adjacent nodes (dominant axis). */
  gaps: number[];
  /** Suggested gap = nearest multiple of 4 to the histogram mode. */
  suggestedGap: number;
}

interface BoundsEntry {
  id: NodeId;
  bounds: Rect;
}

const BIN_WIDTH = 4;

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/**
 * Compute the gap between two axis-aligned rects along the dominant
 * separation axis (the axis with the smaller edge-to-edge distance).
 */
function computeGap(a: Rect, b: Rect): number {
  const hGap = b.x - (a.x + a.w);
  const vGap = b.y - (a.y + a.h);
  return Math.abs(hGap) <= Math.abs(vGap) ? hGap : vGap;
}

/** Collect valid visible-node bounds, filtering out null and zero-area nodes. */
function collectBounds(doc: Document, nodeIds: NodeId[]): BoundsEntry[] {
  const entries: BoundsEntry[] = [];
  for (const id of nodeIds) {
    const bounds = nodeWorldBounds(doc, id);
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      entries.push({ id, bounds });
    }
  }
  return entries;
}

/**
 * Filter out overlapping nodes. Keeps the first entry from each overlapping
 * group so that pairwise gaps are meaningful.
 */
function filterOverlaps(entries: BoundsEntry[]): BoundsEntry[] {
  const result: BoundsEntry[] = [];
  for (const entry of entries) {
    let overlaps = false;
    for (const existing of result) {
      if (rectsOverlap(entry.bounds, existing.bounds)) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Determine whether the set of nodes forms a predominantly horizontal or
 * vertical layout by comparing the variance of bounds origins along each axis.
 */
function isHorizontalLayout(entries: BoundsEntry[]): boolean {
  if (entries.length < 2) return true;
  const xs = entries.map((e) => e.bounds.x);
  const ys = entries.map((e) => e.bounds.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const varX = xs.reduce((a, v) => a + (v - meanX) ** 2, 0) / xs.length;
  const varY = ys.reduce((a, v) => a + (v - meanY) ** 2, 0) / ys.length;
  return varX >= varY;
}

/**
 * Analyse spacing between selected nodes.
 *
 * Returns detected base unit, confidence, all gaps, and suggested gap.
 * When fewer than 2 valid non-overlapping nodes are supplied, returns a
 * no-op result (all zeros, null base unit).
 */
export function analyzeSpacing(doc: Document, nodeIds: NodeId[]): SpacingAnalysis {
  if (nodeIds.length < 2) {
    return { detectedBaseUnit: null, confidence: 0, gaps: [], suggestedGap: 0 };
  }

  let entries = collectBounds(doc, nodeIds);
  entries = filterOverlaps(entries);

  if (entries.length < 2) {
    return { detectedBaseUnit: null, confidence: 0, gaps: [], suggestedGap: 0 };
  }

  // Sort by X then Y (left to right, top to bottom)
  entries.sort((a, b) => {
    const dx = a.bounds.x - b.bounds.x;
    if (dx !== 0) return dx;
    return a.bounds.y - b.bounds.y;
  });

  // Compute gaps between adjacent entries
  const gaps: number[] = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const aBounds = entries[i]?.bounds;
    const bBounds = entries[i + 1]?.bounds;
    if (aBounds && bBounds) {
      gaps.push(computeGap(aBounds, bBounds));
    }
  }

  if (gaps.length === 0) {
    return { detectedBaseUnit: null, confidence: 0, gaps: [], suggestedGap: 0 };
  }

  // Build fixed-width histogram (bins starting from 0)
  const maxGap = Math.max(...gaps);
  const binCount = Math.max(1, Math.ceil((maxGap + 1) / BIN_WIDTH));
  const histogram = new Array(binCount).fill(0) as number[];

  for (const gap of gaps) {
    const bin = Math.max(0, Math.min(Math.floor(gap / BIN_WIDTH), binCount - 1));
    histogram[bin]!++;
  }

  // Find the mode bin (highest individual frequency)
  let modeBin = 0;
  let maxFreq = 0;
  for (let i = 0; i < binCount; i++) {
    const f = histogram[i]!;
    if (f > maxFreq) {
      maxFreq = f;
      modeBin = i;
    }
  }

  // Confidence = how dominant the mode bin is
  const confidence = gaps.length > 0 ? maxFreq / gaps.length : 0;

  // Compute weighted mean of gaps in the 3-bin window around the mode bin
  const windowHalf = 1;
  const windowGaps = gaps.filter((g) => {
    const bin = Math.floor(g / BIN_WIDTH);
    return Math.abs(bin - modeBin) <= windowHalf;
  });

  const weightedMean =
    windowGaps.length > 0 ? windowGaps.reduce((a, b) => a + b, 0) / windowGaps.length : 0;

  const suggestedGap = Math.round(weightedMean / BIN_WIDTH) * BIN_WIDTH;

  return {
    detectedBaseUnit: confidence >= 0.8 ? suggestedGap : null,
    confidence,
    gaps,
    suggestedGap,
  };
}

/**
 * Create a new document with equalised spacing between selected nodes.
 *
 * Determines the dominant layout axis, sorts nodes, and shifts subsequent
 * nodes so that all adjacent gaps equal the `suggestedGap` from analysis.
 *
 * The first node in the sequence is kept in place; only non-overlapping
 * valid nodes are adjusted.
 */
export function harmonizeSpacing(doc: Document, nodeIds: NodeId[]): Document {
  const analysis = analyzeSpacing(doc, nodeIds);
  const gap = analysis.suggestedGap;

  if (gap <= 0 || nodeIds.length < 2) return doc;

  let entries = collectBounds(doc, nodeIds);
  entries = filterOverlaps(entries);

  if (entries.length < 2) return doc;

  // Sort by X then Y
  entries.sort((a, b) => {
    const dx = a.bounds.x - b.bounds.x;
    if (dx !== 0) return dx;
    return a.bounds.y - b.bounds.y;
  });

  const horizontal = isHorizontalLayout(entries);
  let newDoc: Document = doc;
  const first = entries[0]!;

  if (horizontal) {
    let prevRight = first.bounds.x + first.bounds.w;
    for (let i = 1; i < entries.length; i++) {
      const e = entries[i]!;
      const targetLeft = prevRight + gap;
      const delta = targetLeft - e.bounds.x;
      if (Math.abs(delta) > 0.01) {
        const node = newDoc.nodes[e.id];
        if (node) {
          const t = node.transform as Affine;
          const newTransform: Affine = [t[0], t[1], t[2], t[3], t[4] + delta, t[5]];
          newDoc = {
            ...newDoc,
            nodes: {
              ...newDoc.nodes,
              [e.id]: { ...node, transform: newTransform } as typeof node,
            },
          };
        }
      }
      prevRight = targetLeft + e.bounds.w;
    }
  } else {
    let prevBottom = first.bounds.y + first.bounds.h;
    for (let i = 1; i < entries.length; i++) {
      const e = entries[i]!;
      const targetTop = prevBottom + gap;
      const delta = targetTop - e.bounds.y;
      if (Math.abs(delta) > 0.01) {
        const node = newDoc.nodes[e.id];
        if (node) {
          const t = node.transform as Affine;
          const newTransform: Affine = [t[0], t[1], t[2], t[3], t[4], t[5] + delta];
          newDoc = {
            ...newDoc,
            nodes: {
              ...newDoc.nodes,
              [e.id]: { ...node, transform: newTransform } as typeof node,
            },
          };
        }
      }
      prevBottom = targetTop + e.bounds.h;
    }
  }

  return newDoc;
}
