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
