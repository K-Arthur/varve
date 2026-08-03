/**
 * Node-work accounting — whether partial redraw reduces actual scene work, or
 * only the dirty pixel area.
 *
 * A smaller dirty rectangle is not evidence of a cheaper frame. The frame is
 * only cheaper if fewer nodes are traversed, tested, converted and replayed.
 * These counters make the difference measurable: if `visibilityTested` stays
 * flat as the dirty area shrinks, visible-list construction is a fixed cost
 * and shrinking the rectangle cannot help — which is exactly the question
 * Gate D asks before any spatial-query rewrite.
 *
 * The counters are plain integers incremented inside the existing render loop;
 * nothing here walks the scene on its own, so diagnostics never add a
 * full-scene scan.
 */

export interface NodeWorkCounters {
  /** Nodes in the document. */
  totalSceneNodes: number;
  /** Nodes offered by the traversal/spatial broad phase. */
  candidates: number;
  /** Nodes whose bounds were actually computed and tested. */
  visibilityTested: number;
  /** Rejected because their visual bounds fall outside the viewport. */
  rejectedByViewport: number;
  /** Rejected because their visual bounds miss the dirty region. */
  rejectedByDirty: number;
  /**
   * Accepted nodes whose visual bounds do *not* intersect the dirty region —
   * work the current pipeline performs but a dirty-region query could have
   * pruned. This is the headroom estimate Gate D turns on: it is measured
   * without changing the pipeline, so the decision to restructure is backed by
   * a number rather than by the shape of the code.
   */
  prunableByDirty: number;
  /** Rejected by container culling before any per-node work. */
  rejectedByContainer: number;
  /** Accepted into the replay list. */
  acceptedForReplay: number;
  /** Ancestors pulled into the replay set (clips, masks, blend contexts). */
  ancestorsIncluded: number;
  /** Subtree members pulled in by included flatten groups / masks. */
  compositingDependencies: number;
  /** Accepted nodes that are raster layers. */
  rasterRepainted: number;
  /** Accepted nodes that are vector/text primitives. */
  vectorRepainted: number;
  /** Accepted nodes whose bounds were expanded by strokes, effects or shadows. */
  effectExpanded: number;
  /** Nodes served from the engine-node or subtree IR cache. */
  cacheReused: number;
  /** True when the frame fell back to a full redraw. */
  fullFallback: boolean;
  /** Scene traversal and culling time. */
  traversalMs: number;
  /** Bounds resolution and visibility testing time. */
  visibilityMs: number;
  /** Dirty-region intersection testing time. */
  dirtyIntersectMs: number;
}

/**
 * Half-open rectangle overlap. Edge-touching rectangles do not intersect,
 * matching how the dirty rectangle is expanded by a 40px anti-aliasing margin
 * before use — a node exactly on the boundary contributes no pixels.
 */
export function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function createNodeWorkCounters(): NodeWorkCounters {
  return {
    totalSceneNodes: 0,
    candidates: 0,
    visibilityTested: 0,
    rejectedByViewport: 0,
    rejectedByDirty: 0,
    prunableByDirty: 0,
    rejectedByContainer: 0,
    acceptedForReplay: 0,
    ancestorsIncluded: 0,
    compositingDependencies: 0,
    rasterRepainted: 0,
    vectorRepainted: 0,
    effectExpanded: 0,
    cacheReused: 0,
    fullFallback: false,
    traversalMs: 0,
    visibilityMs: 0,
    dirtyIntersectMs: 0,
  };
}

/**
 * Ratios that answer the acceptance question directly. Each is 0 when the
 * denominator is zero rather than NaN, so a quiet frame does not poison a
 * rolled-up average.
 */
export interface NodeWorkRatios {
  /** Accepted / total — the share of the scene that was actually repainted. */
  repaintRatio: number;
  /** Candidates / total — how much the broad phase pruned. */
  candidateRatio: number;
  /** Rejected-by-dirty / tested — the share of pruning the dirty region did. */
  dirtyPruneRatio: number;
  /** Rejected-by-viewport / tested — the share culling did. */
  viewportPruneRatio: number;
  /**
   * Tested / candidates. Near 1 means every candidate paid for a bounds test,
   * so the dirty region is not pruning before the expensive step — the
   * signature of a fixed visible-list cost.
   */
  testedPerCandidate: number;
  /**
   * Prunable / accepted. The share of replayed nodes a dirty-region query
   * could have skipped. A high value with a small dirty rectangle is the
   * signature of pruning being lost between invalidation and replay.
   */
  lostPruningRatio: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function nodeWorkRatios(counters: NodeWorkCounters): NodeWorkRatios {
  return {
    repaintRatio: ratio(counters.acceptedForReplay, counters.totalSceneNodes),
    candidateRatio: ratio(counters.candidates, counters.totalSceneNodes),
    dirtyPruneRatio: ratio(counters.rejectedByDirty, counters.visibilityTested),
    viewportPruneRatio: ratio(counters.rejectedByViewport, counters.visibilityTested),
    testedPerCandidate: ratio(counters.visibilityTested, counters.candidates),
    lostPruningRatio: ratio(counters.prunableByDirty, counters.acceptedForReplay),
  };
}

/**
 * Compare a partial-redraw frame against a full-redraw baseline of the same
 * scene. This is the acceptance evidence: partial redraw is only effective if
 * node work falls roughly in step with dirty area, not merely alongside it.
 */
export interface PartialRedrawComparison {
  dirtyAreaReduction: number;
  candidateReduction: number;
  replayedNodeReduction: number;
  /**
   * How much of the dirty-area reduction translated into replayed-node
   * reduction. 1 means proportional; near 0 means the smaller rectangle bought
   * no less node work, which is the case that justifies changing the pipeline.
   */
  workTrackingRatio: number;
}

function reduction(baseline: number, current: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - current / baseline));
}

export function comparePartialRedraw(
  baseline: { dirtyArea: number; counters: NodeWorkCounters },
  partial: { dirtyArea: number; counters: NodeWorkCounters },
): PartialRedrawComparison {
  const dirtyAreaReduction = reduction(baseline.dirtyArea, partial.dirtyArea);
  const candidateReduction = reduction(baseline.counters.candidates, partial.counters.candidates);
  const replayedNodeReduction = reduction(
    baseline.counters.acceptedForReplay,
    partial.counters.acceptedForReplay,
  );
  return {
    dirtyAreaReduction,
    candidateReduction,
    replayedNodeReduction,
    workTrackingRatio: dirtyAreaReduction > 0 ? replayedNodeReduction / dirtyAreaReduction : 0,
  };
}

/**
 * Bounded ring of per-frame node-work samples. Capped like the other
 * diagnostic rings so a long session cannot grow without limit.
 */
export class NodeWorkRing {
  static readonly MAX_SAMPLES = 120;
  private readonly samples: NodeWorkCounters[] = [];

  record(counters: NodeWorkCounters): void {
    this.samples.push(counters);
    if (this.samples.length > NodeWorkRing.MAX_SAMPLES) this.samples.shift();
  }

  recent(n = 30): NodeWorkCounters[] {
    return this.samples.slice(-n);
  }

  get count(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples.length = 0;
  }
}
