/**
 * Bounded dirty-region merging.
 *
 * The document diff can contribute thousands of individual rectangles per
 * frame (old/new bounds per changed node, raster tiles). Unioning them all
 * into one rect amplifies the redraw: two distant 20 px invalidations become
 * one rect covering the 67%-empty gap between them (measured in the
 * 2026-08-03 observability report). This module retains several independent
 * rectangles while their combined cost is beneficial, merges strongly
 * overlapping or nearby rects, and falls back to one viewport-sized redraw
 * past a measured area threshold.
 *
 * The union of the merged set always equals the union of the inputs — merging
 * never loses dirty pixels. What the set buys is *precision*: candidates
 * between two distant rects are rejected, and per-rect clearing/repainting
 * does not touch the empty gap.
 *
 * Deterministic: the same inputs with the same policy produce the same set.
 * Allocation-bounded: inputs are capped before merging and the greedy pass is
 * O(n²) over at most `maxInputs` rectangles.
 */

import type { Rect } from '@strata/shared';
import {
  computeDocumentDirtyRegion,
  type DirtyRegion,
  type DirtyRegionRecorder,
} from './dirtyRegion';

/**
 * Compute the bounded merged dirty-rect set for a dirty region, using the
 * pre-merge rectangles the document diff recorded. Returns null when the
 * region is not a partial one or the recorder captured nothing (the region
 * analysis produced no individual rects — structural or clean frames).
 */
export function computeMergedDirtyRegion(
  dirty: DirtyRegion,
  recorder: DirtyRegionRecorder,
  viewportW: number,
  viewportH: number,
): DirtyMergeResult | null {
  if (dirty.kind !== 'partial' || recorder.rects.length === 0) return null;
  return mergeDirtyRects(
    recorder.rects.map((record) => record.rect),
    {},
    { width: viewportW, height: viewportH },
  );
}

/**
 * One-call frame dirty-region computation: the document diff, the merged
 * bounded rect set, and the viewport-clamped screen rect for the paint path.
 * `fullFallback` reports whether the region analysis fell back to a full
 * redraw (caller records it on the node-work counters).
 */
export function computeFrameDirtyRegion(opts: {
  previous: import('@strata/scene').Document;
  next: import('@strata/scene').Document;
  recorder: DirtyRegionRecorder;
  parentIndex?: Map<string, string>;
  worldToScreen: (wx: number, wy: number) => readonly [number, number];
  viewportW: number;
  viewportH: number;
}): {
  dirty: DirtyRegion;
  mergedDirty: DirtyMergeResult | null;
  dirtyScreenRect: { x: number; y: number; w: number; h: number } | null;
  fullFallback: boolean;
} {
  const { previous, next, recorder, parentIndex, worldToScreen, viewportW, viewportH } = opts;
  recorder.reset();
  const dirty = computeDocumentDirtyRegion(previous, next, undefined, parentIndex, recorder);
  const mergedDirty = computeMergedDirtyRegion(dirty, recorder, viewportW, viewportH);
  let dirtyScreenRect: { x: number; y: number; w: number; h: number } | null = null;
  let fullFallback = false;
  if (dirty.kind === 'full') {
    fullFallback = true;
  } else if (dirty.kind === 'partial') {
    const dirtyWorld = dirty.bounds;
    const corners: Array<readonly [number, number]> = [
      [dirtyWorld.x, dirtyWorld.y],
      [dirtyWorld.x + dirtyWorld.w, dirtyWorld.y],
      [dirtyWorld.x, dirtyWorld.y + dirtyWorld.h],
      [dirtyWorld.x + dirtyWorld.w, dirtyWorld.y + dirtyWorld.h],
    ];
    let minSx = Number.POSITIVE_INFINITY;
    let minSy = Number.POSITIVE_INFINITY;
    let maxSx = Number.NEGATIVE_INFINITY;
    let maxSy = Number.NEGATIVE_INFINITY;
    for (const [wx, wy] of corners) {
      const [px, py] = worldToScreen(wx, wy);
      minSx = Math.min(minSx, px);
      minSy = Math.min(minSy, py);
      maxSx = Math.max(maxSx, px);
      maxSy = Math.max(maxSy, py);
    }
    dirtyScreenRect = {
      x: Math.max(0, minSx - 40),
      y: Math.max(0, minSy - 40),
      w: Math.min(viewportW, maxSx - minSx + 80),
      h: Math.min(viewportH, maxSy - minSy + 80),
    };
  }
  return { dirty, mergedDirty, dirtyScreenRect, fullFallback };
}

