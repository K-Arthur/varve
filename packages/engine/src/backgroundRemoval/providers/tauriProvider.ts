import { isTauriRuntime } from '@varve/platform';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';

export { isTauriRuntime };

import { preferredWorkerModelIdForMethod } from '../types';
import type { RemovalProvider } from './types';

/** Wire-format response from the Rust `remove_background` Tauri command. */
interface TauriBgRemoveResponse {
  maskBase64: string;
  confidence: number;
  method: string;
  processingTimeMs: number;
  width: number;
  height: number;
}

interface NativeModelStatus {
  runtimeReady: boolean;
  installed: boolean;
  sizeBytes: number;
}

interface NativeModelProgress {
  requestId: string;
  modelId: string;
  loaded: number;
  total: number;
}

/**
 * Whether native ONNX inference is actually usable right now — a
 * runtime-verified check (the Rust side confirms the bundled onnxruntime
 * dylib loaded successfully), not just "the ai Cargo feature was compiled
 * in". See crates/strata-bgremove/src/runtime.rs and
 * docs/audits/background-removal-wasm-memory-hardening-2026-07-18.md for
 * why this distinction matters: a build with `ai` on but a missing dylib
 * for this platform must report `false` here, or the dispatch chain would
 * keep preferring a native path that fails every time.
 *
 * Not cached: this is only called once per ai-quality dispatch (see
 * dispatch.ts), and the underlying Rust state can't change mid-session
 * anyway (native_ai_ready() is set once at app startup), so caching would
 * only save a fast in-process IPC round-trip at the cost of staleness risk.
 */
export async function isNativeAiReady(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('native_ai_status');
  } catch {
    return false;
  }
}

export async function getNativeBackgroundRemovalModelStatus(
  modelId: string,
): Promise<NativeModelStatus | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<NativeModelStatus>('native_background_removal_model_status', { modelId });
  } catch {
    return null;
  }
}

export async function downloadNativeBackgroundRemovalModel(
  modelId: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Native model downloads require the Tauri desktop app');
  if (signal?.aborted) throw new Error('Download cancelled');
  const requestId = crypto.randomUUID();
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<NativeModelProgress>(
    'background-removal-model-progress',
    ({ payload }) => {
      if (payload.requestId === requestId) onProgress?.(payload.loaded, payload.total);
    },
  );
  const cancel = () => {
    void invoke('cancel_background_removal_model_download', { requestId });
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await invoke<number>('download_background_removal_model', { requestId, modelId });
    if (signal?.aborted) throw new Error('Download cancelled');
  } finally {
    signal?.removeEventListener('abort', cancel);
    unlisten();
  }
}

export async function deleteNativeBackgroundRemovalModel(modelId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('delete_background_removal_model', { modelId });
}

async function invokeTauriRemoveBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<TauriBgRemoveResponse>('remove_background', {
    imageData: Array.from(bytes),
    options: {
      method: options.method,
      tolerance: options.tolerance,
      featherRadius: options.feather,
      // Default must match the worker/direct providers: decontamination is
      // an explicit opt-in mask operation, not an implicit native default.
      // The UI always passes the checkbox value explicitly.
      decontaminate: options.decontaminate ?? false,
      clickX: options.clickPoint?.x,
      clickY: options.clickPoint?.y,
      previewMaxDimension: options.previewMaxDimension,
    },
  });

  if (raw.method !== options.method) {
    throw new Error(
      `Native background removal returned '${raw.method}' for '${options.method}' request`,
    );
  }
  const maskDataUrl = `data:image/png;base64,${raw.maskBase64}`;
  const { decodeMaskDataUrl } = await import('../maskDecode');
  const decoded = await decodeMaskDataUrl(maskDataUrl);
  if (decoded.width !== raw.width || decoded.height !== raw.height) {
    throw new Error(
      `Native mask dimensions ${decoded.width}x${decoded.height} do not match response ${raw.width}x${raw.height}`,
    );
  }
  return {
    maskDataUrl,
    confidence: raw.confidence,
    method: options.method,
    processingTimeMs: raw.processingTimeMs,
    width: raw.width,
    height: raw.height,
    executionProvider: 'native',
    modelId: preferredWorkerModelIdForMethod(options.method) ?? undefined,
    rawMask: decoded.mask,
  };
}

export const tauriRemovalProvider: RemovalProvider = {
  id: 'tauri-native',

  async isAvailable(options: BackgroundRemovalOptions, _signal?: AbortSignal): Promise<boolean> {
    const modelId = preferredWorkerModelIdForMethod(options.method);
    if (!modelId) return false;
    const status = await getNativeBackgroundRemovalModelStatus(modelId);
    return Boolean(status?.runtimeReady && status.installed);
  },

  remove(imageData, options, signal) {
    return invokeTauriRemoveBackground(imageData, options, signal);
  },
};
