/**
 * Convert editor-space Object Selection prompts into source-image coordinates.
 *
 * The model consumes normalized coordinates in the untransformed source image,
 * while the pointer tool records document/world coordinates.  In particular,
 * a world-space box is not generally axis-aligned after image rotation or a
 * flip, so all four corners must participate in the source-space bounds.
 */
import type { PreparedImageMaskMapper } from './imageMaskCoordinates';

export interface Sam2WorldPrompts {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Prompts already expressed in normalized source-image coordinates.
 *
 * Automated detectors produce this form. It must not be passed through the
 * world-space mapper as if it were a canvas coordinate: doing so only appears
 * correct when the image happens to be laid out at its natural size.
 */
export interface Sam2SourcePrompts {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
}

export interface Sam2NormalizedPrompts {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
  /** Prompts that could not be mapped to visible source-image pixels. */
  unmappedPointCount: number;
  /** Box corners that could not be mapped to visible source-image pixels. */
  unmappedBoxCornerCount: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(point: { x: number; y: number } | null): point is { x: number; y: number } {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizedSourceBox(box: Sam2SourcePrompts['box']): Sam2SourcePrompts['box'] | null {
  if (
    !box ||
    !normalizedCoordinate(box.x1) ||
    !normalizedCoordinate(box.y1) ||
    !normalizedCoordinate(box.x2) ||
    !normalizedCoordinate(box.y2)
  ) {
    return null;
  }
  const x1 = Math.min(box.x1, box.x2);
  const y1 = Math.min(box.y1, box.y2);
  const x2 = Math.max(box.x1, box.x2);
  const y2 = Math.max(box.y1, box.y2);
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
}

/** Validate source-space prompts without applying any layout transform. */
export function normalizeSourceSam2Prompts(prompts: Sam2SourcePrompts): Sam2NormalizedPrompts {
  const result: Sam2NormalizedPrompts = {
    unmappedPointCount: 0,
    unmappedBoxCornerCount: 0,
  };
  if (prompts.points) {
    result.points = prompts.points.flatMap((point) => {
      if (
        !normalizedCoordinate(point.x) ||
        !normalizedCoordinate(point.y) ||
        (point.label !== 0 && point.label !== 1)
      ) {
        result.unmappedPointCount += 1;
        return [];
      }
      return [{ x: point.x, y: point.y, label: point.label }];
    });
  }
  if (prompts.box) {
    const box = normalizedSourceBox(prompts.box);
    if (!box) {
      result.unmappedBoxCornerCount = 4;
    } else {
      result.box = box;
    }
  }
  return result;
}

/**
 * Combine exact automated source prompts with prompts mapped from the live
 * canvas. An automated box remains authoritative, while later manual points
 * are still included instead of being silently discarded.
 */
export function mergeSam2NormalizedPrompts(
  exact: Sam2NormalizedPrompts,
  mapped: Sam2NormalizedPrompts,
): Sam2NormalizedPrompts {
  const points = [...(exact.points ?? []), ...(mapped.points ?? [])];
  return {
    ...(points.length > 0 ? { points } : {}),
    ...((exact.box ?? mapped.box) ? { box: exact.box ?? mapped.box } : {}),
    unmappedPointCount: exact.unmappedPointCount + mapped.unmappedPointCount,
    unmappedBoxCornerCount: exact.unmappedBoxCornerCount + mapped.unmappedBoxCornerCount,
  };
}

/**
 * Map source-space prompts only for display in the document/canvas overlay.
 * The returned box is an axis-aligned world-space envelope; inference must
 * continue to use the original source-space prompt so a rotated or flipped
 * image does not silently widen the model hint.
 */
export function mapSourceSam2PromptsToWorld(
  prompts: Sam2SourcePrompts,
  imageMapper: Pick<PreparedImageMaskMapper, 'mapSourcePixelToWorld'> | null,
  naturalW: number,
  naturalH: number,
): Sam2WorldPrompts | null {
  const normalized = normalizeSourceSam2Prompts(prompts);
  if (
    normalized.unmappedPointCount > 0 ||
    normalized.unmappedBoxCornerCount > 0 ||
    !imageMapper ||
    !Number.isSafeInteger(naturalW) ||
    !Number.isSafeInteger(naturalH) ||
    naturalW <= 0 ||
    naturalH <= 0
  ) {
    return null;
  }

  const sourcePixel = (point: { x: number; y: number }) => ({
    x: point.x * Math.max(0, naturalW - 1),
    y: point.y * Math.max(0, naturalH - 1),
  });
  const mappedPoints = normalized.points?.map((point) => {
    const mapped = imageMapper.mapSourcePixelToWorld(sourcePixel(point));
    return mapped ? { ...mapped, label: point.label } : null;
  });
  if (mappedPoints?.some((point) => point === null)) return null;

  let mappedBox: Sam2WorldPrompts['box'];
  if (normalized.box) {
    const { x1, y1, x2, y2 } = normalized.box;
    const corners = [
      sourcePixel({ x: x1, y: y1 }),
      sourcePixel({ x: x2, y: y1 }),
      sourcePixel({ x: x2, y: y2 }),
      sourcePixel({ x: x1, y: y2 }),
    ]
      .map((corner) => imageMapper.mapSourcePixelToWorld(corner))
      .filter(finitePoint);
    if (corners.length !== 4) return null;
    mappedBox = {
      x1: Math.min(...corners.map((corner) => corner.x)),
      y1: Math.min(...corners.map((corner) => corner.y)),
      x2: Math.max(...corners.map((corner) => corner.x)),
      y2: Math.max(...corners.map((corner) => corner.y)),
    };
  }

  return {
    ...(mappedPoints ? { points: mappedPoints.filter((point) => point !== null) } : {}),
    ...(mappedBox ? { box: mappedBox } : {}),
  };
}

/** Normalize a world-space prompt using the renderer's image-placement inverse. */
export function normalizeSam2Prompts(
  prompts: Sam2WorldPrompts,
  imageMapper: Pick<PreparedImageMaskMapper, 'mapWorldPoint'> | null,
  naturalW: number,
  naturalH: number,
): Sam2NormalizedPrompts {
  const result: Sam2NormalizedPrompts = {
    unmappedPointCount: 0,
    unmappedBoxCornerCount: 0,
  };
  if (!imageMapper || !Number.isFinite(naturalW) || !Number.isFinite(naturalH)) {
    result.unmappedPointCount = prompts.points?.length ?? 0;
    result.unmappedBoxCornerCount = prompts.box ? 4 : 0;
    return result;
  }
  if (naturalW <= 0 || naturalH <= 0) {
    result.unmappedPointCount = prompts.points?.length ?? 0;
    result.unmappedBoxCornerCount = prompts.box ? 4 : 0;
    return result;
  }

  if (prompts.points) {
    result.points = prompts.points.flatMap((point) => {
      const source = imageMapper.mapWorldPoint({ x: point.x, y: point.y });
      if (!finitePoint(source)) {
        result.unmappedPointCount += 1;
        return [];
      }
      return [
        { x: clamp01(source.x / naturalW), y: clamp01(source.y / naturalH), label: point.label },
      ];
    });
  }

  if (prompts.box) {
    const { x1, y1, x2, y2 } = prompts.box;
    const worldCorners = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];
    const sourceCorners = worldCorners
      .map((corner) => imageMapper.mapWorldPoint(corner))
      .filter(finitePoint);
    result.unmappedBoxCornerCount = worldCorners.length - sourceCorners.length;
    // A box is an explicit spatial constraint. Dropping one or more corners
    // silently changes that constraint, so only expose it when its complete
    // geometry was mapped. Callers can then fail closed with an actionable
    // message instead of asking the model to guess the missing geometry.
    if (result.unmappedBoxCornerCount === 0) {
      const minX = Math.min(...sourceCorners.map((point) => point.x));
      const minY = Math.min(...sourceCorners.map((point) => point.y));
      const maxX = Math.max(...sourceCorners.map((point) => point.x));
      const maxY = Math.max(...sourceCorners.map((point) => point.y));
      result.box = {
        x1: clamp01(minX / naturalW),
        y1: clamp01(minY / naturalH),
        x2: clamp01(maxX / naturalW),
        y2: clamp01(maxY / naturalH),
      };
    }
  }

  return result;
}
