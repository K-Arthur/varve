/**
 * CPU reference kernels for Varve Image Treatments.
 *
 * All kernels receive straight-alpha RGBA and preserve alpha plus the hidden
 * RGB of fully transparent pixels. They are intentionally built from local
 * luminance structure rather than aliases for global contrast or blur:
 *
 * - Micro Detail uses a small-scale luminance residual with a noise floor.
 * - Definition isolates a middle-frequency band between two local averages.
 * - Atmosphere adjusts a broader local residual without changing global tone.
 * - Dehaze estimates local atmospheric veil from an alpha-aware dark channel
 *   and reconstructs a bounded transmission; it is not an Atmosphere alias.
 * - Edge Falloff is evaluated in the captured object/scope image coordinates.
 * - Grain is seeded and document-coordinate anchored when coordinate data is
 *   available, so it cannot crawl while the canvas is panned or zoomed.
 * - Soft Bloom adapts the established linear-light Bloom kernel with a small,
 *   photographic parameter set; it is not a second bloom implementation.
 */

import { applyBloom } from '../liveEffects/bloom';
import { type CoordSpace, docCoordOf } from '../liveEffects/dither';
import { fbm2, hash2 } from '../liveEffects/prng';
import type { EffectQuality } from '../liveEffects/quality';
import type {
  AtmosphereParams,
  DefinitionParams,
  DehazeParams,
  EdgeFalloffParams,
  GrainParams,
  MicroDetailParams,
  SoftBloomParams,
} from './schema';

interface LuminanceField {
  values: Float32Array;
  alpha: Float32Array;
}

/**
 * Maps a temporary filter raster back into stable treatment coordinates.
 *
 * Object filters supply object-local coordinates (so a rotated image keeps
 * its vignette and grain); scoped adjustment layers supply document
 * coordinates.  `bounds` lives in that same coordinate system.  The mapping
 * deliberately uses an affine transform instead of the viewport dimensions:
 * a temporary full-canvas surface is never the semantic image boundary.
 */
export interface ImageTreatmentSpace {
  /** Affine [a, b, c, d, e, f] mapping local raster pixels to treatment space. */
  pixelToTreatment?: readonly [number, number, number, number, number, number];
  /** Semantic treatment bounds in the mapped coordinate system. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Raster pixels per treatment-space unit for spatial-radius parameters. */
  pixelsPerUnit?: number;
}

export interface ImageTreatmentRenderOptions {
  /** Legacy document-coordinate mapping used by existing live effects. */
  coordSpace?: CoordSpace;
  /** Stable object/source or document treatment-space mapping. */
  treatmentSpace?: ImageTreatmentSpace;
  /** Caller quality tier; export always supplies `export`. */
  quality?: EffectQuality;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Serialized data is normalized at the scene boundary, but kernels are public
 * engine APIs too. Keep direct callers with malformed values from introducing
 * NaN pixels or an unbounded blur allocation.
 */
function finiteClamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function makeLuminanceField(imageData: ImageData): LuminanceField {
  const { data } = imageData;
  const values = new Float32Array(imageData.width * imageData.height);
  const alpha = new Float32Array(values.length);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    const a = data[offset + 3]! / 255;
    alpha[pixel] = a;
    if (a === 0) continue;
    values[pixel] = luminance(data[offset]!, data[offset + 1]!, data[offset + 2]!) / 255;
  }
  return { values, alpha };
}

/**
 * Dark-channel field used only by Dehaze. The minimum straight-RGB channel is
 * a conservative local proxy for veiling light: a hazy region loses truly
 * dark samples, whereas a local-contrast adjustment works from luminance
 * residuals alone.
 */
function makeDarkChannelField(imageData: ImageData): LuminanceField {
  const { data } = imageData;
  const values = new Float32Array(imageData.width * imageData.height);
  const alpha = new Float32Array(values.length);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    const a = data[offset + 3]! / 255;
    alpha[pixel] = a;
    if (a === 0) continue;
    values[pixel] = Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!) / 255;
  }
  return { values, alpha };
}

