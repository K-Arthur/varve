/**
 * Prompt-to-mask validation for interactive Object Selection.
 *
 * A prompted segmenter may return several masks and its predicted IoU score is
 * not a guarantee that the mask refers to the user's prompt. This module is
 * the provider-independent last-mile guard: it checks source geometry,
 * include/exclude points, and the meaningful overlap of a box hint before a
 * candidate can be previewed, cycled, or committed. It also reports bounded
 * topology evidence for human review.
 */

import {
  type CandidateRankingPolicyId,
  computeCandidateRankingFeatures,
  rankCandidateIndices,
} from '@varve/engine';

export interface PromptedMaskCandidateLike {
  mask: Uint8Array;
  width: number;
  height: number;
  score: number;
}

export interface PromptedMaskPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export interface PromptedMaskBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PromptedMaskConstraints {
  points?: readonly PromptedMaskPoint[];
  box?: PromptedMaskBox;
}

export interface PromptedMaskValidation {
  /** Fraction of explicit point/box constraints satisfied by this mask. */
  promptContainment: number;
  /**
   * Bounded, source-space diagnostics for the candidate. These are evidence
   * for review, not a claim that the segmenter understood a semantic label.
   */
  diagnostics?: PromptedMaskDiagnostics;
  /** False when the candidate must not be shown or committed. */
  valid: boolean;
  /** A diagnostic reason suitable for logs/tests, not raw model output. */
  reason:
    | 'invalid-geometry'
    | 'no-prompts'
    | 'positive-anchor-required'
    | 'include-point-missed'
    | 'exclude-point-covered'
    | 'box-overlap-too-small'
    | 'mask-too-broad'
    | 'ambiguous-unanchored-region'
    | null;
  /** Sanitized source mask when unprompted islands were safely removed. */
  normalizedMask?: Uint8Array;
}

export interface PromptedMaskDiagnostics {
  /** Source-pixel coverage after the provider's hard threshold. */
  hardPixels: number;
  hardCoverage: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** Connected regions are measured on a bounded max-pooled review grid. */
  componentCount: number;
  anchoredComponentCount: number;
  /** Fraction of hard coverage in components touching a positive prompt/box. */
  anchoredCoverage: number;
  unanchoredCoverage: number;
  /** True when a sizeable disconnected region is not supported by a prompt. */
  ambiguous: boolean;
  /** Hard coverage touches an image edge that the prompts did not support. */
  edgeContact?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  /**
   * Fraction of a bounded neighbourhood covered around each positive prompt.
   * A low value means the click landed on or immediately beside the proposed
   * boundary; it is evidence that a point-only prompt is underspecified.
   */
  positiveAnchorSupport?: Array<{ pointIndex: number; coveredFraction: number }>;
  /** True when the candidate needs an extent prompt before it can be applied. */
  requiresRefinement?: boolean;
  warnings: string[];
}

export interface RankedPromptedMasks<T extends PromptedMaskCandidateLike> {
  /** Only candidates that satisfy all explicit constraints. */
  candidates: Array<T & { promptContainment: number; promptDiagnostics?: PromptedMaskDiagnostics }>;
  selectedIndex: number;
  selectedScore: number;
  rejectedCount: number;
}

const HARD_MASK_THRESHOLD = 127;
/** Decoder masks are restored from a 256px mask; allow its source-space error. */
const PROMPT_TOLERANCE_SOURCE_DIVISOR = 256;
const MAX_PROMPT_TOLERANCE_PIXELS = 8;
/** A box is a hint, but a one-pixel accidental overlap is not a match. */
const MIN_BOX_MASK_FRACTION = 0.2;
/** An almost-full-frame mask is not a useful object-selection result. */
const MAX_ACCEPTED_MASK_COVERAGE = 0.995;
/**
 * Only prune disconnected coverage when the prompted target owns most of the
 * candidate. If it does not, fail closed instead of guessing which object the
 * user intended.
 */
