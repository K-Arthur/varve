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
export type DepthUnit = 'normalized' | 'metres' | 'inverse-metres' | 'unknown';
export type NearFarConvention = 'nearIsLow' | 'nearIsHigh';

export type DepthMapOrigin = 'generated' | 'imported';

/** Reproducible scalar normalization, separate from the colourized preview. */
export interface DepthNormalizationMetadata {
  method: 'percentile-clip' | 'explicit-range' | 'identity';
  sourceMin: number | null;
  sourceMax: number | null;
  lowPercentile?: number;
  highPercentile?: number;
  rangeMin?: number;
  rangeMax?: number;
  validSampleCount: number;
  inputNearFarConvention: NearFarConvention;
  /** True when no valid finite input sample existed. */
  noValidSamples?: boolean;
}

/** Explicit source-to-map registration. Affine values use pixel coordinates. */
export interface DepthMapRegistration {
  schemaVersion: 1;
  sourceWidth: number;
  sourceHeight: number;
  mapWidth: number;
  mapHeight: number;
  coordinateSpace: 'source-image-pixels';
  orientation: 'top-left';
  /** Maps source pixel coordinates into map pixel coordinates. */
  sourceToMap?: readonly [number, number, number, number, number, number];
}

/** Origin and processing details for an accepted resource. */
export interface DepthMapProvenance {
  origin: DepthMapOrigin;
  format?: string;
  runtime?: string;
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  preprocessingVersion?: number;
  importedAt?: number;
}

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
  /** How the canonical scalar field was produced from the input values. */
  normalization?: DepthNormalizationMetadata;
  /** Registration/orientation contract for source-bound resources. */
  registration?: DepthMapRegistration;
  /** Provenance is descriptive; it is never treated as confidence. */
  provenance?: DepthMapProvenance;
}

export interface DepthMap {
  width: number;
  height: number;
  /** Canonical normalized values: 0 = near, 1 = far. */
  values: Float32Array;
  /** 1 for valid samples, 0 for missing/transparent samples. */
  valid: Uint8Array;
  /** Optional calibrated samples, retained without normalized clamping. */
  measurements?: Float32Array;
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
  /** Optional little-endian float32 calibrated payload (metric/disparity). */
  measurementDataBase64?: string;
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
  /** Required when metadata.depthType is metric. Kept in calibrated units. */
  measurements?: Float32Array | readonly number[];
  /** Explicit range for metric normalization; percentile clipping is not used. */
  metricRange?: { min: number; max: number };
  metadata?: Partial<DepthMapMetadata>;
}

export interface DepthRangeOptions {
  /** Canonical normalized near endpoint (0 = near). */
  near: number;
  /** Canonical normalized far endpoint (1 = far). */
  far: number;
  /** Depth-domain transition below the near endpoint. */
  nearTransition?: number;
  /** Depth-domain transition above the far endpoint. */
  farTransition?: number;
  invert?: boolean;
  /** Crossed handles are an empty range unless explicitly normalized. */
  order?: 'empty' | 'normalize';
}

export type MaskCombineMode = 'replace' | 'intersect' | 'union' | 'subtract';

export interface DepthHistogram {
  bins: Uint32Array;
  validCount: number;
  min: number | null;
  max: number | null;
}

const DEFAULT_LOW_PERCENTILE = 0.02;
const DEFAULT_HIGH_PERCENTILE = 0.98;
const MAX_DEPTH_PIXELS = 64 * 1024 * 1024;
const MAX_BASE64_BYTES = 512 * 1024 * 1024;
const MAX_SAMPLE_RADIUS = 32;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validateDimensions(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('DepthMap dimensions must be positive safe integers');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_DEPTH_PIXELS) {
    throw new Error(`DepthMap exceeds the ${MAX_DEPTH_PIXELS}-pixel safety limit`);
  }
  return pixels;
}

