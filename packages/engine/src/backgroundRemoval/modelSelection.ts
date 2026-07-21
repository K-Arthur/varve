import type { ModelPrecision } from '../inference/types';
import { isInt8FasterOnThisCpu } from './precisionCapabilities';
import type { InferenceQualityPreference, RemovalMethod, WorkerModelId } from './types';
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
