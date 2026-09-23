/**
 * Frozen-candidate-set ranking evaluation (G2).
 *
 * Candidate generation and candidate ranking are separate stages: if the best
 * available mask is never generated, no ranker can recover it. This module
 * evaluates ranking policies against frozen candidate sets (masks + scores +
 * prompt) so a policy change can be judged on top-1 quality, oracle gap,
 * acceptable-candidate recall, and click/cycle cost without re-running any
 * encoder.
 *
 * Two evidence shapes are supported:
 * - measured oracle IoU per candidate (synthetic corpus, deterministic), and
 * - human-annotated acceptable/best indices (real photographs).
 */

import {
  CANDIDATE_ACCEPTABLE_REGRET,
  type CandidateRankingFeatures,
  type CandidateRankingPolicyId,
  type CandidateRankingPrompts,
  computeCandidateRankingFeatures,
  decodeMaskRle,
  rankCandidateIndices,
} from '@varve/engine';
import {
  type PromptedCandidateRankingPolicy,
  rankPromptedMaskCandidates,
} from './promptedMaskValidation';

export interface FrozenCandidate {
  score: number;
  /** PackBits-style run-length encoded binary mask, row-major. */
  rle: number[];
}

export interface FrozenCandidateSet {
  caseId: string;
  category: string;
  width: number;
  height: number;
  prompts: CandidateRankingPrompts;
  candidates: FrozenCandidate[];
  /** Measured oracle IoU per candidate, aligned with `candidates`. */
  candidateIoU?: number[];
  /** Human annotation: candidates a reviewer accepts for this prompt. */
  acceptableIndices?: number[];
  /** Human annotation: the best available candidate. */
  bestIndex?: number;
}

export interface FrozenPolicyEvaluation {
  policy: PromptedCandidateRankingPolicy;
  cases: number;
  /** Mean IoU of the policy's top-1 candidate; null when unmeasured. */
  meanTop1IoU: number | null;
  meanBestAvailableIoU: number | null;
  meanRegret: number | null;
  worstRegret: number | null;
  /** Fraction of cases whose top-1 is acceptable or within the regret band. */
  top1AcceptableRate: number;
  /** Fraction of cases with at least one acceptable candidate. */
  coverageRate: number;
  /** acceptableAtK[k-1] = cases whose first acceptable candidate is at rank k. */
  acceptableAtK: number[];
  /** Cases where the top-1 is acceptable without being the oracle-best. */
  acceptableNonOracle: number;
  /** Candidates the validation layer rejected (never selectable). */
  rejectedCandidates: number;
  perCategory: Record<
    string,
    { cases: number; meanTop1IoU: number | null; top1AcceptableRate: number }
  >;
}

interface EvaluatedSet {
  policy: PromptedCandidateRankingPolicy;
  order: number[];
  originalIndices: number[];
  selectedOriginalIndex: number | null;
  rejectedCandidates: number;
  candidateIoU?: number[];
  acceptableOriginalIndices: number[];
  bestOriginalIndex: number | null;
}

function featuresFor(
  masks: Uint8Array[],
  scores: number[],
  set: FrozenCandidateSet,
): CandidateRankingFeatures[] {
  return masks.map((mask, index) =>
    computeCandidateRankingFeatures(mask, set.width, set.height, set.prompts, scores[index] ?? 0),
  );
}

/**
 * Run one frozen set through the real ranker. `ranked.candidates` preserves
 * the eligible order, so a parallel index tag recovers original candidate
 * identities for oracle metrics.
 */
function evaluateSet(
  set: FrozenCandidateSet,
  policy: PromptedCandidateRankingPolicy,
): EvaluatedSet {
  const masks = set.candidates.map((candidate) =>
    decodeMaskRle(candidate.rle, set.width * set.height),
  );
  const tagged = masks.map((mask, index) => ({
    index,
    mask,
    width: set.width,
    height: set.height,
    score: set.candidates[index]?.score ?? 0,
  }));
  const ranked = rankPromptedMaskCandidates(tagged, set.prompts, set.width, set.height, {
    policy,
  });
  const originalIndices = ranked.candidates.map((candidate) => candidate.index);
  let order: number[];
  if (policy === 'reviewed-score') {
    order = orderForReviewedScore(ranked.candidates);
  } else {
    const features = featuresFor(
      ranked.candidates.map((candidate) => candidate.mask),
      ranked.candidates.map((candidate) => candidate.score),
      set,
    );
    order = rankCandidateIndices(features, policy as CandidateRankingPolicyId);
  }
  const selectedPosition = policy === 'reviewed-score' ? ranked.selectedIndex : (order[0] ?? -1);
  const selectedOriginalIndex =
    selectedPosition >= 0 ? (originalIndices[selectedPosition] ?? null) : null;

  let acceptableOriginalIndices: number[] = [];
  let bestOriginalIndex: number | null = null;
  if (set.candidateIoU) {
    const best = Math.max(...set.candidateIoU);
    bestOriginalIndex = set.candidateIoU.indexOf(best);
    acceptableOriginalIndices = set.candidateIoU
      .map((iou, index) => ({ iou, index }))
      .filter(({ iou }) => best - iou <= CANDIDATE_ACCEPTABLE_REGRET)
      .map(({ index }) => index);
  }
  if (set.acceptableIndices && set.acceptableIndices.length > 0) {
    acceptableOriginalIndices = [...new Set(set.acceptableIndices)];
  }
  if (set.bestIndex !== undefined) bestOriginalIndex = set.bestIndex;

  return {
    policy,
    order,
    originalIndices,
    selectedOriginalIndex,
    rejectedCandidates: ranked.rejectedCount,
    ...(set.candidateIoU ? { candidateIoU: set.candidateIoU } : {}),
    acceptableOriginalIndices,
    bestOriginalIndex,
  };
}

