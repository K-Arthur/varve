/**
 * Candidate-generation-vs-ranking separation for prompted selection (G2).
 *
 * A promptable segmenter returns several masks whose predicted-IoU scores are
 * *ranking estimates*, not a promise that the top mask is the object the user
 * meant. This module computes bounded, inspectable per-candidate features that
 * come from the user's prompt and the candidate mask itself, orders candidates
 * with an explicit policy, and evaluates that policy with the metrics the
 * ranking contract requires (automatic top-1, oracle best-available, regret,
 * top-k acceptable recall).
 *
 * It deliberately does not contain a learned reranker and does not use area,
 * centrality, or sharpness as a universal preference: those only ever act as a
 * declared tie-break inside a score band, and only when measurement says they
 * help. See docs/quality/candidate-ranking-evaluation.md.
 */

export interface CandidateRankingPrompts {
  /** Normalized source-image coordinates, label 1 = include, 0 = exclude. */
  points?: ReadonlyArray<{ x: number; y: number; label: 0 | 1 }>;
  /** Normalized source-image box hint. */
  box?: { x1: number; y1: number; x2: number; y2: number };
}

export interface CandidateRankingFeatures {
  /** Provider-native ranking score (predicted IoU or a declared heuristic). */
  score: number;
  /** Masked fraction of the source image. */
  areaFraction: number;
  /** Positive prompt points covered by the mask. */
  includePointsCovered: number;
  includePointsTotal: number;
  /** Negative prompt points covered by the mask (lower is better). */
  excludePointsCovered: number;
  excludePointsTotal: number;
  /** Fraction of the candidate's coverage inside the box hint, or null. */
  boxOverlapFraction: number | null;
  /** Whether the masked centroid lies inside the box hint, or null. */
  boxCentroidInside: boolean | null;
  /** Connected components on a bounded review grid. */
  componentCount: number;
  /** Masked coverage outside every positive anchor's neighborhood. */
  unanchoredFraction: number;
  /**
   * Boundary-stability proxy: interior cells over boundary cells on the
   * bounded grid. Thin structures score low by construction, so this is
   * evidence, never a primary filter or a band tie-break.
   */
  stability: number;
  /** True when masked coverage touches a source image edge. */
  touchesEdge: boolean;
}

export interface CandidateRankingCase {
  caseId: string;
  category: string;
  features: ReadonlyArray<CandidateRankingFeatures>;
  /** Ground-truth or annotated per-candidate quality; oracle evaluation only. */
  candidateIoU: ReadonlyArray<number>;
  /** Provider's own selected index, for baseline comparison. */
  providerSelectedIndex: number;
}

export type CandidateRankingPolicyId =
  | 'provider'
  | 'score'
  | 'guarded-band-box'
  | 'guarded-band-area';

export interface CandidateRankingPolicyOptions {
  /** Score difference treated as a tie; defaults to the routing band constant. */
  scoreBand?: number;
  minBoxOverlapFraction?: number;
}

export const CANDIDATE_RANKING_DEFAULT_SCORE_BAND = 0.02;
export const CANDIDATE_RANKING_MIN_BOX_OVERLAP = 0.2;
/** A case is "acceptable" when its chosen candidate is within this IoU of the best available. */
export const CANDIDATE_ACCEPTABLE_REGRET = 0.1;

const GRID_MAX_DIMENSION = 512;
const GRID_CONNECTIVITY: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Compute bounded features for one candidate mask. Source scans are exact for
 * area, prompt coverage, and box overlap; component topology and stability use
 * a max-pooled review grid so the cost stays bounded for large photographs.
 */
