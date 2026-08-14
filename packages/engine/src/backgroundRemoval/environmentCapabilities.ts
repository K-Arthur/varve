/**
 * Environment capability detection for AI background-removal inference.
 *
 * Provides a unified view of what execution backends and model sizes are
 * safe to attempt in the current runtime environment. Every function is
 * a synchronous probe where possible; asynchronous checks (WebGPU adapter
 * enumeration) are cached after first call.
 *
 * Research basis:
 *   - WebKitGTK OffscreenCanvas/WebGL reliabiliy documented in ADR-0003
 *   - WASM memory ceiling: ~2 GB without cross-origin isolation (COOP/COEP),
 *     ~4 GB with `SharedArrayBuffer` + threaded WASM
 *   - ONNX Runtime Web 1.27 EP priority: WebGPU > WebGL > WASM
 */

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
  /**
   * Estimated safe *peak runtime memory* for WASM inference. Distinct from
   * `wasmSafeModelBytes`, which budgets the model file: peak runs several times
   * file size, so testing a peak figure against the file budget rejects models
   * that run comfortably.
   */
  readonly wasmSafePeakBytes: number;
  /** Best ONNX execution provider ordering for this environment. */
  readonly preferredOnnxProviders: string[];
  /** Human-readable environment summary for diagnostics. */
  readonly label: string;
}

import { isTauriRuntime as detectTauri } from '@varve/platform';

let cachedCapabilities: EnvironmentCapabilities | null = null;
let webGpuResolve: Promise<boolean> | null = null;

function detectWebKitGTK(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return ua.includes('WebKit') && !ua.includes('Chrome') && !ua.includes('Mac');
}

function detectWebGL(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') ?? canvas.getContext('webgl2');
    if (gl) {
      // Lose context to free resources
      const loseContext = gl.getExtension('WEBGL_lose_context');
      loseContext?.loseContext();
    }
    return gl !== null;
  } catch {
    return false;
  }
}

function detectWorker(): boolean {
  return typeof Worker !== 'undefined';
}

function detectCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
}

function detectSharedMemory(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * Estimate the safe upper bound for a model file to run via WASM inference.
 *
 * WASM memory is shared between the model bytes (loaded into WASM heap),
 * intermediate tensors, and the runtime itself. Without cross-origin
 * isolation, the practical ceiling is ~1.5 GB (2 GB limit minus ~500 MB
 * for the browser/runtime overhead). With cross-origin isolation and
 * threaded WASM, up to ~3.5 GB may be available.
 *
 * We use conservative thresholds:
 *   - 50 MB without cross-origin isolation (safe for u2netp at 4.7 MB,
 *     risky for 224 MB BiRefNet which also needs ~200-500 MB for tensors)
 *   - 400 MB with cross-origin isolation (safe for BiRefNet Lite)
 */
function estimateWasmSafeModelBytes(crossOriginIsolated: boolean): number {
  return crossOriginIsolated ? 400_000_000 : 50_000_000;
}

/**
 * Peak-memory ceiling for WASM inference.
 *
 * Sized from what the runtime actually sustains rather than from file size:
 * SCUNet (280MB peak) loads and runs in well under a second on a
 * non-isolated single-threaded build, while BiRefNet (896MB lite / 3.9GB full)
 * is the documented case that exhausts wasm32 and aborts the webview. The
 * non-isolated ceiling therefore sits between the two, and cross-origin
 * isolation — which unlocks threads and a larger practical heap — raises it.
 */
function estimateWasmSafePeakBytes(crossOriginIsolated: boolean): number {
  return crossOriginIsolated ? 1_500_000_000 : 600_000_000;
}

function computePreferredOnnxProviders(caps: {
  hasWebGPU: boolean;
  hasWebGL: boolean;
  isWebKitGTK: boolean;
  crossOriginIsolated: boolean;
}): string[] {
  const providers: string[] = [];

  // WebGPU: preferred accelerated backend for ONNX Runtime 1.27+
  if (caps.hasWebGPU) {
    providers.push('webgpu');
  }

  // WebGL: works on most browsers but unreliable on WebKitGTK
  if (caps.hasWebGL && !caps.isWebKitGTK) {
    providers.push('webgl');
  }

  // WASM: universal fallback
  providers.push('wasm');

  return providers;
}

function buildCapabilities(hasWebGPU: boolean): EnvironmentCapabilities {
  const crossOriginIsolated = detectCrossOriginIsolated();
  const isWebKitGTK = detectWebKitGTK();
  const isTauri = detectTauri();
  const sharedMemoryAvailable = detectSharedMemory();

  return {
    crossOriginIsolated,
    isWebKitGTK,
    isTauri,
    hasWorker: detectWorker(),
    hasWebGL: detectWebGL(),
    hasWebGPU,
    sharedMemoryAvailable,
    wasmSafeModelBytes: estimateWasmSafeModelBytes(crossOriginIsolated),
    wasmSafePeakBytes: estimateWasmSafePeakBytes(crossOriginIsolated),
    preferredOnnxProviders: computePreferredOnnxProviders({
      hasWebGPU,
      hasWebGL: detectWebGL(),
      isWebKitGTK,
      crossOriginIsolated,
    }),
    label: isTauri
      ? isWebKitGTK
        ? 'Tauri/WebKitGTK'
        : 'Tauri/Chromium'
      : crossOriginIsolated
        ? 'Browser (cross-origin isolated)'
        : 'Browser',
  };
}

/**
 * Get the cached environment capabilities synchronously if initialization
 * has already completed, or trigger async initialization and return a
 * best-effort synchronously-available subset.
 */
export function getEnvironmentCapabilities(): Promise<EnvironmentCapabilities> {
  if (cachedCapabilities) {
    return Promise.resolve(cachedCapabilities);
  }

  if (!webGpuResolve) {
    webGpuResolve = detectWebGPUAsync();
  }

  return webGpuResolve.then((hasWebGPU) => {
    if (!cachedCapabilities) {
      cachedCapabilities = buildCapabilities(hasWebGPU);
    }
    return cachedCapabilities;
  });
}

/**
 * Synchronous best-effort snapshot for use before async init completes.
 */
export function getEnvironmentCapabilitiesSync(): EnvironmentCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  return buildCapabilities(false);
}

