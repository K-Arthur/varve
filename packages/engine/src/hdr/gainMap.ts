import type { RangeRaster } from '@varve/shared';

/**
 * Ultra HDR / ISO 21496-1 gain-map support for the range-bearing photo path.
 *
 * Research basis (accessed 2026-09-13):
 * - Android "Ultra HDR Image Format v1.1":
 *   https://developer.android.com/media/platform/hdr-image-format — the
 *   normative gain-map equations, XMP (`hdrgm`) metadata vocabulary, and the
 *   GContainer directory that locates the secondary image.
 * - CIPA DC-007 Multi-Picture Format: https://www.cipa.jp/std/documents/e/DC-X007-KEY_E.pdf
 * - ISO 21496-1 binary metadata storage, cross-checked against
 *   google/libultrahdr v2.0.2 (`lib/src/gainmapmetadata.cpp`,
 *   `lib/src/jpegr.cpp`) and a locally decoded reference file produced by its
 *   `ultrahdr_app` CLI. libultrahdr is MIT/Apache-2.0.
 *
 * The module is deliberately split from OpenEXR: an EXR master preserves scene
 * radiance, while a gain-map JPEG preserves the relationship between an SDR
 * rendition and its HDR rendition on shared-display infrastructure. Neither is
 * a substitute for the other.
 */

const MAX_JPEG_BYTES = 512 * 1024 * 1024;
const MAX_JPEG_SEGMENTS = 512;
const MAX_GAIN_MAP_DIMENSION = 32_768;
const GAIN_MAP_LOG2_FLOOR = -14.3;
const GAIN_MAP_LOG2_CEIL = 15.6;
const DEFAULT_OFFSET = 1 / 64;
const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/';
const CONTAINER_NAMESPACE = 'http://ns.google.com/photos/1.0/container/';
const CONTAINER_ITEM_NAMESPACE = 'http://ns.google.com/photos/1.0/container/item/';
const HDRGM_NAMESPACE = 'http://ns.adobe.com/hdr-gain-map/1.0/';
const ISO_NAMESPACE = 'urn:iso:std:iso:ts:21496:-1';
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export class GainMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GainMapError';
  }
}

/** A scalar, or one value per red/green/blue channel. */
export type GainMapChannelValue = number | readonly [number, number, number];

export interface GainMapMetadata {
  /** log2 of the minimum content boost. May be negative (attenuation). */
  gainMapMin: GainMapChannelValue;
  /** log2 of the maximum content boost. Must be >= gainMapMin. */
  gainMapMax: GainMapChannelValue;
  /** Positive gamma applied to the stored recovery values. */
  gamma: GainMapChannelValue;
  /** Offset applied to the SDR rendition during application. */
  offsetSdr: GainMapChannelValue;
  /** Offset applied to the HDR rendition during application. */
  offsetHdr: GainMapChannelValue;
  /** log2 of the display boost where the map begins to apply. */
  hdrCapacityMin: number;
  /** log2 of the display boost where the map is fully applied. */
  hdrCapacityMax: number;
}

export interface GainMapRaster {
  data: Uint8Array;
  width: number;
  height: number;
  /** Interleaved channel count of `data`: 1 for luminance, 3 for RGB. */
  channels: 1 | 3;
}

export interface GainMapDiagnostics {
  minLog2: number;
  maxLog2: number;
  /** Worst stored-sample error in stops, including downsampling. */
  maxReconstructionErrorStops: number;
  downsampled: boolean;
  finiteSamples: number;
  invalidSamples: number;
  aboveWhitePixels: number;
  channelCount: 1 | 3;
}

export interface GainMapEncodeOptions {
  gamma?: number;
  /**
   * Map channels. 3 (default) stores a per-channel recovery map so the
   * reconstruction is exact for each channel; 1 stores a luminance map, which
   * the specification recommends when per-channel gains are near-identical.
   */
  channels?: 1 | 3;
  /** Linear content boost bounds; defaults derive from the input ratio. */
  minContentBoost?: number;
  maxContentBoost?: number;
  offsetSdr?: number;
  offsetHdr?: number;
  /** Box-downsample factor for the stored map (spec suggests 4). */
  downsample?: 1 | 2 | 4 | 8;
  /** Convenience ceiling: maxContentBoost is clamped to 2^stops. */
  maxHeadroomStops?: number;
}

export interface GainMapEncodeResult {
  gainMap: GainMapRaster;
  metadata: GainMapMetadata;
  diagnostics: GainMapDiagnostics;
}

export interface GainMapApplyOptions {
  /** Display boost weight in [0, 1]; 0 returns the SDR rendition. */
  weight?: number;
  /** Output rows in the SDR rendition's coordinate space. */
  outputWidth?: number;
  outputHeight?: number;
}

export interface UltraHdrDecodeResult {
  baseJpeg: Uint8Array;
  gainMapJpeg: Uint8Array | null;
  baseWidth: number;
  baseHeight: number;
  gainMapWidth: number;
  gainMapHeight: number;
  metadata: GainMapMetadata | null;
  metadataSource: 'iso' | 'xmp-secondary' | 'xmp-primary' | null;
  containerItems: UltraHdrContainerItem[] | null;
  warnings: string[];
}

export interface UltraHdrContainerItem {
  semantic: string;
  mime: string;
  length: number | null;
  padding: number;
}

export interface UltraHdrEncodeInput {
  /** A complete base JPEG, conventionally the SDR rendition. */
  baseJpeg: Uint8Array;
  /** A complete secondary JPEG encoding the recovery map. */
  gainMapJpeg: Uint8Array;
  metadata: GainMapMetadata;
  /**
   * Channel count declared in the ISO metadata. Browser JPEG encoders emit
   * three-component JPEGs, so the editor declares 3 to match the stored map.
   */
  gainMapChannels?: 1 | 3;
  /**
   * `both` (default) writes XMP plus ISO 21496-1 metadata. `xmp` writes only
   * the Ultra HDR v1.1 XMP form, matching libultrahdr's XMP-only build and
   * consumers that predate ISO 21496-1.
   */
  metadataFormat?: 'both' | 'xmp';
}

interface JpegSegment {
  marker: number;
  offset: number;
  /** Exclusive end of the segment including entropy data for SOS. */
  end: number;
  payloadStart: number;
  payloadLength: number;
}

interface JpegLayout {
  start: number;
  end: number;
  width: number;
  height: number;
  componentCount: number;
  segments: JpegSegment[];
  firstSosOffset: number;
}

// ---------------------------------------------------------------------------
// Metadata value helpers
// ---------------------------------------------------------------------------

export function gainMapChannel(value: GainMapChannelValue, index: number): number {
  return typeof value === 'number' ? value : value[index]!;
}

export function isUniformGainMapValue(value: GainMapChannelValue): boolean {
  if (typeof value === 'number') return true;
  return value[0] === value[1] && value[0] === value[2];
}

function uniformValue(value: GainMapChannelValue, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  return value[0]!;
}

