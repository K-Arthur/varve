/**
 * Generic inference framework types for Strata's on-device ML pipeline.
 *
 * Extracted from bg-removal's provider-chain pattern (ADR-0005) so any
 * future model (layout classifier, component embedder, color harmony)
 * resolves through the same lifecycle without re-implementing session
 * caching, provider fallback, or memory-safety gating.
 */

/** Specification for a model's input preprocessing. */
export interface ModelInputSpec {
  /** Expected input width/height (models square). */
  inputSize: number;
  /** Channel-wise mean for normalization. */
  mean: [number, number, number];
  /** Channel-wise std for normalization. */
  std: [number, number, number];
  /** Padding color for letterboxing. */
  paddingRgb: [number, number, number];
  /** Apply sigmoid to output logits. */
  applySigmoid: boolean;
}

/** Entry in the model manifest. */
export interface ModelManifestEntry {
  id: string;
  name: string;
  description: string;
  /** Model file size in bytes. */
  sizeBytes: number;
  /** Remote download URL (empty if bundled-only). */
  remoteUrl: string;
  /** SHA-256 checksum for integrity verification. */
  checksum: string;
  /** True if the model ships with the app. */
  bundled: boolean;
  /** Input preprocessing spec (null = no preprocessing needed). */
  inputSpec: ModelInputSpec | null;
  /** Human-readable quality rating (0-5). */
  quality: number;
  /** Estimated peak memory during inference (bytes). */
  peakMemoryBytes?: number;
  /** Whether GPU acceleration is strongly recommended. */
  gpuRecommended?: boolean;
  /** How many concurrent sessions to cache (-1 = unlimited). */
  maxSessions?: number;
}

export type ModelState = 'unavailable' | 'downloading' | 'ready' | 'error';

export type ModelInstallSource = 'bundled' | 'downloaded' | 'none';

export interface ModelInstallInfo {
  id: string;
  name: string;
  sizeBytes: number;
  installed: boolean;
  source: ModelInstallSource;
  state: ModelState;
}

/** Parameters for a model inference request. */
export interface InferenceRequest<TInput = unknown> {
  modelId: string;
  input: TInput;
  signal?: AbortSignal;
  /** Provider hints: skip certain backends. */
  skipProviders?: string[];
}

/** Result of a model inference request. */
export interface InferenceResult<TOutput = unknown> {
  output: TOutput;
  executionProvider: string;
  processingTimeMs: number;
  modelId: string;
}

/** Lifecycle events a model registry consumer can subscribe to. */
export interface InferenceEvents {
  onStateChange: (modelId: string, state: ModelState) => void;
  onProgress: (modelId: string, loaded: number, total: number) => void;
  onError: (modelId: string, error: Error) => void;
}

/** Provider interface — each backend implements one inference path. */
export interface InferenceProvider<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  isAvailable(request: InferenceRequest<TInput>): boolean | Promise<boolean>;
  run(request: InferenceRequest<TInput>): Promise<InferenceResult<TOutput>>;
}