const MIN_ANCHORED_COVERAGE_FOR_PRUNING = 0.5;
/** A point must be deliberately placed on an image extent to support edge contact. */
const MAX_EDGE_PROMPT_SUPPORT_PIXELS = 8;
/** Do not accept a boundary-only point as sufficient object identity. */
const MIN_POSITIVE_ANCHOR_SUPPORT = 0.75;
/** Keep tiny raster fixtures usable; real photographs are much larger. */
const MIN_ANCHOR_REVIEW_DIMENSION = 32;
const MIN_ANCHOR_REVIEW_PIXELS = 16;
/**
 * Keep review diagnostics bounded on 33 MP photographs and constrained
 * devices, while retaining enough spatial resolution to see small islands in
 * ordinary photographs. Sources up to 2 MP use exact topology; larger
 * sources use a 1024-pixel review grid so several-pixel noise is less likely
 * to merge into the prompted object's component. The grid is still only a
 * bounded review allocation; full-resolution source masks remain the only
 * persisted/editable data.
 */
const MAX_DIAGNOSTIC_DIMENSION = 1024;
/** Exact topology is affordable for the common <=2 MP photograph path. */
const MAX_EXACT_DIAGNOSTIC_PIXELS = 2_000_000;
const DIAGNOSTIC_COMPONENT_CONNECTIVITY: ReadonlyArray<readonly [number, number]> = [
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
 * Validate a single source-sized candidate against normalized model prompts.
 * This intentionally proves geometry only; semantic intent still requires the
 * visible overlay and the user's confirmation.
 */
export function validatePromptedMaskCandidate(
  candidate: PromptedMaskCandidateLike,
  prompts: PromptedMaskConstraints,
  sourceWidth: number,
  sourceHeight: number,
): PromptedMaskValidation {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    candidate.width !== sourceWidth ||
    candidate.height !== sourceHeight ||
    candidate.mask.length !== sourceWidth * sourceHeight ||
    !Number.isFinite(candidate.score)
  ) {
    return invalid('invalid-geometry');
  }

  const points = prompts.points ?? [];
  const hasBox = prompts.box !== undefined;
  const constraintCount = points.length + (hasBox ? 1 : 0);
  if (constraintCount === 0) return invalid('no-prompts');
  // Negative points refine an identified object; by themselves they do not
  // identify one. A point-only request without an include anchor would leave
  // the model free to return an arbitrary foreground region.
  if (!hasBox && !points.some((point) => point.label === 1)) {
    return invalid('positive-anchor-required');
  }
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1 ||
        (point.label !== 0 && point.label !== 1),
    )
  ) {
    return invalid('invalid-geometry');
  }

  const box = hasBox ? pixelBox(prompts.box!, sourceWidth, sourceHeight) : null;
  if (hasBox && !box) return invalid('invalid-geometry', 0);
  const initialDiagnostics = analyzePromptedMaskDiagnostics(
    candidate.mask,
    sourceWidth,
    sourceHeight,
    points,
    box,
  );

  let satisfied = 0;
  for (const point of points) {
    const covered = pointCovered(candidate.mask, sourceWidth, sourceHeight, point);
    if (point.label === 1) {
      if (!covered) return invalid('include-point-missed', satisfied / constraintCount);
    } else if (covered) {
      return invalid('exclude-point-covered', satisfied / constraintCount);
    }
    satisfied += 1;
  }

  const coveredPixels = initialDiagnostics.hardPixels;

  // A one-pixel source has no meaningful boundary to review; keep this
  // degenerate case usable for callers that operate on tiny raster assets.
  if (
    sourceWidth * sourceHeight > 1 &&
    coveredPixels / (sourceWidth * sourceHeight) >= MAX_ACCEPTED_MASK_COVERAGE
  ) {
    return invalid(
      'mask-too-broad',
      satisfied / constraintCount,
      toPublicDiagnostics(initialDiagnostics),
    );
  }

  if (box) {
    const boxFraction = initialDiagnostics.boxOverlapFraction ?? 0;
    if (
      initialDiagnostics.boxCoveredPixels === 0 ||
      boxFraction < MIN_BOX_MASK_FRACTION ||
      initialDiagnostics.boxCentroidInside !== true
    ) {
      return invalid(
        'box-overlap-too-small',
        satisfied / constraintCount,
        toPublicDiagnostics(initialDiagnostics),
      );
    }
    satisfied += 1;
  }

  annotateEdgeRefinement(initialDiagnostics, points, box, sourceWidth, sourceHeight);
  annotateAnchorRefinement(
    initialDiagnostics,
    candidate.mask,
    points,
    box,
    sourceWidth,
    sourceHeight,
  );

  // A prompted mask can contain the requested object and an unrelated
  // disconnected island. Never let a small positive click implicitly accept
  // all of that coverage. When the prompted target is dominant, remove only
  // unsupported components and preserve the cleaned mask for both preview and
  // commit. If the unsupported coverage is substantial, fail closed and ask
  // for another include/exclude prompt rather than guessing.
  const hasUnanchoredComponents =
    initialDiagnostics.componentCount > initialDiagnostics.anchoredComponentCount &&
    initialDiagnostics.unanchoredCoverage > 0;
  if (hasUnanchoredComponents) {
    const publicDiagnostics = toPublicDiagnostics(initialDiagnostics);
    if (initialDiagnostics.anchoredCoverage < MIN_ANCHORED_COVERAGE_FOR_PRUNING) {
      return invalid('ambiguous-unanchored-region', satisfied / constraintCount, publicDiagnostics);
    }
    const pruned = pruneUnanchoredComponents(
      candidate.mask,
      sourceWidth,
      sourceHeight,
      initialDiagnostics,
    );
    if (pruned.removedPixels > 0) {
      const sanitizedDiagnostics = toPublicDiagnostics(
        analyzePromptedMaskDiagnostics(pruned.mask, sourceWidth, sourceHeight, points, box),
      );
      annotateEdgeRefinement(sanitizedDiagnostics, points, box, sourceWidth, sourceHeight);
      annotateAnchorRefinement(
        sanitizedDiagnostics,
        pruned.mask,
        points,
        box,
        sourceWidth,
        sourceHeight,
      );
      const removedCoverage = pruned.removedPixels / (sourceWidth * sourceHeight);
      const removedPercent =
        removedCoverage >= 0.01 ? `${Math.round(removedCoverage * 100)}%` : '<1%';
      sanitizedDiagnostics.warnings = [
        `Removed ${removedPercent} unprompted disconnected coverage; add an include point for any separate part that belongs to the target.`,
        ...sanitizedDiagnostics.warnings,
      ];
      return {
        promptContainment: satisfied / constraintCount,
        diagnostics: sanitizedDiagnostics,
        valid: true,
        reason: null,
        normalizedMask: pruned.mask,
      };
    }
  }

  return {
    promptContainment: satisfied / constraintCount,
    diagnostics: toPublicDiagnostics(initialDiagnostics),
    valid: true,
    reason: null,
  };
}