/**
 * Alpha-weighted separable box blur. The result is a local average of visible
 * source pixels; transparent neighbours never inject a black/white matte.
 */
function blurLuminance(field: LuminanceField, width: number, height: number, radius: number) {
  // Callers clamp serialized radii and control their raster density.  Keep a
  // generous final guard for malformed API input without silently changing a
  // normal treatment at high-DPI preview scale.
  const r = Math.max(0, Math.min(1024, Math.round(radius)));
  if (r === 0) return new Float32Array(field.values);

  const pixels = width * height;
  const horizontalValue = new Float32Array(pixels);
  const horizontalWeight = new Float32Array(pixels);
  const verticalValue = new Float32Array(pixels);
  const verticalWeight = new Float32Array(pixels);
  const diameter = r * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    let valueSum = 0;
    let weightSum = 0;
    for (let dx = -r; dx <= r; dx += 1) {
      const x = Math.max(0, Math.min(width - 1, dx));
      const index = y * width + x;
      const weight = field.alpha[index]!;
      valueSum += field.values[index]! * weight;
      weightSum += weight;
    }
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      horizontalValue[index] = valueSum;
      horizontalWeight[index] = weightSum;
      const left = y * width + Math.max(0, x - r);
      const right = y * width + Math.min(width - 1, x + r + 1);
      valueSum +=
        field.values[right]! * field.alpha[right]! - field.values[left]! * field.alpha[left]!;
      weightSum += field.alpha[right]! - field.alpha[left]!;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let valueSum = 0;
    let weightSum = 0;
    for (let dy = -r; dy <= r; dy += 1) {
      const y = Math.max(0, Math.min(height - 1, dy));
      const index = y * width + x;
      valueSum += horizontalValue[index]!;
      weightSum += horizontalWeight[index]!;
    }
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      verticalValue[index] = valueSum;
      verticalWeight[index] = weightSum;
      const top = Math.max(0, y - r) * width + x;
      const bottom = Math.min(height - 1, y + r + 1) * width + x;
      valueSum += horizontalValue[bottom]! - horizontalValue[top]!;
      weightSum += horizontalWeight[bottom]! - horizontalWeight[top]!;
    }
  }

  const result = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const actualDiameterWeight = verticalWeight[index]! / diameter;
    result[index] = actualDiameterWeight > 0 ? verticalValue[index]! / verticalWeight[index]! : 0;
  }
  return result;
}

function setLuminancePreservingChroma(
  data: Uint8ClampedArray,
  offset: number,
  sourceLuminance: number,
  targetLuminance: number,
): void {
  const factor = clamp01(targetLuminance) / Math.max(sourceLuminance, 1 / 4096);
  // Hard safety bounds keep malformed parameters from amplifying tiny near-black
  // values into a discontinuity. The treatment ranges never reach these limits.
  const boundedFactor = Math.max(0, Math.min(8, factor));
  data[offset] = clampByte(data[offset]! * boundedFactor);
  data[offset + 1] = clampByte(data[offset + 1]! * boundedFactor);
  data[offset + 2] = clampByte(data[offset + 2]! * boundedFactor);
}

function localContrastMask(detail: number, threshold: number): number {
  const floor = 0.002 + clamp01(threshold) * 0.08;
  return smoothstep(floor, floor + 0.1, Math.abs(detail));
}