/** Validate the semantic constraints the application math relies on. */
export function validateGainMapMetadata(metadata: GainMapMetadata): void {
  for (let channel = 0; channel < 3; channel++) {
    const min = gainMapChannel(metadata.gainMapMin, channel);
    const max = gainMapChannel(metadata.gainMapMax, channel);
    const gamma = gainMapChannel(metadata.gamma, channel);
    const offsetSdr = gainMapChannel(metadata.offsetSdr, channel);
    const offsetHdr = gainMapChannel(metadata.offsetHdr, channel);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new GainMapError('gain map boost bounds must be finite');
    }
    if (max < min) {
      throw new GainMapError('gain map GainMapMax must be greater than or equal to GainMapMin');
    }
    if (!Number.isFinite(gamma) || gamma <= 0) {
      throw new GainMapError('gain map gamma must be positive and finite');
    }
    if (!Number.isFinite(offsetSdr) || offsetSdr < 0) {
      throw new GainMapError('gain map OffsetSDR must be zero or positive');
    }
    if (!Number.isFinite(offsetHdr) || offsetHdr < 0) {
      throw new GainMapError('gain map OffsetHDR must be zero or positive');
    }
  }
  if (!Number.isFinite(metadata.hdrCapacityMin) || metadata.hdrCapacityMin < 0) {
    throw new GainMapError('gain map HDRCapacityMin must be zero or positive');
  }
  if (
    !Number.isFinite(metadata.hdrCapacityMax) ||
    metadata.hdrCapacityMax <= metadata.hdrCapacityMin
  ) {
    throw new GainMapError('gain map HDRCapacityMax must be greater than HDRCapacityMin');
  }
}

// ---------------------------------------------------------------------------
// Gain map generation and application
// ---------------------------------------------------------------------------

function assertDisplayLinearRaster(raster: RangeRaster, label: string): void {
  if (raster.contract.sampleType !== 'float32') {
    throw new GainMapError(`${label} must be a float32 range raster`);
  }
  if (raster.contract.reference !== 'display-linear') {
    throw new GainMapError(
      `${label} must be display-linear; tone-map scene-linear data before building a gain map`,
    );
  }
  const { width, height, stride } = raster.contract;
  if (raster.pixels.length < stride * height) {
    throw new GainMapError(`${label} pixel buffer is truncated`);
  }
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_GAIN_MAP_DIMENSION ||
    height > MAX_GAIN_MAP_DIMENSION
  ) {
    throw new GainMapError(`${label} dimensions are outside the supported range`);
  }
}

const LUMINANCE_R = 0.2126;
const LUMINANCE_G = 0.7152;
const LUMINANCE_B = 0.0722;

function luminance(pixels: Float32Array, index: number): number {
  const r = pixels[index]!;
  const g = pixels[index + 1]!;
  const b = pixels[index + 2]!;
  return (
    LUMINANCE_R * (Number.isFinite(r) ? Math.max(0, r) : 0) +
    LUMINANCE_G * (Number.isFinite(g) ? Math.max(0, g) : 0) +
    LUMINANCE_B * (Number.isFinite(b) ? Math.max(0, b) : 0)
  );
}

/**
 * Encode the ratio between an HDR rendition and its SDR rendition as a
 * logarithmic recovery map. Both rasters must already be display-linear and
 * share the SDR primaries, exactly as the Ultra HDR specification requires.
 *
 * The SDR rendition is the authority for the base image: its values are
 * clamped to [0, 1] only because an 8-bit base cannot store more, and the
 * gain map is computed against those stored values so the pair stays
 * consistent. Alpha is not represented by the format and must be opaque.
 */
export function encodeGainMap(
  input: { sdr: RangeRaster; hdr: RangeRaster },
  options: GainMapEncodeOptions = {},
): GainMapEncodeResult {
  const { sdr, hdr } = input;
  assertDisplayLinearRaster(sdr, 'SDR rendition');
  assertDisplayLinearRaster(hdr, 'HDR rendition');
  if (sdr.contract.width !== hdr.contract.width || sdr.contract.height !== hdr.contract.height) {
    throw new GainMapError('SDR and HDR renditions must share the same dimensions');
  }
  const width = sdr.contract.width;
  const height = sdr.contract.height;
  const stride = sdr.contract.stride;
  const hdrStride = hdr.contract.stride;
  const pixelCount = width * height;

  const gamma = options.gamma ?? 1;
  const offsetSdr = options.offsetSdr ?? DEFAULT_OFFSET;
  const offsetHdr = options.offsetHdr ?? DEFAULT_OFFSET;
  if (!Number.isFinite(gamma) || gamma <= 0) {
    throw new GainMapError('gain map gamma must be positive and finite');
  }
  if (offsetSdr < 0 || offsetHdr < 0) {
    throw new GainMapError('gain map offsets must be zero or positive');
  }

  const channelCount: 1 | 3 = options.channels ?? 3;
  const recovery: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    recovery.push(new Float32Array(pixelCount));
  }
  const channelMin = new Float64Array(channelCount).fill(Number.POSITIVE_INFINITY);
  const channelMax = new Float64Array(channelCount).fill(Number.NEGATIVE_INFINITY);
  let finiteSamples = 0;
  let invalidSamples = 0;
  let aboveWhitePixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sdrIndex = y * stride + x * 4;
      const hdrIndex = y * hdrStride + x * 4;
      const alpha = sdr.pixels[sdrIndex + 3]!;
      if (!Number.isFinite(alpha) || alpha < 1 - 1e-3) {
        throw new GainMapError(
          'gain map generation requires an opaque SDR rendition; transparency has no representation in the format',
        );
      }
      const rawSdr = sdr.pixels[sdrIndex]!;
      const rawSdrG = sdr.pixels[sdrIndex + 1]!;
      const rawSdrB = sdr.pixels[sdrIndex + 2]!;
      if (rawSdr > 1.0005 || rawSdrG > 1.0005 || rawSdrB > 1.0005) aboveWhitePixels += 1;
      const index = y * width + x;
      if (channelCount === 1) {
        const sdrLum = Math.min(1, luminance(sdr.pixels, sdrIndex));
        const hdrLum = luminance(hdr.pixels, hdrIndex);
        const log2Gain = log2GainFor(sdrLum, hdrLum, offsetSdr, offsetHdr);
        if (Number.isFinite(log2Gain)) finiteSamples += 1;
        else invalidSamples += 1;
        updateBounds(channelMin, channelMax, 0, log2Gain);
        recovery[0]![index] = log2Gain;
      } else {
        for (let channel = 0; channel < 3; channel++) {
          const base = Math.min(1, Math.max(0, sdr.pixels[sdrIndex + channel]!));
          const target = Math.max(0, hdr.pixels[hdrIndex + channel]!);
          const log2Gain = log2GainFor(base, target, offsetSdr, offsetHdr);
          if (Number.isFinite(log2Gain)) finiteSamples += 1;
          else invalidSamples += 1;
          updateBounds(channelMin, channelMax, channel, log2Gain);
          recovery[channel]![index] = log2Gain;
        }
      }
    }
  }

  if (finiteSamples === 0) {
    throw new GainMapError('gain map input contains no finite luminance relationship');
  }
  const mins: number[] = [];
  const maxes: number[] = [];
  for (let channel = 0; channel < channelCount; channel++) {
    let minLog2 = Number.isFinite(channelMin[channel]!)
      ? Math.max(GAIN_MAP_LOG2_FLOOR, Math.min(GAIN_MAP_LOG2_CEIL, channelMin[channel]!))
      : 0;
    let maxLog2 = Number.isFinite(channelMax[channel]!)
      ? Math.max(GAIN_MAP_LOG2_FLOOR, Math.min(GAIN_MAP_LOG2_CEIL, channelMax[channel]!))
      : 0;
    if (options.minContentBoost !== undefined) {
      minLog2 = clampLog2(Math.log2(options.minContentBoost), options.minContentBoost > 0);
    }
    if (options.maxContentBoost !== undefined) {
      maxLog2 = clampLog2(Math.log2(options.maxContentBoost), options.maxContentBoost > 0);
    }
    if (options.maxHeadroomStops !== undefined) {
      maxLog2 = Math.min(maxLog2, options.maxHeadroomStops);
    }
    if (maxLog2 - minLog2 < 1e-4) {
      // A constant gain still needs a non-degenerate range. Exposing the full
      // [min(L, 0), max(L, 0)] interval keeps the constant value on an
      // endpoint, so it reconstructs exactly while "no change" remains
      // representable.
      const constant = minLog2;
      minLog2 = Math.min(0, constant);
      maxLog2 = Math.max(0, constant);
      if (maxLog2 - minLog2 < 1e-4) maxLog2 = minLog2 + 0.1;
    }
    mins.push(minLog2);
    maxes.push(maxLog2);
  }

  const downsample = options.downsample ?? 1;
  const mapWidth = Math.max(1, Math.ceil(width / downsample));
  const mapHeight = Math.max(1, Math.ceil(height / downsample));
  const encoded = new Uint8Array(mapWidth * mapHeight * channelCount);
  for (let mapY = 0; mapY < mapHeight; mapY++) {
    for (let mapX = 0; mapX < mapWidth; mapX++) {
      const startX = mapX * downsample;
      const startY = mapY * downsample;
      const endX = Math.min(width, startX + downsample);
      const endY = Math.min(height, startY + downsample);
      for (let channel = 0; channel < channelCount; channel++) {
        let sum = 0;
        let count = 0;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            sum += recovery[channel]![y * width + x]!;
            count += 1;
          }
        }
        const span = maxes[channel]! - mins[channel]!;
        const average = count > 0 ? sum / count : mins[channel]!;
        const normalized = (average - mins[channel]!) / span;
        const clamped = Math.max(0, Math.min(1, normalized));
        encoded[(mapY * mapWidth + mapX) * channelCount + channel] = Math.round(
          clamped ** gamma * 255,
        );
      }
    }
  }

  const pack = (values: number[]): GainMapChannelValue =>
    channelCount === 1 ? values[0]! : ([values[0]!, values[1]!, values[2]!] as const);
  const capacityMax = Math.max(...maxes);
  const metadata: GainMapMetadata = {
    gainMapMin: pack(mins),
    gainMapMax: pack(maxes),
    gamma: pack(mins.map(() => gamma)),
    offsetSdr: pack(mins.map(() => offsetSdr)),
    offsetHdr: pack(mins.map(() => offsetHdr)),
    hdrCapacityMin: 0,
    // The specification requires HDRCapacityMax > HDRCapacityMin. An
    // attenuation-only map has no headroom to unlock, so it reports the
    // smallest legal positive capacity.
    hdrCapacityMax: capacityMax > 0 ? capacityMax : 0.01,
  };
  validateGainMapMetadata(metadata);

  const gainMap: GainMapRaster = {
    data: encoded,
    width: mapWidth,
    height: mapHeight,
    channels: channelCount,
  };
  const maxReconstructionErrorStops = measureReconstructionError(
    { recovery, width, height, channels: channelCount },
    gainMap,
    metadata,
    mins,
    maxes,
  );

  return {
    gainMap,
    metadata,
    diagnostics: {
      minLog2: Math.min(...mins),
      maxLog2: Math.max(...maxes),
      maxReconstructionErrorStops,
      downsampled: downsample > 1,
      finiteSamples,
      invalidSamples,
      aboveWhitePixels,
      channelCount,
    },
  };
}