/**
 * Remove prompt-invalid candidates and choose the highest model score among
 * the remaining masks, preferring a candidate that does not need additional
 * user evidence. Keeping this decision after decoding prevents a model from
 * silently selecting a high-IoU mask for the wrong object or an
 * under-specified boundary candidate when a safer alternative is available.
 *
 * `policy` lets evaluation harnesses run the same candidate set through a
 * declared alternative ordering (see `promptedRankingEvaluation.ts`). The
 * default preserves the reviewed-score behaviour exactly.
 */
export type PromptedCandidateRankingPolicy = CandidateRankingPolicyId | 'reviewed-score';

export interface RankPromptedMaskOptions {
  policy?: PromptedCandidateRankingPolicy;
  /** Tie band for the guarded-* policies; forwarded to the engine ranker. */
  scoreBand?: number;
}

export function rankPromptedMaskCandidates<T extends PromptedMaskCandidateLike>(
  candidates: readonly T[],
  prompts: PromptedMaskConstraints,
  sourceWidth: number,
  sourceHeight: number,
  options: RankPromptedMaskOptions = {},
): RankedPromptedMasks<T> {
  const evaluated = candidates.map((candidate) => {
    const validation = validatePromptedMaskCandidate(candidate, prompts, sourceWidth, sourceHeight);
    return { candidate, validation };
  });
  const eligible = evaluated.filter(({ validation }) => validation.valid);
  const ranked = eligible.map(({ candidate, validation }) => {
    return {
      ...candidate,
      ...(validation.normalizedMask ? { mask: validation.normalizedMask } : {}),
      promptContainment: validation.promptContainment,
      promptDiagnostics: validation.diagnostics,
    };
  });
  let selectedIndex = -1;
  let selectedScore = Number.NEGATIVE_INFINITY;
  const policy = options.policy ?? 'reviewed-score';
  if (policy !== 'reviewed-score' && ranked.length > 0) {
    const features = ranked.map((candidate) =>
      computeCandidateRankingFeatures(
        candidate.mask,
        sourceWidth,
        sourceHeight,
        {
          points: prompts.points,
          ...(prompts.box ? { box: prompts.box } : {}),
        },
        candidate.score,
      ),
    );
    const order = rankCandidateIndices(features, policy, {
      ...(options.scoreBand !== undefined ? { scoreBand: options.scoreBand } : {}),
    });
    selectedIndex = order[0] ?? -1;
    selectedScore =
      selectedIndex >= 0
        ? (ranked[selectedIndex]?.score ?? Number.NEGATIVE_INFINITY)
        : Number.NEGATIVE_INFINITY;
  } else {
    for (let index = 0; index < ranked.length; index += 1) {
      const candidate = ranked[index]!;
      const diagnostics = candidate.promptDiagnostics;
      const needsRefinement = diagnostics?.requiresRefinement === true;
      const selected = ranked[selectedIndex];
      const selectedNeedsRefinement = selected?.promptDiagnostics?.requiresRefinement === true;
      if (
        selectedIndex < 0 ||
        (selectedNeedsRefinement && !needsRefinement) ||
        (selectedNeedsRefinement === needsRefinement && candidate.score > selectedScore)
      ) {
        selectedIndex = index;
        selectedScore = candidate.score;
      }
    }
  }
  return {
    candidates: ranked,
    selectedIndex,
    selectedScore,
    rejectedCount: evaluated.length - eligible.length,
  };
}

