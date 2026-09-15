import { isTauriRuntime } from '@varve/platform';
import { decodeMaskBytes, decodeMaskDataUrl } from '../maskDecode';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';

export { isTauriRuntime };

import { nativeModelIdForOptions } from '../modelSelection';
import type { RemovalProvider } from './types';

/** Wire-format response from the Rust `remove_background` Tauri command. */
interface TauriBgRemoveResponse {
  maskBase64: string;
  confidence: number;
  method: string;
  processingTimeMs: number;
  width: number;
  height: number;
  /** Present on runtimes with provider reporting. */
  executionProvider?: string;
}

interface TauriBgRemoveMetadata {
  confidence: number;
  method: string;
  processingTimeMs: number;
  width: number;
  height: number;
  executionProvider?: string;
}

const BG_REMOVE_BINARY_MAGIC = [0x56, 0x42, 0x47, 0x31] as const;

function arrayBufferForBytes(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function responseBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
    return Uint8Array.from(value);
  }
  return null;
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function parseNativeResponse(value: unknown): {
  metadata: TauriBgRemoveMetadata;
  maskBytes?: Uint8Array;
  maskDataUrl?: string;
} {
  const bytes = responseBytes(value);
  if (!bytes) {
    // Keep a narrow compatibility adapter for older desktop binaries. The
    // current command returns the binary envelope below; this branch is not
    // used by the installed build after it has been updated.
    const legacy = value as Partial<TauriBgRemoveResponse> | null;
    if (!legacy || typeof legacy.maskBase64 !== 'string') {
      throw new Error('Native background-removal response is not binary');
    }
    return {
      metadata: {
        confidence: Number(legacy.confidence),
        method: String(legacy.method),
        processingTimeMs: Number(legacy.processingTimeMs),
        width: Number(legacy.width),
        height: Number(legacy.height),
        executionProvider: legacy.executionProvider,
      },
      maskDataUrl: `data:image/png;base64,${legacy.maskBase64}`,
    };
  }

  if (bytes.length < 8 || BG_REMOVE_BINARY_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('Native background-removal response has an invalid binary header');
  }
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    4,
    true,
  );
  const metadataStart = 8;
  const maskStart = metadataStart + metadataLength;
  if (metadataLength > 64 * 1024 || maskStart > bytes.length || maskStart === bytes.length) {
    throw new Error('Native background-removal response has invalid metadata or mask length');
  }
  let metadata: TauriBgRemoveMetadata;
  try {
    metadata = JSON.parse(
      new TextDecoder().decode(bytes.subarray(metadataStart, maskStart)),
    ) as TauriBgRemoveMetadata;
  } catch {
    throw new Error('Native background-removal metadata is invalid');
  }
  if (
    !Number.isFinite(metadata.width) ||
    !Number.isFinite(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0 ||
    typeof metadata.method !== 'string'
  ) {
    throw new Error('Native background-removal metadata is incomplete');
  }
  const maskBytes = bytes.subarray(maskStart);
  return { metadata, maskBytes };
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
 * in". See crates/varve-bgremove/src/runtime.rs and
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

/**
 * Check the native model and source dimensions before the renderer creates a
 * full-resolution canvas and PNG. The Rust command repeats this check inside
 * the worker immediately before ONNX session checkout; the early call exists
 * specifically to protect the webview allocation on low-memory ChromeOS,
 * ARM, and embedded desktop environments.
 */
export async function preflightNativeBackgroundRemoval(
  modelId: string,
  width: number,
  height: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('preflight_native_background_removal', { modelId, width, height });
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

  const modelId = nativeModelIdForOptions(options);
  if (modelId) {
    await preflightNativeBackgroundRemoval(modelId, imageData.width, imageData.height);
    if (signal?.aborted) {
      throw new Error('cancelled');
    }
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
  const raw = await invoke<unknown>('remove_background_binary', arrayBufferForBytes(bytes), {
    headers: {
      'x-varve-bg-remove-options': JSON.stringify({
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
      }),
    },
  });

  const parsed = parseNativeResponse(raw);
  if (parsed.metadata.method !== options.method) {
    throw new Error(
      `Native background removal returned '${parsed.metadata.method}' for '${options.method}' request`,
    );
  }
  const maskDataUrl = parsed.maskBytes ? bytesToDataUrl(parsed.maskBytes) : parsed.maskDataUrl!;
  const decoded = parsed.maskBytes
    ? await decodeMaskBytes(parsed.maskBytes)
    : await decodeMaskDataUrl(maskDataUrl);
  if (decoded.width !== parsed.metadata.width || decoded.height !== parsed.metadata.height) {
    throw new Error(
      `Native mask dimensions ${decoded.width}x${decoded.height} do not match response ${parsed.metadata.width}x${parsed.metadata.height}`,
    );
  }
  return {
    maskDataUrl,
    confidence: parsed.metadata.confidence,
    method: options.method,
    processingTimeMs: parsed.metadata.processingTimeMs,
    width: parsed.metadata.width,
    height: parsed.metadata.height,
    // The Rust result reports which provider actually produced the mask
    // (`native-webgpu` when the WebGPU plugin EP ran the session). Older
    // runtimes omit the field; keep the generic `native` label then.
    executionProvider:
      parsed.metadata.executionProvider === 'native-webgpu'
        ? 'native-webgpu'
        : parsed.metadata.executionProvider === 'native-cpu'
          ? 'native-cpu'
          : 'native',
    modelId: modelId ?? undefined,
    rawMask: decoded.mask,
  };
}

export const tauriRemovalProvider: RemovalProvider = {
  id: 'tauri-native',

  async isAvailable(options: BackgroundRemovalOptions, _signal?: AbortSignal): Promise<boolean> {
    const modelId = nativeModelIdForOptions(options);
    if (!modelId) return false;
    const status = await getNativeBackgroundRemovalModelStatus(modelId);
    return Boolean(status?.runtimeReady && status.installed);
  },

  remove(imageData, options, signal) {
    return invokeTauriRemoveBackground(imageData, options, signal);
  },
};