function updateBounds(
  channelMin: Float64Array,
  channelMax: Float64Array,
  channel: number,
  log2Gain: number,
): void {
  if (!Number.isFinite(log2Gain)) return;
  if (log2Gain < channelMin[channel]!) channelMin[channel] = log2Gain;
  if (log2Gain > channelMax[channel]!) channelMax[channel] = log2Gain;
}

function log2GainFor(base: number, target: number, offsetSdr: number, offsetHdr: number): number {
  const denominator = base + offsetSdr;
  if (denominator <= 1e-12) {
    return target + offsetHdr > 0 ? GAIN_MAP_LOG2_CEIL : 0;
  }
  const gain = (target + offsetHdr) / denominator;
  return gain > 0 ? Math.log2(gain) : GAIN_MAP_LOG2_FLOOR;
}

function clampLog2(value: number, positive: boolean): number {
  if (!positive || !Number.isFinite(value)) {
    throw new GainMapError('gain map content boost must be positive and finite');
  }
  return Math.max(GAIN_MAP_LOG2_FLOOR, Math.min(GAIN_MAP_LOG2_CEIL, value));
}

/**
 * Bound the verification cost on very large images by sampling a stride.
 * The result is a conservative lower bound on the true maximum only when the
 * image is larger than the sample budget; that is reported by the caller as a
 * diagnostic, never as a guarantee.
 */
function measureReconstructionError(
  input: { recovery: Float32Array[]; width: number; height: number; channels: 1 | 3 },
  gainMap: GainMapRaster,
  metadata: GainMapMetadata,
  mins: number[],
  maxes: number[],
): number {
  const { width, height, channels } = input;
  const budget = 1_048_576;
  const pixelCount = width * height;
  const step = Math.max(1, Math.floor(pixelCount / budget));
  let worst = 0;
  for (let index = 0; index < pixelCount; index += step) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let channel = 0; channel < channels; channel++) {
      const target = input.recovery[channel]![index]!;
      const sample = sampleGainMapBilinear(gainMap, (x + 0.5) / width, (y + 0.5) / height, channel);
      const gamma = gainMapChannel(metadata.gamma, channel);
      const recoveryValue = sample / 255;
      const logRecovery = gamma === 1 ? recoveryValue : recoveryValue ** (1 / gamma);
      const reconstructed = mins[channel]! + (maxes[channel]! - mins[channel]!) * logRecovery;
      const error = Math.abs(reconstructed - target);
      if (error > worst) worst = error;
    }
  }
  return worst;
}

