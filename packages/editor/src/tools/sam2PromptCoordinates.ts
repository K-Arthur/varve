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

export interface Sam2NormalizedPrompts {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(point: { x: number; y: number } | null): point is { x: number; y: number } {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Normalize a world-space prompt using the renderer's image-placement inverse. */
export function normalizeSam2Prompts(
  prompts: Sam2WorldPrompts,
  imageMapper: Pick<PreparedImageMaskMapper, 'mapWorldPoint'> | null,
  naturalW: number,
  naturalH: number,
): Sam2NormalizedPrompts {
  const result: Sam2NormalizedPrompts = {};
  if (!imageMapper || !Number.isFinite(naturalW) || !Number.isFinite(naturalH)) return result;
  if (naturalW <= 0 || naturalH <= 0) return result;

  if (prompts.points) {
    result.points = prompts.points.flatMap((point) => {
      const source = imageMapper.mapWorldPoint({ x: point.x, y: point.y });
      if (!finitePoint(source)) return [];
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
    if (sourceCorners.length > 0) {
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