export function computeCandidateRankingFeatures(
  mask: Uint8Array,
  width: number,
  height: number,
  prompts: CandidateRankingPrompts,
  score: number,
): CandidateRankingFeatures {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    mask.length !== width * height
  ) {
    throw new RangeError('Candidate mask must match the declared source dimensions.');
  }
  if (!Number.isFinite(score)) {
    throw new RangeError('Candidate score must be finite; unknowable intent is not a score.');
  }
  const points = prompts.points ?? [];
  const box = prompts.box ?? null;
  const gridScale = Math.max(1, Math.ceil(Math.max(width, height) / GRID_MAX_DIMENSION));
  const gridWidth = Math.max(1, Math.ceil(width / gridScale));
  const gridHeight = Math.max(1, Math.ceil(height / gridScale));
  const grid = new Uint8Array(gridWidth * gridHeight);
  const anchoredGrid = new Uint8Array(gridWidth * gridHeight);

  const pixelBox = box
    ? {
        x1: clamp01(box.x1) * (width - 1),
        y1: clamp01(box.y1) * (height - 1),
        x2: clamp01(box.x2) * (width - 1),
        y2: clamp01(box.y2) * (height - 1),
      }
    : null;
  const boxMinX = pixelBox ? Math.min(pixelBox.x1, pixelBox.x2) : 0;
  const boxMaxX = pixelBox ? Math.max(pixelBox.x1, pixelBox.x2) : 0;
  const boxMinY = pixelBox ? Math.min(pixelBox.y1, pixelBox.y2) : 0;
  const boxMaxY = pixelBox ? Math.max(pixelBox.y1, pixelBox.y2) : 0;

  let coveredPixels = 0;
  let boxCoveredPixels = 0;
  let centroidX = 0;
  let centroidY = 0;
  let touchesEdge = false;
  const anchorRadius = Math.min(8, Math.max(2, Math.ceil(Math.min(width, height) / 256)));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const gridX = Math.min(gridWidth - 1, Math.floor(x / gridScale));
      const gridY = Math.min(gridHeight - 1, Math.floor(y / gridScale));
      const gridIndex = gridY * gridWidth + gridX;
      const insideBox =
        pixelBox !== null && x >= boxMinX && x <= boxMaxX && y >= boxMinY && y <= boxMaxY;
      if (mask[index] === 0) continue;
      grid[gridIndex] = 1;
      coveredPixels += 1;
      centroidX += x;
      centroidY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      if (insideBox) boxCoveredPixels += 1;
    }
  }

  for (const point of points) {
    if (point.label !== 1) continue;
    const px = Math.round(clamp01(point.x) * (width - 1));
    const py = Math.round(clamp01(point.y) * (height - 1));
    for (let dy = -anchorRadius; dy <= anchorRadius; dy += 1) {
      for (let dx = -anchorRadius; dx <= anchorRadius; dx += 1) {
        if (dx * dx + dy * dy > anchorRadius * anchorRadius) continue;
        const sx = px + dx;
        const sy = py + dy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const gridX = Math.min(gridWidth - 1, Math.floor(sx / gridScale));
        const gridY = Math.min(gridHeight - 1, Math.floor(sy / gridScale));
        anchoredGrid[gridY * gridWidth + gridX] = 1;
      }
    }
  }

  let includePointsCovered = 0;
  let includePointsTotal = 0;
  let excludePointsCovered = 0;
  let excludePointsTotal = 0;
  for (const point of points) {
    const covered = maskValueAt(mask, width, height, point.x, point.y);
    if (point.label === 1) {
      includePointsTotal += 1;
      includePointsCovered += covered;
    } else {
      excludePointsTotal += 1;
      excludePointsCovered += covered;
    }
  }

  let anchoredCoveredCells = 0;
  let components = 0;
  const visited = new Uint8Array(gridWidth * gridHeight);
  for (let cell = 0; cell < grid.length; cell += 1) {
    if (grid[cell] === 0 || visited[cell] === 1) continue;
    components += 1;
    const queue = [cell];
    visited[cell] = 1;
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (anchoredGrid[current] === 1) anchoredCoveredCells += 1;
      const cx = current % gridWidth;
      const cy = Math.floor(current / gridWidth);
      for (const [dx, dy] of GRID_CONNECTIVITY) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const neighbour = ny * gridWidth + nx;
        if (grid[neighbour] === 0 || visited[neighbour] === 1) continue;
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }

  const coveredGridCells = grid.reduce((sum, cell) => sum + (cell === 1 ? 1 : 0), 0);
  const unanchoredFraction =
    includePointsTotal === 0 || coveredGridCells === 0
      ? 0
      : 1 - anchoredCoveredCells / coveredGridCells;

  return {
    score,
    areaFraction: coveredPixels / (width * height),
    includePointsCovered,
    includePointsTotal,
    excludePointsCovered,
    excludePointsTotal,
    boxOverlapFraction:
      pixelBox && coveredPixels > 0 ? Math.min(1, boxCoveredPixels / coveredPixels) : null,
    boxCentroidInside:
      pixelBox && coveredPixels > 0
        ? centroidX / coveredPixels >= boxMinX &&
          centroidX / coveredPixels <= boxMaxX &&
          centroidY / coveredPixels >= boxMinY &&
          centroidY / coveredPixels <= boxMaxY
        : null,
    componentCount: components,
    unanchoredFraction,
    stability: gridStability(grid, gridWidth, gridHeight),
    touchesEdge,
  };
}

