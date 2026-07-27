/**
 * Runtime capability detection for upscaling.
 *
 * Determines what the current environment can actually support, so the UI
 * can show honest information about which path will run.
 */

export type UpscaleCapabilityStatus =
  | 'available'
  | 'unsupported'
  | 'model-missing'
  | 'insufficient-memory';

export interface UpscaleCapabilities {
  /** Whether any upscale path is available. */
  available: boolean;
  /** Whether AI upscaling is available. */
  aiAvailable: boolean;
  /** Which provider will handle AI: 'native' (Tauri) or 'worker' (WASM). */
  aiProvider: 'native' | 'worker' | 'none';
  /** Which provider will handle CPU: 'worker' or 'direct'. */
  cpuProvider: 'worker' | 'direct';
  /** Whether the bundled Real-ESRGAN model is present. */
  modelBundled: boolean;
  /** Whether Web Workers are available. */
  workerAvailable: boolean;
  /** Whether running inside Tauri. */
  isTauri: boolean;
  /** Maximum safe output pixels for this environment. */
  maxOutputPixels: number;
  /** Human-readable description of the active path. */
  pathDescription: string;
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

export async function detectUpscaleCapabilities(): Promise<UpscaleCapabilities> {
  const isTauri = isTauriEnvironment();
  const worker = workersAvailable();

  let aiProvider: 'native' | 'worker' | 'none' = 'none';
  let aiAvailable = false;

  if (isTauri && worker) {
    aiProvider = 'native';
    aiAvailable = true;
  } else if (worker) {
    aiProvider = 'worker';
    aiAvailable = true;
  }

  const cpuProvider: 'worker' | 'direct' = worker ? 'worker' : 'direct';
  const available = aiAvailable || worker || true;

  const maxOutputPixels = 64 * 1024 * 1024;

  let pathDescription: string;
  if (aiProvider === 'native') {
    pathDescription = 'Native acceleration';
  } else if (aiProvider === 'worker') {
    pathDescription = 'Web Worker (WASM)';
  } else if (worker) {
    pathDescription = 'Web Worker (CPU)';
  } else {
    pathDescription = 'Main thread (CPU)';
  }

  return {
    available,
    aiAvailable,
    aiProvider,
    cpuProvider,
    modelBundled: true,
    workerAvailable: worker,
    isTauri,
    maxOutputPixels,
    pathDescription,
  };
}
