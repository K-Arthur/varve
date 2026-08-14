/**
 * Model-independent depth data contract.
 *
 * A DepthMap is a continuous scalar field, not a binary mask. Runtime
 * backends may produce arbitrary sign/range conventions; this module turns
 * their output into the canonical Varve convention: 0 = near, 1 = far.
 * Persisted values use 16 bits so blur transitions and range masks do not
 * inherit the banding of an 8-bit preview.
 */

export type DepthType = 'relative' | 'metric';
export type DepthUnit = 'normalized' | 'metres' | 'unknown';
export type NearFarConvention = 'nearIsLow' | 'nearIsHigh';

export interface DepthMapMetadata {
  depthType: DepthType;
  unit: DepthUnit;
  /** Canonical persisted maps always use nearIsLow. */
  nearFarConvention: 'nearIsLow';
  modelId?: string;
  modelVersion?: string;
  inferenceVersion: number;
  preprocessingVersion: number;
  sourceAssetId?: string;
  sourceRevision?: number;
  sourceHash?: string;
  generatedAt?: number;
}

export interface DepthMap {
  width: number;
  height: number;
  /** Canonical normalized values: 0 = near, 1 = far. */
  values: Float32Array;
  /** 1 for valid samples, 0 for missing/transparent samples. */
  valid: Uint8Array;
  metadata: DepthMapMetadata;
}

export interface DepthMapResource extends DepthMapMetadata {
  id: string;
  schemaVersion: 1;
  width: number;
  height: number;
  /** Little-endian uint16 scalar payload, encoded for document storage. */
  dataBase64: string;
  /** Optional validity payload; omitted means every sample is valid. */
  validBase64?: string;
  byteLength: number;
}

export interface NormalizeDepthOptions {
  /** Runtime convention of the raw prediction. Defaults to higher = near. */
  nearFarConvention?: NearFarConvention;
  /** Values outside these quantiles are excluded from the normalization range. */
  lowPercentile?: number;
  highPercentile?: number;
  /** Optional source alpha/validity field, 1 byte per raw sample. */
  valid?: Uint8Array;
  metadata?: Partial<DepthMapMetadata>;
}

const DEFAULT_LOW_PERCENTILE = 0.02;
const DEFAULT_HIGH_PERCENTILE = 0.98;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = clamp01(fraction) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const t = index - lower;
  return sorted[lower]! * (1 - t) + sorted[upper]! * t;
}

/**
 * Normalize a backend prediction while excluding non-finite and invalid
 * samples from the range. Uniform or unusable predictions become a valid,
 * stable mid-plane instead of producing NaNs or infinities downstream.
 */
export function normalizeDepthPrediction(
  raw: Float32Array | readonly number[],
  width: number,
  height: number,
  options: NormalizeDepthOptions = {},
): DepthMap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('DepthMap dimensions must be positive integers');
  }
  if (raw.length !== width * height) {
    throw new Error(`Depth prediction length ${raw.length} does not match ${width}x${height}`);
  }
  if (options.valid && options.valid.length !== raw.length) {
    throw new Error('Depth validity length must match the prediction');
  }

  const valid = new Uint8Array(raw.length);
  const finite: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const isValid = (options.valid?.[i] ?? 1) !== 0 && Number.isFinite(raw[i]);
    valid[i] = isValid ? 1 : 0;
    if (isValid) finite.push(raw[i]!);
  }

  const values = new Float32Array(raw.length);
  if (finite.length === 0) {
    values.fill(0.5);
  } else {
    finite.sort((a, b) => a - b);
    const low = percentile(finite, options.lowPercentile ?? DEFAULT_LOW_PERCENTILE);
    const high = percentile(finite, options.highPercentile ?? DEFAULT_HIGH_PERCENTILE);
    const range = high - low;
    const runtimeNearIsHigh = (options.nearFarConvention ?? 'nearIsHigh') === 'nearIsHigh';
    for (let i = 0; i < raw.length; i++) {
      if (!valid[i]) {
        values[i] = 0.5;
        continue;
      }
      const normalized = range > Number.EPSILON ? clamp01((raw[i]! - low) / range) : 0.5;
      // Persisted Varve convention is nearIsLow.
      values[i] = runtimeNearIsHigh ? 1 - normalized : normalized;
    }
  }

  return {
    width,
    height,
    values,
    valid,
    metadata: {
      depthType: options.metadata?.depthType ?? 'relative',
      unit: options.metadata?.unit ?? 'normalized',
      nearFarConvention: 'nearIsLow',
      inferenceVersion: options.metadata?.inferenceVersion ?? 1,
      preprocessingVersion: options.metadata?.preprocessingVersion ?? 1,
      ...(options.metadata?.modelId ? { modelId: options.metadata.modelId } : {}),
      ...(options.metadata?.modelVersion ? { modelVersion: options.metadata.modelVersion } : {}),
      ...(options.metadata?.sourceAssetId ? { sourceAssetId: options.metadata.sourceAssetId } : {}),
      ...(options.metadata?.sourceRevision !== undefined
        ? { sourceRevision: options.metadata.sourceRevision }
        : {}),
      ...(options.metadata?.sourceHash ? { sourceHash: options.metadata.sourceHash } : {}),
      ...(options.metadata?.generatedAt !== undefined
        ? { generatedAt: options.metadata.generatedAt }
        : {}),
    },
  };
}

