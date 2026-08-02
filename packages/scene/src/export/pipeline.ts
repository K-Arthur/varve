/**
 * Canonical export processing-stage contracts (Strata export pipeline rebuild).
 *
 * These types describe the *processing stages* between "rendered surface" and
 * "encoded file": resampling, output sharpening, dithering/palette
 * quantization, colour conversion, and metadata policy. Each stage is a typed
 * contract so no renderer/encoder/dialog passes a loosely-shaped option object
 * around, and so the UI can never expose a control the canonical implementation
 * ignores.
 *
 * Design notes:
 *  - Every stage has a safe default factory (`createResizeOptions`, etc.) so
 *    plan normalization is deterministic.
 *  - Algorithm enums are closed unions; `isValidX` guards are provided for
 *    runtime validation of persisted/foreign input.
 *  - All numeric parameters are finite-checked in `validateX` — NaN/Infinity/
 *    negative values are rejected rather than producing unbounded work.
 *  - Stages are layered, not duplicated: the raster encoder reads `resize`,
 *    then `sharpen`, then `colorConversion`, then `dither`, then
 *    `metadataPolicy`, in that order (see `docs/implementation/
 *    export-pipeline-progress.md` for the canonical ordering rationale).
 */

import type {
  ColorConversionOptions,
  ColorOperation,
  DitherAlgorithm,
  DitherOptions,
  ProfileSource,
  ResamplingAlgorithm,
  RasterResizeOptions as ResizeOptions,
  SharpenMode,
  SharpenOptions,
} from '@strata/shared';
import type { RenderingIntent } from '../colorManagement';

// The algorithm/working-space unions live in @strata/shared so @strata/engine
// (which must not depend on @strata/scene) can import them without duplicating
// the union definitions. Re-export here so scene consumers keep one import path.
export type {
  DitherAlgorithm,
  DitherChannelMode,
  ExportWorkingSpace,
  ResamplingAlgorithm,
  SharpenMode,
} from '@strata/shared';

// ── Resampling ───────────────────────────────────────────────────────────────

export type {
  ColorConversionOptions,
  ColorOperation,
  DitherOptions,
  ProfileSource,
  RasterResizeOptions as ResizeOptions,
  SharpenOptions,
} from '@strata/shared';
export const RESAMPLING_ALGORITHMS: readonly ResamplingAlgorithm[] = [
  'auto',
  'nearest',
  'bilinear',
  'bicubic',
  'catmull-rom',
  'mitchell',
  'lanczos2',
  'lanczos3',
  'area',
  'pixel-art',
];

export function isValidResamplingAlgorithm(value: unknown): value is ResamplingAlgorithm {
  return typeof value === 'string' && (RESAMPLING_ALGORITHMS as readonly string[]).includes(value);
}

export function createResizeOptions(partial?: Partial<ResizeOptions>): ResizeOptions {
  return {
    algorithm: 'auto',
    workingSpace: 'srgb',
    maxPixels: 64_000_000,
    tileHeight: 0,
    ...partial,
  };
}

export function validateResizeOptions(value: ResizeOptions, path: string): void {
  if (!isValidResamplingAlgorithm(value.algorithm)) {
    throw new Error(`${path}.algorithm: unknown resampling algorithm "${String(value.algorithm)}"`);
  }
  if (value.workingSpace !== 'srgb' && value.workingSpace !== 'linear-srgb') {
    throw new Error(`${path}.workingSpace: must be "srgb" or "linear-srgb"`);
  }
  if (!Number.isFinite(value.maxPixels) || value.maxPixels <= 0) {
    throw new Error(`${path}.maxPixels: must be a positive finite number`);
  }
  if (!Number.isFinite(value.tileHeight) || value.tileHeight < 0) {
    throw new Error(`${path}.tileHeight: must be a non-negative finite number`);
  }
}

// ── Output sharpening ───────────────────────────────────────────────────────

export const SHARPEN_MODES: readonly SharpenMode[] = [
  'none',
  'auto',
  'unsharp',
  'high-pass',
  'crisp',
];

export function isValidSharpenMode(value: unknown): value is SharpenMode {
  return typeof value === 'string' && (SHARPEN_MODES as readonly string[]).includes(value);
}

export function createSharpenOptions(partial?: Partial<SharpenOptions>): SharpenOptions {
  return {
    mode: 'none',
    amount: 0.5,
    radius: 1,
    threshold: 0.02,
    luminanceOnly: true,
    protectAlpha: true,
    workingSpace: 'srgb',
    ...partial,
  };
}

export function validateSharpenOptions(value: SharpenOptions, path: string): void {
  if (!isValidSharpenMode(value.mode)) {
    throw new Error(`${path}.mode: unknown sharpen mode "${String(value.mode)}"`);
  }
  if (value.mode === 'none') return;
  for (const key of ['amount', 'radius', 'threshold'] as const) {
    if (!Number.isFinite(value[key])) throw new Error(`${path}.${key}: must be finite`);
  }
  if (value.amount < 0 || value.amount > 1) {
    throw new Error(`${path}.amount: must be within 0..1`);
  }
  if (value.radius < 0) throw new Error(`${path}.radius: must be non-negative`);
  if (value.threshold < 0 || value.threshold > 1) {
    throw new Error(`${path}.threshold: must be within 0..1`);
  }
  if (value.workingSpace !== 'srgb' && value.workingSpace !== 'linear-srgb') {
    throw new Error(`${path}.workingSpace: must be "srgb" or "linear-srgb"`);
  }
}

// ── Dithering & quantization ─────────────────────────────────────────────────