/** Maximum individual rectangles collected from the document diff. */
export const MAX_DIRTY_INPUT_RECTS = 64;

export interface DirtyMergePolicy {
  /** Maximum rectangles retained after merging. */
  maxRects: number;
  /**
   * Chebyshev gap (world units) under which two rects are merged even when
   * their union amplifies the area.
   */
  mergeDistance: number;
  /**
   * Union-area / sum-of-areas ratio above which a pair only merges when it is
   * within `mergeDistance` — strongly overlapping pairs merge freely.
   */
  maxAmplification: number;
  /**
   * Total merged area beyond this fraction of the viewport falls back to one
   * viewport-sized redraw.
   */
  areaThresholdRatio: number;
}

export const DEFAULT_DIRTY_MERGE_POLICY: DirtyMergePolicy = {
  maxRects: 8,
  mergeDistance: 24,
  maxAmplification: 1.5,
  areaThresholdRatio: 0.6,
};

export type DirtyMergeFallback = 'none' | 'viewport-area';

export interface DirtyMergeResult {
  /** Merged rectangles (bounded by maxRects; empty when inputs were empty). */
  rects: readonly Rect[];
  beforeCount: number;
  afterCount: number;
  /** Sum of individual input areas (pre-merge). */
  sumAreaBefore: number;
  /** Sum of merged rectangle areas (per-rect repaint cost). */
  sumAreaAfter: number;
  /** Area of the union of the merged rectangles (what a redraw must cover). */
  unionAreaAfter: number;
  /** unionAreaAfter / sumAreaBefore — 1 means no amplification, > 1 means gaps. */
  amplification: number;
  /** Number of inputs dropped by the collector cap. */
  overflowed: number;
  /** Number of merge operations applied. */
  mergesApplied: number;
  /** Why the result fell back to a single viewport rect, if it did. */
  fallback: DirtyMergeFallback;
}

export function area(rect: Rect): number {
  return rect.w * rect.h;
}

function isValidRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.w) &&
    Number.isFinite(rect.h) &&
    rect.w > 0 &&
    rect.h > 0
  );
}

function unionPair(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: maxX - x, h: maxY - y };
}

/** Chebyshev gap between two rects (0 when they overlap or touch). */
function chebyshevGap(left: Rect, right: Rect): number {
  const gapX = Math.max(
    0,
    Math.max(left.x, right.x) - Math.min(left.x + left.w, right.x + right.w),
  );
  const gapY = Math.max(
    0,
    Math.max(left.y, right.y) - Math.min(left.y + left.h, right.y + right.h),
  );
  return Math.max(gapX, gapY);
}

/**
 * Merge a bounded set of dirty rectangles under the given policy.
 *
 * Two-tier greedy merging:
 *
 * 1. Free merges — pairs that are overlapping (union amplification < 1) or
 *    within `mergeDistance`. These never amplify the repaint cost, so they
 *    run regardless of the count budget.
 * 2. Budget merges — while the count exceeds `maxRects`, the admissible pair
 *    with the lowest union amplification is merged. A pair is admissible
 *    when its amplification is at most `maxAmplification` or its gap is at
 *    most `mergeDistance`.
 *
 * The budget never forces an expensive merge: when no admissible pair
 * remains, the set is kept as-is (bounded by the input cap) — two distant
 * invalidations staying separate is the point of the exercise.
 *
 * The union of the merged set equals the union of the inputs (except when the
 * area fallback replaces the set with one viewport-sized rect). NaN,
 * Infinity and zero-size inputs are dropped and counted in `overflowed`.
 */
