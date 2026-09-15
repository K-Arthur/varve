/**
 * Prompt-to-mask validation for interactive Object Selection.
 *
 * A prompted segmenter may return several masks and its predicted IoU score is
 * not a guarantee that the mask refers to the user's prompt. This module is
 * the provider-independent last-mile guard: it checks source geometry,
 * include/exclude points, and the meaningful overlap of a box hint before a
 * candidate can be previewed, cycled, or committed.
 */

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
  /** False when the candidate must not be shown or committed. */
  valid: boolean;
  /** A diagnostic reason suitable for logs/tests, not raw model output. */
  reason:
    | 'invalid-geometry'
    | 'no-prompts'
    | 'include-point-missed'
    | 'exclude-point-covered'
    | 'box-overlap-too-small'
    | 'mask-too-broad'
    | null;
}

export interface RankedPromptedMasks<T extends PromptedMaskCandidateLike> {
  /** Only candidates that satisfy all explicit constraints. */
  candidates: Array<T & { promptContainment: number }>;
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

  let coveredPixels = 0;
  let boxCoveredPixels = 0;
  let sumX = 0;
  let sumY = 0;
  const box = hasBox ? pixelBox(prompts.box!, sourceWidth, sourceHeight) : null;
  if (hasBox && !box) return invalid('invalid-geometry', satisfied / constraintCount);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      if ((candidate.mask[y * sourceWidth + x] ?? 0) <= HARD_MASK_THRESHOLD) continue;
      coveredPixels += 1;
      sumX += x;
      sumY += y;
      if (box && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) {
        boxCoveredPixels += 1;
      }
    }
  }

  if (coveredPixels / (sourceWidth * sourceHeight) >= MAX_ACCEPTED_MASK_COVERAGE) {
    return invalid('mask-too-broad', satisfied / constraintCount);
  }

  if (box) {
    const boxFraction = coveredPixels > 0 ? boxCoveredPixels / coveredPixels : 0;
    const centroidX = coveredPixels > 0 ? sumX / coveredPixels : -1;
    const centroidY = coveredPixels > 0 ? sumY / coveredPixels : -1;
    const centroidMargin = Math.max(1, Math.ceil(Math.min(sourceWidth, sourceHeight) / 256));
    const centroidInside =
      centroidX >= box.minX - centroidMargin &&
      centroidX <= box.maxX + centroidMargin &&
      centroidY >= box.minY - centroidMargin &&
      centroidY <= box.maxY + centroidMargin;
    if (boxCoveredPixels === 0 || boxFraction < MIN_BOX_MASK_FRACTION || !centroidInside) {
      return invalid('box-overlap-too-small', satisfied / constraintCount);
    }
    satisfied += 1;
  }

  return {
    promptContainment: satisfied / constraintCount,
    valid: true,
    reason: null,
  };
}

/**
 * Remove prompt-invalid candidates and choose the highest model score among
 * the remaining masks. Keeping this decision after decoding prevents a model
 * from silently selecting a high-IoU mask for the wrong object.
 */
export function rankPromptedMaskCandidates<T extends PromptedMaskCandidateLike>(
  candidates: readonly T[],
  prompts: PromptedMaskConstraints,
  sourceWidth: number,
  sourceHeight: number,
): RankedPromptedMasks<T> {
  const evaluated = candidates.map((candidate) => {
    const validation = validatePromptedMaskCandidate(candidate, prompts, sourceWidth, sourceHeight);
    return { candidate, validation };
  });
  const eligible = evaluated.filter(({ validation }) => validation.valid);
  let selectedIndex = -1;
  let selectedScore = Number.NEGATIVE_INFINITY;
  const ranked = eligible.map(({ candidate, validation }, index) => {
    if (
      selectedIndex < 0 ||
      (Number.isFinite(candidate.score) && candidate.score > selectedScore)
    ) {
      selectedIndex = index;
      selectedScore = candidate.score;
    }
    return { ...candidate, promptContainment: validation.promptContainment };
  });
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
): PromptedMaskValidation {
  return { promptContainment, valid: false, reason };
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