/**
 * Async WebGPU detection — probes for a hardware adapter.
 * Cached after first completion.
 */
async function detectWebGPUAsync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;

    // Use the shared adapter-selection logic that declines software adapters
    const { selectWebGpuAdapter } = await import('../gpuAdapter');
    const selection = await selectWebGpuAdapter(navigator.gpu, {
      requireHardwareAdapter: true,
    });
    return selection.kind === 'accepted';
  } catch {
    return false;
  }
}

/**
 * Determine whether a given model ID can safely run via WASM inference
 * in the current environment.
 *
 * Uses the model catalog's `peakMemoryBytes` when available (which accounts
 * for input tensor size and intermediate activations), falling back to a
 * conservative `sizeBytes * multiplier` heuristic.
 *
 * This is a conservative check — returning `true` means "likely safe",
 * not "guaranteed safe". Returning `false` means "known to be unsafe or
 * likely to exceed available memory".
 */
export async function isWasmModelSafe(modelId: string): Promise<boolean> {
  const caps = await getEnvironmentCapabilities();

  // Use the unified model catalog for size metadata.
  let modelFileSize: number;
  let peakMultiplier = 3;

  try {
    const { getModelById } = await import('../inference/modelCatalog');
    const entry = getModelById(modelId);
    if (entry) {
      if (entry.peakMemoryBytes) {
        return entry.peakMemoryBytes <= caps.wasmSafePeakBytes;
      }
      modelFileSize = entry.sizeBytes;
    } else {
      // Unknown model — use a generous default multiplier.
      return true;
    }
  } catch {
    // Import or catalog unavailable — fall back to hardcoded values.
    switch (modelId) {
      case 'u2netp':
        modelFileSize = 4_574_861;
        break;
      case 'isnet-general-use':
        modelFileSize = 178_648_008;
        break;
      case 'birefnet-general-lite':
        modelFileSize = 224_000_000;
        break;
      case 'birefnet-general':
        modelFileSize = 972_666_916;
        break;
      default:
        return true;
    }
  }

  peakMultiplier = modelId === 'u2netp' ? 3 : 4;
  const estimatedPeakBytes = modelFileSize * peakMultiplier;

  // Derived peak, so it belongs against the peak budget for the same reason as
  // the catalog figure above.
  return estimatedPeakBytes <= caps.wasmSafePeakBytes;
}

/**
 * Get the best ONNX execution provider list for the current environment.
 */
export async function getBestOnnxProviders(): Promise<string[]> {
  const caps = await getEnvironmentCapabilities();
  return caps.preferredOnnxProviders;
}

/**
 * Reset cached capabilities (useful for testing).
 */
export function resetEnvironmentCapabilities(): void {
  cachedCapabilities = null;
  webGpuResolve = null;
}
