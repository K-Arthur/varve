import { getModelById } from '../inference/modelCatalog';
import type { ModelPrecision } from '../inference/types';
import { isInt8FasterOnThisCpu } from './precisionCapabilities';
import type {
  BackgroundRemovalOptions,
  InferenceQualityPreference,
  RemovalMethod,
  WorkerModelId,
} from './types';
import { preferredWorkerModelIdForMethod, workerModelIdForMethod } from './types';

export interface ResolvedWebModel {
  modelId: WorkerModelId;
  modelPath: string;
  /** Weight precision of the resolved model (fp32 or int8). */
  precision?: ModelPrecision;
  /** True when the requested preference overrode the default model. */
  precisionAdjusted?: boolean;
  /** Human-readable reason for the selection (debugging/audit). */
  selectionReason?: string;
}

/** Prefer the enhanced model only when its bytes are actually web-reachable. */
export async function resolveWebModel(
  method: RemovalMethod,
  loader: {
    getModelPath(modelId: string, signal?: AbortSignal): Promise<string | null>;
    hasDownloadedBlob?(modelId: string): Promise<boolean>;
  },
  qualityPreference?: InferenceQualityPreference,
  signal?: AbortSignal,
): Promise<ResolvedWebModel | null> {
  const preferred = preferredWorkerModelIdForMethod(method);
  const fallback = workerModelIdForMethod(method);
  if (!fallback) return null;

  const pref = qualityPreference ?? 'automatic';

  // Check for user-downloaded preferred model (always FP32, user explicit choice)
  if (preferred && preferred !== fallback) {
    const explicitlyDownloaded = await loader.hasDownloadedBlob?.(preferred);
    if (explicitlyDownloaded) {
      const preferredPath = await loader.getModelPath(preferred, signal);
      if (preferredPath) {
        return {
          modelId: preferred,
          modelPath: preferredPath,
          precision: 'fp32',
          precisionAdjusted: false,
          selectionReason: 'User-downloaded preferred model',
        };
      }
    }
  }

  // For 'performance' preference: try INT8 variant, but only if hardware accelerates it
  let int8Faster = false;
  if (pref === 'performance') {
    try {
      int8Faster = await isInt8FasterOnThisCpu();
    } catch {
      // benchmark unavailable; assume FP32
    }
  }

  if (pref === 'performance' && int8Faster) {
    const int8ModelId = `${fallback}-int8` as WorkerModelId;
    const int8Path = await loader.getModelPath(int8ModelId, signal);
    if (int8Path) {
      return {
        modelId: int8ModelId,
        modelPath: int8Path,
        precision: 'int8',
        precisionAdjusted: true,
        selectionReason: `Performance preference, INT8 faster on this CPU: INT8 variant of ${fallback}`,
      };
    }
  }

  // Default: return FP32 fallback
  const fallbackPath = await loader.getModelPath(fallback, signal);
  if (!fallbackPath) return null;

  const precision: ModelPrecision = 'fp32';
  const precisionAdjusted = pref !== 'automatic';
  const reasons: string[] = [];
  if (pref === 'quality') reasons.push('Quality preference');
  if (pref === 'performance' && !int8Faster)
    reasons.push('Performance requested but INT8 not faster on this CPU');
  reasons.push(`FP32 ${fallback}`);
  const selectionReason = reasons.join(', ') || `Default FP32 fallback for ${fallback}`;

  return {
    modelId: fallback,
    modelPath: fallbackPath,
    precision,
    precisionAdjusted,
    selectionReason,
  };
}

/**
 * Resolve the model a request must run, honoring an explicit `modelId`.
 *
 * An explicit request is a contract: if the model's bytes are unreachable the
 * resolution returns null and the provider throws, rather than substituting
 * the method's preferred model. This is what keeps "Fast (U²-NetP)" from
 * silently becoming an installed IS-Net run.
 */
export async function resolveWebModelForOptions(
  options: Pick<BackgroundRemovalOptions, 'method' | 'qualityPreference' | 'modelId'>,
  loader: {
    getModelPath(modelId: string, signal?: AbortSignal): Promise<string | null>;
    hasDownloadedBlob?(modelId: string): Promise<boolean>;
  },
  signal?: AbortSignal,
): Promise<ResolvedWebModel | null> {
  if (options.modelId) {
    const path = await loader.getModelPath(options.modelId, signal);
    if (!path) return null;
    return {
      modelId: options.modelId,
      modelPath: path,
      precision: options.modelId.endsWith('-int8') ? 'int8' : 'fp32',
      precisionAdjusted: false,
      selectionReason: `Explicit model request: ${options.modelId}`,
    };
  }
  return resolveWebModel(options.method, loader, options.qualityPreference, signal);
}

/**
 * Native model for a request, or null when the native path must decline.
 *
 * The Rust bridge resolves its model from the *method*, so an explicit model
 * request may only use native execution when the requested model is exactly
 * the native model for that method. This keeps the no-substitution contract
 * without changing the native wire protocol.
 */
export function nativeModelIdForOptions(options: {
  method: RemovalMethod;
  modelId?: WorkerModelId;
}): WorkerModelId | null {
  const native = preferredWorkerModelIdForMethod(options.method);
  if (!options.modelId) return native;
  return options.modelId === native ? native : null;
}

/**
 * Peak working set for the model a request will actually run.
 *
 * The browser preflight in `removeBackground` used to assess every AI method
 * with the bundled u2netp peak (330 MB). When an installed IS-Net or BiRefNet
 * model is selected instead, that under-estimates the run, so the wasm32
 * linear-memory ceiling can abort the page before any provider reports an
 * error. Resolving the model first keeps the admission gate honest. Returns
 * null when nothing resolves; the caller then applies the bundled-model
 * fallback (which is also what dispatch would fall back to).
 */
export async function resolveWebModelPeakBytes(
  method: RemovalMethod,
  loader: {
    getModelPath(modelId: string, signal?: AbortSignal): Promise<string | null>;
    hasDownloadedBlob?(modelId: string): Promise<boolean>;
  },
  qualityPreference?: InferenceQualityPreference,
  signal?: AbortSignal,
  modelId?: WorkerModelId,
): Promise<{ modelId: WorkerModelId; peakMemoryBytes: number } | null> {
  if (method === 'quick') return null;
  const resolved = await resolveWebModelForOptions(
    { method, qualityPreference, modelId },
    loader,
    signal,
  );
  if (!resolved) return null;
  const peak = getModelById(resolved.modelId)?.peakMemoryBytes;
  if (typeof peak !== 'number' || !Number.isFinite(peak) || peak <= 0) return null;
  return { modelId: resolved.modelId, peakMemoryBytes: peak };
}
