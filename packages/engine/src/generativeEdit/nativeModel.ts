import { isTauriRuntime } from '@varve/platform';

export const NATIVE_GENERATIVE_MODEL_PROFILE = {
  id: 'sd15-inpainting-q4_0-v1',
  modelHandle: 'varve-diffusion-inpainting',
  name: 'Stable Diffusion 1.5 Inpainting · Q4_0',
  sizeBytes: 1_747_219_584,
  sha256: 'd157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16',
  revision: '21491e4',
  minimumMemoryBytes: 6 * 1024 * 1024 * 1024,
  license: 'CreativeML OpenRAIL-M',
} as const;

export interface NativeGenerativeModelDownloadProgress {
  requestId: string;
  loaded: number;
  total: number;
}

export interface NativeGenerativeModelStatus {
  installed: boolean;
  ready: boolean;
  modelHandle: string | null;
  profileId: string | null;
  checksumSha256: string | null;
  sizeBytes: number;
  partialBytes: number;
  reason: string | null;
  /** Measured by the native runtime immediately before model use when available. */
  memoryAvailableBytes?: number | null;
  /** Conservative working-set requirement for the current native profile. */
  memoryRequiredBytes?: number;
  /** constrained / standard / high / unknown. */
  resourceTier?: string;
  /** The helper backend selected by the packaged runtime. */
  executionBackend?: string;
  /** Target OS used when the model was qualified and for the current helper. */
  platform?: string;
  /** OS architecture, including arm64/aarch64 where applicable. */
  architecture?: string;
}

/**
 * Resolve the explicitly installed local diffusion artifact. Browser builds
 * intentionally return an unavailable status: no remote or silent fallback
 * is allowed for prompt-conditioned editing.
 */
export async function getNativeGenerativeModelStatus(): Promise<NativeGenerativeModelStatus> {
  if (!isTauriRuntime()) {
    return {
      installed: false,
      ready: false,
      modelHandle: null,
      profileId: null,
      checksumSha256: null,
      sizeBytes: 0,
      partialBytes: 0,
      reason: 'Prompt-capable generation requires the packaged desktop provider.',
      memoryAvailableBytes: null,
      memoryRequiredBytes: NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
      resourceTier: 'unknown',
      executionBackend: 'unknown',
      platform: undefined,
      architecture: undefined,
    };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<NativeGenerativeModelStatus>('generative_edit_model_status');
  } catch (error) {
    return {
      installed: false,
      ready: false,
      modelHandle: null,
      profileId: null,
      checksumSha256: null,
      sizeBytes: 0,
      partialBytes: 0,
      reason:
        error instanceof Error ? error.message : 'The local diffusion model status is unavailable.',
      memoryAvailableBytes: null,
      memoryRequiredBytes: NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
      resourceTier: 'unknown',
      executionBackend: 'unknown',
      platform: undefined,
      architecture: undefined,
    };
  }
}

/** Copy a user-selected model into Varve's managed model store. */
export async function importNativeGenerativeModel(
  path: string,
): Promise<NativeGenerativeModelStatus> {
  if (!isTauriRuntime())
    throw new Error('Local diffusion models can only be installed in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeGenerativeModelStatus>('import_generative_edit_model', { path });
}

/** Run the production helper against a fixed masked fixture before considering a model. */
export async function qualifyNativeGenerativeModel(): Promise<NativeGenerativeModelStatus> {
  if (!isTauriRuntime())
    throw new Error('Local diffusion models can only be qualified in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeGenerativeModelStatus>('qualify_generative_edit_model');
}

/**
 * Download the allowlisted model directly into native managed storage. The
 * desktop command owns URL validation, partial-file resume, hashing, and the
 * atomic install; the renderer receives progress only.
 */
export async function downloadNativeGenerativeModel(
  onProgress?: (progress: NativeGenerativeModelDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<NativeGenerativeModelStatus> {
  if (!isTauriRuntime())
    throw new Error('Local diffusion models can only be downloaded in the desktop app.');
  if (signal?.aborted) throw new Error('Download cancelled');
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  const requestId = `generative-model-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let rejectOnAbort: ((reason: Error) => void) | undefined;
  const cancel = () => {
    // Native storage owns the partial file and must be told to stop. The
    // renderer also rejects immediately so a slow network read cannot keep a
    // closed dialog in a downloading state.
    void invoke('cancel_generative_edit_model_download', { requestId }).catch(() => undefined);
    rejectOnAbort?.(new Error('Download cancelled'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let unlisten: (() => void | Promise<void>) | undefined;
  try {
    if (signal?.aborted) throw new Error('Download cancelled');
    unlisten = await listen<NativeGenerativeModelDownloadProgress>(
      'generative-edit-model-progress',
      (event) => {
        if (signal?.aborted || event.payload.requestId !== requestId) return;
        onProgress?.(event.payload);
      },
    );
    if (signal?.aborted) throw new Error('Download cancelled');
    const nativeDownload = invoke<NativeGenerativeModelStatus>('download_generative_edit_model', {
      requestId,
    });
    if (!signal) return await nativeDownload;
    const cancelled = new Promise<never>((_, reject) => {
      rejectOnAbort = reject;
    });
    if (signal.aborted) cancel();
    return await Promise.race([nativeDownload, cancelled]);
  } finally {
    signal?.removeEventListener('abort', cancel);
    await unlisten?.();
  }
}
