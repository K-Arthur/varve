import type { ContentAwareFillResult } from '../contentAwareFill';

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

export interface GenerativeEditProvider {
  kind: GenerativeEditProviderKind;
  id: string;
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: GenerativeEditRuntime;
}

export interface GenerativeEditCapabilities {
  fill: boolean;
  remove: boolean;
  replace: boolean;
  expand: boolean;
  prompt: boolean;
  variations: boolean;
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