function invalid(
  reason: Exclude<PromptedMaskValidation['reason'], null>,
  promptContainment = 0,
  diagnostics?: PromptedMaskDiagnostics,
): PromptedMaskValidation {
  return { promptContainment, diagnostics, valid: false, reason };
}

function toPublicDiagnostics(
  diagnostics: InternalPromptedMaskDiagnostics,
): PromptedMaskDiagnostics {
  const {
    anchoredGrid: _anchoredGrid,
    gridWidth: _gridWidth,
    gridHeight: _gridHeight,
    boxCoveredPixels: _boxCoveredPixels,
    boxOverlapFraction: _boxOverlapFraction,
    boxCentroidInside: _boxCentroidInside,
    ...publicDiagnostics
  } = diagnostics;
  return publicDiagnostics;
}

/**
 * Remove source pixels that belong to a bounded-grid component with no
 * positive prompt or box support. This keeps the memory cost bounded for
 * large photographs and is deliberately conservative: callers only invoke
 * it after the target owns at least half of the hard candidate coverage.
 */
function pruneUnanchoredComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  diagnostics: InternalPromptedMaskDiagnostics,
): { mask: Uint8Array; removedPixels: number } {
  const normalized = new Uint8Array(mask);
  let removedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((normalized[index] ?? 0) === 0) continue;
      const gridX = Math.min(
        diagnostics.gridWidth - 1,
        Math.floor((x * diagnostics.gridWidth) / width),
      );
      const gridY = Math.min(
        diagnostics.gridHeight - 1,
        Math.floor((y * diagnostics.gridHeight) / height),
      );
      if (diagnostics.anchoredGrid[gridY * diagnostics.gridWidth + gridX] !== 0) continue;
      normalized[index] = 0;
      removedPixels += 1;
    }
  }
  return { mask: normalized, removedPixels };
}

/**
 * Check whether positive prompts land on actual source pixels. Transparent
 * image regions contain arbitrary RGB values (often transparent black), so a
 * positive click there gives a prompted model no reliable object identity and
 * can produce an unrelated high-scoring foreground mask. A small neighborhood
 * tolerates an anti-aliased edge without accepting a completely transparent
 * hole. Exclude prompts are allowed on transparency because they refine an
 * already identified target.
 */