export function mergeDirtyRects(
  inputs: readonly Rect[],
  policy: Partial<DirtyMergePolicy> = {},
  viewport?: { width: number; height: number },
): DirtyMergeResult {
  const mergedPolicy: DirtyMergePolicy = { ...DEFAULT_DIRTY_MERGE_POLICY, ...policy };
  const valid: Rect[] = [];
  let overflowed = 0;
  let sumAreaBefore = 0;
  for (const rect of inputs) {
    if (!isValidRect(rect)) {
      overflowed++;
      continue;
    }
    if (valid.length >= MAX_DIRTY_INPUT_RECTS) {
      overflowed++;
      continue;
    }
    valid.push({ ...rect });
    sumAreaBefore += area(rect);
  }
  const beforeCount = valid.length;
  let mergesApplied = 0;

  const amplificationOf = (a: Rect, b: Rect): number => {
    const sum = area(a) + area(b);
    return sum > 0 ? area(unionPair(a, b)) / sum : Number.POSITIVE_INFINITY;
  };
  const freeAdmissible = (a: Rect, b: Rect): boolean => {
    if (chebyshevGap(a, b) <= mergedPolicy.mergeDistance) return true;
    return amplificationOf(a, b) < 1;
  };
  const budgetAdmissible = (a: Rect, b: Rect): boolean => {
    if (amplificationOf(a, b) <= mergedPolicy.maxAmplification) return true;
    return chebyshevGap(a, b) <= mergedPolicy.mergeDistance;
  };

  const mergePair = (i: number, j: number): void => {
    const merged = unionPair(valid[i]!, valid[j]!);
    valid[j] = merged;
    valid.splice(i, 1);
    mergesApplied++;
  };

  let progress = true;
  while (progress && valid.length > 1) {
    progress = false;
    // Tier 1: free merges (never amplify cost).
    outer1: for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        if (freeAdmissible(valid[i]!, valid[j]!)) {
          mergePair(i, j);
          progress = true;
          break outer1;
        }
      }
    }
    if (progress) continue;
    // Tier 2: budget merges (cheapest admissible pair) while over budget.
    if (valid.length <= mergedPolicy.maxRects) break;
    let bestI = -1;
    let bestJ = -1;
    let bestAmp = Number.POSITIVE_INFINITY;
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        if (!budgetAdmissible(valid[i]!, valid[j]!)) continue;
        const amp = amplificationOf(valid[i]!, valid[j]!);
        if (amp < bestAmp) {
          bestAmp = amp;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI < 0 || bestJ < 0) break;
    mergePair(bestI, bestJ);
    progress = true;
  }

  let unionAreaAfter = 0;
  let sumAreaAfter = 0;
  if (valid.length > 0) {
    let union: Rect | null = null;
    for (const rect of valid) {
      union = union ? unionPair(union, rect) : { ...rect };
      sumAreaAfter += area(rect);
    }
    unionAreaAfter = union ? area(union) : 0;
  }

  let fallback: DirtyMergeFallback = 'none';
  let rects = valid;
  if (viewport && viewport.width > 0 && viewport.height > 0 && valid.length > 0) {
    const viewportArea = viewport.width * viewport.height;
    // The per-rect repaint cost (sum of rect areas) drives the fallback: a
    // set of tiny distant rects must not fall back just because their
    // bounding box is large, and a set whose rects genuinely cover most of
    // the viewport buys nothing over a full redraw.
    if (sumAreaAfter > viewportArea * mergedPolicy.areaThresholdRatio) {
      rects = [{ x: 0, y: 0, w: viewport.width, h: viewport.height }];
      fallback = 'viewport-area';
      sumAreaAfter = viewportArea;
      unionAreaAfter = viewportArea;
    }
  }

  return {
    rects,
    beforeCount,
    afterCount: rects.length,
    sumAreaBefore,
    sumAreaAfter,
    unionAreaAfter,
    amplification: sumAreaBefore > 0 ? unionAreaAfter / sumAreaBefore : 1,
    overflowed,
    mergesApplied,
    fallback,
  };
}
