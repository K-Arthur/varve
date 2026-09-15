import type { ContentAwareFillResult } from '../contentAwareFill/types';

/**
 * `remove` is the persisted operation name for Generative Subtract: the user
 * marks content to remove and the provider reconstructs the surrounding image
 * in that coverage. It is deliberately distinct from deleting pixels or
 * filling transparent canvas.
 */
export type GenerativeEditMode = 'fill' | 'remove' | 'replace' | 'expand';
export type GenerativeEditQuality = 'draft' | 'balanced' | 'quality';
export type GenerativeEditProviderKind = 'local' | 'remote';
export type GenerativeEditRuntime =
  | 'patchmatch'
  | 'wasm'
  | 'webgpu'
  | 'native-cpu'
  | 'native-accelerated'
  | 'remote';

export type GenerativeEditResourceTier = 'constrained' | 'standard' | 'high' | 'unknown';
export type GenerativeEditExecutionBackend = 'native' | 'webgpu' | 'wasm' | 'unknown';

/** Exact model input frame used after aspect-ratio preparation. */
export interface GenerativeEditInputFrame {
  contractId: string;
  preprocessingVersion: string;
  width: number;
  height: number;
}

export interface GenerativeEditResourceProfile {
  /** Conservative device tier used for local preflight and UI copy. */
  tier: GenerativeEditResourceTier;
  /** Best-effort platform family (for example `chromeos`, `macos`, or `android`). */
  platform?: string;
  /** Best-known execution family; this is not a quality qualification. */
  executionBackend: GenerativeEditExecutionBackend;
  /** Runtime-reported architecture when one is available. */
  architecture?: string;
  /** Browser device-memory hint, when the platform exposes one. */
  approximateMemoryBytes?: number;
  /** Conservative safe peak for browser/WASM inference, when known. */
  safePeakBytes?: number;
  /** Conservative safe model-file budget for browser/WASM inference. */
  safeModelBytes?: number;
  /** Honest explanation suitable for the setup/status surface. */
  summary: string;
}

/**
 * Runtime state supplied by the UI when resolving local capabilities.
 *
 * A desktop runtime can expose the native helper before a model has been
 * installed and qualified. Keeping that distinction in the capability
 * resolver prevents prompt controls from advertising an executable route
 * prematurely.
 */
export interface GenerativeEditCapabilityContext {
  nativeModelReady?: boolean;
}

export interface GenerativeEditProvider {
  kind: GenerativeEditProviderKind;
  id: string;
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: GenerativeEditRuntime;
  /** Optional for reconstruction/legacy providers; required for diffusion results. */
  inputFrame?: GenerativeEditInputFrame;
}

export type GenerativeEditCapabilityParameter =
  | 'prompt'
  | 'negativePrompt'
  | 'seed'
  | 'strength'
  | 'steps'
  | 'guidanceScale'
  | 'imageGuidanceScale'
  | 'variations'
  | 'contextPadding'
  | 'maskExpansion'
  | 'feather';

export type GenerativeEditCapabilityReasonCode =
  | 'runtime-unavailable'
  | 'model-required'
  | 'model-unqualified'
  | 'insufficient-memory'
  | 'prompt-unavailable'
  | 'remote-unconfigured';

export interface GenerativeEditModeCapabilities {
  /** The provider knows how to execute this operation in this runtime. */
  available: boolean;
  /** All prerequisites, including a qualified model, are currently ready. */
  ready: boolean;
  prompt: boolean;
  variations: boolean;
  supportedParameters: readonly GenerativeEditCapabilityParameter[];
  limits: {
    maxWidth: number;
    maxHeight: number;
    maxVariations: number;
    maxSteps?: number;
  };
  reasonCode?: GenerativeEditCapabilityReasonCode;
  reason?: string;
}

export interface GenerativeEditCapabilities {
  fill: boolean;
  remove: boolean;
  replace: boolean;
  expand: boolean;
  prompt: boolean;
  variations: boolean;
  modes: Record<GenerativeEditMode, GenerativeEditModeCapabilities>;
  resourceProfile: GenerativeEditResourceProfile;
  reason?: string;
}

export interface GenerativeEditProgress {
  stage: 'preparing' | 'generating' | 'compositing';
  progress: number;
}

export interface GenerativeEditRequest {
  mode: GenerativeEditMode;
  imageData: ImageData;
  /** 0 keeps source pixels; 255 edits them. Mask is in source-image pixels. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  maskOffsetX?: number;
  maskOffsetY?: number;
  quality: GenerativeEditQuality;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  strength?: number;
  steps?: number;
  guidanceScale?: number;
  /** Separate image-conditioning guidance used by local inpainting models. */
  imageGuidanceScale?: number;
  outputWidth?: number;
  outputHeight?: number;
  contextPadding?: number;
  /** Opaque handle for a qualified native prompt-capable model. */
  modelHandle?: string;
  modelPath?: string;
  modelId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: GenerativeEditProgress) => void;
  /** Called before and after inference to prevent stale results being applied. */
  isCurrent?: () => boolean;
}

export interface GenerativeEditResult {
  imageData: ImageData;
  width: number;
  height: number;
  filledBounds: ContentAwareFillResult['filledBounds'];
  mode: GenerativeEditMode;
  quality: GenerativeEditQuality;
  provider: GenerativeEditProvider;
  processingTimeMs: number;
  warnings: string[];
}

export type GenerativeEditErrorCode =
  | 'unsupported-mode'
  | 'prompt-unavailable'
  | 'unsupported-runtime'
  | 'invalid-image'
  | 'invalid-mask'
  | 'empty-mask'
  | 'missing-model'
  | 'insufficient-memory'
  | 'device-loss'
  | 'timeout'
  | 'runtime-failure'
  | 'cancelled'
  | 'stale';

export class GenerativeEditError extends Error {
  readonly code: GenerativeEditErrorCode;

  constructor(code: GenerativeEditErrorCode, message: string) {
    super(message);
    this.name = 'GenerativeEditError';
    this.code = code;
  }
}
