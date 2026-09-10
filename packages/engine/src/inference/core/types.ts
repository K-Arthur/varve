import type { ModelAcquisition } from '../types';

export type { ModelAcquisition, ModelSource, ModelUnavailableReason } from '../types';

export type ModelPrecision = 'fp32' | 'fp16' | 'int8' | 'bf16';

export type TaskCategory =
  | 'segmentation'
  | 'background-removal'
  | 'upscaling'
  | 'denoising'
  | 'depth'
  | 'colorization'
  | 'lineart'
  | 'inpainting'
  | 'detection'
  | 'classification'
  | 'embedding'
  | 'ocr'
  | 'frame-interpolation'
  | 'other';

export type ExecutionProvider =
  | 'wasm'
  | 'webgl'
  | 'webgpu'
  | 'cpu'
  | 'cuda'
  | 'coreml'
  | 'native'
  | 'xnnpack';
export type RuntimeKind = 'browser-wasm' | 'browser-worker' | 'tauri-native';

export type QualityTier = 1 | 2 | 3 | 4 | 5;
export type SpeedTier = 1 | 2 | 3 | 4 | 5;

export type UserQualityMode = 'auto' | 'fast' | 'balanced' | 'high-quality' | 'custom';

export type DownloadState =
  | 'not-downloaded'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'error'
  | 'update-available'
  | 'incompatible';

export type ModelAvailability =
  | 'bundled'
  | 'downloaded'
  | 'indexeddb'
  | 'native'
  | 'remote'
  | 'unavailable';

export interface TensorContractInput {
  name: string;
  dims: (number | null)[];
  dtype: string;
}

export interface TensorContractOutput {
  name: string;
  dims: (number | null)[];
  dtype: string;
}

export interface NormalizationParams {
  mean: [number, number, number];
  std: [number, number, number];
  channelOrder: 'rgb' | 'bgr';
}

export interface TensorContract {
  version: number;
  inputs: TensorContractInput[];
  outputs: TensorContractOutput[];
  normalization?: NormalizationParams;
  outputActivation: 'sigmoid' | 'softmax' | 'none' | 'linear' | 'tanh';
  inputDivisor?: number;
  peakMemoryBytes?: number;
}