function sampleGainMapBilinear(map: GainMapRaster, u: number, v: number, channel: number): number {
  const { width, height, data, channels } = map;
  if (width <= 0 || height <= 0) return 0;
  const safeChannel = channels === 1 ? 0 : Math.min(channels - 1, Math.max(0, channel));
  const gx = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const gy = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const top =
    data[(y0 * width + x0) * channels + safeChannel]! * (1 - fx) +
    data[(y0 * width + x1) * channels + safeChannel]! * fx;
  const bottom =
    data[(y1 * width + x0) * channels + safeChannel]! * (1 - fx) +
    data[(y1 * width + x1) * channels + safeChannel]! * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Apply a recovery map to a display-linear SDR rendition. The reconstruction
 * is the normative ISO 21496-1 / Ultra HDR equation; `weight` models a
 * display's available boost so callers can preview partial adaptation.
 */
export function applyGainMap(
  sdr: RangeRaster,
  gainMap: GainMapRaster,
  metadata: GainMapMetadata,
  options: GainMapApplyOptions = {},
): { width: number; height: number; pixels: Float32Array } {
  assertDisplayLinearRaster(sdr, 'SDR rendition');
  if (gainMap.data.length < gainMap.width * gainMap.height * gainMap.channels) {
    throw new GainMapError('gain map raster is truncated');
  }
  validateGainMapMetadata(metadata);
  const weight = options.weight ?? 1;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new GainMapError('gain map application weight must be within [0, 1]');
  }
  const width = options.outputWidth ?? sdr.contract.width;
  const height = options.outputHeight ?? sdr.contract.height;
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_GAIN_MAP_DIMENSION ||
    height > MAX_GAIN_MAP_DIMENSION
  ) {
    throw new GainMapError('gain map output dimensions are outside the supported range');
  }
  const output = new Float32Array(width * height * 4);
  const sdrStride = sdr.contract.stride;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outputIndex = (y * width + x) * 4;
      const sourceX = Math.min(
        sdr.contract.width - 1,
        Math.floor(((x + 0.5) * sdr.contract.width) / width),
      );
      const sourceY = Math.min(
        sdr.contract.height - 1,
        Math.floor(((y + 0.5) * sdr.contract.height) / height),
      );
      const sdrIndex = sourceY * sdrStride + sourceX * 4;
      for (let channel = 0; channel < 3; channel++) {
        const recoveryByte = sampleGainMapBilinear(
          gainMap,
          (x + 0.5) / width,
          (y + 0.5) / height,
          channel,
        );
        const recoveryValue = recoveryByte / 255;
        const gamma = gainMapChannel(metadata.gamma, channel);
        const min = gainMapChannel(metadata.gainMapMin, channel);
        const max = gainMapChannel(metadata.gainMapMax, channel);
        const offsetSdr = gainMapChannel(metadata.offsetSdr, channel);
        const offsetHdr = gainMapChannel(metadata.offsetHdr, channel);
        const logRecovery = gamma === 1 ? recoveryValue : recoveryValue ** (1 / gamma);
        const boost = min * (1 - logRecovery) + max * logRecovery;
        const base = sdr.pixels[sdrIndex + channel]!;
        const value = (base + offsetSdr) * 2 ** (boost * weight) - offsetHdr;
        output[outputIndex + channel] = Number.isFinite(value) ? value : 0;
      }
      const alpha = sdr.pixels[sdrIndex + 3]!;
      output[outputIndex + 3] = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    }
  }
  return { width, height, pixels: output };
}

// ---------------------------------------------------------------------------
// XMP metadata
// ---------------------------------------------------------------------------

function formatNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new GainMapError('cannot serialize a non-finite gain map value');
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}

function formatChannelValue(value: GainMapChannelValue): string {
  return typeof value === 'number'
    ? formatNumber(value)
    : `${formatNumber(value[0])},${formatNumber(value[1])},${formatNumber(value[2])}`;
}

export function serializeGainMapXmpSecondary(metadata: GainMapMetadata): string {
  validateGainMapMetadata(metadata);
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Varve">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:hdrgm="${HDRGM_NAMESPACE}"
      hdrgm:Version="1.0"
      hdrgm:GainMapMin="${formatChannelValue(metadata.gainMapMin)}"
      hdrgm:GainMapMax="${formatChannelValue(metadata.gainMapMax)}"
      hdrgm:Gamma="${formatChannelValue(metadata.gamma)}"
      hdrgm:OffsetSDR="${formatChannelValue(metadata.offsetSdr)}"
      hdrgm:OffsetHDR="${formatChannelValue(metadata.offsetHdr)}"
      hdrgm:HDRCapacityMin="${formatNumber(metadata.hdrCapacityMin)}"
      hdrgm:HDRCapacityMax="${formatNumber(metadata.hdrCapacityMax)}"
      hdrgm:BaseRenditionIsHDR="False"/>
  </rdf:RDF>
</x:xmpmeta>`;
}

/**
 * The primary packet declares the GContainer directory. The gain map length is
 * the byte count of the secondary image, encoded independently of the primary
 * so the directory can be written in one pass without a circular size.
 */
export function serializeGainMapXmpPrimary(gainMapLength: number): string {
  if (!Number.isSafeInteger(gainMapLength) || gainMapLength <= 0) {
    throw new GainMapError('gain map length must be a positive integer');
  }
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Varve">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:Container="${CONTAINER_NAMESPACE}"
      xmlns:Item="${CONTAINER_ITEM_NAMESPACE}"
      xmlns:hdrgm="${HDRGM_NAMESPACE}"
      hdrgm:Version="1.0">
      <Container:Directory>
        <rdf:Seq>
          <rdf:li rdf:parseType="Resource">
            <Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/>
          </rdf:li>
          <rdf:li rdf:parseType="Resource">
            <Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gainMapLength}"/>
          </rdf:li>
        </rdf:Seq>
      </Container:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
}

function parseXmpNumbers(raw: string, field: string): GainMapChannelValue {
  const tokens = raw.split(',').map((part) => part.trim());
  if (tokens.some((token) => token.length === 0)) {
    throw new GainMapError(`gain map XMP field ${field} contains an empty value`);
  }
  const parts = tokens.map((token) => Number(token));
  if (parts.some((value) => !Number.isFinite(value))) {
    throw new GainMapError(`gain map XMP field ${field} must hold finite numbers`);
  }
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 3) return [parts[0]!, parts[1]!, parts[2]!] as const;
  throw new GainMapError(`gain map XMP field ${field} must hold one or three finite numbers`);
}

export function parseGainMapXmpMetadata(xmp: string): GainMapMetadata | null {
  const attribute = (name: string): string | null => {
    const match = xmp.match(new RegExp(`hdrgm:${name}\\s*=\\s*"([^"]*)"`));
    return match ? match[1]! : null;
  };
  const version = attribute('Version');
  const baseIsHdr = attribute('BaseRenditionIsHDR');
  const maxRaw = attribute('GainMapMax');
  if (version === null && maxRaw === null) return null;
  if (version !== null && version !== '1.0') {
    throw new GainMapError(`unsupported gain map XMP version: ${version}`);
  }
  if (baseIsHdr !== null && baseIsHdr.toLowerCase() === 'true') {
    throw new GainMapError('HDR-base gain maps are not supported by this decoder');
  }
  if (maxRaw === null) {
    throw new GainMapError('gain map XMP is missing the required hdrgm:GainMapMax field');
  }
  const capacityMaxRaw = attribute('HDRCapacityMax');
  const metadata: GainMapMetadata = {
    gainMapMin: attribute('GainMapMin')
      ? parseXmpNumbers(attribute('GainMapMin')!, 'GainMapMin')
      : 0,
    gainMapMax: parseXmpNumbers(maxRaw, 'GainMapMax'),
    gamma: attribute('Gamma') ? parseXmpNumbers(attribute('Gamma')!, 'Gamma') : 1,
    offsetSdr: attribute('OffsetSDR')
      ? parseXmpNumbers(attribute('OffsetSDR')!, 'OffsetSDR')
      : DEFAULT_OFFSET,
    offsetHdr: attribute('OffsetHDR')
      ? parseXmpNumbers(attribute('OffsetHDR')!, 'OffsetHDR')
      : DEFAULT_OFFSET,
    hdrCapacityMin: attribute('HDRCapacityMin') ? Number(attribute('HDRCapacityMin')) : 0,
    hdrCapacityMax: capacityMaxRaw
      ? Number(capacityMaxRaw)
      : uniformValue(parseXmpNumbers(maxRaw, 'GainMapMax'), 0),
  };
  validateGainMapMetadata(metadata);
  return metadata;
}

