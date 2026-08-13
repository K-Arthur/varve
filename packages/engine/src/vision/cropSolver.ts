import type { FaceDetection, VisionBox, VisionRect } from './types';

export interface FaceAwareCropOptions {
  /** Fraction of the larger face dimension added on every side. */
  safetyMargin?: number;
  /** Minimum margin in source pixels, useful for small faces. */
  minimumSafetyMargin?: number;
  /** Ignore detections below this model-confidence threshold. */
  minimumConfidence?: number;
  /** Optional normalized importance supplied by a user or workflow. */
  defaultImportance?: number;
  /** Used only for the no-face fallback; defaults to source center. */
  fallbackFocus?: { x: number; y: number };
}

export interface FaceAwareCropSuggestion {
  crop: VisionRect;
  detectedFaces: number;
  coveredFaceIds: readonly string[];
  usedFallback: boolean;
}

const EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteBox(box: VisionBox, sourceWidth: number, sourceHeight: number): VisionBox | null {
  if (![box.x, box.y, box.width, box.height, box.score].every(Number.isFinite)) return null;
  const x = clamp(box.x, 0, sourceWidth);
  const y = clamp(box.y, 0, sourceHeight);
  const right = clamp(box.x + box.width, 0, sourceWidth);
  const bottom = clamp(box.y + box.height, 0, sourceHeight);
  if (right - x <= EPSILON || bottom - y <= EPSILON) return null;
  return { ...box, x, y, width: right - x, height: bottom - y };
}

function expandBox(
  box: VisionBox,
  sourceWidth: number,
  sourceHeight: number,
  options: Required<Pick<FaceAwareCropOptions, 'safetyMargin' | 'minimumSafetyMargin'>>,
): VisionBox {
  const margin = Math.max(
    options.minimumSafetyMargin,
    Math.max(box.width, box.height) * options.safetyMargin,
  );
  const x = clamp(box.x - margin, 0, sourceWidth);
  const y = clamp(box.y - margin, 0, sourceHeight);
  const right = clamp(box.x + box.width + margin, 0, sourceWidth);
  const bottom = clamp(box.y + box.height + margin, 0, sourceHeight);
  return { ...box, x, y, width: right - x, height: bottom - y };
}

function cropForCenter(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): VisionRect {
  const x = clamp(centerX - width / 2, 0, sourceWidth - width);
  const y = clamp(centerY - height / 2, 0, sourceHeight - height);
  return { x, y, width, height };
}

function intersectionArea(a: VisionRect, b: VisionRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function scoreCrop(
  crop: VisionRect,
  faces: readonly { id: string; box: VisionBox; weight: number }[],
): number {
  return faces.reduce((score, face) => {
    const area = face.box.width * face.box.height;
    const coverage = area <= EPSILON ? 0 : intersectionArea(crop, face.box) / area;
    const leftMargin = (face.box.x - crop.x) / Math.max(crop.width, 1);
    const rightMargin =
      (crop.x + crop.width - (face.box.x + face.box.width)) / Math.max(crop.width, 1);
    const topMargin = (face.box.y - crop.y) / Math.max(crop.height, 1);
    const bottomMargin =
      (crop.y + crop.height - (face.box.y + face.box.height)) / Math.max(crop.height, 1);
    const marginScore = clamp(Math.min(leftMargin, rightMargin, topMargin, bottomMargin) * 5, 0, 1);
    return score + face.weight * (coverage * 0.8 + marginScore * 0.2);
  }, 0);
}

/**
 * Suggest a source-pixel crop at a target aspect ratio.
 *
 * The crop window is fixed by the target ratio; detections influence its
 * position only. Large/confident faces receive more weight, while a tiny
 * background face cannot force an extreme zoom-out. The returned rectangle
 * is safe to persist as ImageFillData.crop and never mutates source pixels.
 */
export function suggestFaceAwareCrop(
  source: { width: number; height: number },
  target: { width: number; height: number },
  faces: readonly FaceDetection[],
  options: FaceAwareCropOptions = {},
): FaceAwareCropSuggestion {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    !Number.isFinite(target.width) ||
    !Number.isFinite(target.height) ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    throw new Error('Source and target dimensions must be positive finite numbers.');
  }

  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const targetRatio = target.width / target.height;
  const cropWidth =
    sourceWidth / sourceHeight > targetRatio ? sourceHeight * targetRatio : sourceWidth;
  const cropHeight = cropWidth / targetRatio;
  const safetyMargin = options.safetyMargin ?? 0.28;
  const minimumSafetyMargin = options.minimumSafetyMargin ?? 12;
  const minimumConfidence = options.minimumConfidence ?? 0.25;
  const validFaces = faces
    .map((face) => ({ ...face, box: finiteBox(face.box, sourceWidth, sourceHeight) }))
    .filter(
      (face): face is FaceDetection & { box: VisionBox } =>
        Boolean(face.box) && face.confidence >= minimumConfidence,
    )
    .map((face) => {
      const box = expandBox(face.box, sourceWidth, sourceHeight, {
        safetyMargin,
        minimumSafetyMargin,
      });
      const areaWeight = Math.sqrt(
        (face.box.width * face.box.height) / (sourceWidth * sourceHeight),
      );
      return {
        id: face.id,
        box,
        weight:
          Math.max(0.1, face.confidence) *
          Math.max(0.25, face.importance ?? options.defaultImportance ?? 1) *
          Math.max(0.25, areaWeight),
      };
    });

  const fallbackFocus = options.fallbackFocus ?? { x: sourceWidth / 2, y: sourceHeight / 2 };
  if (validFaces.length === 0) {
    return {
      crop: cropForCenter(
        fallbackFocus.x,
        fallbackFocus.y,
        cropWidth,
        cropHeight,
        sourceWidth,
        sourceHeight,
      ),
      detectedFaces: 0,
      coveredFaceIds: [],
      usedFallback: true,
    };
  }

  const weightedCenter = validFaces.reduce(
    (center, face) => {
      const weight = face.weight;
      return {
        x: center.x + (face.box.x + face.box.width / 2) * weight,
        y: center.y + (face.box.y + face.box.height / 2) * weight,
        weight: center.weight + weight,
      };
    },
    { x: 0, y: 0, weight: 0 },
  );
  weightedCenter.x /= weightedCenter.weight;
  weightedCenter.y /= weightedCenter.weight;

  const minX = Math.min(...validFaces.map((face) => face.box.x));
  const minY = Math.min(...validFaces.map((face) => face.box.y));
  const maxX = Math.max(...validFaces.map((face) => face.box.x + face.box.width));
  const maxY = Math.max(...validFaces.map((face) => face.box.y + face.box.height));
  const unionCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const candidates = [
    weightedCenter,
    unionCenter,
    { x: sourceWidth / 2, y: sourceHeight / 2 },
    ...validFaces.map((face) => ({
      x: face.box.x + face.box.width / 2,
      y: face.box.y + face.box.height / 2,
    })),
  ];
  const best = candidates
    .map((center) =>
      cropForCenter(center.x, center.y, cropWidth, cropHeight, sourceWidth, sourceHeight),
    )
    .sort((a, b) => scoreCrop(b, validFaces) - scoreCrop(a, validFaces))[0]!;
  const coveredFaceIds = validFaces
    .filter((face) => intersectionArea(best, face.box) >= face.box.width * face.box.height - 0.5)
    .map((face) => face.id);

  return { crop: best, detectedFaces: validFaces.length, coveredFaceIds, usedFallback: false };
}
