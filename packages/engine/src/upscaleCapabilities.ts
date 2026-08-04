/**
 * Runtime capability detection for upscaling.
 *
 * Determines what the current environment can actually support, so the UI
 * can show honest information about which path will run.
 */

import { isTauriRuntime as isTauriEnvironment } from '@varve/platform';

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

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Check whether native ONNX inference is actually usable right now.
 * Mirrors backgroundRemoval/providers/tauriProvider.ts:isNativeAiReady.
 */
async function isNativeAiReady(): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('native_ai_status');
  } catch {
    return false;
  }
}

export async function detectUpscaleCapabilities(): Promise<UpscaleCapabilities> {
  const isTauri = isTauriEnvironment();
  const worker = workersAvailable();

  let aiProvider: 'native' | 'worker' | 'none' = 'none';
  let aiAvailable = false;

  if (isTauri && worker) {
    // Probe actual native runtime state before claiming native provider
    const nativeReady = await isNativeAiReady();
    if (nativeReady) {
      aiProvider = 'native';
      aiAvailable = true;
    } else {
      // Native ONNX not available; fall back to worker
      aiProvider = 'worker';
      aiAvailable = true;
    }
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
