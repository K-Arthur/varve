import { createRangeRaster, type RangeRaster, sanitizeRangeRasterInPlace } from '@varve/shared';
import { HdrProcessingError, type ToneMapOptions, type ToneMapResult } from './types';

/**
 * Global Reinhard tone mapping for a stable full-frame SDR preview. The
 * operator is intentionally global: its scale is derived from the supplied
 * scene values, never from the viewport or crop, so panning cannot change the
 * appearance. The input master is never mutated.
 */
export function toneMapReinhardGlobal(
  source: RangeRaster,
  options: ToneMapOptions = {},
): ToneMapResult {
  const exposureStops = options.exposureStops ?? 0;
  const whitePoint = options.whitePoint ?? 1;
  if (!Number.isFinite(exposureStops))
    throw new HdrProcessingError('tone-map exposure must be finite');
  if (!Number.isFinite(whitePoint) || whitePoint <= 0) {
    throw new HdrProcessingError('tone-map whitePoint must be positive and finite');
  }
  const multiplier = 2 ** exposureStops;
  const output = createRangeRaster({
    ...source.contract,
    stride: source.contract.width * 4,
    encoding: {
      ...source.contract.encoding,
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
    },
    reference: 'display-linear',
    alphaMode: 'straight',
    provenance: 'derived-display-preview',
  });
  const { width, height, stride } = source.contract;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = y * stride + x * 4;
      const outputIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = source.pixels[sourceIndex + channel]!;
        const exposed = Number.isFinite(value) ? Math.max(0, value * multiplier) : 0;
        const scaled = exposed / whitePoint;
        output.pixels[outputIndex + channel] = scaled / (1 + scaled);
      }
      const alpha = source.pixels[sourceIndex + 3]!;
      output.pixels[outputIndex + 3] = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    }
  }
  sanitizeRangeRasterInPlace(output, { maxAbsRgb: 1 });
  return {
    raster: output,
    diagnostics: { operator: 'reinhard-global', exposureStops, whitePoint },
  };
}

/** Linear-light sRGB transfer for a display/export boundary. */
export function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/**
 * Convert an SDR display-linear raster to an ordinary 8-bit sRGB rendition.
 * This is a disposable output, not a replacement for the range-bearing master.
 */
export function rangeRasterToSrgbBytes(source: RangeRaster): Uint8ClampedArray {
  if (source.contract.reference !== 'display-linear') {
    throw new HdrProcessingError('SDR byte export requires a display-linear tone-mapped raster');
  }
  const output = new Uint8ClampedArray(source.contract.width * source.contract.height * 4);
  for (let y = 0; y < source.contract.height; y++) {
    for (let x = 0; x < source.contract.width; x++) {
      const inputIndex = y * source.contract.stride + x * 4;
      const outputIndex = (y * source.contract.width + x) * 4;
      output[outputIndex] = Math.round(linearToSrgb(source.pixels[inputIndex]!) * 255);
      output[outputIndex + 1] = Math.round(linearToSrgb(source.pixels[inputIndex + 1]!) * 255);
      output[outputIndex + 2] = Math.round(linearToSrgb(source.pixels[inputIndex + 2]!) * 255);
      output[outputIndex + 3] = Math.round(
        Math.max(0, Math.min(1, source.pixels[inputIndex + 3]!)) * 255,
      );
    }
  }
  return output;
}
