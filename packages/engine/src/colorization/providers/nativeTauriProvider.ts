/**
 * Native Tauri inference provider — runs ONNX inference through Rust
 * via Tauri IPC commands. Uses the native ONNX Runtime library that
 * was bundled via scripts/fetch-onnxruntime.mjs.
 *
 * Falls back gracefully when:
 *   - Not running in Tauri (returns isAvailable = false)
 *   - Native ONNX Runtime dylib not loaded
 *   - Model not installed locally
 *
 * Architecture:
 *   JS main thread → Tauri invoke('native_infer', { modelType, modelPath, tensors })
 *   → Rust ort crate session.run() → serialized outputs → JS main thread
 *
 * The Rust side handles:
 *   - Session creation and LRU caching
 *   - Provider selection (CUDA/CoreML/DirectML/WASM)
 *   - Memory-bounded inference
 *   - Cancellation via AbortSignal-like mechanism
 *
 * Research basis:
 *   - Session 53: native ONNX Runtime bundling for BiRefNet
 *   - ADR-0005: provider chain with native-first preference
 */
import type {
  ColorizationRequestContract,
  ColorizationResultContract,
} from '../colorizationRequest';
import type { ColorizationProvider } from '../providerAbstraction';

const NATIVE_PROVIDER_ID = 'native-tauri';

/**
 * Check if we're running inside Tauri with native AI available.
 */
async function checkTauriNativeAi(): Promise<boolean> {
  try {
    if (
      typeof window === 'undefined' ||
      !(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    ) {
      return false;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke('native_ai_status');
    return status === true;
  } catch {
    return false;
  }
}

/**
 * Invoke a native inference command through Tauri IPC.
 */
async function nativeInfer(params: {
  modelType: string;
  modelPath: string;
  imageData?: ArrayBuffer;
  tensors?: Record<string, { data: Float32Array; dims: number[] }>;
  params?: Record<string, unknown>;
  targetWidth?: number;
  targetHeight?: number;
}): Promise<{
  outputs: Record<string, unknown>;
  executionProvider: string;
  processingTimeMs: number;
}> {
  const { invoke } = await import('@tauri-apps/api/core');

  // Convert ImageData ArrayBuffer to base64 for IPC transport
  const inputPayload: Record<string, unknown> = {
    modelType: params.modelType,
    modelPath: params.modelPath,
    targetWidth: params.targetWidth,
    targetHeight: params.targetHeight,
  };

  if (params.imageData) {
    // Convert ArrayBuffer to Uint8Array for base64 encoding
    const bytes = new Uint8Array(params.imageData);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    inputPayload.imageDataBase64 = btoa(binary);
  }

  if (params.tensors) {
    inputPayload.tensors = params.tensors;
  }

  if (params.params) {
    inputPayload.inferParams = params.params;
  }

  const result = await invoke('native_colorize_infer', inputPayload);
  return result as {
    outputs: Record<string, unknown>;
    executionProvider: string;
    processingTimeMs: number;
  };
}

/**
 * Convert ImageData to ArrayBuffer for IPC transport.
 */
function imageDataToArrayBuffer(imageData: ImageData): ArrayBuffer {
  return imageData.data.buffer;
}

export const nativeTauriColorizationProvider: ColorizationProvider = {
  id: NATIVE_PROVIDER_ID,
  name: 'Native ONNX Runtime (Tauri)',
  estimatedPeakMemory: 2 * 1024 * 1024 * 1024, // ~2GB for SAM2 encoder

  isAvailable: () => checkTauriNativeAi(),

  supportsModel: (modelId: string) => {
    const supported = new Set([
      'scunet',
      'sam2-hiera-tiny',
      'sam2-hiera-tiny-encoder',
      'sam2-hiera-tiny-decoder',
      'ddcolor',
      'lama',
      'lineart',
    ]);
    return supported.has(modelId);
  },

  async run(request: ColorizationRequestContract): Promise<ColorizationResultContract> {
    switch (request.kind) {
      case 'scunet-denoise': {
        // SCUNet runs as a single-session inference
        // The actual ImageData must be provided by the caller through
        // the pipeline dispatcher (which carries sourceData).
        // Here we handle the native IPC communication.
        throw new Error(
          'Native SCUNet denoise requires pre-loaded ImageData. ' +
            'Use the pipeline dispatcher which carries image data.',
        );
      }

      case 'sam2-encode': {
        // SAM2 encoder runs once per image
        throw new Error(
          'Native SAM2 encode requires pre-loaded ImageData. ' +
            'Use the pipeline dispatcher which carries image data.',
        );
      }

      case 'sam2-decode': {
        // SAM2 decoder runs per-prompt using cached embeddings
        throw new Error(
          'Native SAM2 decode requires pre-computed embeddings. ' +
            'Use the pipeline dispatcher which carries embeddings.',
        );
      }

      case 'photo-colorize': {
        // DDColor inference through native path
        throw new Error(
          'Native DDColor requires pre-loaded ImageData. ' +
            'Use the pipeline dispatcher which carries image data.',
        );
      }

      default:
        throw new Error(
          `Native inference not supported for kind: ${request.kind}. ` +
            'Classical workflows run on the main thread.',
        );
    }
  },
};

/**
 * Direct native inference for when the caller has already loaded
 * the image data and wants to bypass the provider abstraction.
 * Used by the useSam2Segmentation hook and AIDenoiseSection.
 */
export async function nativeScunetInfer(
  imageData: ImageData,
  modelPath: string,
  _strength: number,
  _signal?: AbortSignal,
): Promise<{
  outputs: Record<string, unknown>;
  executionProvider: string;
  processingTimeMs: number;
}> {
  return nativeInfer({
    modelType: 'scunet',
    modelPath,
    imageData: imageDataToArrayBuffer(imageData),
    params: { strength: _strength },
    targetWidth: imageData.width,
    targetHeight: imageData.height,
  });
}

export async function nativeSam2Encode(
  imageData: ImageData,
  modelPath: string,
  _signal?: AbortSignal,
): Promise<{
  outputs: Record<string, unknown>;
  executionProvider: string;
  processingTimeMs: number;
}> {
  return nativeInfer({
    modelType: 'sam2-encoder',
    modelPath,
    imageData: imageDataToArrayBuffer(imageData),
  });
}

export async function nativeSam2Decode(
  embeddings: Record<string, { data: Float32Array; dims: number[] }>,
  modelPath: string,
  params: {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
    letterbox?: { offsetX: number; offsetY: number };
  },
  _signal?: AbortSignal,
): Promise<{
  outputs: Record<string, unknown>;
  executionProvider: string;
  processingTimeMs: number;
}> {
  return nativeInfer({
    modelType: 'sam2-decoder',
    modelPath,
    tensors: embeddings,
    params,
  });
}
