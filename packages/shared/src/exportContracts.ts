/**
 * Cross-package export contract enums.
 *
 * Owned here (not in @strata/scene) so @strata/engine — which must not depend
 * on @strata/scene — can reference the same closed unions without duplicating
 * them. @strata/scene re-exports these from `export/pipeline.ts`; the engine's
 * `exportPipeline/*` modules import them from this file. This keeps the "no
 * duplicate incompatible types across packages" invariant.
 */

/** Resampling algorithms supported by the canonical export resampler. */
export type ResamplingAlgorithm =
  | 'auto'
  | 'nearest'
  | 'bilinear'
  | 'bicubic'
  | 'catmull-rom'
  | 'mitchell'
  | 'lanczos2'
  | 'lanczos3'
  | 'area'
  | 'pixel-art';

/**
 * Working space for a processing stage. `srgb` treats stored values as the
 * encoded signal (perceptual); `linear-srgb` converts through the IEC
 * 61966-2-1 EOTF first (physically additive).
 */
export type ExportWorkingSpace = 'srgb' | 'linear-srgb';

/** Output sharpening strategies for the canonical sharpen stage. */
export type SharpenMode = 'none' | 'auto' | 'unsharp' | 'high-pass' | 'crisp';

/** Technical bit-depth / palette dithering algorithms for the export stage. */
export type DitherAlgorithm =
  | 'none'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'blue-noise';

export type DitherChannelMode = 'all' | 'luminance';

// ── Metadata policy ─────────────────────────────────────────────────────────

export type MetadataPolicyKind =
  | 'preserve'
  | 'copyright-only'
  | 'privacy-strip'
  | 'strip-all'
  | 'document'
  | 'custom';

export type MetadataFieldDecision = 'keep' | 'strip' | 'inherit';

export interface MetadataFieldOverrides {
  gps: MetadataFieldDecision;
  device: MetadataFieldDecision;
  copyright: MetadataFieldDecision;
  creator: MetadataFieldDecision;
  timestamps: MetadataFieldDecision;
  thumbnail: MetadataFieldDecision;
  history: MetadataFieldDecision;
}

export interface MetadataPolicy {
  kind: MetadataPolicyKind;
  /** Suppress timestamps/ids/random docs for reproducible output. */
  deterministic: boolean;
  /** Per-field overrides; only meaningful when kind=custom. */
  overrides?: Partial<MetadataFieldOverrides>;
}

export const METADATA_POLICY_KINDS: readonly MetadataPolicyKind[] = [
  'preserve',
  'copyright-only',
  'privacy-strip',
  'strip-all',
  'document',
  'custom',
];

export const METADATA_OVERRIDE_KEYS = [
  'gps',
  'device',
  'copyright',
  'creator',
  'timestamps',
  'thumbnail',
  'history',
] as const;

export type MetadataFieldKey = (typeof METADATA_OVERRIDE_KEYS)[number];

const FIELD_DECISIONS: readonly MetadataFieldDecision[] = ['keep', 'strip', 'inherit'];

export function isValidMetadataPolicyKind(value: unknown): value is MetadataPolicyKind {
  return typeof value === 'string' && (METADATA_POLICY_KINDS as readonly string[]).includes(value);
}

export function createMetadataPolicy(partial?: Partial<MetadataPolicy>): MetadataPolicy {
  return {
    kind: 'privacy-strip',
    deterministic: false,
    ...partial,
  };
}

/**
 * Resolve the effective decision for a metadata field under a policy. `custom`
 * policies use their overrides; named policies have fixed built-in behaviour.
 */
export function resolveMetadataFieldDecision(
  policy: MetadataPolicy,
  field: MetadataFieldKey,
): MetadataFieldDecision {
  switch (policy.kind) {
    case 'preserve':
      return 'keep';
    case 'copyright-only':
      return field === 'copyright' ? 'keep' : 'strip';
    case 'privacy-strip':
      // Privacy-conscious default: drop anything personally identifying or
      // machine-specific, but keep authorship/copyright.
      if (field === 'copyright' || field === 'creator') return 'keep';
      return 'strip';
    case 'strip-all':
      return 'strip';
    case 'document':
      return 'keep';
    case 'custom':
      return policy.overrides?.[field] ?? 'inherit';
  }
}

export function isMetadataFieldDecision(value: unknown): value is MetadataFieldDecision {
  return typeof value === 'string' && (FIELD_DECISIONS as readonly string[]).includes(value);
}