/** Bilinear sample in source-map coordinates. Invalid samples are skipped. */
export function sampleDepth(map: DepthMap, x: number, y: number, radius = 1): number | null {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let sum = 0;
  let count = 0;
  const r = Math.max(0, Math.floor(radius));
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const sx = cx + ox;
      const sy = cy + oy;
      if (sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) continue;
      const index = sy * map.width + sx;
      if (!map.valid[index]) continue;
      sum += map.values[index]!;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Resize a depth field with bilinear interpolation while preserving validity. */
export function resizeDepthMap(map: DepthMap, width: number, height: number): DepthMap {
  if (map.width === width && map.height === height) return map;
  const values = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const xScale = map.width / width;
  const yScale = map.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(map.height - 1, Math.max(0, (y + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(map.height - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(map.width - 1, Math.max(0, (x + 0.5) * xScale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(map.width - 1, x0 + 1);
      const tx = sx - x0;
      const i00 = y0 * map.width + x0;
      const i10 = y0 * map.width + x1;
      const i01 = y1 * map.width + x0;
      const i11 = y1 * map.width + x1;
      const out = y * width + x;
      const count =
        Number(map.valid[i00]) +
        Number(map.valid[i10]) +
        Number(map.valid[i01]) +
        Number(map.valid[i11]);
      if (count === 0) {
        values[out] = 0.5;
        valid[out] = 0;
        continue;
      }
      values[out] =
        map.values[i00]! * (1 - tx) * (1 - ty) +
        map.values[i10]! * tx * (1 - ty) +
        map.values[i01]! * (1 - tx) * ty +
        map.values[i11]! * tx * ty;
      valid[out] = 1;
    }
  }
  return { ...map, width, height, values, valid };
}

/** Convert a continuous range into an ordinary semantic coverage mask. */
export function depthRangeToMask(
  map: DepthMap,
  near: number,
  far: number,
  feather = 0,
  invert = false,
): Uint8Array {
  const lo = Math.min(clamp01(near), clamp01(far));
  const hi = Math.max(clamp01(near), clamp01(far));
  const featherWidth = Math.max(0, feather);
  const mask = new Uint8Array(map.values.length);
  for (let i = 0; i < mask.length; i++) {
    if (!map.valid[i]) {
      mask[i] = 0;
      continue;
    }
    const value = map.values[i]!;
    let coverage =
      featherWidth === 0
        ? value >= lo && value <= hi
          ? 1
          : 0
        : Math.min(
            1,
            Math.min(
              (value - (lo - featherWidth)) / featherWidth,
              (hi + featherWidth - value) / featherWidth,
            ),
          );
    coverage = Math.max(0, coverage);
    mask[i] = Math.round((invert ? 1 - coverage : coverage) * 255);
  }
  return mask;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function serializeDepthMap(map: DepthMap, id: string): DepthMapResource {
  const encoded = new Uint8Array(map.values.length * 2);
  const view = new DataView(encoded.buffer);
  for (let i = 0; i < map.values.length; i++) {
    view.setUint16(i * 2, Math.round(clamp01(map.values[i]!) * 65535), true);
  }
  const valid = map.valid.some((value) => value === 0) ? bytesToBase64(map.valid) : undefined;
  return {
    id,
    schemaVersion: 1,
    width: map.width,
    height: map.height,
    dataBase64: bytesToBase64(encoded),
    ...(valid ? { validBase64: valid } : {}),
    byteLength: encoded.byteLength + (valid ? map.valid.byteLength : 0),
    ...map.metadata,
  };
}

export function deserializeDepthMap(resource: DepthMapResource): DepthMap {
  if (resource.schemaVersion !== 1) throw new Error('Unsupported DepthMap resource version');
  const bytes = base64ToBytes(resource.dataBase64);
  if (bytes.byteLength !== resource.width * resource.height * 2) {
    throw new Error('Depth resource has an invalid scalar payload length');
  }
  const values = new Float32Array(resource.width * resource.height);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(i * 2, true) / 65535;
  const valid = resource.validBase64
    ? base64ToBytes(resource.validBase64)
    : new Uint8Array(values.length).fill(1);
  if (valid.length !== values.length)
    throw new Error('Depth resource has an invalid validity payload');
  return {
    width: resource.width,
    height: resource.height,
    values,
    valid,
    metadata: {
      depthType: resource.depthType,
      unit: resource.unit,
      nearFarConvention: 'nearIsLow',
      inferenceVersion: resource.inferenceVersion,
      preprocessingVersion: resource.preprocessingVersion,
      ...(resource.modelId ? { modelId: resource.modelId } : {}),
      ...(resource.modelVersion ? { modelVersion: resource.modelVersion } : {}),
      ...(resource.sourceAssetId ? { sourceAssetId: resource.sourceAssetId } : {}),
      ...(resource.sourceRevision !== undefined ? { sourceRevision: resource.sourceRevision } : {}),
      ...(resource.sourceHash ? { sourceHash: resource.sourceHash } : {}),
      ...(resource.generatedAt !== undefined ? { generatedAt: resource.generatedAt } : {}),
    },
  };
}
export interface DepthCacheKeyInput {
  sourceHash: string;
  sourceRevision: number;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: number;
  width: number;
  height: number;
}

export function depthCacheKey(input: DepthCacheKeyInput): string {
  return [
    'depth',
    input.sourceHash,
    input.sourceRevision,
    input.modelId,
    input.modelVersion,
    input.preprocessingVersion,
    input.width,
    input.height,
  ].join(':');
}

/** Small bounded LRU for decoded maps; persisted resources remain authoritative. */
export class DepthMapCache {
  private readonly entries = new Map<string, DepthMap>();

  constructor(private readonly maxEntries = 3) {}

  get(key: string): DepthMap | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: DepthMap): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