export function parseContainerItems(xmp: string): UltraHdrContainerItem[] | null {
  if (!xmp.includes('Container:Directory')) return null;
  const items: UltraHdrContainerItem[] = [];
  const itemPattern = /<Container:Item\b([^>]*)\/?>/g;
  let match = itemPattern.exec(xmp);
  while (match) {
    const attributes = match[1]!;
    const attribute = (name: string): string | null => {
      const found = attributes.match(new RegExp(`${name.replace(':', ':')}\\s*=\\s*"([^"]*)"`));
      return found ? found[1]! : null;
    };
    const semantic = attribute('Item:Semantic');
    const mime = attribute('Item:Mime');
    if (semantic && mime) {
      const lengthRaw = attribute('Item:Length');
      const paddingRaw = attribute('Item:Padding');
      items.push({
        semantic,
        mime,
        length: lengthRaw !== null ? Number(lengthRaw) : null,
        padding: paddingRaw !== null ? Number(paddingRaw) : 0,
      });
    }
    match = itemPattern.exec(xmp);
  }
  return items.length > 0 ? items : null;
}

// ---------------------------------------------------------------------------
// ISO 21496-1 metadata
// ---------------------------------------------------------------------------

interface Fraction {
  numerator: number;
  denominator: number;
}

function floatToUnsignedFractionImpl(v: number, maxNumerator: number): Fraction | null {
  if (!Number.isFinite(v) || v < 0 || v > maxNumerator) return null;
  const maxD = v <= 1 ? 0xffffffff : Math.floor(maxNumerator / v);
  let denominator = 1;
  let previousD = 0;
  let numerator = 0;
  let currentV = v - Math.floor(v);
  for (let iter = 0; iter < 39; iter++) {
    const numeratorDouble = denominator * v;
    if (numeratorDouble > maxNumerator) return null;
    numerator = Math.round(numeratorDouble);
    if (Math.abs(numeratorDouble - numerator) === 0) return { numerator, denominator };
    currentV = 1 / currentV;
    const newD = previousD + Math.floor(currentV) * denominator;
    if (newD > maxD) return { numerator, denominator };
    previousD = denominator;
    if (newD > 0xffffffff) return null;
    denominator = newD;
    currentV -= Math.floor(currentV);
  }
  numerator = Math.round(denominator * v);
  return { numerator, denominator };
}

function floatToUnsignedFraction(v: number): Fraction {
  const result = floatToUnsignedFractionImpl(v, 0xffffffff);
  if (!result) throw new GainMapError(`cannot represent ${v} as an unsigned fraction`);
  return result;
}

function floatToSignedFraction(v: number): Fraction {
  const result = floatToUnsignedFractionImpl(Math.abs(v), 2147483647);
  if (!result) throw new GainMapError(`cannot represent ${v} as a signed fraction`);
  return {
    numerator: v < 0 ? -result.numerator : result.numerator,
    denominator: result.denominator,
  };
}

