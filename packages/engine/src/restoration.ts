/**
 * Shared contracts for image restoration and enhancement.
 *
 * User operations intentionally stay separate from model identifiers.  A
 * checkpoint is only advertised for the task it was trained and validated for;
 * an architecture name is not a capability.
 */

export type RestorationTask = 'denoise' | 'deblur' | 'compression-restoration' | 'upscale';

export type RestorationOperation =
  | 'none'
  | 'denoise'
  | 'deblur'
  | 'compression-restoration'
  | 'upscale'
  | 'restore-upscale'
  | 'deblur-upscale';

export type RestorationRuntime = 'onnx-native' | 'onnx-web' | 'classical-cpu';

export type CapabilityStatus = 'available' | 'not-validated' | 'unsupported';

export interface RestorationCapability {
  /** Stable internal identifier for the validated implementation. */
  id: string;
  task: RestorationTask;
  family: string;
  architecture: string;
  variant: string;
  revision: string;
  source: string;
  sourceUrl: string;
  license: string;
  redistribution: 'verified' | 'pending' | 'not-permitted';
  runtime: RestorationRuntime;
  modelSizeBytes: number;
  sha256?: string;
  inputChannels: 1 | 3 | 4;
  inputRange: '[0,1]' | '[-1,1]' | 'uint8';
  paddingMultiple: number;
  outputScale: number;
  peakMemoryBytes: number;
  qualityTier: 'faithful' | 'balanced' | 'experimental';
  status: CapabilityStatus;
  /** Human-readable reason when the capability is not available. */
  statusReason?: string;
}

/** The validated model/runtime inventory used by planning and diagnostics. */
export const RESTORATION_CAPABILITIES: readonly RestorationCapability[] = [
  {
    id: 'scunet',
    task: 'denoise',
    family: 'SCUNet',
    architecture: 'SCUNet color real PSNR',
    variant: 'real-world denoising',
    revision: 'Heliosoph/scunet-onnx @ pinned manifest hash',
    source: 'Heliosoph/scunet-onnx',
    sourceUrl: 'https://huggingface.co/Heliosoph/scunet-onnx',
    license: 'Apache-2.0',
    redistribution: 'verified',
    runtime: 'onnx-native',
    modelSizeBytes: 76_936_854,
    sha256: '231be201ab413dbc999d7951caa9844846b93a12a40a41e037d6b5888ed4e88c',
    inputChannels: 3,
    inputRange: '[0,1]',
    // The Heliosoph conversion's baked window-8 attention reshape requires
    // padded dims divisible by 64 (verified by dimension sweep 2026-08-13);
    // the manifest previously claimed 8 and crashed on e.g. 1080p inputs.
    paddingMultiple: 64,
    outputScale: 1,
    peakMemoryBytes: 280_000_000,
    qualityTier: 'faithful',
    status: 'available',
  },
  {
    id: 'nafnet-deblur-gopro',
    task: 'deblur',
    family: 'NAFNet',
    architecture: 'NAFNet width64 (enc 1,1,1,28 / middle 1 / dec 1,1,1,1)',
    variant: 'GoPro motion/defocus deblurring',
    revision: 'megvii-research/NAFNet @ 2b4af71 (official checkpoint)',
    source: 'megvii-research/NAFNet',
    sourceUrl: 'https://github.com/megvii-research/NAFNet',
    license: 'MIT',
    redistribution: 'verified',
    runtime: 'onnx-native',
    modelSizeBytes: 138_050_767,
    sha256: 'e9b82a578b6ddf47a3f22118da65d13a4459b53e6c0e5fcf41f5615eadf92f5e',
    inputChannels: 3,
    inputRange: '[0,1]',
    paddingMultiple: 16,
    outputScale: 1,
    peakMemoryBytes: 420_000_000,
    qualityTier: 'faithful',
    status: 'available',
    statusReason:
      'BGR channel order (official training convention); the runtime swaps channels at the boundary. Validated for deblur only.',
  },
  {
    id: 'upscale-realesr-general',
    task: 'upscale',
    family: 'Real-ESRGAN',
    architecture: 'Real-ESRGAN general x4',
    variant: 'general-purpose super-resolution',
    revision: 'v0.2.5.0 / x4v3',
    source: 'xinntao/Real-ESRGAN',
    sourceUrl: 'https://github.com/xinntao/Real-ESRGAN',
    license: 'BSD-3-Clause',
    redistribution: 'verified',
    runtime: 'onnx-native',
    modelSizeBytes: 4_866_438,
    sha256: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    inputChannels: 3,
    inputRange: '[0,1]',
    paddingMultiple: 1,
    outputScale: 4,
    peakMemoryBytes: 17_032_533,
    qualityTier: 'balanced',
    status: 'available',
  },
  {
    id: 'upscale-realesrgan-anime',
    task: 'upscale',
    family: 'Real-ESRGAN',
    architecture: 'Real-ESRGAN anime x4 (6B)',
    variant: 'anime/illustration super-resolution',
    revision: 'v0.2.2.4 / x4plus_anime_6B, ONNX via deepghs/imgutils-models, SHA-256 pinned',
    source: 'xinntao/Real-ESRGAN (community ONNX export)',
    sourceUrl:
      'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx',
    license: 'BSD-3-Clause',
    redistribution: 'verified',
    runtime: 'onnx-native',
    modelSizeBytes: 17_906_556,
    sha256: '2648cab4c4343541c1aa291c6754e9e8edbe7a813fffc2a677423dd12cb6b7f7',
    inputChannels: 3,
    inputRange: '[0,1]',
    paddingMultiple: 1,
    outputScale: 4,
    peakMemoryBytes: 22_000_000,
    qualityTier: 'balanced',
    status: 'available',
    statusReason:
      'Dimension sweep passes all tested sizes (1-513px). 5.9x sharper than general model on block-edge content. No padding constraint. Uploaded to varve-models-v1 release.',
  },
];

