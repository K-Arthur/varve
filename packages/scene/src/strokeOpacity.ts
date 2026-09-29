/**
 * Per-gesture opacity tracking for raster dabs.
 *
 * One byte per touched raster pixel tracks the total source-over coverage
 * deposited by a single pointer gesture. The memory ceiling is shared by all
 * symmetry branches and keeps long strokes from retaining unbounded buffers.
 */
export const MAX_STROKE_OPACITY_BYTES = 64 * 1024 * 1024;

export interface StrokeOpacityAccumulator {
  readonly tilePixels: number;
  readonly maxTiles: number;
  readonly tiles: Map<string, Uint8Array>;
  overflowed: boolean;
}

export function createStrokeOpacityAccumulator(
  tilePixels: number,
  maxBytes = MAX_STROKE_OPACITY_BYTES,
): StrokeOpacityAccumulator {
  const safeTilePixels = Number.isSafeInteger(tilePixels) && tilePixels > 0 ? tilePixels : 1;
  const safeBytes = Number.isSafeInteger(maxBytes) && maxBytes >= 0 ? maxBytes : 0;
  return {
    tilePixels: safeTilePixels,
    maxTiles: Math.floor(safeBytes / safeTilePixels),
    tiles: new Map(),
    overflowed: false,
  };
}

/**
 * Return the portion of a dab alpha that stays below the per-pixel gesture
 * ceiling, recording the resulting coverage for later overlaps. If the
 * bounded tile cache is full, preserve painting and flag the explicit
 * buildup fallback for the caller to announce.
 */
export function limitStrokeOpacityDeposit(
  accumulator: StrokeOpacityAccumulator,
  tileKey: string,
  pixelIndex: number,
  requestedAlpha: number,
  ceiling: number,
): number {
  const requested = clamp01(requestedAlpha);
  const limit = clamp01(ceiling);
  if (requested <= 0 || limit <= 0) return 0;

  let tile = accumulator.tiles.get(tileKey);
  if (!tile) {
    if (accumulator.tiles.size >= accumulator.maxTiles) {
      accumulator.overflowed = true;
      return requested;
    }
    tile = new Uint8Array(accumulator.tilePixels);
    accumulator.tiles.set(tileKey, tile);
  }

  if (!Number.isSafeInteger(pixelIndex) || pixelIndex < 0 || pixelIndex >= tile.length) return 0;
  const deposited = tile[pixelIndex]! / 255;
  if (deposited >= limit) return 0;
  const allowed = Math.min(requested, (limit - deposited) / (1 - deposited));
  const next = deposited + allowed * (1 - deposited);
  tile[pixelIndex] = Math.round(clamp01(next) * 255);
  return allowed;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
