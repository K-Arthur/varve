import { isTauriRuntime } from '@varve/platform';

export interface NativeGenerativeModelStatus {
  installed: boolean;
  ready: boolean;
  modelHandle: string | null;
  profileId: string | null;
  checksumSha256: string | null;
  sizeBytes: number;
  reason: string | null;
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
      reason: 'Prompt-capable generation requires the packaged desktop provider.',
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
      reason:
        error instanceof Error ? error.message : 'The local diffusion model status is unavailable.',
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

/** Run the production helper against a fixed masked fixture before enabling a model. */
export async function qualifyNativeGenerativeModel(): Promise<NativeGenerativeModelStatus> {
  if (!isTauriRuntime())
    throw new Error('Local diffusion models can only be qualified in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<NativeGenerativeModelStatus>('qualify_generative_edit_model');
}