export const DITHER_ALGORITHMS: readonly DitherAlgorithm[] = [
  'none',
  'floyd-steinberg',
  'atkinson',
  'jarvis-judice-ninke',
  'stucki',
  'bayer-2',
  'bayer-4',
  'bayer-8',
  'blue-noise',
];

export function isValidDitherAlgorithm(value: unknown): value is DitherAlgorithm {
  return typeof value === 'string' && (DITHER_ALGORITHMS as readonly string[]).includes(value);
}

export function createDitherOptions(partial?: Partial<DitherOptions>): DitherOptions {
  return {
    algorithm: 'none',
    strength: 1,
    targetBitDepth: 8,
    paletteSize: 0,
    serpentine: true,
    seed: 0,
    channelMode: 'all',
    alphaThreshold: 0,
    ...partial,
  };
}

export function validateDitherOptions(value: DitherOptions, path: string): void {
  if (!isValidDitherAlgorithm(value.algorithm)) {
    throw new Error(`${path}.algorithm: unknown dither algorithm "${String(value.algorithm)}"`);
  }
  for (const key of [
    'strength',
    'targetBitDepth',
    'paletteSize',
    'seed',
    'alphaThreshold',
  ] as const) {
    if (!Number.isFinite(value[key])) throw new Error(`${path}.${key}: must be finite`);
  }
  if (value.strength < 0 || value.strength > 1) {
    throw new Error(`${path}.strength: must be within 0..1`);
  }
  if (![8, 7, 6, 5, 4, 3, 2, 1].includes(value.targetBitDepth)) {
    throw new Error(`${path}.targetBitDepth: must be an integer 1..8`);
  }
  if (value.paletteSize < 0 || value.paletteSize > 256) {
    throw new Error(`${path}.paletteSize: must be within 0..256`);
  }
  if (value.alphaThreshold < 0 || value.alphaThreshold > 1) {
    throw new Error(`${path}.alphaThreshold: must be within 0..1`);
  }
  if (value.channelMode !== 'all' && value.channelMode !== 'luminance') {
    throw new Error(`${path}.channelMode: must be "all" or "luminance"`);
  }
}

// ── Metadata policy ─────────────────────────────────────────────────────────
//
// The policy contract lives in @strata/shared (`exportContracts.ts`) so the
// engine's metadata writer can import it without a scene dependency. Scene
// re-exports the shared names so config consumers keep a single import path;
// `validateMetadataPolicy` adds configuration-time validation on top.

export type {
  MetadataFieldDecision,
  MetadataFieldKey,
  MetadataFieldOverrides,
  MetadataPolicy,
  MetadataPolicyKind,
} from '@strata/shared';
export {
  createMetadataPolicy,
  isMetadataFieldDecision,
  isValidMetadataPolicyKind,
  METADATA_OVERRIDE_KEYS,
  METADATA_POLICY_KINDS,
  resolveMetadataFieldDecision,
} from '@strata/shared';

import type { MetadataPolicy } from '@strata/shared';
import {
  isMetadataFieldDecision,
  isValidMetadataPolicyKind,
  METADATA_OVERRIDE_KEYS,
} from '@strata/shared';

export function validateMetadataPolicy(value: MetadataPolicy, path: string): void {
  if (!isValidMetadataPolicyKind(value.kind)) {
    throw new Error(`${path}.kind: unknown metadata policy "${String(value.kind)}"`);
  }
  if (typeof value.deterministic !== 'boolean') {
    throw new Error(`${path}.deterministic: must be a boolean`);
  }
  if (value.overrides) {
    for (const key of METADATA_OVERRIDE_KEYS) {
      const decision = value.overrides[key];
      if (decision === undefined) continue;
      if (!isMetadataFieldDecision(decision)) {
        throw new Error(`${path}.overrides.${key}: unknown decision "${String(decision)}"`);
      }
    }
  }
}

// ── Colour conversion ────────────────────────────────────────────────────────

export const PROFILE_SOURCES: readonly ProfileSource[] = [
  'embedded',
  'document',
  'assigned',
  'assume-srgb',
  'user',
  'none',
];

export const COLOR_OPERATIONS: readonly ColorOperation[] = [
  'assign',
  'convert',
  'embed',
  'strip',
  'proof',
];

export function isValidProfileSource(value: unknown): value is ProfileSource {
  return typeof value === 'string' && (PROFILE_SOURCES as readonly string[]).includes(value);
}

export function isValidColorOperation(value: unknown): value is ColorOperation {
  return typeof value === 'string' && (COLOR_OPERATIONS as readonly string[]).includes(value);
}

export function createColorConversionOptions(
  partial?: Partial<ColorConversionOptions>,
): ColorConversionOptions {
  return {
    operation: 'convert',
    sourceProfile: 'assume-srgb',
    renderingIntent: 'relative',
    blackPointCompensation: true,
    ...partial,
  };
}

export function validateColorConversionOptions(value: ColorConversionOptions, path: string): void {
  if (!isValidColorOperation(value.operation)) {
    throw new Error(`${path}.operation: unknown operation "${String(value.operation)}"`);
  }
  if (!isValidProfileSource(value.sourceProfile)) {
    throw new Error(`${path}.sourceProfile: unknown source "${String(value.sourceProfile)}"`);
  }
  if (value.sourceProfile === 'user' && !value.sourceProfileName) {
    throw new Error(`${path}.sourceProfileName: required when sourceProfile=user`);
  }
  const intents: readonly RenderingIntent[] = ['perceptual', 'relative', 'absolute', 'saturation'];
  if (!intents.includes(value.renderingIntent)) {
    throw new Error(`${path}.renderingIntent: unknown intent "${String(value.renderingIntent)}"`);
  }
  if (typeof value.blackPointCompensation !== 'boolean') {
    throw new Error(`${path}.blackPointCompensation: must be a boolean`);
  }
}
