/**
 * Backwards-compatible capability facade for background-removal inference.
 *
 * RuntimeCapabilities is the canonical runtime probe for the engine. Older
 * background-removal providers import this module, so keep their public names
 * while projecting the canonical snapshot instead of maintaining a second
 * memory/WebGPU policy. In particular, this keeps `deviceMemory`, ChromeOS,
 * ARM, WebGPU, and cross-origin-isolation decisions identical for every local
 * ONNX consumer.
 */

import {
  getRuntimeCapabilities,
  getRuntimeCapabilitiesSync,
  isWasmModelSafe as isCanonicalWasmModelSafe,
  resetRuntimeCapabilities,
} from '../inference/core/RuntimeCapabilities';
import type { RuntimeCapabilities } from '../inference/core/types';

export interface EnvironmentCapabilities {
  /** True when the page has cross-origin isolation (COOP+COEP). */
  readonly crossOriginIsolated: boolean;
  /** True when the browser is WebKitGTK (Tauri on Linux). */
  readonly isWebKitGTK: boolean;
  /** True when the runtime is Tauri desktop (not browser). */
  readonly isTauri: boolean;
  /** True when Web Workers are constructable. */
  readonly hasWorker: boolean;
  /** True when WebGL 1/2 context can be created. */
  readonly hasWebGL: boolean;
  /** True when WebGPU adapter was found and accepted (async, cached). */
  hasWebGPU: boolean;
  /** True when the runtime shares memory between worker and main thread. */
  readonly sharedMemoryAvailable: boolean;
  /** Estimated safe model-file size in bytes for WASM inference. */
  readonly wasmSafeModelBytes: number;
  /** Estimated safe peak runtime memory for WASM inference. */
  readonly wasmSafePeakBytes: number;
  /** Best ONNX execution provider ordering for this environment. */
  readonly preferredOnnxProviders: string[];
  /** Human-readable environment summary for diagnostics. */
  readonly label: string;
}

function projectCapabilities(caps: RuntimeCapabilities): EnvironmentCapabilities {
  return {
    crossOriginIsolated: caps.crossOriginIsolated,
    isWebKitGTK: caps.isWebKitGTK,
    isTauri: caps.isTauri,
    hasWorker: caps.hasWorker,
    hasWebGL: caps.hasWebGL,
    hasWebGPU: caps.hasWebGPU,
    sharedMemoryAvailable: caps.sharedMemoryAvailable,
    wasmSafeModelBytes: caps.wasmSafeModelBytes,
    wasmSafePeakBytes: caps.wasmSafePeakBytes,
    preferredOnnxProviders: [...caps.preferredOnnxProviders],
    label: caps.label,
  };
}

let cachedCapabilities: EnvironmentCapabilities | null = null;

/** Return the canonical asynchronous runtime snapshot under the legacy API. */
export async function getEnvironmentCapabilities(): Promise<EnvironmentCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;
  const capabilities = projectCapabilities(await getRuntimeCapabilities());
  cachedCapabilities ??= capabilities;
  return cachedCapabilities;
}

/** Return the canonical synchronous snapshot under the legacy API. */
export function getEnvironmentCapabilitiesSync(): EnvironmentCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const capabilities = projectCapabilities(getRuntimeCapabilitiesSync());
  cachedCapabilities = capabilities;
  return capabilities;
}

/** Use the same model safety calculation as the rest of the engine. */
export async function isWasmModelSafe(modelId: string): Promise<boolean> {
  return isCanonicalWasmModelSafe(modelId);
}

/** Return the canonical provider ordering under the legacy API. */
export async function getBestOnnxProviders(): Promise<string[]> {
  const capabilities = await getEnvironmentCapabilities();
  return capabilities.preferredOnnxProviders;
}

/** Clear both facades so tests and runtime re-probes cannot disagree. */
export function resetEnvironmentCapabilities(): void {
  cachedCapabilities = null;
  resetRuntimeCapabilities();
}
