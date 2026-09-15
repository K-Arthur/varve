/**
 * Retrieval metrics for the semantic-similarity evaluation harness.
 * Pure functions over ranked lists; no model knowledge here.
 */

export interface RankedResult {
  id: string;
  score: number;
}

/** Reciprocal Rank: 1/rank of first relevant hit (rank is 1-based). */
export function reciprocalRank(
  ranked: readonly RankedResult[],
  relevant: ReadonlySet<string>,
): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i]!.id)) return 1 / (i + 1);
  }
  return 0;
}

/** Mean average precision over the ranked list, capped at k. */
export function averagePrecision(
  ranked: readonly RankedResult[],
  relevant: ReadonlySet<string>,
  k = 10,
): number {
  let hits = 0;
  let sum = 0;
  for (let i = 0; i < Math.min(ranked.length, k); i++) {
    if (relevant.has(ranked[i]!.id)) {
      hits++;
      sum += hits / (i + 1);
    }
  }
  return hits === 0 ? 0 : sum / Math.min(relevant.size, k);
}

/** Discounted cumulative gain with binary relevance. */
export function nDcgAtK(
  ranked: readonly RankedResult[],
  relevant: ReadonlySet<string>,
  k = 10,
): number {
  const dcg = (list: readonly RankedResult[], set: ReadonlySet<string>) =>
    list.reduce((acc, item, i) => {
      if (!set.has(item.id)) return acc;
      return acc + 1 / Math.log2(i + 2);
    }, 0);
  const ideal = [...relevant].map((id) => ({ id, score: 1 })).sort((a, b) => b.score - a.score);
  const idcg = dcg(ideal.slice(0, k), relevant);
  if (idcg === 0) return 0;
  return dcg(ranked.slice(0, k), relevant) / idcg;
}

export interface RetrievalMetrics {
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  precisionAt10: number;
  mAP: number;
  nDCG: number;
  mrr: number;
}

export function computeRetrievalMetrics(
  queries: ReadonlyArray<{
    id: string;
    ranked: readonly RankedResult[];
    relevant: ReadonlySet<string>;
  }>,
): RetrievalMetrics {
  if (queries.length === 0) {
    return { recallAt1: 0, recallAt5: 0, recallAt10: 0, precisionAt10: 0, mAP: 0, nDCG: 0, mrr: 0 };
  }
  let r1 = 0;
  let r5 = 0;
  let r10 = 0;
  let p10 = 0;
  let ap = 0;
  let ndcg = 0;
  let mrr = 0;
  for (const q of queries) {
    if (q.relevant.size === 0) continue;
    const ranked10 = q.ranked.slice(0, 10);
    r1 += q.ranked[0] && q.relevant.has(q.ranked[0].id) ? 1 : 0;
    r5 += q.ranked.slice(0, 5).some((r) => q.relevant.has(r.id)) ? 1 : 0;
    r10 += ranked10.some((r) => q.relevant.has(r.id)) ? 1 : 0;
    p10 += ranked10.filter((r) => q.relevant.has(r.id)).length / Math.min(10, ranked10.length);
    ap += averagePrecision(q.ranked, q.relevant, 10);
    ndcg += nDcgAtK(q.ranked, q.relevant, 10);
    mrr += reciprocalRank(q.ranked, q.relevant);
  }
  const n = queries.length;
  return {
    recallAt1: r1 / n,
    recallAt5: r5 / n,
    recallAt10: r10 / n,
    precisionAt10: p10 / n,
    mAP: ap / n,
    nDCG: ndcg / n,
    mrr: mrr / n,
  };
}

/** Aggregate a list of per-query metric objects into means. */
export function meanOf(metrics: readonly RetrievalMetrics[]): RetrievalMetrics {
  const n = metrics.length || 1;
  return {
    recallAt1: metrics.reduce((a, m) => a + m.recallAt1, 0) / n,
    recallAt5: metrics.reduce((a, m) => a + m.recallAt5, 0) / n,
    recallAt10: metrics.reduce((a, m) => a + m.recallAt10, 0) / n,
    precisionAt10: metrics.reduce((a, m) => a + m.precisionAt10, 0) / n,
    mAP: metrics.reduce((a, m) => a + m.mAP, 0) / n,
    nDCG: metrics.reduce((a, m) => a + m.nDCG, 0) / n,
    mrr: metrics.reduce((a, m) => a + m.mrr, 0) / n,
  };
}

export interface DuplicateDetectionResult {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export interface DuplicateDetectionMetrics {
  precision: number;
  recall: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  f1: number;
  count: number;
}

export function duplicateMetrics(r: DuplicateDetectionResult): DuplicateDetectionMetrics {
  const { truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn } = r;
  const denomP = tp + fp;
  const denomR = tp + fn;
  const precision = denomP > 0 ? tp / denomP : 0;
  const recall = denomR > 0 ? tp / denomR : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const fnr = denomR > 0 ? fn / denomR : 0;
  return {
    precision,
    recall,
    falsePositiveRate: fpr,
    falseNegativeRate: fnr,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    count: tp + fp + tn + fn,
  };
}
