/**
 * Font detection types — shared contracts for the font identification pipeline.
 *
 * Supports three detection modes:
 *   - 'classifier':  ML model (EfficientNet B3) predicts font family from image crop
 *   - 'local-match': render-and-compare against installed/project fonts
 *   - 'hybrid':      classifier top-k → render-and-compare refinement
 *
 * Every candidate is tagged with a confidence category and match type so the
 * UI can communicate uncertainty honestly.
 */

import type { FontCatalogEntry } from '../font/fontCatalog';

// ---------------------------------------------------------------------------
// Detection mode
// ---------------------------------------------------------------------------

export type FontDetectionMode = 'classifier' | 'local-match' | 'hybrid';

// ---------------------------------------------------------------------------
// Crop region
// ---------------------------------------------------------------------------

/** Axis-aligned crop rectangle in source-image pixel coordinates. */
export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation correction applied (degrees). */
  rotation: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface FontDetectionRequest {
  /** RGBA pixel data of the cropped text region. */
  imageData: ImageData;
  /** Detection mode to use. */
  mode: FontDetectionMode;
  /** OCR'd or user-supplied text visible in the crop (for render-and-compare). */
  recognizedText?: string;
  /** Max candidates to return. */
  maxCandidates?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Typography properties (estimated from the crop)
// ---------------------------------------------------------------------------

export interface TypographyFeatures {
  serif: 'serif' | 'sans-serif' | 'unknown';
  monospace: boolean | null;
  weightEstimate: number;
  italicAngle: number;
  isItalic: boolean;
  xHeightRatio: number | null;
  contrast: number | null;
  category: 'body' | 'display' | 'script' | 'monospace' | 'unknown';
}

// ---------------------------------------------------------------------------
// Confidence and match classification
// ---------------------------------------------------------------------------

/**
 * User-facing confidence category. These map to specific language in the UI
 * and must stay ordered from most to least certain.
 */
export type ConfidenceCategory =
  | 'likely-match'
  | 'plausible-match'
  | 'similar-candidate'
  | 'low-confidence'
  | 'out-of-catalogue'
  | 'insufficient-quality';

export type MatchType =
  | 'exact-installed'
  | 'style-variant'
  | 'similar-installed'
  | 'open-source-match'
  | 'proprietary-unavailable'
  | 'unknown';

// ---------------------------------------------------------------------------
// Candidate result
// ---------------------------------------------------------------------------

export interface FontCandidate {
  /** Ranked position (0 = best). */
  rank: number;
  /** Family name as predicted or matched. */
  family: string;
  /** Style/weight within the family. */
  style: string;
  /** Confidence category for UI display. */
  confidenceCategory: ConfidenceCategory;
  /** Numeric confidence score (0-1), for diagnostics only. */
  confidenceScore: number;
  /** Match type describing the relationship. */
  matchType: MatchType;
  /** Whether the font is installed/available locally. */
  isAvailable: boolean;
  /** Source of the font. */
  source: 'system' | 'project' | 'bundled' | 'user' | 'downloadable' | 'unknown';
  /** License info if known. */
  license?: string;
  /** Preview text rendered with this candidate (for comparison UI). */
  previewText?: string;
  /** Component scores from render-and-compare (diagnostics). */
  componentScores?: RenderCompareScores;
  /** Reference to catalog entry if resolved. */
  catalogEntry?: FontCatalogEntry;
}

// ---------------------------------------------------------------------------
// Render-and-compare component scores
// ---------------------------------------------------------------------------

export interface RenderCompareScores {
  silhouetteOverlap: number;
  strokeWidthSimilarity: number;
  xHeightDelta: number;
  charWidthRatio: number;
  compositeScore: number;
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export type FontDetectionStatus =
  | 'success'
  | 'low-confidence'
  | 'model-unavailable'
  | 'insufficient-quality'
  | 'cancelled'
  | 'error';

export interface FontDetectionResult {
  status: FontDetectionStatus;
  candidates: FontCandidate[];
  /** Estimated typography features. */
  features: TypographyFeatures | null;
  /** Human-readable message for error/edge cases. */
  message: string;
  /** Processing time in ms. */
  elapsedMs: number;
  /** Whether the classifier model was used (vs pure local matching). */
  usedClassifier: boolean;
  /** The mode actually used (may differ from request if model unavailable). */
  resolvedMode: FontDetectionMode;
  /** Quality warnings detected during preprocessing. */
  qualityWarnings: QualityWarning[];
}

export interface QualityWarning {
  code:
    | 'crop-too-small'
    | 'low-resolution'
    | 'low-contrast'
    | 'multiple-fonts'
    | 'rotated'
    | 'blurry'
    | 'few-characters';
  message: string;
}
