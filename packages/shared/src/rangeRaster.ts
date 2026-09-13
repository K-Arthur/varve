/**
 * Range-bearing RGBA raster contract.
 *
 * This is deliberately separate from the legacy RasterTile byte storage and
 * from a display canvas. It describes the meaning of a float buffer at a
 * processing boundary so a renderer cannot accidentally turn an HDR master
 * into an 8-bit preview. RGB values are allowed to be negative or above 1 in
 * scene-linear work; alpha is always bounded independently.
 */

import type { RasterColorEncoding } from './rasterColorEncoding';

export const MAX_RANGE_RASTER_PIXELS = 64_000_000;
export const RGBA_CHANNELS = 4;

export type RangeRasterReference = 'scene-linear' | 'display-linear' | 'display-referred';
export type RangeRasterProvenance =
  | 'raw-development'
  | 'hdr-radiance'
  | 'hdr-exposure-fusion'
  | 'rendered-image'
  | 'derived-display-preview';

export interface RangeRasterContract {
  width: number;
  height: number;
  /** Row stride in float samples, not bytes. Must be at least width * 4. */
  stride: number;
  channelLayout: 'rgba';
  sampleType: 'float32';
  encoding: RasterColorEncoding;
  reference: RangeRasterReference;
  /** Relative scene/display scale. This is not an absolute nit calibration. */
  referenceWhite: number;
  alphaMode: 'straight' | 'premultiplied';
  provenance: RangeRasterProvenance;
}

export interface RangeRaster {
  contract: RangeRasterContract;
  pixels: Float32Array;
}

export interface RangeRasterValidation {
  valid: boolean;
  errors: string[];
}

export interface RangeSanitizeReport {
  replacedNonFinite: number;
  clampedAlpha: number;
  clampedRgb: number;
}

/** Validate structure before allocating or trusting a range-bearing buffer. */
export function validateRangeRasterContract(contract: RangeRasterContract): RangeRasterValidation {
  const errors: string[] = [];
  if (!Number.isInteger(contract.width) || contract.width <= 0) {
    errors.push('width must be a positive integer');
  }
  if (!Number.isInteger(contract.height) || contract.height <= 0) {
    errors.push('height must be a positive integer');
  }
  const pixels = contract.width * contract.height;
  if (Number.isFinite(pixels) && pixels > MAX_RANGE_RASTER_PIXELS) {
    errors.push(`pixel count exceeds ${MAX_RANGE_RASTER_PIXELS.toLocaleString()}`);
  }
  if (!Number.isInteger(contract.stride) || contract.stride < contract.width * RGBA_CHANNELS) {
    errors.push('stride must be an integer of at least width * 4 samples');
  }
  if (contract.channelLayout !== 'rgba') errors.push('only RGBA channel layout is supported');
  if (contract.sampleType !== 'float32') errors.push('only float32 range rasters are supported');
  if (!Number.isFinite(contract.referenceWhite) || contract.referenceWhite <= 0) {
    errors.push('referenceWhite must be a positive finite relative value');
  }
  if (contract.encoding.model !== 'rgb' && contract.encoding.model !== 'gray') {
    errors.push('range rasters require RGB or gray source semantics');
  }
  return { valid: errors.length === 0, errors };
}

/** Create a zero-filled range raster after validating dimensions and stride. */
export function createRangeRaster(
  contract: RangeRasterContract,
  pixels?: Float32Array,
): RangeRaster {
  const validation = validateRangeRasterContract(contract);
  if (!validation.valid) throw new RangeRasterError(validation.errors.join('; '));
  const expectedLength = contract.stride * contract.height;
  if (pixels && pixels.length < expectedLength) {
    throw new RangeRasterError(
      `pixel buffer has ${pixels.length} samples; ${expectedLength} are required`,
    );
  }
  return { contract: { ...contract }, pixels: pixels ?? new Float32Array(expectedLength) };
}

/**
 * Sanitize untrusted float output without narrowing legitimate scene range.
 * RGB is only bounded by the caller's finite safety limit; alpha is clamped to
 * [0, 1] exactly once at this contract boundary.
 */
export function sanitizeRangeRasterInPlace(
  raster: RangeRaster,
  options: { maxAbsRgb?: number } = {},
): RangeSanitizeReport {
  const maxAbsRgb = options.maxAbsRgb ?? 65504;
  if (!Number.isFinite(maxAbsRgb) || maxAbsRgb <= 0) {
    throw new RangeRasterError('maxAbsRgb must be a positive finite value');
  }
  const { width, height, stride } = raster.contract;
  const report: RangeSanitizeReport = { replacedNonFinite: 0, clampedAlpha: 0, clampedRgb: 0 };
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const index = row + x * RGBA_CHANNELS;
      for (let channel = 0; channel < 3; channel++) {
        const value = raster.pixels[index + channel]!;
        if (!Number.isFinite(value)) {
          raster.pixels[index + channel] = Number.isNaN(value)
            ? 0
            : value === Number.NEGATIVE_INFINITY
              ? -maxAbsRgb
              : maxAbsRgb;
          report.replacedNonFinite++;
        } else if (value > maxAbsRgb) {
          raster.pixels[index + channel] = maxAbsRgb;
          report.clampedRgb++;
        } else if (value < -maxAbsRgb) {
          raster.pixels[index + channel] = -maxAbsRgb;
          report.clampedRgb++;
        }
      }
      const alphaIndex = index + 3;
      const alpha = raster.pixels[alphaIndex]!;
      if (!Number.isFinite(alpha)) {
        raster.pixels[alphaIndex] = 0;
        report.replacedNonFinite++;
      } else if (alpha < 0) {
        raster.pixels[alphaIndex] = 0;
        report.clampedAlpha++;
      } else if (alpha > 1) {
        raster.pixels[alphaIndex] = 1;
        report.clampedAlpha++;
      }
    }
  }
  return report;
}

/** Stable cache identity for source/working data contracts. */
export function rangeRasterContractKey(contract: RangeRasterContract): string {
  return JSON.stringify({
    width: contract.width,
    height: contract.height,
    stride: contract.stride,
    channelLayout: contract.channelLayout,
    sampleType: contract.sampleType,
    encoding: contract.encoding,
    reference: contract.reference,
    referenceWhite: contract.referenceWhite,
    alphaMode: contract.alphaMode,
    provenance: contract.provenance,
  });
}

export class RangeRasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeRasterError';
  }
}