function pixelsPerTreatmentUnit(options: ImageTreatmentRenderOptions | undefined): number {
  const value = options?.treatmentSpace?.pixelsPerUnit ?? options?.coordSpace?.scale ?? 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function treatmentPoint(
  x: number,
  y: number,
  options: ImageTreatmentRenderOptions | undefined,
): { x: number; y: number } {
  const matrix = options?.treatmentSpace?.pixelToTreatment;
  if (matrix) {
    return {
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    };
  }
  if (options?.coordSpace) return docCoordOf(x, y, options.coordSpace);
  return { x, y };
}

function treatmentBounds(
  imageData: ImageData,
  options: ImageTreatmentRenderOptions | undefined,
): { x: number; y: number; width: number; height: number } {
  const bounds = options?.treatmentSpace?.bounds;
  if (
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  ) {
    return bounds;
  }
  return { x: 0, y: 0, width: Math.max(1, imageData.width), height: Math.max(1, imageData.height) };
}

/** Fine-scale texture residual with an explicit noise floor. */
export function applyMicroDetail(
  imageData: ImageData,
  params: MicroDetailParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const amount = Math.max(-100, Math.min(100, params.amount ?? 0));
  if (amount === 0 || imageData.width === 0 || imageData.height === 0) return imageData;

  const field = makeLuminanceField(imageData);
  const local = blurLuminance(
    field,
    imageData.width,
    imageData.height,
    pixelsPerTreatmentUnit(options),
  );
  const gain = (amount / 100) * (amount < 0 ? 0.85 : 1.65);
  const threshold = params.threshold ?? 0.12;
  const { data } = imageData;

  for (let index = 0; index < field.values.length; index += 1) {
    if (field.alpha[index] === 0) continue;
    const source = field.values[index]!;
    const detail = source - local[index]!;
    const target = source + detail * gain * localContrastMask(detail, threshold);
    setLuminancePreservingChroma(data, index * 4, source, target);
  }
  return imageData;
}

/** Middle-frequency local contrast, deliberately distinct from Micro Detail. */
export function applyDefinition(
  imageData: ImageData,
  params: DefinitionParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const amount = Math.max(-100, Math.min(100, params.amount ?? 0));
  if (amount === 0 || imageData.width === 0 || imageData.height === 0) return imageData;

  const field = makeLuminanceField(imageData);
  const pixelsPerUnit = pixelsPerTreatmentUnit(options);
  const small = blurLuminance(field, imageData.width, imageData.height, 2 * pixelsPerUnit);
  const broad = blurLuminance(
    field,
    imageData.width,
    imageData.height,
    Math.max(3, Math.min(64, params.radius ?? 12)) * pixelsPerUnit,
  );
  const gain = (amount / 100) * 1.45;
  const protectHighlights = clamp01(params.protectHighlights ?? 0.35);
  const { data } = imageData;

  for (let index = 0; index < field.values.length; index += 1) {
    if (field.alpha[index] === 0) continue;
    const source = field.values[index]!;
    const midBand = small[index]! - broad[index]!;
    const highlightMask = 1 - protectHighlights * smoothstep(0.72, 1, source);
    const edgeMask = 1 - smoothstep(0.32, 0.75, Math.abs(midBand)) * 0.35;
    const target = source + midBand * gain * highlightMask * edgeMask;
    setLuminancePreservingChroma(data, index * 4, source, target);
  }
  return imageData;
}

/** Broad local-depth adjustment with no global contrast or saturation branch. */
export function applyAtmosphere(
  imageData: ImageData,
  params: AtmosphereParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const amount = Math.max(-100, Math.min(100, params.amount ?? 0));
  if (amount === 0 || imageData.width === 0 || imageData.height === 0) return imageData;

  const field = makeLuminanceField(imageData);
  const broad = blurLuminance(
    field,
    imageData.width,
    imageData.height,
    Math.max(4, Math.min(128, params.radius ?? 28)) * pixelsPerTreatmentUnit(options),
  );
  const gain = (amount / 100) * 1.1;
  const protectHighlights = clamp01(params.protectHighlights ?? 0.6);
  const { data } = imageData;

  for (let index = 0; index < field.values.length; index += 1) {
    if (field.alpha[index] === 0) continue;
    const source = field.values[index]!;
    const localDepth = source - broad[index]!;
    // Keep smooth skies stable: only meaningful broad structure receives the
    // full adjustment, while near-flat gradients taper in gently.
    const structure = smoothstep(0.004, 0.12, Math.abs(localDepth));
    const highlightMask = 1 - protectHighlights * smoothstep(0.68, 1, source);
    const target = source + localDepth * gain * structure * highlightMask;
    setLuminancePreservingChroma(data, index * 4, source, target);
  }
  return imageData;
}

/**
 * Local atmospheric-haze recovery using a dark-channel veil estimate.
 *
 * This is intentionally distinct from Atmosphere: it estimates the amount of
 * neutral veiling light in each broad neighbourhood, then applies a bounded
 * inverse atmospheric-light transform (`J = (I - h) / (1 - h)`) to luminance.
 * The dark-channel confidence and a transmission floor make the inverse safe
 * for low-detail or malformed direct API inputs. It preserves chroma rather
 * than inventing saturation, alpha exactly, and hidden RGB of transparent
 * pixels exactly.
 */
export function applyDehaze(
  imageData: ImageData,
  params: DehazeParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const amount = finiteClamp(params.amount, 0, 100, 0) / 100;
  if (amount === 0 || imageData.width === 0 || imageData.height === 0) return imageData;

  const radius = finiteClamp(params.radius, 4, 256, 48) * pixelsPerTreatmentUnit(options);
  const protectHighlights = finiteClamp(params.protectHighlights, 0, 1, 0.45);
  const darkChannel = makeDarkChannelField(imageData);
  const localVeil = blurLuminance(darkChannel, imageData.width, imageData.height, radius);
  const luminanceField = makeLuminanceField(imageData);
  const { data } = imageData;

  for (let index = 0; index < luminanceField.values.length; index += 1) {
    if (luminanceField.alpha[index] === 0) continue;
    const source = luminanceField.values[index]!;
    const darkVeil = clamp01(localVeil[index]!);
    // A bright, locally dark-channel-free pixel is not evidence of haze. This
    // confidence curve also prevents an otherwise flat middle-grey patch from
    // being treated as fully veiled at high Amount.
    const veilConfidence = smoothstep(0.04, 0.82, darkVeil);
    const estimatedVeil = Math.min(0.58, darkVeil * veilConfidence * 0.9);
    const highlightMask = 1 - protectHighlights * smoothstep(0.64, 1, source);
    const haze = estimatedVeil * amount * highlightMask;
    // Never divide by a near-zero estimated transmission. The cap above and
    // this explicit floor are both deliberate numerical safety boundaries.
    const transmission = Math.max(0.22, 1 - haze);
    const restored = clamp01((source - haze) / transmission);
    setLuminancePreservingChroma(data, index * 4, source, restored);
  }
  return imageData;
}

/** Object/scope-coordinate vignette-like finishing treatment. */
export function applyEdgeFalloff(
  imageData: ImageData,
  params: EdgeFalloffParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const strength = Math.max(-100, Math.min(100, params.strength ?? 0));
  const { width, height, data } = imageData;
  if (strength === 0 || width === 0 || height === 0) return imageData;

  const midpoint = clamp01((params.midpoint ?? 50) / 100);
  const feather = clamp01((params.feather ?? 60) / 100);
  const roundness = Math.max(-1, Math.min(1, (params.roundness ?? 0) / 100));
  const centerX = clamp01(params.centerX ?? 0.5);
  const centerY = clamp01(params.centerY ?? 0.5);
  const highlightProtection = clamp01((params.highlightProtection ?? 0) / 100);
  const bounds = treatmentBounds(imageData, options);
  const aspect = bounds.width / Math.max(1, bounds.height);
  const circularX = aspect >= 1 ? aspect : 1;
  const circularY = aspect < 1 ? 1 / aspect : 1;
  const xScale = roundness >= 0 ? 1 + (circularX - 1) * roundness : 1;
  const yScale = roundness >= 0 ? 1 + (circularY - 1) * roundness : 1;
  const ovalX = roundness < 0 ? 1 + (circularY - 1) * -roundness : xScale;
  const ovalY = roundness < 0 ? 1 + (circularX - 1) * -roundness : yScale;
  const start = Math.min(0.97, midpoint * 0.9);
  const exponent = 1 + (1 - feather) * 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] === 0) continue;
      const point = treatmentPoint(x + 0.5, y + 0.5, options);
      const nx = ((point.x - bounds.x) / bounds.width - centerX) * 2 * ovalX;
      const ny = ((point.y - bounds.y) / bounds.height - centerY) * 2 * ovalY;
      const distance = Math.min(1.5, Math.hypot(nx, ny));
      const edge = smoothstep(start, 1, distance);
      const shaped = edge ** exponent;
      const source = luminance(data[offset]!, data[offset + 1]!, data[offset + 2]!) / 255;
      const protect = strength < 0 ? 1 - highlightProtection * smoothstep(0.65, 1, source) : 1;
      const amount = (strength / 100) * 0.72 * shaped * protect;
      const target = amount < 0 ? source * (1 + amount) : source + (1 - source) * amount;
      setLuminancePreservingChroma(data, offset, source, target);
    }
  }
  return imageData;
}