const TASK_LABELS: Record<RestorationTask, string> = {
  denoise: 'Denoise',
  deblur: 'Deblur',
  'compression-restoration': 'Remove compression artifacts',
  upscale: 'Upscale',
};

export function restorationTaskLabel(task: RestorationTask): string {
  return TASK_LABELS[task];
}

export function capabilitiesForTask(task: RestorationTask): RestorationCapability[] {
  return RESTORATION_CAPABILITIES.filter((capability) => capability.task === task);
}

export function firstAvailableCapability(task: RestorationTask): RestorationCapability | null {
  return (
    capabilitiesForTask(task).find(
      (capability) => capability.status === 'available' && capability.redistribution === 'verified',
    ) ?? null
  );
}

export interface RestorationRequest {
  operation: RestorationOperation;
  denoise?: {
    strength: 'light' | 'medium' | 'strong';
    modelId?: string;
  };
  deblur?: {
    /** Output blend strength (0-1). 0 = source only, 1 = full deblur. */
    strength: number;
    modelId?: string;
  };
  upscale?: {
    method: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3' | 'ai' | 'pixel-art';
    scale: number;
    modelId?: string;
    pixelArtAlgorithm?: import('./pixelArtScaling').PixelArtAlgorithm;
  };
  /** Conservative behavior is the product default for design assets. */
  qualityPolicy?: 'faithful' | 'balanced';
  preview?: boolean;
  previewMaxDimension?: number;
}

export interface RestorationStagePlan {
  id: string;
  task: RestorationTask;
  modelId?: string;
  runtime?: RestorationRuntime;
  status: 'ready' | 'unsupported';
  reason?: string;
}

export interface RestorationPlan {
  operation: RestorationOperation;
  stages: RestorationStagePlan[];
  warnings: string[];
}

export class RestorationPlanningError extends Error {
  readonly code: 'unsupported-operation' | 'invalid-request' | 'model-unavailable';

  constructor(code: RestorationPlanningError['code'], message: string) {
    super(message);
    this.name = 'RestorationPlanningError';
    this.code = code;
  }
}

/** Execution-side restoration failure taxonomy (see the enhance error policy). */
export type RestorationErrorCode =
  | 'model-not-installed'
  | 'model-download-failed'
  | 'hash-mismatch'
  | 'unsupported-operation'
  | 'unsupported-runtime'
  | 'runtime-unavailable'
  | 'tensor-allocation'
  | 'invalid-image'
  | 'invalid-request'
  | 'dimension-limit'
  | 'provider-failed'
  | 'cancelled'
  | 'stale-result';

export const RESTORATION_ERROR_CODES: readonly RestorationErrorCode[] = [
  'model-not-installed',
  'model-download-failed',
  'hash-mismatch',
  'unsupported-operation',
  'unsupported-runtime',
  'runtime-unavailable',
  'tensor-allocation',
  'invalid-image',
  'invalid-request',
  'dimension-limit',
  'provider-failed',
  'cancelled',
  'stale-result',
];

export function isRestorationErrorCode(value: string): value is RestorationErrorCode {
  return (RESTORATION_ERROR_CODES as readonly string[]).includes(value);
}

export class RestorationError extends Error {
  readonly code: RestorationErrorCode;

  constructor(code: RestorationErrorCode, message: string) {
    super(message);
    this.name = 'RestorationError';
    this.code = code;
  }
}

/**
 * Classify a thrown value into a typed restoration failure without losing the
 * human-readable message. The native backend rejects with bare strings, so a
 * code is only assigned when the message matches a known pattern; everything
 * else is `provider-failed`.
 */
export function toRestorationError(caught: unknown): RestorationError {
  if (caught instanceof RestorationPlanningError) {
    const code: RestorationErrorCode =
      caught.code === 'unsupported-operation'
        ? 'unsupported-operation'
        : caught.code === 'model-unavailable'
          ? 'model-not-installed'
          : 'invalid-request';
    return new RestorationError(code, caught.message);
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/^cancelled$|^inference cancelled$/i.test(message.trim())) {
    return new RestorationError('cancelled', message);
  }
  if (/not downloaded|model.*not found|not installed/i.test(message)) {
    return new RestorationError('model-not-installed', message);
  }
  if (/checksum|hash mismatch|verification failed/i.test(message)) {
    return new RestorationError('hash-mismatch', message);
  }
  if (/dimension|too large|16384|megapixel/i.test(message)) {
    return new RestorationError('dimension-limit', message);
  }
  if (/allocation|out of memory|OOM|allocate/i.test(message)) {
    return new RestorationError('tensor-allocation', message);
  }
  if (/runtime|worker|wasm|native ai/i.test(message)) {
    return new RestorationError('runtime-unavailable', message);
  }
  if (/stale|source changed/i.test(message)) {
    return new RestorationError('stale-result', message);
  }
  return new RestorationError('provider-failed', message);
}

