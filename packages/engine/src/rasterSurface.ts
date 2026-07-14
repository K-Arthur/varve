/**
 * Portable Canvas 2D surfaces for raster export and intermediate rendering.
 *
 * Research basis: WHATWG Canvas 2D context creation and bitmap serialization;
 * MDN OffscreenCanvas compatibility and canvas maximum-size guidance. Browser
 * limits are runtime-, OS-, and memory-dependent, so the policy below is an
 * application memory budget rather than a claim about a particular engine.
 */

export type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RasterCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RasterSurface {
  canvas: RasterCanvas;
  context: RasterCanvasContext;
  backend: 'offscreen' | 'html';
}

export interface RasterSurfacePolicy {
  /** Per-axis guard for engines that reject very wide/tall bitmaps. */
  maxDimension: number;
  /** Raw RGBA pixel budget, independent of the engine's theoretical limit. */
  maxPixels: number;
}

/** 32 Mi pixels = 128 MiB for one uncompressed RGBA backing store. */
export const DEFAULT_RASTER_SURFACE_POLICY: RasterSurfacePolicy = {
  maxDimension: 16_384,
  maxPixels: 33_554_432,
};

export interface FittedRasterDimensions {
  width: number;
  height: number;
  scaleFactor: number;
  constrainedBy: Array<'dimension' | 'area'>;
}

export function fitRasterDimensions(
  requestedWidth: number,
  requestedHeight: number,
  policy: RasterSurfacePolicy = DEFAULT_RASTER_SURFACE_POLICY,
): FittedRasterDimensions {
  if (
    !Number.isFinite(requestedWidth) ||
    !Number.isFinite(requestedHeight) ||
    requestedWidth <= 0 ||
    requestedHeight <= 0
  ) {
    throw new RangeError('Raster dimensions must be finite positive numbers');
  }
  if (
    !Number.isFinite(policy.maxDimension) ||
    !Number.isFinite(policy.maxPixels) ||
    policy.maxDimension < 1 ||
    policy.maxPixels < 1
  ) {
    throw new RangeError('Raster surface policy must contain positive finite limits');
  }

  const width = Math.max(1, Math.round(requestedWidth));
  const height = Math.max(1, Math.round(requestedHeight));
  const dimensionFactor = Math.min(1, policy.maxDimension / Math.max(width, height));
  const areaFactor = Math.min(1, Math.sqrt(policy.maxPixels / (width * height)));
  const scaleFactor = Math.min(dimensionFactor, areaFactor);
  const constrainedBy: Array<'dimension' | 'area'> = [];
  if (dimensionFactor < 1) constrainedBy.push('dimension');
  if (areaFactor < 1) constrainedBy.push('area');

  let fittedWidth = Math.max(1, Math.floor(width * scaleFactor));
  let fittedHeight = Math.max(1, Math.floor(height * scaleFactor));
  while (fittedWidth * fittedHeight > policy.maxPixels) {
    if (fittedWidth >= fittedHeight) fittedWidth--;
    else fittedHeight--;
  }

  return { width: fittedWidth, height: fittedHeight, scaleFactor, constrainedBy };
}

export function createRasterSurface(
  width: number,
  height: number,
  attributes: CanvasRenderingContext2DSettings = {},
): RasterSurface {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid raster surface size ${width}x${height}`);
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', attributes);
      if (context) return { canvas, context, backend: 'offscreen' };
    } catch {
      // Fall through to the main-thread HTML canvas path.
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', attributes);
    if (context) return { canvas, context, backend: 'html' };
  }

  throw new Error(`Canvas 2D surface allocation failed for ${width}x${height}`);
}

export async function encodeRasterSurface(
  surface: RasterSurface,
  type: string,
  quality?: number,
): Promise<Blob> {
  if (surface.backend === 'offscreen') {
    return (surface.canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  const canvas = surface.canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob: Blob | null) => {
          if (blob) resolve(blob);
          else reject(new Error(`Canvas encoder returned no data for ${type}`));
        },
        type,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}