export function validatePromptedImageAnchors(
  imageData: { data: ArrayLike<number>; width: number; height: number },
  points: readonly PromptedMaskPoint[] | undefined,
): { valid: true } | { valid: false; pointIndex: number } {
  if (
    !Number.isSafeInteger(imageData.width) ||
    !Number.isSafeInteger(imageData.height) ||
    imageData.width <= 0 ||
    imageData.height <= 0 ||
    imageData.data.length !== imageData.width * imageData.height * 4
  ) {
    return { valid: false, pointIndex: -1 };
  }
  const radius = Math.min(
    4,
    Math.max(1, Math.ceil(Math.min(imageData.width, imageData.height) / 512)),
  );
  for (const [pointIndex, point] of (points ?? []).entries()) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1 ||
      (point.label !== 0 && point.label !== 1)
    ) {
      return { valid: false, pointIndex };
    }
    if (point.label !== 1) continue;
    const x = Math.round(point.x * (imageData.width - 1));
    const y = Math.round(point.y * (imageData.height - 1));
    let hasVisibleAlpha = false;
    for (let dy = -radius; dy <= radius && !hasVisibleAlpha; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const sampleX = x + dx;
        const sampleY = y + dy;
        if (
          sampleX < 0 ||
          sampleX >= imageData.width ||
          sampleY < 0 ||
          sampleY >= imageData.height
        ) {
          continue;
        }
        if (Number(imageData.data[(sampleY * imageData.width + sampleX) * 4 + 3] ?? 0) > 0) {
          hasVisibleAlpha = true;
          break;
        }
      }
    }
    if (!hasVisibleAlpha) return { valid: false, pointIndex };
  }
  return { valid: true };
}

interface DiagnosticBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface InternalPromptedMaskDiagnostics extends PromptedMaskDiagnostics {
  boxCoveredPixels: number;
  boxOverlapFraction?: number;
  boxCentroidInside?: boolean;
  anchoredGrid: Uint8Array;
  gridWidth: number;
  gridHeight: number;
}

/**
 * Compute review diagnostics with a bounded max-pooled grid. The source scan
 * remains exact for coverage, bounds, and box containment; only connected
 * component topology is reduced. This avoids allocating a second full-size
 * visited/label buffer for large photographs while still exposing the common
 * wrong-target signal: an isolated prompted speck beside a large unprompted
 * region.
 */