/** The tasks a user operation requires, if any (an operation maps to one or two tasks). */
export function restorationTasksForOperation(operation: RestorationOperation): RestorationTask[] {
  switch (operation) {
    case 'none':
      return [];
    case 'denoise':
      return ['denoise'];
    case 'restore-upscale':
      return ['denoise', 'upscale'];
    case 'deblur-upscale':
      return ['deblur', 'upscale'];
    case 'deblur':
      return ['deblur'];
    case 'compression-restoration':
      return ['compression-restoration'];
    case 'upscale':
      return ['upscale'];
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

/**
 * Whether a user operation can be planned on this installation, derived from
 * the validated capability registry rather than hardcoded per-operation rules.
 */
export function isRestorationOperationAvailable(operation: RestorationOperation): boolean {
  const tasks = restorationTasksForOperation(operation);
  return tasks.every((task) => firstAvailableCapability(task) !== null);
}

function capabilityForRequestedTask(task: RestorationTask, modelId?: string) {
  const capability = modelId
    ? capabilitiesForTask(task).find((candidate) => candidate.id === modelId)
    : firstAvailableCapability(task);
  if (!capability) {
    throw new RestorationPlanningError(
      task === 'deblur' || task === 'compression-restoration'
        ? 'unsupported-operation'
        : 'model-unavailable',
      `${restorationTaskLabel(task)} is not available for this installation`,
    );
  }
  if (capability.status !== 'available' || capability.redistribution !== 'verified') {
    throw new RestorationPlanningError(
      'model-unavailable',
      capability.statusReason ?? `${capability.family} is not available for this installation`,
    );
  }
  return capability;
}

function validateScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RestorationPlanningError('invalid-request', 'Upscale scale must be positive');
  }
}

function validateStrength(strength: number | undefined): void {
  if (strength === undefined) return;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RestorationPlanningError(
      'invalid-request',
      'Restoration strength must be a finite number between 0 and 1',
    );
  }
}

/** Build a lazy, truthful execution plan without loading any model. */
export function planRestoration(request: RestorationRequest): RestorationPlan {
  const warnings: string[] = [];
  if (request.operation === 'none') return { operation: 'none', stages: [], warnings };

  const stages: RestorationStagePlan[] = [];
  const addStage = (task: RestorationTask, modelId?: string) => {
    const capability = capabilityForRequestedTask(task, modelId);
    stages.push({
      id: task,
      task,
      modelId: capability.id,
      runtime: capability.runtime,
      status: 'ready',
    });
  };

  switch (request.operation) {
    case 'denoise':
      addStage('denoise', request.denoise?.modelId);
      break;
    case 'upscale':
      if (!request.upscale) {
        throw new RestorationPlanningError('invalid-request', 'Upscale settings are required');
      }
      validateScale(request.upscale.scale);
      if (request.upscale.method === 'ai') addStage('upscale', request.upscale.modelId);
      else stages.push({ id: 'upscale', task: 'upscale', status: 'ready' });
      break;
    case 'restore-upscale':
      addStage('denoise', request.denoise?.modelId);
      if (!request.upscale) {
        throw new RestorationPlanningError('invalid-request', 'Upscale settings are required');
      }
      validateScale(request.upscale.scale);
      if (request.upscale.method === 'ai') addStage('upscale', request.upscale.modelId);
      else stages.push({ id: 'upscale', task: 'upscale', status: 'ready' });
      warnings.push(
        'Restoration runs before super-resolution so the upscale does not enlarge noise.',
      );
      break;
    case 'deblur-upscale':
      validateStrength(request.deblur?.strength);
      addStage('deblur');
      if (!request.upscale) {
        throw new RestorationPlanningError('invalid-request', 'Upscale settings are required');
      }
      validateScale(request.upscale.scale);
      if (request.upscale.method === 'ai') addStage('upscale', request.upscale.modelId);
      else stages.push({ id: 'upscale', task: 'upscale', status: 'ready' });
      warnings.push(
        'Restoration runs before super-resolution so the upscale does not enlarge blur.',
      );
      break;
    case 'deblur':
      validateStrength(request.deblur?.strength);
      addStage('deblur');
      break;
    case 'compression-restoration':
      addStage('compression-restoration');
      break;
    default: {
      const exhaustive: never = request.operation;
      throw new RestorationPlanningError('invalid-request', `Unknown operation: ${exhaustive}`);
    }
  }

  return { operation: request.operation, stages, warnings };
}