function validatePercentile(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite value between 0 and 1`);
  }
}

function validateVersion(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function validateOptionalString(value: unknown, label: string, maxLength = 4096): void {
  if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
    throw new Error(`${label} must be a string of at most ${maxLength} characters`);
  }
}

function validateOptionalTimestamp(value: unknown, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || (value as number) < 0)) {
    throw new Error(`${label} must be a finite non-negative timestamp`);
  }
}

function validateNormalizationMetadata(
  normalization: DepthNormalizationMetadata,
  pixels: number,
): void {
  if (!['percentile-clip', 'explicit-range', 'identity'].includes(normalization.method)) {
    throw new Error('Depth normalization method is unsupported');
  }
  for (const [value, label] of [
    [normalization.sourceMin, 'normalization.sourceMin'],
    [normalization.sourceMax, 'normalization.sourceMax'],
  ] as const) {
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`${label} must be finite or null`);
    }
  }
  if (
    (normalization.sourceMin === null) !== (normalization.sourceMax === null) ||
    (normalization.sourceMin !== null &&
      normalization.sourceMax !== null &&
      normalization.sourceMin > normalization.sourceMax)
  ) {
    throw new Error('Depth normalization source range is invalid');
  }
  if (
    !Number.isSafeInteger(normalization.validSampleCount) ||
    normalization.validSampleCount < 0 ||
    normalization.validSampleCount > pixels
  ) {
    throw new Error('Depth normalization validSampleCount is invalid');
  }
  if (normalization.lowPercentile !== undefined) {
    validatePercentile(normalization.lowPercentile, 'normalization.lowPercentile');
  }
  if (normalization.highPercentile !== undefined) {
    validatePercentile(normalization.highPercentile, 'normalization.highPercentile');
  }
  if (
    normalization.lowPercentile !== undefined &&
    normalization.highPercentile !== undefined &&
    normalization.lowPercentile > normalization.highPercentile
  ) {
    throw new Error('Depth normalization percentiles are crossed');
  }
  if ((normalization.rangeMin === undefined) !== (normalization.rangeMax === undefined)) {
    throw new Error('Depth normalization range must contain both endpoints');
  }
  if (
    normalization.rangeMin !== undefined &&
    normalization.rangeMax !== undefined &&
    (!Number.isFinite(normalization.rangeMin) ||
      !Number.isFinite(normalization.rangeMax) ||
      normalization.rangeMin > normalization.rangeMax)
  ) {
    throw new Error('Depth normalization range is invalid');
  }
  if (!['nearIsLow', 'nearIsHigh'].includes(normalization.inputNearFarConvention)) {
    throw new Error('Depth normalization input convention is unsupported');
  }
  if (
    normalization.noValidSamples === true &&
    (normalization.validSampleCount !== 0 ||
      normalization.sourceMin !== null ||
      normalization.sourceMax !== null)
  ) {
    throw new Error('Depth normalization noValidSamples flag is inconsistent');
  }
}

function validateRegistrationMetadata(
  registration: DepthMapRegistration,
  width: number,
  height: number,
): void {
  if (registration.schemaVersion !== 1) {
    throw new Error('Depth registration schema is unsupported');
  }
  validateDimensions(registration.sourceWidth, registration.sourceHeight);
  if (registration.mapWidth !== width || registration.mapHeight !== height) {
    throw new Error('Depth registration map dimensions do not match the scalar payload');
  }
  if (registration.coordinateSpace !== 'source-image-pixels') {
    throw new Error('Depth registration coordinate space is unsupported');
  }
  if (registration.orientation !== 'top-left') {
    throw new Error('Depth registration orientation is unsupported');
  }
  if (registration.sourceToMap !== undefined) {
    if (registration.sourceToMap.length !== 6) {
      throw new Error('Depth registration transform must contain six affine values');
    }
    if (registration.sourceToMap.some((value) => !Number.isFinite(value))) {
      throw new Error('Depth registration transform must contain finite values');
    }
    const [a, b, c, d] = registration.sourceToMap;
    if (Math.abs(a * d - b * c) <= Number.EPSILON) {
      throw new Error('Depth registration transform must be invertible');
    }
  }
}

function validateValidityBuffer(valid: Uint8Array | undefined, expectedLength: number): void {
  if (!valid) return;
  if (valid.length !== expectedLength) {
    throw new Error('Depth validity length must match the prediction');
  }
  for (const value of valid) {
    if (value !== 0 && value !== 1) {
      throw new Error('Depth validity must contain only 0 or 1');
    }
  }
}

function validateProvenanceMetadata(provenance: DepthMapProvenance): void {
  if (provenance.origin !== 'generated' && provenance.origin !== 'imported') {
    throw new Error('Depth provenance origin is unsupported');
  }
  validateOptionalString(provenance.format, 'Depth provenance format');
  validateOptionalString(provenance.runtime, 'Depth provenance runtime');
  validateOptionalString(provenance.modelId, 'Depth provenance modelId');
  validateOptionalString(provenance.modelVersion, 'Depth provenance modelVersion');
  validateOptionalString(provenance.modelChecksum, 'Depth provenance modelChecksum', 128);
  if (provenance.preprocessingVersion !== undefined) {
    validateVersion(provenance.preprocessingVersion, 'Depth provenance preprocessingVersion');
  }
  validateOptionalTimestamp(provenance.importedAt, 'Depth provenance importedAt');
}

function validateDepthMetadata(metadata: DepthMapMetadata, width: number, height: number): void {
  if (metadata.depthType !== 'relative' && metadata.depthType !== 'metric') {
    throw new Error('Depth metadata type is unsupported');
  }
  if (!['normalized', 'metres', 'inverse-metres', 'unknown'].includes(metadata.unit)) {
    throw new Error('Depth metadata unit is unsupported');
  }
  if (metadata.depthType === 'metric') {
    if (metadata.unit !== 'metres' && metadata.unit !== 'inverse-metres') {
      throw new Error('Metric depth must declare metres or inverse-metres');
    }
  } else if (metadata.unit === 'metres' || metadata.unit === 'inverse-metres') {
    throw new Error('Relative depth cannot declare a metric unit');
  }
  if (metadata.nearFarConvention !== 'nearIsLow') {
    throw new Error('Persisted depth resources must use canonical nearIsLow ordering');
  }
  validateVersion(metadata.inferenceVersion, 'Depth inferenceVersion');
  validateVersion(metadata.preprocessingVersion, 'Depth preprocessingVersion');
  validateOptionalString(metadata.modelId, 'Depth modelId');
  validateOptionalString(metadata.modelVersion, 'Depth modelVersion');
  validateOptionalString(metadata.sourceAssetId, 'Depth sourceAssetId');
  validateOptionalString(metadata.sourceHash, 'Depth sourceHash', 128);
  if (metadata.sourceRevision !== undefined) {
    if (!Number.isSafeInteger(metadata.sourceRevision) || metadata.sourceRevision < 0) {
      throw new Error('Depth sourceRevision must be a non-negative safe integer');
    }
  }
  validateOptionalTimestamp(metadata.generatedAt, 'Depth generatedAt');
  if (metadata.normalization) validateNormalizationMetadata(metadata.normalization, width * height);
  if (metadata.registration) validateRegistrationMetadata(metadata.registration, width, height);
  if (metadata.provenance) validateProvenanceMetadata(metadata.provenance);
}

/** In-place selection avoids a boxed-number full sort for large maps. */
function selectKth(values: Float32Array, length: number, kth: number): number {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const pivot = values[Math.floor((left + right) / 2)]!;
    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i]! < pivot) i++;
      while (values[j]! > pivot) j--;
      if (i <= j) {
        const value = values[i]!;
        values[i] = values[j]!;
        values[j] = value;
        i++;
        j--;
      }
    }
    if (kth <= j) right = j;
    else if (kth >= i) left = i;
    else break;
  }
  return values[kth]!;
}

function percentile(values: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0;
  const index = clamp01(fraction) * (length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = selectKth(values, length, lower);
  if (lower === upper) return lowerValue;
  const upperValue = selectKth(values, length, upper);
  const t = index - lower;
  return lowerValue * (1 - t) + upperValue * t;
}

function metadataForNormalization(
  options: NormalizeDepthOptions,
  sourceMin: number | null,
  sourceMax: number | null,
  validSampleCount: number,
  lowPercentile: number,
  highPercentile: number,
  rangeMin: number | undefined,
  rangeMax: number | undefined,
): DepthNormalizationMetadata {
  return {
    method: 'percentile-clip',
    sourceMin,
    sourceMax,
    lowPercentile,
    highPercentile,
    ...(rangeMin !== undefined ? { rangeMin } : {}),
    ...(rangeMax !== undefined ? { rangeMax } : {}),
    validSampleCount,
    inputNearFarConvention: options.nearFarConvention ?? 'nearIsHigh',
    ...(validSampleCount === 0 ? { noValidSamples: true } : {}),
  };
}

function copyMetadata(metadata: DepthMapMetadata): DepthMapMetadata {
  return {
    ...metadata,
    ...(metadata.normalization ? { normalization: { ...metadata.normalization } } : {}),
    ...(metadata.registration
      ? {
          registration: {
            ...metadata.registration,
            ...(metadata.registration.sourceToMap
              ? {
                  sourceToMap: [
                    ...metadata.registration.sourceToMap,
                  ] as typeof metadata.registration.sourceToMap,
                }
              : {}),
          },
        }
      : {}),
    ...(metadata.provenance ? { provenance: { ...metadata.provenance } } : {}),
  };
}

/**
 * Carry a source-to-map registration through a pixel-grid resample. The
 * affine is expressed in index coordinates; pixel-centre offsets cancel when
 * the grid is scaled, so this remains stable across preview sizes.
 */
function remapRegistration(
  metadata: DepthMapMetadata,
  mapWidth: number,
  mapHeight: number,
  scaleX: number,
  scaleY: number,
  offsetX = 0,
  offsetY = 0,
): DepthMapMetadata {
  if (!metadata.registration) return copyMetadata(metadata);
  const registration = metadata.registration;
  const [a, b, c, d, e, f] = registration.sourceToMap ?? [1, 0, 0, 1, 0, 0];
  return {
    ...copyMetadata(metadata),
    registration: {
      ...registration,
      mapWidth,
      mapHeight,
      sourceToMap: [
        scaleX * a,
        scaleY * b,
        scaleX * c,
        scaleY * d,
        scaleX * (e - offsetX),
        scaleY * (f - offsetY),
      ],
    },
  };
}

function validateMapBuffers(map: DepthMap): number {
  const pixels = validateDimensions(map.width, map.height);
  validateDepthMetadata(map.metadata, map.width, map.height);
  if (map.values.length !== pixels) {
    throw new Error('DepthMap scalar length does not match its dimensions');
  }
  if (map.valid.length !== pixels) {
    throw new Error('DepthMap validity length does not match its dimensions');
  }
  if (map.measurements && map.measurements.length !== pixels) {
    throw new Error('DepthMap measurement length does not match its dimensions');
  }
  for (let i = 0; i < pixels; i++) {
    if (map.valid[i] !== 0 && map.valid[i] !== 1) {
      throw new Error('DepthMap validity must contain only 0 or 1');
    }
    if (!Number.isFinite(map.values[i]!) || map.values[i]! < 0 || map.values[i]! > 1) {
      throw new Error('DepthMap scalar values must be finite and normalized to 0..1');
    }
    if (map.measurements && !Number.isFinite(map.measurements[i])) {
      throw new Error('DepthMap calibrated measurements must be finite');
    }
  }
  if (map.metadata.depthType === 'metric' && !map.measurements) {
    throw new Error('Metric DepthMaps must retain calibrated measurements');
  }
  return pixels;
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
  const pixels = validateDimensions(width, height);
  if (raw.length !== pixels) {
    throw new Error(`Depth prediction length ${raw.length} does not match ${width}x${height}`);
  }
  validateValidityBuffer(options.valid, raw.length);
  if (options.metadata?.depthType === 'metric') {
    if (!options.metricRange) {
      throw new Error('Metric depth requires an explicit metricRange');
    }
    return normalizeMetricDepth(raw, width, height, {
      ...options,
      metricRange: options.metricRange,
      measurements: options.measurements ?? raw,
    });
  }
  if (options.measurements) {
    throw new Error('Calibrated measurements require metadata.depthType=metric');
  }

  const lowPercentile = options.lowPercentile ?? DEFAULT_LOW_PERCENTILE;
  const highPercentile = options.highPercentile ?? DEFAULT_HIGH_PERCENTILE;
  validatePercentile(lowPercentile, 'lowPercentile');
  validatePercentile(highPercentile, 'highPercentile');
  if (lowPercentile > highPercentile) {
    throw new Error('lowPercentile must not exceed highPercentile');
  }

  const valid = new Uint8Array(pixels);
  const finite = new Float32Array(pixels);
  let finiteCount = 0;
  let sourceMin = Infinity;
  let sourceMax = -Infinity;
  for (let i = 0; i < pixels; i++) {
    const isValid = (options.valid?.[i] ?? 1) !== 0 && Number.isFinite(raw[i]);
    valid[i] = isValid ? 1 : 0;
    if (isValid) {
      const sample = raw[i]!;
      finite[finiteCount++] = sample;
      sourceMin = Math.min(sourceMin, sample);
      sourceMax = Math.max(sourceMax, sample);
    }
  }

  const values = new Float32Array(pixels);
  let low = 0;
  let high = 0;
  if (finiteCount === 0) {
    values.fill(0.5);
  } else {
    low = percentile(finite, finiteCount, lowPercentile);
    high = percentile(finite, finiteCount, highPercentile);
    const range = high - low;
    const runtimeNearIsHigh = (options.nearFarConvention ?? 'nearIsHigh') === 'nearIsHigh';
    for (let i = 0; i < pixels; i++) {
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
      normalization: metadataForNormalization(
        options,
        finiteCount === 0 ? null : sourceMin,
        finiteCount === 0 ? null : sourceMax,
        finiteCount,
        lowPercentile,
        highPercentile,
        finiteCount > 0 ? low : undefined,
        finiteCount > 0 ? high : undefined,
      ),
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
      ...(options.metadata?.registration ? { registration: options.metadata.registration } : {}),
      ...(options.metadata?.provenance ? { provenance: options.metadata.provenance } : {}),
    },
  };
}

/**
 * Normalize a calibrated depth/disparity input without discarding its units.
 * The normalized `values` field is used for range UI; `measurements` remains
 * the original finite float32 field for a future metric consumer/export.
 */
export function normalizeMetricDepth(
  raw: Float32Array | readonly number[],
  width: number,
  height: number,
  options: NormalizeDepthOptions & { metricRange: { min: number; max: number } },
): DepthMap {
  const pixels = validateDimensions(width, height);
  if (raw.length !== pixels) {
    throw new Error(`Metric depth length ${raw.length} does not match ${width}x${height}`);
  }
  validateValidityBuffer(options.valid, pixels);
  const measurementInput = options.measurements ?? raw;
  if (measurementInput.length !== pixels) {
    throw new Error('Depth measurement length must match the metric depth');
  }
  const rangeMin = options.metricRange.min;
  const rangeMax = options.metricRange.max;
  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax) || rangeMin > rangeMax) {
    throw new Error('Metric depth range must contain finite ordered endpoints');
  }
  const valid = new Uint8Array(pixels);
  const measurements = new Float32Array(pixels);
  const values = new Float32Array(pixels);
  let sourceMin = Infinity;
  let sourceMax = -Infinity;
  let validCount = 0;
  for (let i = 0; i < pixels; i++) {
    const measurement = measurementInput[i]!;
    const isValid = (options.valid?.[i] ?? 1) !== 0 && Number.isFinite(measurement);
    if (!isValid) {
      measurements[i] = 0;
      values[i] = 0.5;
      continue;
    }
    valid[i] = 1;
    measurements[i] = measurement;
    validCount++;
    sourceMin = Math.min(sourceMin, measurement);
    sourceMax = Math.max(sourceMax, measurement);
    const normalized =
      rangeMax > rangeMin ? clamp01((measurement - rangeMin) / (rangeMax - rangeMin)) : 0.5;
    values[i] =
      (options.nearFarConvention ?? 'nearIsLow') === 'nearIsHigh' ? 1 - normalized : normalized;
  }
  const unit = options.metadata?.unit ?? 'metres';
  if (unit !== 'metres' && unit !== 'inverse-metres') {
    throw new Error('Metric depth must declare metres or inverse-metres');
  }
  return {
    width,
    height,
    values,
    valid,
    measurements,
    metadata: {
      depthType: 'metric',
      unit,
      nearFarConvention: 'nearIsLow',
      inferenceVersion: options.metadata?.inferenceVersion ?? 1,
      preprocessingVersion: options.metadata?.preprocessingVersion ?? 1,
      normalization: {
        method: 'explicit-range',
        sourceMin: validCount === 0 ? null : sourceMin,
        sourceMax: validCount === 0 ? null : sourceMax,
        rangeMin,
        rangeMax,
        validSampleCount: validCount,
        inputNearFarConvention: options.nearFarConvention ?? 'nearIsLow',
        ...(validCount === 0 ? { noValidSamples: true } : {}),
      },
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
      ...(options.metadata?.registration ? { registration: options.metadata.registration } : {}),
      ...(options.metadata?.provenance ? { provenance: options.metadata.provenance } : {}),
    },
  };
}

/**
 * Robust local sample in source-map coordinates. Invalid samples are skipped
 * and the median keeps a single bad/outlier prediction from moving focus.
 */
export function sampleDepth(map: DepthMap, x: number, y: number, radius = 1): number | null {
  validateMapBuffers(map);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const samples: number[] = [];
  const r = Math.min(MAX_SAMPLE_RADIUS, Math.max(0, Math.floor(radius)));
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const sx = cx + ox;
      const sy = cy + oy;
      if (sx < 0 || sy < 0 || sx >= map.width || sy >= map.height) continue;
      const index = sy * map.width + sx;
      if (!map.valid[index]) continue;
      const value = map.values[index]!;
      if (Number.isFinite(value)) samples.push(value);
    }
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 === 1
    ? samples[middle]!
    : (samples[middle - 1]! + samples[middle]!) / 2;
}

/** Resize a depth field with bilinear interpolation while preserving validity. */
export function resizeDepthMap(map: DepthMap, width: number, height: number): DepthMap {
  validateMapBuffers(map);
  const pixels = validateDimensions(width, height);
  if (map.width === width && map.height === height) return map;
  const values = new Float32Array(pixels);
  const valid = new Uint8Array(pixels);
  const measurements = map.measurements ? new Float32Array(pixels) : undefined;
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
      const weightedSamples = [
        [i00, (1 - tx) * (1 - ty)],
        [i10, tx * (1 - ty)],
        [i01, (1 - tx) * ty],
        [i11, tx * ty],
      ] as const;
      let weightedValue = 0;
      let weightedMeasurement = 0;
      let weight = 0;
      for (const [index, sampleWeight] of weightedSamples) {
        if (!map.valid[index] || sampleWeight <= 0) continue;
        weightedValue += map.values[index]! * sampleWeight;
        if (measurements && map.measurements) {
          weightedMeasurement += map.measurements[index]! * sampleWeight;
        }
        weight += sampleWeight;
      }
      if (weight <= 0) {
        values[out] = 0.5;
        if (measurements) measurements[out] = 0;
        valid[out] = 0;
        continue;
      }
      values[out] = weightedValue / weight;
      if (measurements) measurements[out] = weightedMeasurement / weight;
      valid[out] = 1;
    }
  }
  return {
    ...map,
    width,
    height,
    values,
    valid,
    ...(measurements ? { measurements } : {}),
    metadata: remapRegistration(
      map.metadata,
      width,
      height,
      width / map.width,
      height / map.height,
    ),
  };
}

export interface DepthLetterboxTransform {
  /** Padding offset in the model-output coordinate space. */
  offsetX: number;
  offsetY: number;
  /** Content rectangle in the model-output coordinate space. */
  contentWidth?: number;
  contentHeight?: number;
}

/**
 * Project source alpha into the model-output grid without treating transparent
 * RGB as valid depth evidence. The transform is the same letterbox geometry
 * used to build the model input; omitted geometry means a direct contain-free
 * resize between the two grids. This buffer is validity, not alpha coverage.
 */
export function sourceAlphaToDepthValidity(
  alpha: ArrayLike<number>,
  sourceWidth: number,
  sourceHeight: number,
  mapWidth: number,
  mapHeight: number,
  transform?: DepthLetterboxTransform,
): Uint8Array {
  const sourcePixels = validateDimensions(sourceWidth, sourceHeight);
  const mapPixels = validateDimensions(mapWidth, mapHeight);
  if (alpha.length !== sourcePixels) {
    throw new Error('Source alpha length must match the source image dimensions');
  }
  const offsetX = transform?.offsetX ?? 0;
  const offsetY = transform?.offsetY ?? 0;
  const contentWidth = transform?.contentWidth ?? mapWidth;
  const contentHeight = transform?.contentHeight ?? mapHeight;
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight) ||
    offsetX < 0 ||
    offsetY < 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    throw new Error('Depth alpha registration is invalid');
  }

  const valid = new Uint8Array(mapPixels);
  for (let y = 0; y < mapHeight; y++) {
    const v = (y + 0.5 - offsetY) / contentHeight;
    if (v < 0 || v > 1) continue;
    const sourceY = v * sourceHeight - 0.5;
    const nearestY = Math.max(0, Math.min(sourceHeight - 1, Math.round(sourceY)));
    for (let x = 0; x < mapWidth; x++) {
      const u = (x + 0.5 - offsetX) / contentWidth;
      if (u < 0 || u > 1) continue;
      const sourceX = u * sourceWidth - 0.5;
      const nearestX = Math.max(0, Math.min(sourceWidth - 1, Math.round(sourceX)));
      valid[y * mapWidth + x] = alpha[nearestY * sourceWidth + nearestX]! > 0 ? 1 : 0;
    }
  }
  return valid;
}

function sampleDepthBilinear(
  map: DepthMap,
  x: number,
  y: number,
): { value: number; measurement?: number } | null {
  const sx = Math.min(map.width - 1, Math.max(0, x));
  const sy = Math.min(map.height - 1, Math.max(0, y));
  const x0 = Math.floor(sx);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y0 = Math.floor(sy);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const weightedSamples = [
    [y0 * map.width + x0, (1 - tx) * (1 - ty)],
    [y0 * map.width + x1, tx * (1 - ty)],
    [y1 * map.width + x0, (1 - tx) * ty],
    [y1 * map.width + x1, tx * ty],
  ] as const;
  let value = 0;
  let measurement = 0;
  let weight = 0;
  for (const [index, sampleWeight] of weightedSamples) {
    if (!map.valid[index] || sampleWeight <= 0) continue;
    value += map.values[index]! * sampleWeight;
    if (map.measurements) measurement += map.measurements[index]! * sampleWeight;
    weight += sampleWeight;
  }
  if (weight <= 0) return null;
  return {
    value: value / weight,
    ...(map.measurements ? { measurement: measurement / weight } : {}),
  };
}

function sampleDepthBilinearInside(
  map: DepthMap,
  x: number,
  y: number,
): { value: number; measurement?: number } | null {
  // Pixel centres occupy [-0.5, width - 0.5]. Do not clamp a source pixel
  // outside a registration to the edge of the map: that turns a no-data bar
  // into a false strip of selected foreground/background coverage.
  if (x < -0.5 || y < -0.5 || x > map.width - 0.5 || y > map.height - 0.5) return null;
  return sampleDepthBilinear(
    map,
    Math.max(0, Math.min(map.width - 1, x)),
    Math.max(0, Math.min(map.height - 1, y)),
  );
}

/**
 * Register a map to source-image pixels using its persisted source-to-map
 * transform. This is the only source-space resampling entry point for depth
 * masks; the accepted resource itself is never rewritten.
 */
export function alignDepthMapToSource(
  map: DepthMap,
  sourceWidth: number,
  sourceHeight: number,
  registration = map.metadata.registration,
): DepthMap {
  validateMapBuffers(map);
  validateDimensions(sourceWidth, sourceHeight);
  if (!registration) {
    if (map.width !== sourceWidth || map.height !== sourceHeight) {
      throw new Error('Depth map dimensions require an explicit source registration');
    }
    return map;
  }
  validateRegistrationMetadata(registration, map.width, map.height);
  if (registration.sourceWidth !== sourceWidth || registration.sourceHeight !== sourceHeight) {
    throw new Error('Depth registration source dimensions do not match the image');
  }
  const sourceToMap: readonly [number, number, number, number, number, number] =
    registration.sourceToMap ?? [1, 0, 0, 1, 0, 0];
  const values = new Float32Array(sourceWidth * sourceHeight);
  const valid = new Uint8Array(sourceWidth * sourceHeight);
  const measurements = map.measurements ? new Float32Array(values.length) : undefined;
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const sourceX = x + 0.5;
      const sourceY = y + 0.5;
      const mapX = sourceToMap[0] * sourceX + sourceToMap[2] * sourceY + sourceToMap[4] - 0.5;
      const mapY = sourceToMap[1] * sourceX + sourceToMap[3] * sourceY + sourceToMap[5] - 0.5;
      const sample = sampleDepthBilinearInside(map, mapX, mapY);
      const output = y * sourceWidth + x;
      if (!sample) {
        values[output] = 0.5;
        if (measurements) measurements[output] = 0;
        continue;
      }
      values[output] = sample.value;
      if (measurements) measurements[output] = sample.measurement ?? 0;
      valid[output] = 1;
    }
  }
  return {
    ...map,
    width: sourceWidth,
    height: sourceHeight,
    values,
    valid,
    ...(measurements ? { measurements } : {}),
    metadata: {
      ...copyMetadata(map.metadata),
      registration: {
        ...registration,
        mapWidth: sourceWidth,
        mapHeight: sourceHeight,
        sourceToMap: [1, 0, 0, 1, 0, 0],
      },
    },
  };
}

/** Remove model-space letterbox padding before mapping depth to source pixels. */
export function unletterboxDepthMap(
  map: DepthMap,
  width: number,
  height: number,
  transform: DepthLetterboxTransform,
): DepthMap {
  validateMapBuffers(map);
  validateDimensions(width, height);
  if (
    !Number.isFinite(transform.offsetX) ||
    !Number.isFinite(transform.offsetY) ||
    transform.offsetX < 0 ||
    transform.offsetY < 0
  ) {
    return resizeDepthMap(map, width, height);
  }
  const scale = Math.min(map.width / width, map.height / height);
  if (!Number.isFinite(scale) || scale <= 0) return resizeDepthMap(map, width, height);
  const values = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const measurements = map.measurements ? new Float32Array(width * height) : undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sample = sampleDepthBilinearInside(
        map,
        transform.offsetX + (x + 0.5) * scale - 0.5,
        transform.offsetY + (y + 0.5) * scale - 0.5,
      );
      const index = y * width + x;
      if (sample === null) {
        values[index] = 0.5;
        if (measurements) measurements[index] = 0;
        continue;
      }
      values[index] = sample.value;
      if (measurements) measurements[index] = sample.measurement ?? 0;
      valid[index] = 1;
    }
  }
  return {
    ...map,
    width,
    height,
    values,
    valid,
    ...(measurements ? { measurements } : {}),
    metadata: remapRegistration(
      map.metadata,
      width,
      height,
      1 / scale,
      1 / scale,
      transform.offsetX,
      transform.offsetY,
    ),
  };
}

export interface NormalizedDepthRange {
  near: number;
  far: number;
  crossed: boolean;
}

/** Clamp endpoints once and make a crossed-handle decision explicit. */
export function normalizeDepthRange(options: DepthRangeOptions): NormalizedDepthRange {
  if (!Number.isFinite(options.near) || !Number.isFinite(options.far)) {
    throw new Error('Depth range endpoints must be finite');
  }
  const near = clamp01(options.near);
  const far = clamp01(options.far);
  const crossed = near > far;
  if (!crossed || options.order === 'empty') return { near, far, crossed };
  return { near: Math.min(near, far), far: Math.max(near, far), crossed: true };
}

function transitionWidth(value: number | undefined, label: string): number {
  const width = value ?? 0;
  if (!Number.isFinite(width) || width < 0) {
    throw new Error(`${label} must be a finite non-negative value`);
  }
  return width;
}

function depthRangeCoverage(
  value: number,
  range: NormalizedDepthRange,
  nearTransition: number,
  farTransition: number,
): number {
  if (range.crossed) return 0;
  if (value < range.near) {
    return nearTransition > 0
      ? clamp01((value - (range.near - nearTransition)) / nearTransition)
      : 0;
  }
  if (value > range.far) {
    return farTransition > 0 ? clamp01((range.far + farTransition - value) / farTransition) : 0;
  }
  return 1;
}

/**
 * Evaluate a depth range as float coverage. Transitions are in normalized
 * depth units and extend outside the selected band; spatial feathering is a
 * separate mask operation. Invalid pixels always remain zero.
 */
export function depthRangeToCoverage(map: DepthMap, options: DepthRangeOptions): Float32Array {
  const pixels = validateMapBuffers(map);
  const range = normalizeDepthRange(options);
  const nearTransition = transitionWidth(options.nearTransition, 'nearTransition');
  const farTransition = transitionWidth(options.farTransition, 'farTransition');
  const coverage = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    if (!map.valid[i]) continue;
    const selected = depthRangeCoverage(map.values[i]!, range, nearTransition, farTransition);
    coverage[i] = options.invert ? 1 - selected : selected;
  }
  return coverage;
}

/** Convert float coverage to the existing immutable PNG-mask byte plane. */
export function coverageToMask(coverage: Float32Array | readonly number[]): Uint8Array {
  const mask = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i++) {
    const value = coverage[i]!;
    if (!Number.isFinite(value)) throw new Error('Mask coverage must be finite');
    mask[i] = Math.round(clamp01(value) * 255);
  }
  return mask;
}

/**
 * Combine soft coverage without collapsing it to binary Boolean operations.
 * Union is the probabilistic sum, intersection is product, and subtraction
 * removes the second coverage from the first.
 */
export function combineMaskCoverage(
  existing: Float32Array | Uint8Array | undefined,
  incoming: Float32Array | Uint8Array,
  mode: MaskCombineMode,
): Float32Array {
  if (existing && existing.length !== incoming.length) {
    throw new Error('Mask coverage planes must have the same length');
  }
  const output = new Float32Array(incoming.length);
  for (let i = 0; i < incoming.length; i++) {
    const next = coverageValue(incoming, i);
    if (mode === 'replace' || !existing) {
      output[i] = next;
      continue;
    }
    const prior = coverageValue(existing, i);
    output[i] =
      mode === 'intersect'
        ? prior * next
        : mode === 'union'
          ? prior + next - prior * next
          : prior * (1 - next);
  }
  return output;
}

function coverageValue(coverage: Float32Array | Uint8Array, index: number): number {
  const raw = coverage[index]!;
  if (!Number.isFinite(raw)) throw new Error('Mask coverage must be finite');
  return clamp01(coverage instanceof Uint8Array ? raw / 255 : raw);
}

/** Convert a continuous range into the established byte-mask representation. */
export function depthRangeToMask(
  map: DepthMap,
  near: number,
  far: number,
  feather = 0,
  invert = false,
): Uint8Array {
  return coverageToMask(
    depthRangeToCoverage(map, {
      near,
      far,
      nearTransition: feather,
      farTransition: feather,
      invert,
      order: 'empty',
    }),
  );
}

/** Build a viewport-independent histogram from valid scalar samples. */
export function depthHistogram(map: DepthMap, binCount = 64): DepthHistogram {
  const pixels = validateMapBuffers(map);
  if (!Number.isInteger(binCount) || binCount < 2 || binCount > 256) {
    throw new Error('Depth histogram binCount must be an integer between 2 and 256');
  }
  const bins = new Uint32Array(binCount);
  let validCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixels; i++) {
    if (!map.valid[i]) continue;
    const value = map.values[i]!;
    if (!Number.isFinite(value)) continue;
    validCount++;
    min = Math.min(min, value);
    max = Math.max(max, value);
    const bin = Math.min(binCount - 1, Math.floor(clamp01(value) * binCount));
    bins[bin]!++;
  }
  return {
    bins,
    validCount,
    min: validCount > 0 ? min : null,
    max: validCount > 0 ? max : null,
  };
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
  if (typeof value !== 'string' || value.length > (MAX_BASE64_BYTES * 4) / 3 + 4) {
    throw new Error('Depth resource contains an invalid or oversized base64 payload');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Depth resource contains malformed base64');
  }
  if (typeof atob === 'function') {
    const binary = atob(value);
    if (binary.length > MAX_BASE64_BYTES) throw new Error('Depth resource payload is oversized');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length > MAX_BASE64_BYTES) throw new Error('Depth resource payload is oversized');
  return bytes;
}

export function serializeDepthMap(map: DepthMap, id: string): DepthMapResource {
  const pixels = validateMapBuffers(map);
  if (!id || id.length > 256) throw new Error('Depth resource id must be 1..256 characters');
  const encoded = new Uint8Array(pixels * 2);
  const view = new DataView(encoded.buffer);
  for (let i = 0; i < pixels; i++) {
    view.setUint16(i * 2, Math.round(clamp01(map.values[i]!) * 65535), true);
  }
  const valid = map.valid.some((value) => value === 0) ? bytesToBase64(map.valid) : undefined;
  let measurementDataBase64: string | undefined;
  let measurementBytes = 0;
  if (map.measurements) {
    const measurementBuffer = new Uint8Array(map.measurements.length * 4);
    const measurementView = new DataView(measurementBuffer.buffer);
    for (let i = 0; i < map.measurements.length; i++) {
      const value = map.measurements[i]!;
      if (!Number.isFinite(value)) throw new Error('Metric depth measurements must be finite');
      measurementView.setFloat32(i * 4, value, true);
    }
    measurementDataBase64 = bytesToBase64(measurementBuffer);
    measurementBytes = measurementBuffer.byteLength;
  }
  return {
    ...map.metadata,
    id,
    schemaVersion: 1,
    width: map.width,
    height: map.height,
    dataBase64: bytesToBase64(encoded),
    ...(valid ? { validBase64: valid } : {}),
    ...(measurementDataBase64 ? { measurementDataBase64 } : {}),
    byteLength: encoded.byteLength + (valid ? map.valid.byteLength : 0) + measurementBytes,
  };
}

export function deserializeDepthMap(resource: DepthMapResource): DepthMap {
  if (resource.schemaVersion !== 1) throw new Error('Unsupported DepthMap resource version');
  const pixels = validateDimensions(resource.width, resource.height);
  if (typeof resource.id !== 'string' || resource.id.length === 0 || resource.id.length > 256) {
    throw new Error('Depth resource id must not be empty');
  }
  if (resource.nearFarConvention !== 'nearIsLow') {
    throw new Error('Depth resource must declare canonical nearIsLow ordering');
  }
  validateDepthMetadata(resource, resource.width, resource.height);
  if (resource.depthType !== 'metric' && resource.measurementDataBase64 !== undefined) {
    throw new Error('Only metric depth resources may carry calibrated measurements');
  }
  const bytes = base64ToBytes(resource.dataBase64);
  if (bytes.byteLength !== pixels * 2) {
    throw new Error('Depth resource has an invalid scalar payload length');
  }
  const values = new Float32Array(pixels);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(i * 2, true) / 65535;
  const valid = resource.validBase64
    ? base64ToBytes(resource.validBase64)
    : new Uint8Array(values.length).fill(1);
  if (valid.length !== values.length)
    throw new Error('Depth resource has an invalid validity payload');
  for (const value of valid) {
    if (value !== 0 && value !== 1) throw new Error('Depth validity must contain only 0 or 1');
  }
  const measurements = resource.measurementDataBase64
    ? (() => {
        const measurementBytes = base64ToBytes(resource.measurementDataBase64!);
        if (measurementBytes.byteLength !== pixels * 4) {
          throw new Error('Depth resource has an invalid calibrated payload length');
        }
        const decoded = new Float32Array(pixels);
        const measurementView = new DataView(
          measurementBytes.buffer,
          measurementBytes.byteOffset,
          measurementBytes.byteLength,
        );
        for (let i = 0; i < pixels; i++) {
          const value = measurementView.getFloat32(i * 4, true);
          if (!Number.isFinite(value)) throw new Error('Depth measurements must be finite');
          decoded[i] = value;
        }
        return decoded;
      })()
    : undefined;
  if (resource.depthType === 'metric' && !measurements) {
    throw new Error('Metric depth resource is missing calibrated measurements');
  }
  const expectedBytes =
    pixels * 2 + (resource.validBase64 ? pixels : 0) + (measurements ? pixels * 4 : 0);
  if (!Number.isSafeInteger(resource.byteLength) || resource.byteLength !== expectedBytes) {
    throw new Error('Depth resource byteLength does not match its payloads');
  }
  const map: DepthMap = {
    width: resource.width,
    height: resource.height,
    values,
    valid,
    ...(measurements ? { measurements } : {}),
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
      ...(resource.normalization ? { normalization: resource.normalization } : {}),
      ...(resource.registration ? { registration: resource.registration } : {}),
      ...(resource.provenance ? { provenance: resource.provenance } : {}),
    },
  };
  validateMapBuffers(map);
  return map;
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
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = 3,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  get(key: string): DepthMap | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: DepthMap): void {
    const valueBytes =
      value.values.byteLength + value.valid.byteLength + (value.measurements?.byteLength ?? 0);
    const previous = this.entries.get(key);
    if (previous) this.totalBytes -= depthMapByteLength(previous);
    this.entries.delete(key);
    if (valueBytes > Math.max(1, this.maxBytes)) return;
    this.entries.set(key, value);
    this.totalBytes += valueBytes;
    while (
      this.entries.size > Math.max(1, this.maxEntries) ||
      this.totalBytes > Math.max(1, this.maxBytes)
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (evicted) this.totalBytes -= depthMapByteLength(evicted);
    }
  }

  delete(key: string): void {
    const value = this.entries.get(key);
    this.entries.delete(key);
    if (value) this.totalBytes -= depthMapByteLength(value);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }
}

function depthMapByteLength(map: DepthMap): number {
  return map.values.byteLength + map.valid.byteLength + (map.measurements?.byteLength ?? 0);
}