function analyzePromptedMaskDiagnostics(
  mask: Uint8Array,
  width: number,
  height: number,
  points: readonly PromptedMaskPoint[],
  box: DiagnosticBox | null,
): InternalPromptedMaskDiagnostics {
  const pixelCount = width * height;
  const gridScale =
    pixelCount <= MAX_EXACT_DIAGNOSTIC_PIXELS
      ? 1
      : Math.min(1, MAX_DIAGNOSTIC_DIMENSION / Math.max(width, height));
  const gridWidth = Math.max(1, Math.round(width * gridScale));
  const gridHeight = Math.max(1, Math.round(height * gridScale));
  const gridPixels = gridWidth * gridHeight;
  const gridMask = new Uint8Array(gridPixels);
  const gridWeights = new Uint32Array(gridPixels);
  let hardPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let boxCoveredPixels = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((mask[y * width + x] ?? 0) <= HARD_MASK_THRESHOLD) continue;
      hardPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      if (box && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) {
        boxCoveredPixels += 1;
      }
      const gridX = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / width));
      const gridY = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / height));
      const gridIndex = gridY * gridWidth + gridX;
      gridMask[gridIndex] = 1;
      gridWeights[gridIndex] = (gridWeights[gridIndex] ?? 0) + 1;
    }
  }

  const labels = new Int32Array(gridPixels);
  labels.fill(-1);
  const queue = new Int32Array(gridPixels);
  const componentWeights: number[] = [];
  for (let start = 0; start < gridPixels; start += 1) {
    if (gridMask[start] === 0 || labels[start] !== -1) continue;
    const componentIndex = componentWeights.length;
    let head = 0;
    let tail = 0;
    let weight = 0;
    queue[tail++] = start;
    labels[start] = componentIndex;
    while (head < tail) {
      const current = queue[head++]!;
      weight += gridWeights[current] ?? 0;
      const x = current % gridWidth;
      const y = Math.floor(current / gridWidth);
      for (const [dx, dy] of DIAGNOSTIC_COMPONENT_CONNECTIVITY) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= gridWidth || nextY >= gridHeight) continue;
        const next = nextY * gridWidth + nextX;
        if (gridMask[next] === 0 || labels[next] !== -1) continue;
        labels[next] = componentIndex;
        queue[tail++] = next;
      }
    }
    componentWeights.push(weight);
  }

  const anchored = new Uint8Array(componentWeights.length);
  for (const point of points) {
    if (point.label !== 1) continue;
    const sourceX = Math.round(point.x * (width - 1));
    const sourceY = Math.round(point.y * (height - 1));
    const gridX = Math.min(gridWidth - 1, Math.floor((sourceX * gridWidth) / width));
    const gridY = Math.min(gridHeight - 1, Math.floor((sourceY * gridHeight) / height));
    const component = nearestComponent(labels, gridMask, gridWidth, gridHeight, gridX, gridY);
    if (component !== null) anchored[component] = 1;
  }
  if (box) {
    // A box is a location hint, not proof that every disconnected region
    // inside it belongs to one object. Anchor only the largest component
    // supported by the box; separate parts must receive their own positive
    // point instead of silently importing a neighbouring object.
    const primaryComponent = primaryBoxComponent(
      labels,
      gridWeights,
      componentWeights,
      gridWidth,
      gridHeight,
      width,
      height,
      box,
    );
    if (primaryComponent !== null) anchored[primaryComponent] = 1;
  }

  let anchoredPixels = 0;
  let anchoredComponentCount = 0;
  for (let index = 0; index < anchored.length; index += 1) {
    if (anchored[index] === 0) continue;
    anchoredComponentCount += 1;
    anchoredPixels += componentWeights[index] ?? 0;
  }
  const anchoredCoverage = hardPixels > 0 ? anchoredPixels / hardPixels : 0;
  const unanchoredCoverage = Math.max(0, 1 - anchoredCoverage);
  const ambiguous = componentWeights.length > anchoredComponentCount && unanchoredCoverage >= 0.2;
  const warnings: string[] = [];
  if (componentWeights.length > 1) {
    warnings.push(
      `The candidate contains ${componentWeights.length} disconnected regions; verify every highlighted region is part of the target.`,
    );
  }
  if (ambiguous) {
    warnings.push(
      `Only ${Math.round(anchoredCoverage * 100)}% of hard coverage is connected to the prompt; add an include point or exclude the extra region before applying.`,
    );
  }
  const bounds =
    maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  const boxCentroidMargin = Math.max(1, Math.ceil(Math.min(width, height) / 256));
  const boxCentroidInside =
    box === null ||
    (hardPixels > 0 &&
      sumX / hardPixels >= box.minX - boxCentroidMargin &&
      sumX / hardPixels <= box.maxX + boxCentroidMargin &&
      sumY / hardPixels >= box.minY - boxCentroidMargin &&
      sumY / hardPixels <= box.maxY + boxCentroidMargin);
  const anchoredGrid = new Uint8Array(gridPixels);
  for (let index = 0; index < gridPixels; index += 1) {
    const component = labels[index] ?? -1;
    if (component >= 0 && anchored[component] !== 0) anchoredGrid[index] = 1;
  }
  return {
    hardPixels,
    hardCoverage: hardPixels / pixelCount,
    bounds,
    componentCount: componentWeights.length,
    anchoredComponentCount,
    anchoredCoverage,
    unanchoredCoverage,
    ambiguous,
    warnings,
    edgeContact: {
      top: maxY >= 0 && minY === 0,
      right: maxX >= 0 && maxX === width - 1,
      bottom: maxY >= 0 && maxY === height - 1,
      left: maxX >= 0 && minX === 0,
    },
    boxCoveredPixels,
    boxOverlapFraction: hardPixels > 0 ? boxCoveredPixels / hardPixels : 0,
    boxCentroidInside,
    anchoredGrid,
    gridWidth,
    gridHeight,
  };
}

/**
 * A prompt can prove that a candidate contains the clicked region without
 * proving that it contains the complete object. Edge contact is the common
 * under-selection case for objects cropped by the source frame: require an
 * explicit prompt on that extent (or a box reaching it) before any operation
 * can mutate pixels. The candidate remains previewable so the user can see
 * exactly what needs refinement.
 */