/**
 * The reviewed-score ordering: complete candidates before refinement-needed
 * ones, then provider score descending, stable on ties. This mirrors the
 * default ranker loop and is asserted against `selectedIndex` in tests.
 */
function orderForReviewedScore<
  T extends { score: number; promptDiagnostics?: { requiresRefinement?: boolean } },
>(candidates: readonly T[]): number[] {
  return candidates
    .map((candidate, index) => ({ index, candidate }))
    .sort((left, right) => {
      const leftRefinement = left.candidate.promptDiagnostics?.requiresRefinement === true ? 1 : 0;
      const rightRefinement =
        right.candidate.promptDiagnostics?.requiresRefinement === true ? 1 : 0;
      if (leftRefinement !== rightRefinement) return leftRefinement - rightRefinement;
      if (right.candidate.score !== left.candidate.score) {
        return right.candidate.score - left.candidate.score;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.index);
}

export function evaluateFrozenCandidateSets(
  sets: readonly FrozenCandidateSet[],
  policies: readonly PromptedCandidateRankingPolicy[],
): FrozenPolicyEvaluation[] {
  return policies.map((policy) => summarize(sets, policy));
}

function summarize(
  sets: readonly FrozenCandidateSet[],
  policy: PromptedCandidateRankingPolicy,
): FrozenPolicyEvaluation {
  const maxCandidates = Math.max(1, ...sets.map((set) => set.candidates.length));
  const acceptableAtK = new Array<number>(maxCandidates).fill(0);
  let top1Sum = 0;
  let bestSum = 0;
  let regretSum = 0;
  let worstRegret = 0;
  let iouCases = 0;
  let top1Acceptable = 0;
  let coverage = 0;
  let acceptableNonOracle = 0;
  let rejectedCandidates = 0;
  const perCategory: FrozenPolicyEvaluation['perCategory'] = {};

  for (const set of sets) {
    const evaluated = evaluateSet(set, policy);
    rejectedCandidates += evaluated.rejectedCandidates;
    const acceptable = new Set(evaluated.acceptableOriginalIndices);
    if (acceptable.size > 0) coverage += 1;

    const firstAcceptableRank = evaluated.order.findIndex((position) => {
      const original = evaluated.originalIndices[position];
      return original !== undefined && acceptable.has(original);
    });
    const selected = evaluated.selectedOriginalIndex;
    const top1IsAcceptable = selected !== null && acceptable.has(selected);
    if (top1IsAcceptable) top1Acceptable += 1;
    if (firstAcceptableRank >= 0) {
      const slot = Math.min(acceptableAtK.length - 1, firstAcceptableRank);
      acceptableAtK[slot] = (acceptableAtK[slot] ?? 0) + 1;
      if (firstAcceptableRank > 0) acceptableNonOracle += 1;
    }

    let caseTop1IoU: number | null = null;
    if (evaluated.candidateIoU) {
      const best = Math.max(...evaluated.candidateIoU);
      const top1 = selected !== null ? (evaluated.candidateIoU[selected] ?? 0) : 0;
      const regret = best - top1;
      top1Sum += top1;
      bestSum += best;
      regretSum += regret;
      worstRegret = Math.max(worstRegret, regret);
      iouCases += 1;
      caseTop1IoU = top1;
    }

    const bucket = perCategory[set.category] ?? {
      cases: 0,
      meanTop1IoU: null,
      top1AcceptableRate: 0,
    };
    perCategory[set.category] = bucket;
    bucket.cases += 1;
    if (caseTop1IoU !== null) {
      bucket.meanTop1IoU =
        bucket.meanTop1IoU === null
          ? caseTop1IoU
          : (bucket.meanTop1IoU * (bucket.cases - 1) + caseTop1IoU) / bucket.cases;
    }
    bucket.top1AcceptableRate =
      (bucket.top1AcceptableRate * (bucket.cases - 1) + (top1IsAcceptable ? 1 : 0)) / bucket.cases;
  }

  const count = sets.length || 1;
  return {
    policy,
    cases: sets.length,
    meanTop1IoU: iouCases > 0 ? top1Sum / iouCases : null,
    meanBestAvailableIoU: iouCases > 0 ? bestSum / iouCases : null,
    meanRegret: iouCases > 0 ? regretSum / iouCases : null,
    worstRegret: iouCases > 0 ? worstRegret : null,
    top1AcceptableRate: top1Acceptable / count,
    coverageRate: coverage / count,
    acceptableAtK,
    acceptableNonOracle,
    rejectedCandidates,
    perCategory,
  };
}