class IsoWriter {
  private readonly bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value >> 8);
    this.u8(value);
  }

  u32(value: number): void {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  s32(value: number): void {
    this.u32(value >>> 0);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Encode the ISO 21496-1 metadata block (the payload after the namespace
 * string). Version-only blocks (four zero bytes) are what the primary image
 * carries; the full block lives in the secondary image.
 */
export function encodeIsoGainMapMetadata(
  metadata: GainMapMetadata | null,
  options: { channelCount?: 1 | 3 } = {},
): Uint8Array {
  const writer = new IsoWriter();
  writer.u16(0);
  writer.u16(0);
  if (!metadata) return writer.finish();
  validateGainMapMetadata(metadata);
  const requested = options.channelCount ?? (isUniformGainMapValue(metadata.gainMapMax) ? 1 : 3);
  const channelCount = requested === 3 ? 3 : 1;
  const flags = channelCount === 3 ? 1 : 0;
  writer.u8(flags);
  const headroomMin = floatToUnsignedFraction(Math.max(0, metadata.hdrCapacityMin));
  const headroomMax = floatToUnsignedFraction(Math.max(0, metadata.hdrCapacityMax));
  writer.u32(headroomMin.numerator);
  writer.u32(headroomMin.denominator);
  writer.u32(headroomMax.numerator);
  writer.u32(headroomMax.denominator);
  for (let channel = 0; channel < channelCount; channel++) {
    const min = floatToSignedFraction(gainMapChannel(metadata.gainMapMin, channel));
    const max = floatToSignedFraction(gainMapChannel(metadata.gainMapMax, channel));
    const gamma = floatToUnsignedFraction(gainMapChannel(metadata.gamma, channel));
    const baseOffset = floatToSignedFraction(gainMapChannel(metadata.offsetSdr, channel));
    const alternateOffset = floatToSignedFraction(gainMapChannel(metadata.offsetHdr, channel));
    writer.s32(min.numerator);
    writer.u32(min.denominator);
    writer.s32(max.numerator);
    writer.u32(max.denominator);
    writer.u32(gamma.numerator);
    writer.u32(gamma.denominator);
    writer.s32(baseOffset.numerator);
    writer.u32(baseOffset.denominator);
    writer.s32(alternateOffset.numerator);
    writer.u32(alternateOffset.denominator);
  }
  return writer.finish();
}

class IsoReader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  u8(): number {
    if (this.remaining < 1) throw new GainMapError('truncated ISO 21496-1 metadata');
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  s32(): number {
    return this.u32() | 0;
  }
}

export function decodeIsoGainMapMetadata(bytes: Uint8Array): GainMapMetadata | null {
  if (bytes.length < 5) {
    if (bytes.length === 4) return null;
    throw new GainMapError('ISO 21496-1 metadata block is too short');
  }
  const reader = new IsoReader(bytes);
  const minimumVersion = reader.u16();
  reader.u16();
  if (minimumVersion !== 0) {
    throw new GainMapError(`unsupported ISO 21496-1 minimum version ${minimumVersion}; expected 0`);
  }
  const flags = reader.u8();
  const channelCount = (flags & 1) !== 0 ? 3 : 1;
  if ((flags & 4) !== 0) {
    throw new GainMapError('HDR-base (backward direction) gain maps are not supported');
  }
  const commonDenominator = (flags & 8) !== 0;
  const mins: number[] = [];
  const maxes: number[] = [];
  const gammas: number[] = [];
  const offsetsSdr: number[] = [];
  const offsetsHdr: number[] = [];
  let headroomMin: number;
  let headroomMax: number;
  const fraction = (numerator: number, denominator: number, label: string): number => {
    if (denominator === 0) throw new GainMapError(`ISO 21496-1 ${label} has a zero denominator`);
    return numerator / denominator;
  };
  if (commonDenominator) {
    const denominator = reader.u32();
    headroomMin = fraction(reader.u32(), denominator, 'HDR capacity min');
    headroomMax = fraction(reader.u32(), denominator, 'HDR capacity max');
    for (let channel = 0; channel < channelCount; channel++) {
      mins.push(fraction(reader.s32(), denominator, 'GainMapMin'));
      maxes.push(fraction(reader.s32(), denominator, 'GainMapMax'));
      gammas.push(fraction(reader.u32(), denominator, 'Gamma'));
      offsetsSdr.push(fraction(reader.s32(), denominator, 'OffsetSDR'));
      offsetsHdr.push(fraction(reader.s32(), denominator, 'OffsetHDR'));
    }
  } else {
    headroomMin = fraction(reader.u32(), reader.u32(), 'HDR capacity min');
    headroomMax = fraction(reader.u32(), reader.u32(), 'HDR capacity max');
    for (let channel = 0; channel < channelCount; channel++) {
      mins.push(fraction(reader.s32(), reader.u32(), 'GainMapMin'));
      maxes.push(fraction(reader.s32(), reader.u32(), 'GainMapMax'));
      gammas.push(fraction(reader.u32(), reader.u32(), 'Gamma'));
      offsetsSdr.push(fraction(reader.s32(), reader.u32(), 'OffsetSDR'));
      offsetsHdr.push(fraction(reader.s32(), reader.u32(), 'OffsetHDR'));
    }
  }
  while (mins.length < 3) {
    mins.push(mins[0]!);
    maxes.push(maxes[0]!);
    gammas.push(gammas[0]!);
    offsetsSdr.push(offsetsSdr[0]!);
    offsetsHdr.push(offsetsHdr[0]!);
  }
  const identical =
    mins[0] === mins[1] &&
    mins[0] === mins[2] &&
    maxes[0] === maxes[1] &&
    maxes[0] === maxes[2] &&
    gammas[0] === gammas[1] &&
    gammas[0] === gammas[2] &&
    offsetsSdr[0] === offsetsSdr[1] &&
    offsetsSdr[0] === offsetsSdr[2] &&
    offsetsHdr[0] === offsetsHdr[1] &&
    offsetsHdr[0] === offsetsHdr[2];
  const pack = (values: number[]): GainMapChannelValue =>
    identical ? values[0]! : ([values[0]!, values[1]!, values[2]!] as const);
  const metadata: GainMapMetadata = {
    gainMapMin: pack(mins),
    gainMapMax: pack(maxes),
    gamma: pack(gammas),
    offsetSdr: pack(offsetsSdr),
    offsetHdr: pack(offsetsHdr),
    hdrCapacityMin: headroomMin,
    hdrCapacityMax: headroomMax,
  };
  validateGainMapMetadata(metadata);
  return metadata;
}

// ---------------------------------------------------------------------------
// JPEG container plumbing
// ---------------------------------------------------------------------------

function readJpegLayout(bytes: Uint8Array, start = 0): JpegLayout {
  if (bytes.length > MAX_JPEG_BYTES) {
    throw new GainMapError('JPEG exceeds the supported size limit');
  }
  if (start + 4 > bytes.length || bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) {
    throw new GainMapError('not a JPEG stream (missing SOI)');
  }
  const segments: JpegSegment[] = [];
  let offset = start + 2;
  let width = 0;
  let height = 0;
  let componentCount = 0;
  let firstSosOffset = -1;
  let end = -1;
  while (offset + 1 < bytes.length) {
    if (segments.length >= MAX_JPEG_SEGMENTS) {
      throw new GainMapError('JPEG contains too many segments');
    }
    if (bytes[offset] !== 0xff) {
      throw new GainMapError('JPEG marker stream is desynchronized');
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9) {
      end = offset + 2;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) throw new GainMapError('truncated JPEG segment header');
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) {
      throw new GainMapError('invalid JPEG segment length');
    }
    if (marker === 0xda) {
      if (firstSosOffset < 0) firstSosOffset = offset;
      let scan = offset + 2 + length;
      while (scan + 1 < bytes.length) {
        if (bytes[scan] === 0xff) {
          const next = bytes[scan + 1]!;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            scan += 2;
            continue;
          }
          if (next === 0xff) {
            scan += 1;
            continue;
          }
          break;
        }
        scan += 1;
      }
      segments.push({
        marker,
        offset,
        end: scan,
        payloadStart: offset + 4,
        payloadLength: length - 2,
      });
      offset = scan;
      continue;
    }
    segments.push({
      marker,
      offset,
      end: offset + 2 + length,
      payloadStart: offset + 4,
      payloadLength: length - 2,
    });
    if (SOF_MARKERS.has(marker)) {
      if (length < 8) throw new GainMapError('truncated JPEG frame header');
      height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      componentCount = bytes[offset + 9]!;
      if (
        width <= 0 ||
        height <= 0 ||
        width > MAX_GAIN_MAP_DIMENSION ||
        height > MAX_GAIN_MAP_DIMENSION
      ) {
        throw new GainMapError('JPEG dimensions are outside the supported range');
      }
    }
    offset += 2 + length;
  }
  if (end < 0) throw new GainMapError('truncated JPEG stream (missing EOI)');
  if (width === 0 || height === 0)
    throw new GainMapError('JPEG is missing a supported frame header');
  if (firstSosOffset < 0) throw new GainMapError('JPEG is missing a scan');
  return { start, end, width, height, componentCount, segments, firstSosOffset };
}

function segmentStartsWith(bytes: Uint8Array, segment: JpegSegment, text: string): boolean {
  const prefix = new TextEncoder().encode(text);
  if (segment.payloadLength < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[segment.payloadStart + index] !== prefix[index]) return false;
  }
  return true;
}

function isMetadataSegment(bytes: Uint8Array, segment: JpegSegment): boolean {
  if (segment.marker === 0xe1) {
    return (
      segmentStartsWith(bytes, segment, `${XMP_NAMESPACE}\0`) ||
      segmentStartsWith(bytes, segment, 'Exif\0\0')
    );
  }
  if (segment.marker === 0xe2) {
    return (
      segmentStartsWith(bytes, segment, 'MPF\0') ||
      segmentStartsWith(bytes, segment, `${ISO_NAMESPACE}\0`)
    );
  }
  return false;
}

function copySegments(
  bytes: Uint8Array,
  layout: JpegLayout,
  keep: (segment: JpegSegment) => boolean,
): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const segment of layout.segments) {
    if (!keep(segment)) continue;
    parts.push(bytes.subarray(segment.offset, segment.end));
    total += segment.end - segment.offset;
  }
  parts.push(bytes.subarray(layout.end - 2, layout.end));
  total += 2;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function appSegment(marker: number, namespace: string, payload: Uint8Array): Uint8Array {
  const namespaceBytes = new TextEncoder().encode(namespace);
  const length = 2 + namespaceBytes.length + payload.length;
  if (length > 0xffff) throw new GainMapError('JPEG metadata segment exceeds 64 KiB');
  const output = new Uint8Array(2 + length);
  output[0] = 0xff;
  output[1] = marker;
  output[2] = (length >> 8) & 0xff;
  output[3] = length & 0xff;
  output.set(namespaceBytes, 4);
  output.set(payload, 4 + namespaceBytes.length);
  return output;
}

interface MpfEntry {
  attribute: number;
  size: number;
  dataOffset: number;
}

interface MpfInfo {
  endianPosition: number;
  entries: MpfEntry[];
}

/** A two-entry MPF APP2 segment is always this many bytes. */
const MPF_SEGMENT_LENGTH = 90;

