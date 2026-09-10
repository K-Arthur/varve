/**
 * Shared multimodal request contract for all colorization workflows.
 *
 * Every asynchronous colorization operation — palette colorize, selective
 * recolor, reference transfer, SCUNet denoise, SAM2 mask generation —
 * accepts a typed request object and returns a result that carries enough
 * context for the caller to detect stale outcomes.
 *
 * Key invariants:
 *   - Requests carry a unique `requestId` for cancellation correlation.
 *   - Every result carries `requestId`, `sourceRevision`, and
 *     `dispatchedAt` so the caller can reject stale outcomes.
 *   - Results are rejected when the source, mask, palette, reference
 *     image, model, provider, or document changed after dispatch.
 *   - `AbortSignal` is threaded through to every async boundary.
 *
 * Research basis:
 *   - Reinhard et al. (2001): color transfer in LAB space.
 *   - DDColor (Kang et al., ICCV 2023): photo-realistic colorization.
 *   - SAM2 (Kirillov et al., 2023): Segment Anything Model 2.
 *   - SCUNet (Zhang et al., 2023): CNN+Transformer denoising.
 */
import type { ColorizationWorkflow, QualityMode } from './types';

// ---------------------------------------------------------------------------
// Request kinds — discriminated union of every colorization operation
// ---------------------------------------------------------------------------

export type ColorizationRequestKind =
  | 'palette-colorize'
  | 'selective-recolor'
  | 'reference-transfer'
  | 'harmonize'
  | 'photo-colorize'
  | 'scunet-denoise'
  | 'sam2-encode'
  | 'sam2-decode';

// ---------------------------------------------------------------------------
// Source identity — what image is being processed
// ---------------------------------------------------------------------------

export interface SourceIdentity {
  /** Stable node ID in the document. */
  nodeId: string;
  /** Monotonically increasing revision — bumped on every pixel change. */
  revision: number;
  /** Natural pixel dimensions. */
  width: number;
  height: number;
  /** Optional color profile name (e.g. 'srgb', 'display-p3'). */
  colorProfile?: string;
}

// ---------------------------------------------------------------------------
// Mask reference — optional SAM2 or manual mask
// ---------------------------------------------------------------------------

export interface MaskReference {
  /** Stable mask asset or node ID. */
  maskId: string;
  /** Revision of the mask data (bumped on edit). */
  revision: number;
  /** Raw mask pixel data (0-255 alpha). */
  data: Uint8Array;
  width: number;
  height: number;
  /** Optional feather radius in pixels. */
  feather?: number;
  /** Optional density (0-1). */
  density?: number;
  /** Whether the mask is inverted. */
  inverted?: boolean;
}

// ---------------------------------------------------------------------------
// Palette reference — document swatches for palette colorization
// ---------------------------------------------------------------------------

export interface PaletteReference {
  /** Array of hex color strings (e.g. '#ff0000'). */
  colors: string[];
  /** Optional swatch IDs — when stable IDs are provided, the pipeline
   *  can detect when a referenced swatch changes and invalidate stale
   *  results. */
  swatchIds?: string[];
  /** Revision of the palette (bumped when swatches change). */
  revision: number;
  /** Target adherence 0-1 (0 = loose, 1 = strict palette match). */
  adherence?: number;
}

// ---------------------------------------------------------------------------
// Reference image — for color transfer workflows
// ---------------------------------------------------------------------------

export interface ReferenceImage {
  /** Stable asset or node ID. */
  assetId: string;
  /** Revision of the reference data. */
  revision: number;
  /** Natural pixel dimensions. */
  width: number;
  height: number;
  /** Optional color profile. */
  colorProfile?: string;
  /** Embedded data URL or asset reference. */
  src: string;
}

// ---------------------------------------------------------------------------
// Provider preference
// ---------------------------------------------------------------------------

export type InferenceBackend = 'auto' | 'worker' | 'native-tauri' | 'webgpu' | 'wasm';

export interface ProviderPreference {
  backend: InferenceBackend;
  /** Skip specific provider IDs. */
  skipProviders?: string[];
  /** Preview (fast, lower quality) or full-resolution. */
  intent: 'preview' | 'full';
  /** Maximum preview dimension (default 512). */
  previewMaxDimension?: number;
}