function grainValue(x: number, y: number, scale: number, character: number, seed: number): number {
  const scaledX = x / Math.max(0.25, scale);
  const scaledY = y / Math.max(0.25, scale);
  const fine = hash2(Math.floor(scaledX), Math.floor(scaledY), seed) * 2 - 1;
  const coarse = fbm2(scaledX * 0.38, scaledY * 0.38, seed ^ 0x9e3779b9, 3) * 2 - 1;
  const clustering = clamp01(character / 100);
  const mixed = fine * (1 - clustering * 0.7) + coarse * clustering * 0.7;
  const shaped = Math.sign(mixed) * Math.abs(mixed) ** (1.45 - clustering * 0.8);
  return Math.max(-1, Math.min(1, shaped));
}

/** Deterministic monochrome grain in document/source coordinate space. */
export function applyGrain(
  imageData: ImageData,
  params: GrainParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const strength = clamp01((params.strength ?? 0) / 100);
  if (strength === 0 || imageData.width === 0 || imageData.height === 0) return imageData;

  const scale = Math.max(0.25, Math.min(4, params.scale ?? 1));
  const character = Math.max(0, Math.min(100, params.character ?? 50));
  const seed = Math.round(params.seed ?? 0) >>> 0;
  const { width, height, data } = imageData;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] === 0) continue;
      const sourcePoint = treatmentPoint(x, y, options);
      const grain = grainValue(sourcePoint.x, sourcePoint.y, scale, character, seed);
      const source = luminance(data[offset]!, data[offset + 1]!, data[offset + 2]!) / 255;
      // Grain is strongest in midtones, retaining clean black/white endpoints.
      const midtoneMask = 0.35 + 0.65 * (1 - Math.abs(source * 2 - 1));
      const delta = grain * strength * midtoneMask * 0.12;
      setLuminancePreservingChroma(data, offset, source, source + delta);
    }
  }
  return imageData;
}