export interface ValidationInfo {
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

export interface QualityValidationResult {
  passed: boolean;
  meanMae: number;
  meanPsnrDb: number;
  meanSsim?: number;
  boundaryFScore?: number;
  validatedAt: string;
  ortVersion: string;
  failureReasons?: string[];
}

export interface ModelComponent {
  id: string;
  role: string;
  filename: string;
  sizeBytes: number;
  remoteUrl: string;
  checksum?: string;
}

export interface ManifestEntry {
  id: string;
  filename: string;
  localPath: string;
  sha256: string | null;
  bundled: boolean;
  remoteUrl: string;
  remoteDataUrl?: string;
  precision?: ModelPrecision;
  sourceModelId?: string;
  sourceSha256?: string;
  modelVersion: string;
  sourceRevision?: string;
  sourceLicense?: string;
  preprocessingVersion: number;
  postprocessingVersion: number;
  supportedProviders: ExecutionProvider[];
  tensorContract?: TensorContract;
  validation?: ValidationInfo;
  notes?: string;
  components?: ModelComponent[];
}

export interface ModelManifest {
  version: number;
  schemaVersion: string;
  generatedAt: string;
  models: ManifestEntry[];
}

export interface ModelManifestEntry {
  id: string;
  name: string;
  description: string;
  sizeBytes: number;
  remoteUrl: string;
  checksum: string;
  bundled: boolean;
  inputSpec: ModelInputSpec | null;
  quality: QualityTier;
  speed: SpeedTier;
  peakMemoryBytes: number;
  gpuRecommended: boolean;
  maxSessions: number;
  precision: ModelPrecision;
  category: TaskCategory;
  sourceModelId?: string;
  sourceSha256?: string;
  localPath?: string;
  qualityValidation?: QualityValidationResult;
  remoteDataUrl?: string;
  source?: string;
  sourceLicense?: string;
  tensorContract?: TensorContract;
  validation?: ValidationInfo;
  multiComponent?: boolean;
  /** Post-download graph repair the DownloadManager must apply before
   *  hashing/serving the bytes (e.g. 'sam2-empty-value-info'). */
  repair?: string;
  /** Checksum of the upstream (pre-repair) artifact, when it differs from
   *  the shipped `checksum` (repaired bytes). */
  upstreamChecksum?: string;
  components?: ModelComponentEntry[];
  metadata?: Record<string, string>;
  /** Explicit acquisition strategy. Falls back to deriveAcquisition() when absent. */
  acquisition?: ModelAcquisition;
}

/**
 * Derive an acquisition strategy from legacy fields. Centralises the
 * previously-scattered truthiness checks.
 */
export function deriveAcquisition(entry: {
  id: string;
  bundled: boolean;
  remoteUrl: string;
  checksum: string;
  localPath?: string;
}): ModelAcquisition {
  if (!entry.bundled && !entry.remoteUrl) {
    return {
      kind: 'unavailable',
      reasonCode: 'source-unavailable',
      detail: 'No download source available',
    };
  }

  if (entry.bundled) {
    return {
      kind: 'bundled',
      assetPath: entry.localPath ?? `/models/${entry.id}.onnx`,
      sha256: entry.checksum || '',
    };
  }

  if (entry.remoteUrl && entry.checksum) {
    return {
      kind: 'remote',
      sources: [{ url: entry.remoteUrl, sha256: entry.checksum }],
      sha256: entry.checksum,
    };
  }

  return {
    kind: 'unavailable',
    reasonCode: 'source-unavailable',
    detail: 'Model entry has incomplete acquisition metadata',
  };
}

/**
 * Resolve the effective acquisition for an entry, preferring the explicit
 * field and falling back to legacy derivation.
 */
export function resolveAcquisition(entry: {
  acquisition?: ModelAcquisition;
  id: string;
  bundled: boolean;
  remoteUrl: string;
  checksum: string;
  localPath?: string;
}): ModelAcquisition {
  return entry.acquisition ?? deriveAcquisition(entry);
}

export interface ModelComponentEntry {
  id: string;
  role: string;
  filename: string;
  sizeBytes: number;
  remoteUrl?: string;
  checksum?: string;
}

export interface ModelInputSpec {
  inputSize: number;
  mean: [number, number, number];
  std: [number, number, number];
  paddingRgb: [number, number, number];
  applySigmoid: boolean;
}

export type ModelState =
  | 'unavailable'
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'error';

export type ModelInstallSource = 'bundled' | 'downloaded' | 'native' | 'none';

export interface ModelInstallInfo {
  id: string;
  name: string;
  sizeBytes: number;
  installed: boolean;
  source: ModelInstallSource;
  state: ModelState;
  precision?: ModelPrecision;
  category?: TaskCategory;
  quality?: QualityTier;
  version?: string;
  lastUsed?: number;
  downloadProgress?: { loaded: number; total: number };
}

export interface RuntimeCapabilities {
  crossOriginIsolated: boolean;
  isWebKitGTK: boolean;
  isTauri: boolean;
  hasWorker: boolean;
  hasWebGL: boolean;
  hasWebGPU: boolean;
  sharedMemoryAvailable: boolean;
  wasmSafeModelBytes: number;
  /** Estimated safe peak runtime memory for WASM inference. */
  wasmSafePeakBytes: number;
  preferredOnnxProviders: ExecutionProvider[];
  label: string;
  os?: string;
  cpuArch?: string;
  logicalProcessors?: number;
  approximateMemoryMB?: number;
  memoryTier?: 'low' | 'medium' | 'high';
  hasAvx2?: boolean;
  hasAvx512?: boolean;
  hasVnni?: boolean;
  hasNeon?: boolean;
  hasDotProduct?: boolean;
  webgpuAdapterInfo?: string;
  batteryPowered?: boolean;
  networkType?: string;
  webgpuDeviceLost?: boolean;
}

export interface SelectionDecision {
  modelId: string;
  precision: ModelPrecision;
  executionProvider: ExecutionProvider;
  quality: QualityTier;
  speed: SpeedTier;
  estimatedRuntimeMs: number;
  estimatedPeakMemoryBytes: number;
  requireDownload: boolean;
  tiling: boolean;
  downscale: boolean;
  approximate: boolean;
  reason: string;
  warnings?: string[];
  rejections: Array<{ modelId: string; precision: ModelPrecision; reason: string }>;
}

export interface SelectionContext {
  task: TaskCategory;
  qualityMode: UserQualityMode;
  inputWidth: number;
  inputHeight: number;
  hasAlpha: boolean;
  runtimeCapabilities: RuntimeCapabilities;
  availableModels: ModelInstallInfo[];
  batteryPowered?: boolean;
  meteredConnection?: boolean;
}

export interface InferenceRequest {
  modelId: string;
  input: ImageData | Float32Array | Uint8Array;
  signal?: AbortSignal;
  skipProviders?: ExecutionProvider[];
  priority?: number;
  correlationId?: string;
}

export interface InferenceResult {
  output: ImageData | Float32Array | Uint8Array;
  executionProvider: ExecutionProvider;
  processingTimeMs: number;
  modelId: string;
  precision: ModelPrecision;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  preprocessingMs: number;
  inferenceMs: number;
  postprocessingMs: number;
  fallback: boolean;
  tiled: boolean;
  warnings: string[];
  correlationId?: string;
}

export interface InferenceProvider {
  readonly id: string;
  isAvailable(request: InferenceRequest): boolean | Promise<boolean>;
  run(request: InferenceRequest): Promise<InferenceResult>;
}

export interface InferenceEvents {
  onStateChange: (modelId: string, state: ModelState) => void;
  onProgress: (modelId: string, loaded: number, total: number) => void;
  onError: (modelId: string, error: Error) => void;
}

export interface DownloadProgress {
  modelId: string;
  loaded: number;
  total: number;
  speedBytesPerSec: number;
  estimatedRemainingMs: number;
}

export interface TaskAdapter<TInput = unknown, TOutput = unknown> {
  readonly task: TaskCategory;
  readonly supportedModels: string[];
  validate(input: TInput): string | null;
  preprocess(input: TInput, modelId: string): Promise<InferenceRequest>;
  postprocess(result: InferenceResult, originalInput: TInput): Promise<TOutput>;
  estimateMemory(input: TInput, modelId: string): number;
}

export interface DiagnosticsReport {
  applicationVersion: string;
  ortVersion: string;
  runtimeCapabilities: RuntimeCapabilities;
  installedModels: ModelInstallInfo[];
  recentErrors: Array<{ code: string; message: string; time: string }>;
  precisionCapabilities: {
    provider: ExecutionProvider;
    int8Accelerated: boolean;
    fp16Supported: boolean;
    measuredSpeedup: number | null;
  }[];
}
