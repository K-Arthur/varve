import type { RemovalMethod, WorkerModelId } from './types';
import { preferredWorkerModelIdForMethod, workerModelIdForMethod } from './types';

export interface ResolvedWebModel {
  modelId: WorkerModelId;
  modelPath: string;
}

/** Prefer the enhanced model only when its bytes are actually web-reachable. */
export async function resolveWebModel(
  method: RemovalMethod,
  loader: {
    getModelPath(modelId: string, signal?: AbortSignal): Promise<string | null>;
    hasDownloadedBlob?(modelId: string): Promise<boolean>;
  },
  signal?: AbortSignal,
): Promise<ResolvedWebModel | null> {
  const preferred = preferredWorkerModelIdForMethod(method);
  const fallback = workerModelIdForMethod(method);
  if (!fallback) return null;

  if (preferred && preferred !== fallback) {
    const explicitlyDownloaded = await loader.hasDownloadedBlob?.(preferred);
    if (explicitlyDownloaded) {
      const preferredPath = await loader.getModelPath(preferred, signal);
      if (preferredPath) return { modelId: preferred, modelPath: preferredPath };
    }
  }

  const fallbackPath = await loader.getModelPath(fallback, signal);
  return fallbackPath ? { modelId: fallback, modelPath: fallbackPath } : null;
}
