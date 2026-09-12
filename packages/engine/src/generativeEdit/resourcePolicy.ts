import {
  estimateInferenceReservation,
  getRuntimeCapabilitiesSync,
  type RuntimeCapabilities,
} from '../inference';
import type {
  GenerativeEditExecutionBackend,
  GenerativeEditMode,
  GenerativeEditQuality,
  GenerativeEditResourceProfile,
  GenerativeEditResourceTier,
} from './types';

const BYTES_PER_GIB = 1024 ** 3;
const LAMA_MODEL_BYTES = 208_044_816;
const NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES = 6 * BYTES_PER_GIB;

export interface GenerativeEditResourceAssessment {
  allowed: boolean;
  estimatedPeakBytes: number;
  reason?: string;
  reasonCode?: 'insufficient-memory';
  fallback: 'quick-cleanup' | 'content-aware-fill' | 'none';
}

function browserReportsDeviceMemory(): boolean {
  if (typeof navigator === 'undefined') return false;
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function classifyMemory(memoryBytes: number | undefined): GenerativeEditResourceTier {
  if (memoryBytes === undefined) return 'unknown';
  if (memoryBytes < 4 * BYTES_PER_GIB) return 'constrained';
  if (memoryBytes < 8 * BYTES_PER_GIB) return 'standard';
  return 'high';
}

function executionBackend(runtime: RuntimeCapabilities): GenerativeEditExecutionBackend {
  if (runtime.isTauri) return 'native';
  if (runtime.hasWebGPU) return 'webgpu';
  if (runtime.hasWorker || runtime.preferredOnnxProviders.includes('wasm')) return 'wasm';
  return 'unknown';
}

/**
 * Build the renderer-visible resource profile without pretending that a
 * browser can measure all system memory. Native desktop memory must be
 * rechecked by the native command immediately before loading a model.
 */
export function getGenerativeEditResourceProfile(
  runtime: RuntimeCapabilities = getRuntimeCapabilitiesSync(),
): GenerativeEditResourceProfile {
  const memoryBytes =
    !runtime.isTauri && browserReportsDeviceMemory() && runtime.approximateMemoryMB
      ? runtime.approximateMemoryMB * 1_000_000
      : undefined;
  const tier = runtime.isTauri ? 'unknown' : classifyMemory(memoryBytes);
  const backend = executionBackend(runtime);
  const architecture = runtime.cpuArch;
  const shared = {
    tier,
    executionBackend: backend,
    ...(architecture ? { architecture } : {}),
    ...(memoryBytes ? { approximateMemoryBytes: memoryBytes } : {}),
    ...(!runtime.isTauri && runtime.wasmSafePeakBytes > 0
      ? { safePeakBytes: runtime.wasmSafePeakBytes }
      : {}),
    ...(!runtime.isTauri && runtime.wasmSafeModelBytes > 0
      ? { safeModelBytes: runtime.wasmSafeModelBytes }
      : {}),
  } satisfies Omit<GenerativeEditResourceProfile, 'summary'>;

  if (runtime.isTauri) {
    return {
      ...shared,
      summary:
        'Desktop memory is checked before model loading; use Quick Cleanup when the measured reservation does not fit.',
    };
  }
  if (tier === 'constrained') {
    return {
      ...shared,
      summary:
        'Constrained browser memory: Quick Cleanup and lightweight masking are preferred; larger models may be refused before allocation.',
    };
  }
  if (tier === 'unknown') {
    return {
      ...shared,
      summary:
        'Browser memory is not exposed by this runtime; model safety is checked by the provider before inference.',
    };
  }
  return {
    ...shared,
    summary:
      backend === 'webgpu'
        ? 'Browser WebGPU is available for qualified lightweight models; model fit and quality still require a provider check.'
        : 'Browser CPU inference is available for bounded local models; larger models may require Quick Cleanup.',
  };
}

function modelBytesForRequest(options: {
  requiresDiffusion: boolean;
  quality: GenerativeEditQuality;
}): number {
  if (options.requiresDiffusion) return NATIVE_DIFFUSION_MINIMUM_MEMORY_BYTES;
  return options.quality === 'quality' ? LAMA_MODEL_BYTES : 0;
}

/**
 * Conservative preflight for model-backed paths. Unknown native memory is
 * deliberately allowed through here because the desktop command performs the
 * authoritative OS-level check; browser/WASM paths are rejected when their
 * reported safe peak cannot contain the complete working set.
 */
export function assessGenerativeEditResources(options: {
  mode: GenerativeEditMode;
  width: number;
  height: number;
  outputWidth?: number;
  outputHeight?: number;
  quality: GenerativeEditQuality;
  requiresDiffusion: boolean;
  profile?: GenerativeEditResourceProfile;
}): GenerativeEditResourceAssessment {
  const profile = options.profile ?? getGenerativeEditResourceProfile();
  const modelBytes = modelBytesForRequest(options);
  const estimatedPeakBytes = estimateInferenceReservation({
    width: options.width,
    height: options.height,
    outputWidth: options.outputWidth,
    outputHeight: options.outputHeight,
    modelBytes,
    workingSetMultiplier: options.requiresDiffusion ? 4 : options.quality === 'quality' ? 4 : 2,
  });

  if (modelBytes === 0 || profile.executionBackend === 'native' || profile.tier === 'unknown') {
    return { allowed: true, estimatedPeakBytes, fallback: 'none' };
  }

  const safePeakBytes = profile.safePeakBytes;
  if (safePeakBytes !== undefined && estimatedPeakBytes > safePeakBytes) {
    const safeMiB = Math.floor(safePeakBytes / (1024 * 1024));
    const estimateMiB = Math.ceil(estimatedPeakBytes / (1024 * 1024));
    return {
      allowed: false,
      estimatedPeakBytes,
      reasonCode: 'insufficient-memory',
      reason: `This device's safe inference budget is ${safeMiB} MiB, but this request may need about ${estimateMiB} MiB. Use Quick Cleanup or a smaller bounded region.`,
      fallback: options.requiresDiffusion ? 'content-aware-fill' : 'quick-cleanup',
    };
  }

  return { allowed: true, estimatedPeakBytes, fallback: 'none' };
}
