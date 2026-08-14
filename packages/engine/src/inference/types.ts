/**
 * Generic inference framework types for Strata's on-device ML pipeline.
 *
 * Extracted from bg-removal's provider-chain pattern (ADR-0005) so any
 * future model (layout classifier, component embedder, color harmony)
 * resolves through the same lifecycle without re-implementing session
 * caching, provider fallback, or memory-safety gating.
 */

export type ModelPrecision = 'fp32' | 'fp16' | 'int8' | 'bf16';

/**
 * A downloadable source for a model artifact or its upstream weights.
 * Every source must pin a SHA-256 so integrity is independently verifiable.
 */
export interface ModelSource {
  url: string;
  mirrorUrls?: string[];
  sha256: string;
  label?: string;
}

/**
 * Why a model cannot be acquired or used. Codes are machine-readable so the
 * UI can branch on them and tests can assert coverage.
 */
export type ModelUnavailableReason =
  | 'source-unavailable'
  | 'no-public-onnx'
  | 'export-pending'
  | 'license-restricted'
  | 'runtime-incompatible'
  | 'retired';

/**
 * Discriminated union describing how a model is obtained. This replaces the
 * ambiguous pattern of inferring availability from `remoteUrl === ''` or
 * `sha256 === null`. Every entry MUST resolve to exactly one variant.
 */
export type ModelAcquisition =
  | {
      kind: 'bundled';
      assetPath: string;
      sha256: string;
    }
  | {
      kind: 'remote';
      sources: ModelSource[];
      sha256: string;
    }
  | {
      kind: 'generated';
      recipeId: string;
      sourceWeights: ModelSource[];
      expectedSha256?: string;
    }
  | {
      kind: 'manual-import';
      acceptedFormats: string[];
      validationProfile: string;
    }
  | {
      kind: 'unavailable';
      reasonCode: ModelUnavailableReason;
      detail: string;
      alternatives?: string[];
    };

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

export interface QualityValidation {
  passed: boolean;
  meanMae: number;
  meanPsnrDb: number;
  validatedAt: string;
  ortVersion: string;
  failureReasons?: string[];
}

/** Tensor contract for ONNX model input/output specification. */
export interface ModelTensorContract {
  version: number;
  inputs: Array<{ name: string; dims: number[]; dtype: string }>;
  outputs: Array<{ name: string; dims: number[]; dtype: string }>;
  outputActivation: 'sigmoid' | 'softmax' | 'none' | 'linear';
  normalization?: {
    mean: [number, number, number];
    std: [number, number, number];
    channelOrder: 'rgb' | 'bgr';
  };
}

/** Model validation check results. */
export interface ModelValidation {
  contractVerified: boolean;
  contractVerifiedAt?: string;
  contractVersion?: number;
  integrityVerified: boolean;
  integrityVerifiedAt?: string;
  provenanceStatus: 'unverified' | 'signed' | 'verified' | 'revoked' | 'expired';
  provenanceVerifiedAt?: string;
  inferenceVerified: boolean;
  inferenceVerifiedAt?: string;
  validationSummary?: string;
}

export type ModelValidationStatus =
  | 'fully-verified'
  | 'partially-verified'
  | 'unverified'
  | 'verification-failed'
  | 'disabled';

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
  /**
   * For artifacts that are post-processed after download (e.g. the SAM2
   * encoder graph repair): SHA-256 of the file exactly as served upstream.
   * The download verifies against this first, applies `repair`, then
   * re-verifies against `checksum`.
   */
  upstreamChecksum?: string;
  /**
   * Optional post-download transform applied before install and final
   * checksum verification. 'sam2-empty-value-info' removes the empty
   * value_info shapes that ort-web's wasm shape inference rejects.
   */
  repair?: 'sam2-empty-value-info';
  /** True if the model ships with the app. */
  bundled: boolean;
  /** Input preprocessing spec (null = no preprocessing needed). */
  inputSpec: ModelInputSpec | null;
  /** Human-readable quality rating (0-5). */
  quality: number;
  /** Speed rating (1-5). */
  speed?: number;
  /** Estimated peak memory during inference (bytes). */
  peakMemoryBytes?: number;
  /** Whether GPU acceleration is strongly recommended. */
  gpuRecommended?: boolean;
  /** How many concurrent sessions to cache (-1 = unlimited). */
  maxSessions?: number;
  /** Weight precision (default fp32). */
  precision?: ModelPrecision;
  /** For INT8 variants: the FP32 source model this was quantized from. */
  sourceModelId?: string;
  /** SHA-256 of the FP32 source at quantization time. */
  sourceSha256?: string;
  /** Model category — segmentation, upscaling, denoising, etc. */
  category?: string;
  /** Local path to the model file (relative to public/). */
  localPath?: string;
  /** INT8 quality validation results (set for bundled INT8 variants). */
  qualityValidation?: QualityValidation;
  /** Separate .onnx.data file URL for models with external weights (>2GB). */
  remoteDataUrl?: string;
  /** Attribution string for the model's origin (e.g. "org/repo-name"). */
  source?: string;
  /** SPDX license identifier for the model weights. */
  sourceLicense?: string;
  /** SHA-256 checksum of the model file (may differ from `checksum` in the manifest JSON). */
  sha256?: string | null;
  /** Tensor contract for ONNX model input/output specification. */
  tensorContract?: ModelTensorContract;
  /** Model validation check results. */
  validation?: ModelValidation;
  /** True when this entry is a virtual grouping of several download components
   * (e.g. SAM2's separate encoder + decoder graphs) rather than a single file. */
  multiComponent?: boolean;
  /** Per-graph component specs for multiComponent models. */
  components?: ModelComponentEntry[];
  /**
   * Explicit acquisition strategy. When present, this is the single source of
   * truth for how the model is obtained. When absent, use
   * `deriveAcquisition()` to compute it from legacy fields.
   */
  acquisition?: ModelAcquisition;
}

export interface ModelComponentEntry {
  id: string;
  role: string;
  filename: string;
  sizeBytes: number;
  remoteUrl?: string;
  checksum?: string;
  /** SHA-256 of the file exactly as served upstream (pre-repair). */
  upstreamChecksum?: string;
  /** Optional post-download transform; see ModelManifestEntry.repair. */
  repair?: 'sam2-empty-value-info';
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
