/** Retrieval metrics for a held-out, caller-owned similarity corpus. */

export interface LabeledQuery {
  queryId: string;
  relevantIds: ReadonlySet<string>;
}

export interface RetrievalMetrics {
  queryCount: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  meanAveragePrecision: number;
  meanReciprocalRank: number;
}

export function evaluateRetrieval(
  queries: readonly LabeledQuery[],
  rankings: ReadonlyMap<string, readonly string[]>,
): RetrievalMetrics {
  if (queries.length === 0) {
    return {
      queryCount: 0,
      recallAt1: 0,
      recallAt5: 0,
      recallAt10: 0,
      meanAveragePrecision: 0,
      meanReciprocalRank: 0,
    };
  }
  let recallAt1 = 0;
  let recallAt5 = 0;
  let recallAt10 = 0;
  let meanAveragePrecision = 0;
  let meanReciprocalRank = 0;
  for (const query of queries) {
    const ranked = rankings.get(query.queryId) ?? [];
    const relevant = query.relevantIds;
    if (ranked.slice(0, 1).some((id) => relevant.has(id))) recallAt1 += 1;
    if (ranked.slice(0, 5).some((id) => relevant.has(id))) recallAt5 += 1;
    if (ranked.slice(0, 10).some((id) => relevant.has(id))) recallAt10 += 1;
    let hits = 0;
    let averagePrecision = 0;
    let reciprocalRank = 0;
    for (let index = 0; index < ranked.length; index += 1) {
      if (!relevant.has(ranked[index] ?? '')) continue;
      hits += 1;
      averagePrecision += hits / (index + 1);
      if (reciprocalRank === 0) reciprocalRank = 1 / (index + 1);
    }
    meanAveragePrecision += relevant.size ? averagePrecision / relevant.size : 0;
    meanReciprocalRank += reciprocalRank;
  }
  const count = queries.length;
  return {
    queryCount: count,
    recallAt1: recallAt1 / count,
    recallAt5: recallAt5 / count,
    recallAt10: recallAt10 / count,
    meanAveragePrecision: meanAveragePrecision / count,
    meanReciprocalRank: meanReciprocalRank / count,
  };
}
