/**
 * Native (Tauri) download bridge for generic inference models.
 *
 * Browser `fetch` cannot read GitHub release assets because they carry no
 * CORS headers; the desktop app downloads them in Rust instead, verifies the
 * catalog SHA-256 before exposing them, and returns a path that the loader
 * converts to a Tauri asset URL for the ONNX worker.
 *
 * Every function is a no-op outside Tauri so the web build keeps using the
 * existing IndexedDB path.
 */
import { isTauriRuntime } from '@varve/platform';

export interface NativeInferenceModelDownloadOptions {
  requestId: string;
  modelId: string;
  url: string;
  sha256: string;
  sizeBytes?: number;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

interface NativeInferenceProgress {
  requestId: string;
  modelId: string;
  loaded: number;
  total: number;
}

/** Absolute path of an installed native inference model, if any. */
export async function nativeInferenceModelPath(modelId: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('inference_model_path', { modelId });
    return path ?? null;
  } catch {
    return null;
  }
}

/**
 * Download and verify a model through the native command. Resolves with the
 * installed file path; rejects when the download is cancelled, incomplete, or
 * fails hash verification.
 */
export async function nativeDownloadInferenceModel(
  options: NativeInferenceModelDownloadOptions,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('Native model downloads are only available on desktop');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const cancel = () => {
    void invoke('cancel_inference_model_download', {
      requestId: options.requestId,
    }).catch(() => undefined);
  };
  // Register before awaiting the listener so an abort that lands during setup
  // is still forwarded to the native command.
  options.signal?.addEventListener('abort', cancel);
  if (options.signal?.aborted) {
    options.signal.removeEventListener('abort', cancel);
    throw new Error('Download cancelled');
  }
  const unlisten = await listen<NativeInferenceProgress>('inference-model-progress', (event) => {
    if (event.payload.requestId !== options.requestId) return;
    options.onProgress?.(event.payload.loaded, event.payload.total);
  });
  try {
    return await invoke<string>('download_inference_model', {
      requestId: options.requestId,
      modelId: options.modelId,
      url: options.url,
      sha256: options.sha256,
      sizeBytes: options.sizeBytes ?? null,
    });
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    unlisten();
  }
}

export async function nativeDeleteInferenceModel(modelId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('delete_inference_model', { modelId });
  } catch {
    return false;
  }
}