function buildMpfSegment(entries: MpfEntry[]): Uint8Array {
  const payload = new Uint8Array(86);
  const view = new DataView(payload.buffer);
  payload.set(new TextEncoder().encode('MPF\0'), 0);
  view.setUint16(4, 0x4d4d, false);
  view.setUint16(6, 0x002a, false);
  view.setUint32(8, 8, false);
  view.setUint16(12, 3, false);
  const entryTable = 14 + 36 + 4;
  view.setUint16(14, 0xb000, false);
  view.setUint16(16, 7, false);
  view.setUint32(18, 4, false);
  payload.set(new TextEncoder().encode('0100'), 22);
  view.setUint16(26, 0xb001, false);
  view.setUint16(28, 4, false);
  view.setUint32(30, 1, false);
  view.setUint32(34, entries.length, false);
  view.setUint16(38, 0xb002, false);
  view.setUint16(40, 7, false);
  view.setUint32(42, entries.length * 16, false);
  // MPF value offsets are relative to the MP Endian field at payload[4].
  view.setUint32(46, entryTable - 4, false);
  view.setUint32(50, 0, false);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const base = entryTable + index * 16;
    view.setUint32(base, entry.attribute, false);
    view.setUint32(base + 4, entry.size, false);
    view.setUint32(base + 8, entry.dataOffset, false);
    view.setUint32(base + 12, 0, false);
  }
  return appSegment(0xe2, 'MPF\0', payload.subarray(4));
}

function readMpfSegment(bytes: Uint8Array, segment: JpegSegment): MpfInfo | null {
  if (!segmentStartsWith(bytes, segment, 'MPF\0')) return null;
  const payload = bytes.subarray(
    segment.payloadStart,
    segment.payloadStart + segment.payloadLength,
  );
  if (payload.length < 14) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const endianPosition = segment.payloadStart + 4;
  const little = payload[4] === 0x49 && payload[5] === 0x49;
  if (!little && !(payload[4] === 0x4d && payload[5] === 0x4d)) {
    throw new GainMapError('MPF endian marker is invalid');
  }
  const getU16 = (offset: number): number =>
    little ? view.getUint16(offset, true) : view.getUint16(offset, false);
  const getU32 = (offset: number): number =>
    little ? view.getUint32(offset, true) : view.getUint32(offset, false);
  if (getU16(6) !== 0x002a) throw new GainMapError('MPF TIFF header is invalid');
  const ifdOffset = getU32(8);
  const ifdBase = 4 + ifdOffset;
  if (ifdBase + 2 > payload.length) throw new GainMapError('MPF IFD is truncated');
  const count = getU16(ifdBase);
  if (count > 64) throw new GainMapError('MPF IFD declares too many entries');
  const entries: MpfEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entryBase = ifdBase + 2 + index * 12;
    if (entryBase + 12 > payload.length) throw new GainMapError('MPF IFD entry is truncated');
    const tag = getU16(entryBase);
    const type = getU16(entryBase + 2);
    const valueCount = getU32(entryBase + 4);
    const valueOrOffset = getU32(entryBase + 8);
    if (tag !== 0xb002) continue;
    const entryCount = type === 4 ? valueCount : Math.floor(valueCount / 16);
    if (entryCount > 64) throw new GainMapError('MPF entry list is too long');
    const listBase = 4 + valueOrOffset;
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const base = listBase + entryIndex * 16;
      if (base + 16 > payload.length) throw new GainMapError('MPF entry is truncated');
      entries.push({
        attribute: getU32(base),
        size: getU32(base + 4),
        dataOffset: getU32(base + 8),
      });
    }
  }
  if (entries.length === 0) return null;
  return { endianPosition, entries };
}

/**
 * Assemble a conforming Ultra HDR JPEG from an already-encoded base JPEG and
 * gain map JPEG. The base image bytes after SOI are preserved; the base JPEG
 * is never re-encoded, so the SDR rendition stays exactly the pixels the user
 * reviewed.
 */
export function assembleUltraHdrJpeg(input: UltraHdrEncodeInput): Uint8Array {
  validateGainMapMetadata(input.metadata);
  const base = readJpegLayout(input.baseJpeg);
  const gain = readJpegLayout(input.gainMapJpeg);
  const writeIso = (input.metadataFormat ?? 'both') !== 'xmp';
  const secondaryXmp = new TextEncoder().encode(serializeGainMapXmpSecondary(input.metadata));
  const secondarySegments: Uint8Array[] = [appSegment(0xe1, `${XMP_NAMESPACE}\0`, secondaryXmp)];
  if (writeIso) {
    const secondaryIso = encodeIsoGainMapMetadata(input.metadata, {
      channelCount: input.gainMapChannels ?? 1,
    });
    secondarySegments.push(appSegment(0xe2, `${ISO_NAMESPACE}\0`, secondaryIso));
  }
  const gainBody = copySegments(input.gainMapJpeg, gain, (segment) => {
    if (segment.marker === 0xe0) return false;
    return !isMetadataSegment(input.gainMapJpeg, segment);
  });
  let secondaryLength = 2 + gainBody.length;
  for (const segment of secondarySegments) secondaryLength += segment.length;

  const primaryXmp = new TextEncoder().encode(serializeGainMapXmpPrimary(secondaryLength));
  const primaryMetadataSegments: Uint8Array[] = [
    appSegment(0xe1, `${XMP_NAMESPACE}\0`, primaryXmp),
  ];
  if (writeIso) {
    primaryMetadataSegments.push(
      appSegment(0xe2, `${ISO_NAMESPACE}\0`, encodeIsoGainMapMetadata(null)),
    );
  }
  const primaryMetadataLength = primaryMetadataSegments.reduce(
    (sum, segment) => sum + segment.length,
    0,
  );

  const app0 = base.segments.find((segment) => segment.marker === 0xe0);
  const exifSegments = base.segments.filter(
    (segment) => segment.marker === 0xe1 && segmentStartsWith(input.baseJpeg, segment, 'Exif\0\0'),
  );
  const keepSegment = (segment: JpegSegment): boolean => {
    if (segment.marker === 0xe0) return false;
    if (segmentStartsWith(input.baseJpeg, segment, 'Exif\0\0')) return false;
    if (isMetadataSegment(input.baseJpeg, segment)) return false;
    return true;
  };
  const beforeSos = base.segments.filter(
    (segment) => segment.offset < base.firstSosOffset && keepSegment(segment),
  );
  const fromSos = base.segments.filter((segment) => segment.offset >= base.firstSosOffset);
  const sumSegments = (segments: JpegSegment[]): number =>
    segments.reduce((sum, segment) => sum + (segment.end - segment.offset), 0);

  const app0Length = app0 ? app0.end - app0.offset : 0;
  const exifLength = sumSegments(exifSegments);
  const beforeSosLength = sumSegments(beforeSos);
  const prefixEnd = 2 + app0Length + exifLength + primaryMetadataLength + beforeSosLength;
  const endianPosition = prefixEnd + 8;
  const primaryLength = prefixEnd + MPF_SEGMENT_LENGTH + sumSegments(fromSos) + 2;
  if (secondaryLength > primaryLength) {
    // The gain map offset must remain positive and inside the file.
    throw new GainMapError('gain map offset would be negative');
  }
  const gainMapOffset = primaryLength - endianPosition;
  const finalMpf = buildMpfSegment([
    { attribute: 0x030000, size: primaryLength, dataOffset: 0 },
    { attribute: 0x000000, size: secondaryLength, dataOffset: gainMapOffset },
  ]);

  const output = new Uint8Array(primaryLength + secondaryLength);
  let cursor = 0;
  const push = (part: Uint8Array): void => {
    output.set(part, cursor);
    cursor += part.length;
  };
  push(Uint8Array.of(0xff, 0xd8));
  if (app0) push(input.baseJpeg.subarray(app0.offset, app0.end));
  for (const segment of exifSegments) push(input.baseJpeg.subarray(segment.offset, segment.end));
  for (const segment of primaryMetadataSegments) push(segment);
  for (const segment of beforeSos) push(input.baseJpeg.subarray(segment.offset, segment.end));
  push(finalMpf);
  for (const segment of fromSos) push(input.baseJpeg.subarray(segment.offset, segment.end));
  push(input.baseJpeg.subarray(base.end - 2, base.end));
  push(Uint8Array.of(0xff, 0xd8));
  for (const segment of secondarySegments) push(segment);
  push(gainBody);
  if (cursor !== output.length) {
    throw new GainMapError(
      `gain map container size accounting failed: wrote ${cursor}, reserved ${output.length}, mpf ${finalMpf.length}, prefix ${prefixEnd}, fromSos ${sumSegments(fromSos)}`,
    );
  }
  return output;
}