function annotateEdgeRefinement(
  diagnostics: PromptedMaskDiagnostics,
  points: readonly PromptedMaskPoint[],
  box: DiagnosticBox | null,
  width: number,
  height: number,
): void {
  const edgeContact = diagnostics.edgeContact;
  if (!edgeContact) return;
  const tolerance = Math.max(
    1,
    Math.min(MAX_EDGE_PROMPT_SUPPORT_PIXELS, Math.ceil(Math.min(width, height) * 0.02)),
  );
  const supported = {
    top: edgePromptSupported('top', points, box, width, height, tolerance),
    right: edgePromptSupported('right', points, box, width, height, tolerance),
    bottom: edgePromptSupported('bottom', points, box, width, height, tolerance),
    left: edgePromptSupported('left', points, box, width, height, tolerance),
  };
  const unsupportedEdges = (['top', 'right', 'bottom', 'left'] as const).filter(
    (edge) => edgeContact[edge] && !supported[edge],
  );
  if (unsupportedEdges.length === 0) return;
  diagnostics.requiresRefinement = true;
  const labels = unsupportedEdges.map((edge) => `${edge} image edge`);
  diagnostics.warnings.push(
    `The candidate reaches the ${labels.join(' and ')} without an extent prompt. Add an include point on the missing extent or draw a box around the full target before applying it; this prevents a partial edge object from being edited.`,
  );
}

/**
 * A positive point on a mask boundary is not enough evidence for the extent
 * of an object. SAM-style promptable segmenters can legitimately return a
 * small region containing such a point, even when the user meant the whole
 * object. Keep the candidate visible, but require a deeper include point or a
 * box for real-image editing. A box is already an explicit extent cue, so the
 * check is intentionally limited to point-only requests.
 */
function annotateAnchorRefinement(
  diagnostics: PromptedMaskDiagnostics,
  mask: Uint8Array,
  points: readonly PromptedMaskPoint[],
  box: DiagnosticBox | null,
  width: number,
  height: number,
): void {
  const positivePoints = points
    .map((point, pointIndex) => ({ point, pointIndex }))
    .filter(({ point }) => point.label === 1);
  if (positivePoints.length === 0) return;

  const supportRadius = Math.max(1, Math.min(16, Math.ceil(Math.min(width, height) / 64)));
  diagnostics.positiveAnchorSupport = positivePoints.map(({ point, pointIndex }) => ({
    pointIndex,
    coveredFraction: positivePointSupport(mask, point, width, height, supportRadius),
  }));

  if (
    box ||
    Math.min(width, height) < MIN_ANCHOR_REVIEW_DIMENSION ||
    diagnostics.hardPixels < MIN_ANCHOR_REVIEW_PIXELS ||
    diagnostics.positiveAnchorSupport.some(
      ({ coveredFraction }) => coveredFraction >= MIN_POSITIVE_ANCHOR_SUPPORT,
    )
  ) {
    return;
  }

  diagnostics.requiresRefinement = true;
  diagnostics.warnings.push(
    'The include point is on or near the candidate boundary. Add another include point deeper inside the intended object or draw a box before applying it; a boundary click cannot establish the object extent.',
  );
}

function positivePointSupport(
  mask: Uint8Array,
  point: PromptedMaskPoint,
  width: number,
  height: number,
  radius: number,
): number {
  let covered = 0;
  let samples = 0;
  const centerX = Math.round(point.x * (width - 1));
  const centerY = Math.round(point.y * (height - 1));
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const sampleX = centerX + dx;
      const sampleY = centerY + dy;
      if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
      samples += 1;
      if ((mask[sampleY * width + sampleX] ?? 0) > HARD_MASK_THRESHOLD) covered += 1;
    }
  }
  return samples > 0 ? covered / samples : 0;
}

function edgePromptSupported(
  edge: 'top' | 'right' | 'bottom' | 'left',
  points: readonly PromptedMaskPoint[],
  box: DiagnosticBox | null,
  width: number,
  height: number,
  tolerance: number,
): boolean {
  if (box) {
    if (edge === 'top' && box.minY <= tolerance) return true;
    if (edge === 'right' && box.maxX >= width - 1 - tolerance) return true;
    if (edge === 'bottom' && box.maxY >= height - 1 - tolerance) return true;
    if (edge === 'left' && box.minX <= tolerance) return true;
  }
  return points.some((point) => {
    if (point.label !== 1) return false;
    const x = point.x * (width - 1);
    const y = point.y * (height - 1);
    if (edge === 'top') return y <= tolerance;
    if (edge === 'right') return x >= width - 1 - tolerance;
    if (edge === 'bottom') return y >= height - 1 - tolerance;
    return x <= tolerance;
  });
}