/**
 * Order candidate indices under a declared policy. Every policy keeps the
 * provider's order as the final deterministic tie-break and never drops a
 * candidate: ranking cannot repair a missing best-available mask, so coverage
 * is preserved for review and keyboard cycling.
 *
 * Prompt-agreement failures are grouped below prompt-agreeing candidates, but
 * they are not removed: the caller's validation layer owns rejection, and this
 * function stays a pure ordering rule.
 */
export function rankCandidateIndices(
  features: ReadonlyArray<CandidateRankingFeatures>,
  policy: CandidateRankingPolicyId,
  options: CandidateRankingPolicyOptions = {},
): number[] {
  const indices = features.map((_, index) => index);
  if (policy === 'provider') return indices;
  const scoreBand = options.scoreBand ?? CANDIDATE_RANKING_DEFAULT_SCORE_BAND;
  const minBoxOverlap = options.minBoxOverlapFraction ?? CANDIDATE_RANKING_MIN_BOX_OVERLAP;

  return indices.sort((left, right) => {
    const leftFeature = features[left]!;
    const rightFeature = features[right]!;
    if (policy === 'score') {
      const scoreGap = rightFeature.score - leftFeature.score;
      if (Math.abs(scoreGap) > Number.EPSILON) return scoreGap > 0 ? 1 : -1;
      return left - right;
    }

    const leftRank = promptAgreementRank(leftFeature, minBoxOverlap);
    const rightRank = promptAgreementRank(rightFeature, minBoxOverlap);
    if (leftRank !== rightRank) return leftRank - rightRank;

    const scoreGap = rightFeature.score - leftFeature.score;
    if (Math.abs(scoreGap) > scoreBand) return scoreGap > 0 ? 1 : -1;
    if (policy === 'guarded-band-box') {
      const boxGap = (rightFeature.boxOverlapFraction ?? 0) - (leftFeature.boxOverlapFraction ?? 0);
      if (boxGap !== 0) return boxGap > 0 ? 1 : -1;
    }
    if (policy === 'guarded-band-area') {
      const areaGap = rightFeature.areaFraction - leftFeature.areaFraction;
      if (areaGap !== 0) return areaGap > 0 ? 1 : -1;
    }
    return left - right;
  });
}

function promptAgreementRank(feature: CandidateRankingFeatures, minBoxOverlap: number): number {
  let rank = 0;
  if (feature.includePointsTotal > 0 && feature.includePointsCovered < feature.includePointsTotal) {
    rank += 4;
  }
  if (feature.excludePointsCovered > 0) rank += 2;
  if (feature.boxOverlapFraction !== null && feature.boxOverlapFraction < minBoxOverlap) rank += 1;
  return rank;
}