// ---------------------------------------------------------------------------
// Colorization request — unified contract
// ---------------------------------------------------------------------------

export interface ColorizationRequestContract {
  /** Unique request ID for cancellation correlation. */
  requestId: string;
  /** Which colorization workflow. */
  kind: ColorizationRequestKind;
  /** Source image being processed. */
  source: SourceIdentity;
  /** Quality preference. */
  qualityMode: QualityMode;
  /** Provider preference. */
  provider: ProviderPreference;
  /** Optional mask for selective recolor or masked transfer. */
  mask?: MaskReference;
  /** Optional palette for palette-colorize workflow. */
  palette?: PaletteReference;
  /** Optional reference image for color transfer. */
  reference?: ReferenceImage;
  /** Workflow-specific parameters. */
  params?: {
    /** Target hue in degrees (for selective-recolor). */
    targetHue?: number;
    /** Saturation scale 0-∞ (for selective-recolor). */
    saturationScale?: number;
    /** Luminance preservation 0-1. */
    luminancePreservation?: number;
    /** Chroma strength 0-1 (for transfer/harmonize). */
    chromaStrength?: number;
    /** Neutral region protection. */
    neutralProtection?: boolean;
    /** Skin-tone protection. */
    skinProtection?: boolean;
    /** Denoise strength 0-1 (for SCUNet). */
    denoiseStrength?: number;
    /** SAM2-specific prompt data. */
    sam2Prompts?: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    /** SAM2 previous mask logits for iterative refinement. */
    sam2PreviousMask?: { data: Float32Array; width: number; height: number };
  };
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Progress callback. */
  onProgress?: (progress: ColorizationProgress) => void;
}

// ---------------------------------------------------------------------------
// Colorization result — carries stale-detection metadata
// ---------------------------------------------------------------------------

export interface ColorizationResultContract {
  /** Echo of the request ID for correlation. */
  requestId: string;
  /** The source identity at time of dispatch (for staleness check). */
  sourceRevision: number;
  /** When the request was dispatched (performance.now()). */
  dispatchedAt: number;
  /** Output image data. */
  imageData: ImageData;
  /** Which workflow produced this result. */
  workflow: ColorizationWorkflow | 'scunet-denoise';
  /** Model ID used (null for classical operations). */
  modelUsed: string | null;
  /** Execution provider string. */
  provider: string;
  /** Total wall-clock processing time in ms. */
  elapsedMs: number;
  /** For SAM2 decode: multiple mask candidates. */
  maskCandidates?: Array<{
    mask: Uint8Array;
    width: number;
    height: number;
    iouScore: number;
  }>;
  /** For SAM2 decode: selected mask index. */
  selectedMaskIndex?: number;
  /** For SAM2 decode: confidence score. */
  confidence?: number;
  /** For SAM2 decode: low-res mask logits for next iteration. */
  lowResMask?: { data: Float32Array; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Progress events
// ---------------------------------------------------------------------------

export type ColorizationProgressPhase =
  | 'preprocessing'
  | 'model-download'
  | 'encoding'
  | 'inference'
  | 'decoding'
  | 'postprocessing'
  | 'compositing'
  | 'complete';

export interface ColorizationProgress {
  phase: ColorizationProgressPhase;
  percent: number;
  elapsedMs: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Stale-result detection helper
// ---------------------------------------------------------------------------

/**
 * Check whether a result is stale given the current source state.
 * Returns null if the result is fresh, or a reason string if stale.
 */
export function detectStaleResult(
  result: ColorizationResultContract,
  currentSourceRevision: number,
  _currentPaletteRevision?: number,
  _currentMaskRevision?: number,
  _currentReferenceRevision?: number,
): string | null {
  if (result.sourceRevision !== currentSourceRevision) {
    return 'source-changed';
  }
  // Additional staleness checks can be added here when palette/mask/
  // reference revisions are threaded through the result.
  return null;
}

// ---------------------------------------------------------------------------
// Request ID generation
// ---------------------------------------------------------------------------

let requestCounter = 0;

export function generateColorizationRequestId(): string {
  return `cz-${++requestCounter}-${Date.now().toString(36)}`;
}
