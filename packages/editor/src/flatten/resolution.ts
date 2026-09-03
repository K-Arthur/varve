import type { FlattenOptions } from './types';

/**
 * Varve's document coordinate system is a 96-unit-per-inch design space.
 * Flattening may request either a scale factor (legacy callers) or an
 * explicit raster density. The density form is converted here, once, so
 * selection rasterization cannot accidentally use screen/DPR resolution.
 */
export const FLATTEN_REFERENCE_PPI = 96;

export interface FlattenRasterDimensions {
  scale: number;
  requestedPixelWidth: number;
  requestedPixelHeight: number;
  requestedPpi: number;
}

/** Resolve flatten output dimensions before any raster surface is allocated. */
export function resolveFlattenRasterDimensions(
  width: number,
  height: number,
  options: Pick<FlattenOptions, 'scale' | 'dpi'>,
): FlattenRasterDimensions {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;

  if (options.dpi !== undefined) {
    if (!Number.isFinite(options.dpi) || options.dpi <= 0) {
      throw new Error('Flatten output PPI must be a positive finite number');
    }
  }

  const scale = Math.max(
    0.01,
    options.dpi === undefined ? (options.scale ?? 1) : options.dpi / FLATTEN_REFERENCE_PPI,
  );
  const requestedPpi = scale * FLATTEN_REFERENCE_PPI;

  return {
    scale,
    requestedPixelWidth: Math.max(1, Math.round(safeWidth * scale)),
    requestedPixelHeight: Math.max(1, Math.round(safeHeight * scale)),
    requestedPpi,
  };
}
