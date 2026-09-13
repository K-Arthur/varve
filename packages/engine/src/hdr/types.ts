import type { RangeRaster } from '@varve/shared';

export interface HdrFrame {
  raster: RangeRaster;
  /** Exposure time used for radiance normalization, in seconds. */
  exposureTimeSeconds?: number;
  /** Optional provenance shown in a merge review; never used for grouping. */
  sourceLabel?: string;
}

export interface HdrMergeOptions {
  /** The frame whose surviving content wins when other frames are invalid. */
  referenceIndex: number;
  /** Values at or above this normalized white are treated as sensor-clipped. */
  saturationThreshold?: number;
  /** Minimum accumulated weight before a pixel is marked valid. */
  minimumWeight?: number;
  /** Optional per-frame coverage/deghost masks, one byte per pixel. */
  validMasks?: readonly Uint8Array[];
}

export interface HdrAlignmentOptions {
  referenceIndex: number;
  /** Translation search radius in full-resolution pixels. */
  maxTranslationPx?: number;
  /** Largest dimension used by the bounded alignment proxy. */
  proxyMaxDimension?: number;
}

export interface HdrFrameTransform {
  dx: number;
  dy: number;
  score: number;
  coverage: Uint8Array;
}

export interface HdrAlignmentResult {
  frames: HdrFrame[];
  transforms: HdrFrameTransform[];
  warnings: string[];
}

export interface HdrDeghostOptions {
  referenceIndex: number;
  /** Relative radiance difference that marks a non-reference sample moving. */
  differenceThreshold?: number;
  /**
   * How the motion comparison accounts for frame brightness. Metadata is the
   * calibrated RAW path; rendered-local-contrast is only for rendered
   * exposure fusion, where the source response is unknown and exposure-
   * relative local structure is used conservatively for motion candidates.
   */
  normalization?: 'metadata' | 'rendered-local-contrast' | 'none';
}

export interface HdrDeghostResult {
  validMasks: Uint8Array[];
  movingPixels: number;
  warnings: string[];
}

export interface HdrMergeDiagnostics {
  method: 'radiance' | 'exposure-fusion';
  frameCount: number;
  invalidPixels: number;
  saturatedSamples: number;
  missingExposureValues: number;
  warnings: string[];
}

export interface HdrMergeResult {
  raster: RangeRaster;
  /** 1 for pixels with valid contributing coverage, otherwise 0. */
  validMask: Uint8Array;
  diagnostics: HdrMergeDiagnostics;
}

export interface ToneMapOptions {
  /** Scene exposure multiplier, expressed as photographic stops. */
  exposureStops?: number;
  /** Optional scene value mapped to display white; must be positive. */
  whitePoint?: number;
}

export interface ToneMapResult {
  raster: RangeRaster;
  diagnostics: {
    operator: 'reinhard-global';
    exposureStops: number;
    whitePoint: number;
  };
}

export interface OpenExrEncodeOptions {
  precision?: 'float32' | 'float16';
  /** Half-float overflow is rejected unless the caller explicitly opts in. */
  halfOverflow?: 'reject' | 'clamp';
  includeAlpha?: boolean;
}

export interface OpenExrDecodeResult {
  raster: RangeRaster;
  dataWindow: { xMin: number; yMin: number; xMax: number; yMax: number };
  displayWindow: { xMin: number; yMin: number; xMax: number; yMax: number };
  channels: string[];
  warnings: string[];
}

export class HdrProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HdrProcessingError';
  }
}

export class OpenExrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenExrError';
  }
}