/**
 * Read the base image, locate the secondary gain map, and decode whichever
 * metadata block is authoritative. ISO 21496-1 wins over XMP when both are
 * present, matching libultrahdr's precedence.
 */
export function parseUltraHdrJpeg(bytes: Uint8Array): UltraHdrDecodeResult {
  const warnings: string[] = [];
  const base = readJpegLayout(bytes, 0);
  let xmpPrimary: string | null = null;
  let mpf: MpfInfo | null = null;
  for (const segment of base.segments) {
    if (
      !xmpPrimary &&
      segment.marker === 0xe1 &&
      segmentStartsWith(bytes, segment, `${XMP_NAMESPACE}\0`)
    ) {
      xmpPrimary = new TextDecoder().decode(
        bytes.subarray(
          segment.payloadStart + XMP_NAMESPACE.length + 1,
          segment.payloadStart + segment.payloadLength,
        ),
      );
    }
    if (!mpf) mpf = readMpfSegment(bytes, segment);
  }
  const containerItems = xmpPrimary ? parseContainerItems(xmpPrimary) : null;
  let gainMapStart = -1;
  let gainMapEnd = -1;
  if (mpf && mpf.entries.length >= 2) {
    const entry = mpf.entries[1]!;
    gainMapStart = mpf.endianPosition + entry.dataOffset;
    gainMapEnd = entry.size > 0 ? gainMapStart + entry.size : bytes.length;
    if (gainMapStart < base.end || gainMapStart + 2 > bytes.length) {
      throw new GainMapError(
        `MPF points outside the JPEG container: start ${gainMapStart}, base end ${base.end}, size ${bytes.length}`,
      );
    }
    if (bytes[gainMapStart] !== 0xff || bytes[gainMapStart + 1] !== 0xd8) {
      warnings.push('MPF secondary image does not start with a JPEG SOI marker');
      gainMapStart = -1;
    }
  } else if (containerItems) {
    const gainMapIndex = containerItems.findIndex((item) => item.semantic === 'GainMap');
    if (gainMapIndex >= 0) {
      let location = base.end;
      for (let index = 0; index < gainMapIndex; index++) {
        const item = containerItems[index]!;
        if (item.length !== null) location += item.length;
        location += item.padding;
      }
      const item = containerItems[gainMapIndex]!;
      gainMapStart = location;
      gainMapEnd = item.length !== null ? location + item.length : bytes.length;
      if (
        gainMapStart + 2 <= bytes.length &&
        (bytes[gainMapStart] !== 0xff || bytes[gainMapStart + 1] !== 0xd8)
      ) {
        warnings.push('GContainer directory points at a non-JPEG secondary image');
        gainMapStart = -1;
      } else {
        warnings.push('located the gain map through the GContainer directory (no MPF index)');
      }
    }
  }
  if (gainMapStart < 0) {
    return {
      baseJpeg: bytes.subarray(0, base.end),
      gainMapJpeg: null,
      baseWidth: base.width,
      baseHeight: base.height,
      gainMapWidth: 0,
      gainMapHeight: 0,
      metadata: null,
      metadataSource: null,
      containerItems,
      warnings,
    };
  }
  if (gainMapEnd > bytes.length) {
    throw new GainMapError('gain map extends beyond the JPEG container');
  }
  const gainLayout = readJpegLayout(bytes, gainMapStart);
  const gainMapEndClamped = Math.min(gainMapEnd, gainLayout.end);
  let xmpSecondary: string | null = null;
  let isoSegment: Uint8Array | null = null;
  for (const segment of gainLayout.segments) {
    if (
      !xmpSecondary &&
      segment.marker === 0xe1 &&
      segmentStartsWith(bytes, segment, `${XMP_NAMESPACE}\0`)
    ) {
      xmpSecondary = new TextDecoder().decode(
        bytes.subarray(
          segment.payloadStart + XMP_NAMESPACE.length + 1,
          segment.payloadStart + segment.payloadLength,
        ),
      );
    }
    if (
      !isoSegment &&
      segment.marker === 0xe2 &&
      segmentStartsWith(bytes, segment, `${ISO_NAMESPACE}\0`)
    ) {
      isoSegment = bytes.subarray(
        segment.payloadStart + ISO_NAMESPACE.length + 1,
        segment.payloadStart + segment.payloadLength,
      );
    }
  }
  let metadata: GainMapMetadata | null = null;
  let metadataSource: UltraHdrDecodeResult['metadataSource'] = null;
  if (isoSegment && isoSegment.length > 4) {
    metadata = decodeIsoGainMapMetadata(isoSegment);
    if (metadata) metadataSource = 'iso';
  }
  if (!metadata && xmpSecondary) {
    metadata = parseGainMapXmpMetadata(xmpSecondary);
    if (metadata) metadataSource = 'xmp-secondary';
  }
  if (!metadata && xmpPrimary) {
    metadata = parseGainMapXmpMetadata(xmpPrimary);
    if (metadata) metadataSource = 'xmp-primary';
  }
  if (!metadata) {
    warnings.push('the secondary image carries no supported gain map metadata');
  }
  if (gainLayout.width !== base.width || gainLayout.height !== base.height) {
    warnings.push(
      `gain map is ${gainLayout.width}x${gainLayout.height}; the primary image is ${base.width}x${base.height}`,
    );
  }
  return {
    baseJpeg: bytes.subarray(0, base.end),
    gainMapJpeg: bytes.subarray(gainMapStart, Math.min(gainMapEndClamped, gainLayout.end)),
    baseWidth: base.width,
    baseHeight: base.height,
    gainMapWidth: gainLayout.width,
    gainMapHeight: gainLayout.height,
    metadata,
    metadataSource,
    containerItems,
    warnings,
  };
}

export function isUltraHdrJpeg(bytes: Uint8Array): boolean {
  try {
    const result = parseUltraHdrJpeg(bytes);
    return result.metadata !== null;
  } catch {
    return false;
  }
}