export interface CandidateRankingEvaluation {
  policy: CandidateRankingPolicyId;
  cases: number;
  /** Mean IoU of the policy's top-1 candidate. */
  meanTop1IoU: number;
  /** Mean IoU of the best available candidate (oracle over candidates). */
  meanBestAvailableIoU: number;
  /** mean(bestAvailable - top1), the ranking regret under IoU. */
  meanRegret: number;
  worstRegret: number;
  /** Fraction of cases whose top-1 candidate is within the acceptable band. */
  top1AcceptableRate: number;
  /** Fraction of cases where any acceptable candidate exists in the list. */
  coverageRate: number;
  /** Count of cases whose minimum acceptable rank is k (1-based), index k-1. */
  acceptableAtK: number[];
  /** Cases where the top-1 candidate is acceptable but did not equal the oracle index. */
  acceptableNonOracle: number;
}

/**
 * Annotation-only ranking evaluation.
 *
 * Oracle IoU cannot express intent: for the same click, "the whole crab" and
 * "the eye" have different correct answers. This case shape carries an
 * explicit acceptable set (and optionally the best index) from a human
 * review, so a policy can be judged without inventing a ground-truth metric
 * that would silently disagree with the user's intent.
 *
 * `candidateIoU` is deliberately absent: IoU-based numbers must come from a
 * measured oracle, never from an annotation.
 */
export interface AnnotatedRankingCase {
  caseId: string;
  category: string;
  features: ReadonlyArray<CandidateRankingFeatures>;
  /** Candidates a reviewer accepts for this case's declared intent. */
  acceptableIndices: ReadonlyArray<number>;
  /** Reviewer's best available candidate, when one exists. */
  bestIndex?: number;
  /** Provider's own selected index at capture time. */
  providerSelectedIndex: number;
}

export interface AnnotatedRankingEvaluation {
  policy: CandidateRankingPolicyId;
  cases: number;
  /** Fraction of cases whose policy top-1 is in the acceptable set. */
  top1AcceptableRate: number;
  /** Fraction of cases with at least one acceptable candidate. */
  coverageRate: number;
  /** Cases whose first acceptable candidate appears at rank k (1-based). */
  acceptableAtK: number[];
  /** Mean 1-based rank of the first acceptable candidate, over covered cases. */
  meanClicksToAccept: number | null;
  /** Cases where no candidate was acceptable for the declared intent. */
  casesWithoutAcceptable: string[];
  /** Cases where the policy's top-1 equals the reviewer's best index. */
  top1MatchesBest: number;
}

/**
 * Evaluate declared policies against annotated cases. The ordering comes from
 * the same `rankCandidateIndices` the runtime ranker uses, so a policy that
 * looks good here is the same code path the editor runs.
 */
export function evaluateAnnotatedRankingPolicy(
  cases: ReadonlyArray<AnnotatedRankingCase>,
  policy: CandidateRankingPolicyId,
  options: CandidateRankingPolicyOptions = {},
): AnnotatedRankingEvaluation {
  const maxCandidates = Math.max(1, ...cases.map((entry) => entry.features.length));
  const acceptableAtK = new Array<number>(maxCandidates).fill(0);
  const casesWithoutAcceptable: string[] = [];
  let top1Acceptable = 0;
  let coverage = 0;
  let top1MatchesBest = 0;
  let clicksSum = 0;
  let coveredCases = 0;

  for (const entry of cases) {
    const order = rankCandidateIndices(entry.features, policy, options);
    const acceptable = new Set(entry.acceptableIndices);
    if (acceptable.size > 0) coverage += 1;
    else casesWithoutAcceptable.push(entry.caseId);

    const top1 = order[0];
    if (top1 !== undefined && acceptable.has(top1)) top1Acceptable += 1;
    if (entry.bestIndex !== undefined && top1 === entry.bestIndex) top1MatchesBest += 1;

    const rank = order.findIndex((index) => acceptable.has(index));
    if (rank >= 0) {
      coveredCases += 1;
      clicksSum += rank + 1;
      acceptableAtK[Math.min(acceptableAtK.length - 1, rank)] =
        (acceptableAtK[Math.min(acceptableAtK.length - 1, rank)] ?? 0) + 1;
    }
  }

  const count = cases.length || 1;
  return {
    policy,
    cases: cases.length,
    top1AcceptableRate: top1Acceptable / count,
    coverageRate: coverage / count,
    acceptableAtK,
    meanClicksToAccept: coveredCases > 0 ? clicksSum / coveredCases : null,
    casesWithoutAcceptable,
    top1MatchesBest,
  };
}

