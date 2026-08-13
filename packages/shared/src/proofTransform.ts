/**
 * Soft-proof transform (display-only).
 *
 * Soft proofing simulates an output condition on screen WITHOUT mutating
 * document colors. The display pipeline is:
 *
 *   document values
 *   → document working profile
 *   → optional proof profile simulation
 *   → display profile
 *   → canvas output
 *
 * Browser canvases do not expose monitor-profile control, and the browser
 * runtime has no ICC engine by default. The transform therefore reports an
 * honest capability kind:
 *
 * - `'icc'`: a profile lookup table was supplied (desktop/WASM engine).
 * - `'analytical'`: a runtime-declared approximate converter was supplied.
 * - `'unavailable'`: no profile data — the source color passes through and
 *   callers MUST disclose that accurate proofing is unavailable instead of
 *   pretending the preview is proofed.
 *
 * `applyProofToRgba` never mutates its input and is deterministic for a
 * given (config, color) pair. Transforms are cached per config key.
 */

/** Rendering intent for the proof condition (ICC vocabulary). */
export type ProofRenderingIntent = 'perceptual' | 'relative' | 'absolute' | 'saturation';

/** Display-only proof configuration (never persisted into documents). */
export interface ProofTransformConfig {
  /** Proof profile identifier (e.g. 'fogra39'). */
  profileId: string;
  /** Profile display name for UI. */
  profileName?: string;
  renderingIntent: ProofRenderingIntent;
  blackPointCompensation: boolean;
  simulatePaperColor: boolean;
  simulateBlackInk: boolean;
}

/**
 * A profile-aware transform supplied by a runtime engine. Returns the
 * proofed sRGB channels, or null when the color cannot be converted.
 */
export type ProfileProofConverter = (
  rgba: [number, number, number, number],
) => [number, number, number, number] | null;

/** Precision-preserving proof converter used before a display boundary. */
export type ProfileProofConverterNormalized = (
  rgba: [number, number, number, number],
) => [number, number, number, number] | null;

export type ProofTransformResult =
  | { kind: 'icc'; rgba: [number, number, number, number] }
  | { kind: 'analytical'; rgba: [number, number, number, number] }
  | { kind: 'unavailable'; rgba: [number, number, number, number] };

export type NormalizedProofTransformResult = ProofTransformResult;

/** Stable cache key for a proof configuration. */
export function proofConfigKey(config: ProofTransformConfig): string {
  return [
    config.profileId,
    config.renderingIntent,
    config.blackPointCompensation ? 'bpc' : 'nobpc',
    config.simulatePaperColor ? 'paper' : 'nopaper',
    config.simulateBlackInk ? 'ink' : 'noink',
  ].join(':');
}

/** Runtime-registered ICC/analytical proof converters, keyed by profile id. */
const profileConverters = new Map<string, ProfileProofConverter>();
const normalizedProfileConverters = new Map<string, ProfileProofConverterNormalized>();

/**
 * Register a runtime proof converter (desktop bridge or WASM). Cleared by
 * `clearProofConverters` on document closure to release resources.
 */
export function registerProfileProofConverter(
  profileId: string,
  converter: ProfileProofConverter,
): void {
  profileConverters.set(profileId, converter);
}

/** Register a proof converter that consumes/returns normalized float channels. */
export function registerProfileProofConverterNormalized(
  profileId: string,
  converter: ProfileProofConverterNormalized,
): void {
  normalizedProfileConverters.set(profileId, converter);
}

/** Remove every runtime proof converter (document closed). */
export function clearProofConverters(): void {
  profileConverters.clear();
  normalizedProfileConverters.clear();
  transformCache.clear();
  normalizedTransformCache.clear();
}

const transformCache = new Map<string, [number, number, number, number]>();
const normalizedTransformCache = new Map<string, [number, number, number, number]>();

/** Bounded cache for deterministic proof transforms. */
const TRANSFORM_CACHE_MAX = 4096;

function cacheGet(key: string): [number, number, number, number] | undefined {
  return transformCache.get(key);
}

function cacheSet(key: string, rgba: [number, number, number, number]): void {
  if (transformCache.size >= TRANSFORM_CACHE_MAX) {
    transformCache.clear();
  }
  transformCache.set(key, rgba);
}

function normalizedCacheSet(key: string, rgba: [number, number, number, number]): void {
  if (normalizedTransformCache.size >= TRANSFORM_CACHE_MAX) {
    normalizedTransformCache.clear();
  }
  normalizedTransformCache.set(key, rgba);
}

/**
 * Apply the proof transform to an sRGB RGBA color (0-255). Display-only —
 * the input is never mutated and the result must never be written back to
 * the document.
 */
export function applyProofToRgba(
  rgba: [number, number, number, number],
  config: ProofTransformConfig,
): ProofTransformResult {
  const converter = profileConverters.get(config.profileId);
  if (!converter) {
    return { kind: 'unavailable', rgba };
  }
  const cacheKey = `${proofConfigKey(config)}:${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { kind: 'icc', rgba: cached };

  const converted = converter(rgba);
  if (!converted) {
    return { kind: 'unavailable', rgba };
  }
  cacheSet(cacheKey, converted);
  return { kind: 'icc', rgba: converted };
}

/**
 * Apply a normalized proof transform without reducing channels to RGBA8.
 * Returns unavailable when the runtime has no precision-preserving provider;
 * callers may then use the legacy RGBA8 provider as an explicit preview
 * fallback.
 */
export function applyProofToNormalized(
  rgba: [number, number, number, number],
  config: ProofTransformConfig,
): NormalizedProofTransformResult {
  const converter = normalizedProfileConverters.get(config.profileId);
  if (!converter) return { kind: 'unavailable', rgba };
  const cacheKey = `${proofConfigKey(config)}:${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]}`;
  const cached = normalizedTransformCache.get(cacheKey);
  if (cached) return { kind: 'icc', rgba: cached };
  const converted = converter(rgba);
  if (!converted) return { kind: 'unavailable', rgba };
  normalizedCacheSet(cacheKey, converted);
  return { kind: 'icc', rgba: converted };
}

/**
 * Out-of-proof-gamut status for a color under the given proof condition.
 * Returns:
 * - `true` when the proof transform clips meaningfully,
 * - `false` when the color survives the proof transform,
 * - `null` when no profile converter is registered (unknown — callers must
 *   disclose the limitation rather than claiming a result).
 */
export function isColorOutOfProofGamut(
  rgba: [number, number, number, number],
  config: ProofTransformConfig,
): boolean | null {
  const converter = profileConverters.get(config.profileId);
  if (!converter) return null;
  const converted = converter(rgba);
  if (!converted) return null;
  const tolerance = 1.5;
  return (
    Math.abs(converted[0] - rgba[0]) > tolerance ||
    Math.abs(converted[1] - rgba[1]) > tolerance ||
    Math.abs(converted[2] - rgba[2]) > tolerance
  );
}

/** True when any profile converter is registered (proofing is available). */
export function isProofingAvailable(config: ProofTransformConfig): boolean {
  return (
    profileConverters.has(config.profileId) || normalizedProfileConverters.has(config.profileId)
  );
}