/** Compact photographic wrapper around the shared, linear-light Bloom kernel. */
export function applySoftBloom(
  imageData: ImageData,
  params: SoftBloomParams,
  options: ImageTreatmentRenderOptions = {},
): ImageData {
  const strength = clamp01((params.strength ?? 0) / 100);
  if (strength === 0) return imageData;
  // The shared bloom core intentionally supports translucent glow buffers.
  // Image Treatments instead follow the Adjustment contract: preserve alpha
  // exactly, and never alter hidden RGB in fully transparent source pixels.
  const original = new Uint8ClampedArray(imageData.data);
  const scale = pixelsPerTreatmentUnit(options);
  applyBloom(
    imageData,
    {
      threshold: clamp01(params.threshold ?? 0.65),
      softKnee: clamp01(params.softness ?? 0.35),
      intensity: strength * 1.6,
      radius: Math.max(0, Math.min(128, params.radius ?? 24)),
      diffusion: 0.65,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: false,
      streakAngle: 0,
      streakLength: 0,
      streakIntensity: 0,
      streakAspect: 1,
      quality: 'auto',
    },
    {
      quality: options.quality,
      // Bloom consumes only `scale` today. Passing a deliberately local mapping
      // avoids reusing a capture-region phase that has no meaning for bloom.
      coordSpace: { scale, originX: 0, originY: 0, regionX: 0, regionY: 0 },
    },
  );
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const alpha = original[offset + 3]!;
    imageData.data[offset + 3] = alpha;
    if (alpha === 0) {
      imageData.data[offset] = original[offset]!;
      imageData.data[offset + 1] = original[offset + 1]!;
      imageData.data[offset + 2] = original[offset + 2]!;
    }
  }
  return imageData;
}
