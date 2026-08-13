/**
 * Human-readable model information for the background-removal UI.
 *
 * Each entry documents what the user needs to know before selecting a mode:
 * disk size, estimated peak RAM during inference, quality tier, and any
 * backend requirements.
 */

export interface ModelInfo {
  /** UI label (short). */
  readonly label: string;
  /** UI description (sentence). */
  readonly description: string;
  /** Model file size on disk (bytes). */
  readonly diskSizeBytes: number;
  /** Estimated peak WASM heap + tensor memory during inference (bytes). */
  readonly estimatedPeakRamBytes: number;
  /** Human-readable peak memory string. */
  readonly peakRamDisplay: string;
  /** Human-readable disk size string. */
  readonly diskSizeDisplay: string;
  /** Quality tier label. */
  readonly quality: string;
  /** Whether a download is required (not bundled). */
  readonly requiresDownload: boolean;
  /** Whether GPU acceleration is recommended. */
  readonly gpuRecommended: boolean;
  /** Whether WASM-only is safe (known not to crash). */
  readonly wasmSafe: boolean;
}

export const QUICK_MODEL_INFO: ModelInfo = {
  label: 'Fast',
  description: 'Fast CPU heuristic — no AI model, works offline on every image.',
  diskSizeBytes: 0,
  estimatedPeakRamBytes: 16_000_000,
  peakRamDisplay: '~16 MB',
  diskSizeDisplay: '0 B (no model)',
  quality: 'Basic',
  requiresDownload: false,
  gpuRecommended: false,
  wasmSafe: true,
};

export const AI_BALANCED_MODEL_INFO: ModelInfo = {
  label: 'Auto',
  description: 'General-purpose local AI with automatic low-memory fallback.',
  diskSizeBytes: 178_648_008,
  estimatedPeakRamBytes: 700_000_000,
  peakRamDisplay: 'up to ~700 MB',
  diskSizeDisplay: '179 MB optional',
  quality: 'Very good',
  requiresDownload: true,
  gpuRecommended: true,
  wasmSafe: false,
};

export const AI_QUALITY_MODEL_INFO: ModelInfo = {
  label: 'High quality',
  description: 'BiRefNet Lite for hair, fur, and complex edges.',
  diskSizeBytes: 224_000_000,
  estimatedPeakRamBytes: 900_000_000,
  peakRamDisplay: '~900 MB',
  diskSizeDisplay: '224 MB',
  quality: 'Best',
  requiresDownload: true,
  gpuRecommended: true,
  wasmSafe: false,
};

export const MODEL_INFO_MAP: Record<string, ModelInfo> = {
  quick: QUICK_MODEL_INFO,
  'ai-balanced': AI_BALANCED_MODEL_INFO,
  'ai-quality': AI_QUALITY_MODEL_INFO,
};

export function getModelInfo(method: string): ModelInfo | undefined {
  return MODEL_INFO_MAP[method];
}