export function evaluateRankingPolicy(
  cases: ReadonlyArray<CandidateRankingCase>,
  policy: CandidateRankingPolicyId,
  options: CandidateRankingPolicyOptions = {},
): CandidateRankingEvaluation {
  let top1Sum = 0;
  let bestSum = 0;
  let regretSum = 0;
  let worstRegret = 0;
  let top1Acceptable = 0;
  let coverage = 0;
  let acceptableNonOracle = 0;
  const maxCandidates = Math.max(
    1,
    ...cases.map((evaluationCase) => evaluationCase.features.length),
  );
  const acceptableAtK = new Array<number>(maxCandidates).fill(0);
  for (const evaluationCase of cases) {
    const order = rankCandidateIndices(evaluationCase.features, policy, options);
    const top1 = evaluationCase.candidateIoU[order[0] ?? 0] ?? 0;
    const best = Math.max(...evaluationCase.candidateIoU, 0);
    const regret = best - top1;
    top1Sum += top1;
    bestSum += best;
    regretSum += regret;
    worstRegret = Math.max(worstRegret, regret);
    if (regret <= CANDIDATE_ACCEPTABLE_REGRET) top1Acceptable += 1;
    const acceptableIndex = order.findIndex(
      (index) => best - (evaluationCase.candidateIoU[index] ?? 0) <= CANDIDATE_ACCEPTABLE_REGRET,
    );
    if (acceptableIndex >= 0) {
      coverage += 1;
      const slot = Math.min(acceptableAtK.length - 1, acceptableIndex);
      acceptableAtK[slot] = (acceptableAtK[slot] ?? 0) + 1;
      if (acceptableIndex > 0) acceptableNonOracle += 1;
    }
  }
  const count = cases.length || 1;
  return {
    policy,
    cases: cases.length,
    meanTop1IoU: top1Sum / count,
    meanBestAvailableIoU: bestSum / count,
    meanRegret: regretSum / count,
    worstRegret,
    top1AcceptableRate: top1Acceptable / count,
    coverageRate: coverage / count,
    acceptableAtK,
    acceptableNonOracle,
  };
}

/** Per-category evaluation for worst-category regression checks. */
export function evaluateRankingPolicyByCategory(
  cases: ReadonlyArray<CandidateRankingCase>,
  policy: CandidateRankingPolicyId,
  options: CandidateRankingPolicyOptions = {},
): Record<string, CandidateRankingEvaluation> {
  const categories = [...new Set(cases.map((evaluationCase) => evaluationCase.category))].sort();
  const result: Record<string, CandidateRankingEvaluation> = {};
  for (const category of categories) {
    result[category] = evaluateRankingPolicy(
      cases.filter((evaluationCase) => evaluationCase.category === category),
      policy,
      options,
    );
  }
  return result;
}

function gridStability(grid: Uint8Array, width: number, height: number): number {
  let interior = 0;
  let boundary = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (grid[index] === 0) continue;
      const isInterior =
        x > 0 &&
        x < width - 1 &&
        y > 0 &&
        y < height - 1 &&
        grid[index - 1] === 1 &&
        grid[index + 1] === 1 &&
        grid[index - width] === 1 &&
        grid[index + width] === 1;
      if (isInterior) {
        interior += 1;
      } else {
        boundary += 1;
      }
    }
  }
  const total = interior + boundary;
  return total === 0 ? 0 : interior / total;
}

function maskValueAt(
  mask: Uint8Array,
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number,
): number {
  const x = Math.round(clamp01(normalizedX) * (width - 1));
  const y = Math.round(clamp01(normalizedY) * (height - 1));
  return mask[y * width + x] === 0 ? 0 : 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