function nearestComponent(
  labels: Int32Array,
  gridMask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number | null {
  const direct = labels[y * width + x];
  if (direct !== undefined && direct >= 0 && gridMask[y * width + x] !== 0) return direct;
  for (let radius = 1; radius <= 2; radius += 1) {
    let best: number | null = null;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const sampleX = x + dx;
        const sampleY = y + dy;
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
        const label = labels[sampleY * width + sampleX];
        if (label !== undefined && label >= 0) best = label;
      }
    }
    if (best !== null) return best;
  }
  return null;
}

function primaryBoxComponent(
  labels: Int32Array,
  gridWeights: Uint32Array,
  componentWeights: readonly number[],
  gridWidth: number,
  gridHeight: number,
  width: number,
  height: number,
  box: DiagnosticBox,
): number | null {
  const boxWeights = new Uint32Array(componentWeights.length);
  for (let index = 0; index < labels.length; index += 1) {
    const component = labels[index];
    if (component === undefined || component < 0) continue;
    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    const cellMinX = Math.floor((x * width) / gridWidth);
    const cellMaxX = Math.ceil(((x + 1) * width) / gridWidth) - 1;
    const cellMinY = Math.floor((y * height) / gridHeight);
    const cellMaxY = Math.ceil(((y + 1) * height) / gridHeight) - 1;
    if (
      cellMaxX >= box.minX &&
      cellMinX <= box.maxX &&
      cellMaxY >= box.minY &&
      cellMinY <= box.maxY
    ) {
      boxWeights[component] = (boxWeights[component] ?? 0) + (gridWeights[index] ?? 0);
    }
  }

  let primary: number | null = null;
  for (let component = 0; component < boxWeights.length; component += 1) {
    const weight = boxWeights[component] ?? 0;
    if (weight === 0) continue;
    if (
      primary === null ||
      weight > (boxWeights[primary] ?? 0) ||
      (weight === (boxWeights[primary] ?? 0) &&
        (componentWeights[component] ?? 0) > (componentWeights[primary] ?? 0))
    ) {
      primary = component;
    }
  }
  return primary;
}

function pointCovered(
  mask: Uint8Array,
  width: number,
  height: number,
  point: PromptedMaskPoint,
): boolean {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  ) {
    return false;
  }
  const x = Math.round(point.x * (width - 1));
  const y = Math.round(point.y * (height - 1));
  const radius =
    point.label === 1
      ? Math.min(
          MAX_PROMPT_TOLERANCE_PIXELS,
          Math.max(1, Math.ceil(Math.min(width, height) / PROMPT_TOLERANCE_SOURCE_DIVISOR)),
        )
      : 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const sampleX = x + dx;
      const sampleY = y + dy;
      if (
        sampleX >= 0 &&
        sampleX < width &&
        sampleY >= 0 &&
        sampleY < height &&
        (mask[sampleY * width + sampleX] ?? 0) > HARD_MASK_THRESHOLD
      ) {
        return true;
      }
    }
  }
  return false;
}

function pixelBox(
  box: PromptedMaskBox,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (
    ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite) ||
    box.x1 < 0 ||
    box.x1 > 1 ||
    box.y1 < 0 ||
    box.y1 > 1 ||
    box.x2 < 0 ||
    box.x2 > 1 ||
    box.y2 < 0 ||
    box.y2 > 1 ||
    box.x2 <= box.x1 ||
    box.y2 <= box.y1
  ) {
    return null;
  }
  const minX = Math.max(0, Math.min(width - 1, Math.floor(box.x1 * width)));
  const minY = Math.max(0, Math.min(height - 1, Math.floor(box.y1 * height)));
  const maxX = Math.max(minX, Math.min(width - 1, Math.ceil(box.x2 * width) - 1));
  const maxY = Math.max(minY, Math.min(height - 1, Math.ceil(box.y2 * height) - 1));
  return { minX, minY, maxX, maxY };
}
