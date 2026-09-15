import type { RangeRaster } from '@varve/shared';

export type RawMosaicKind = 'bayer' | 'monochrome';
export type RawDemosaicMethod = 'bilinear-bayer';

export interface RawActiveArea {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface RawCameraMetadata {
  make?: string;
  model?: string;
  uniqueModel?: string;
  dngVersion?: string;
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  exposureTimeSeconds?: number;
  fNumber?: number;
  iso?: number;
  focalLengthMm?: number;
}

export interface RawMosaic {
  width: number;
  height: number;
  /** One normalized sensor sample per pixel; integer code values are preserved. */
  pixels: Uint16Array;
  bitDepth: 8 | 10 | 12 | 14 | 16;
  kind: RawMosaicKind;
  /** Bayer color plane index for each repeating pattern cell. */
  cfaPattern?: readonly [number, number, number, number];
  blackLevel: number[];
  whiteLevel: number[];
  activeArea: RawActiveArea;
  defaultCrop?: { x: number; y: number; width: number; height: number };
  asShotNeutral?: number[];
  colorMatrix1?: number[];
  colorMatrix2?: number[];
  calibrationIlluminant1?: number;
  calibrationIlluminant2?: number;
  /** True when the DNG LinearizationTable was applied before development. */
  linearizationApplied?: boolean;
  camera: RawCameraMetadata;
  sourceFormat: 'dng-bayer-uncompressed' | 'dng-monochrome-uncompressed';
  warnings: string[];
}

export interface RawRecipe {
  version: 1;
  /** Recipe is tied to the source decoder and raw source revision. */
  decoderId: string;
  profile: 'camera-matrix' | 'srgb-d65';
  /** Select a DNG XYZ-to-camera matrix; auto uses the as-shot neutral when possible. */
  cameraMatrix?: 'auto' | 'color-matrix-1' | 'color-matrix-2';
  whiteBalance: 'as-shot' | 'custom';
  /** Camera-neutral multipliers, not sensor RGB values relabelled as sRGB. */
  customMultipliers?: readonly [number, number, number];
  exposureStops: number;
  blackPoint: number;
  whitePoint: number;
  highlights: number;
  shadows: number;
  noiseReduction: number;
  captureSharpening: number;
  outputSharpening: number;
  lensCorrection: 'none' | 'lensfun-if-available';
  demosaic: RawDemosaicMethod;
  crop?: RawActiveArea;
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

export interface RawDevelopDiagnostics {
  decoderId: string;
  profile: RawRecipe['profile'];
  cameraMatrix?: 'color-matrix-1' | 'color-matrix-2';
  whiteBalanceSource: 'as-shot' | 'custom' | 'fallback-neutral';
  sensorClippedPixels: number;
  outputClippedPixels: number;
  warnings: string[];
}

export interface RawDevelopResult {
  raster: RangeRaster;
  diagnostics: RawDevelopDiagnostics;
}

export class RawDecodeError extends Error {
  readonly code:
    | 'invalid-container'
    | 'unsupported-variant'
    | 'truncated'
    | 'safety-limit'
    | 'invalid-calibration';

  constructor(code: RawDecodeError['code'], message: string) {
    super(message);
    this.name = 'RawDecodeError';
    this.code = code;
  }
}

export class RawDevelopmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawDevelopmentError';
  }
}
