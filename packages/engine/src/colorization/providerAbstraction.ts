/**
 * Common inference provider abstraction for colorization workflows.
 *
 * The editor and tools must not know whether inference ran in JavaScript
 * (web worker) or Rust (Tauri native). This module defines the provider
 * interface and a resolution function that picks the best available
 * backend based on platform, installed models, and user preference.
 *
 * Provider resolution order:
 *   1. native-tauri — when running in Tauri with native ONNX Runtime
 *   2. webgpu — when WebGPU is available and model supports it
 *   3. wasm — fallback for all browsers
 *   4. unsupported — when no safe provider exists
 *
 * Research basis:
 *   - ADR-0005: offline-first ONNX model bundling and provider chain.
 *   - Session 53: native ONNX Runtime bundling for BiRefNet.
 */
import type {
  ColorizationRequestContract,
  ColorizationResultContract,
} from './colorizationRequest';

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface ColorizationProvider {
  /** Unique provider identifier. */
  readonly id: string;
  /** Human-readable name for UI display. */
  readonly name: string;
  /** Whether this provider is available on the current platform. */
  isAvailable(): boolean | Promise<boolean>;
  /** Run a colorization request through this provider. */
  run(request: ColorizationRequestContract): Promise<ColorizationResultContract>;
  /** Estimated peak memory usage in bytes (0 = unknown). */
  readonly estimatedPeakMemory: number;
  /** Whether this provider supports the given model. */
  supportsModel(modelId: string): boolean;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const providers = new Map<string, ColorizationProvider>();

export function registerColorizationProvider(provider: ColorizationProvider): void {
  providers.set(provider.id, provider);
}

export function getColorizationProvider(id: string): ColorizationProvider | undefined {
  return providers.get(id);
}

export function getAllColorizationProviders(): ColorizationProvider[] {
  return Array.from(providers.values());
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  provider: ColorizationProvider;
  reason: string;
}

/**
 * Resolve the best available provider for a given request.
 *
 * Returns the provider and a human-readable reason string explaining
 * why this provider was chosen (for diagnostic UI).
 */
export async function resolveColorizationProvider(
  request: ColorizationRequestContract,
): Promise<ResolvedProvider> {
  const preference = request.provider;
  const allProviders = getAllColorizationProviders();

  if (allProviders.length === 0) {
    throw new Error('No colorization providers registered');
  }

  // If user explicitly requested a specific backend, try that first
  if (preference.backend !== 'auto') {
    const target = allProviders.find(
      (p) => p.id === preference.backend || p.id.includes(preference.backend),
    );
    if (target && (await target.isAvailable())) {
      return { provider: target, reason: `User-preferred backend: ${preference.backend}` };
    }
  }

  // Auto-resolution: try providers in priority order
  const priority: string[] = ['native-tauri', 'webgpu', 'wasm'];

  for (const id of priority) {
    const provider = allProviders.find((p) => p.id === id);
    if (!provider) continue;

    // Skip if explicitly excluded
    if (preference.skipProviders?.includes(id)) continue;

    // Check availability
    const available = await provider.isAvailable();
    if (!available) continue;

    // Check model support for the specific request kind
    const modelId = getModelIdForRequest(request);
    if (modelId && !provider.supportsModel(modelId)) continue;

    return {
      provider,
      reason: `Auto-selected ${provider.name} (priority order)`,
    };
  }

  // Last resort: any available provider
  for (const provider of allProviders) {
    if (preference.skipProviders?.includes(provider.id)) continue;
    const available = await provider.isAvailable();
    if (available) {
      return {
        provider,
        reason: `Fallback to ${provider.name} (no preferred provider available)`,
      };
    }
  }

  throw new Error(
    'No compatible inference provider available. ' +
      'Install native ONNX Runtime or use a WebGPU-compatible browser.',
  );
}

function getModelIdForRequest(request: ColorizationRequestContract): string | null {
  switch (request.kind) {
    case 'scunet-denoise':
      return 'scunet';
    case 'sam2-encode':
    case 'sam2-decode':
      return 'sam2-hiera-tiny';
    case 'photo-colorize':
      return 'ddcolor';
    default:
      return null; // Classical workflows need no model
  }
}

// ---------------------------------------------------------------------------
// Backend capability query
// ---------------------------------------------------------------------------

export interface BackendCapabilities {
  hasNativeOnnx: boolean;
  hasWebGpu: boolean;
  hasWasm: boolean;
  maxMemoryBytes: number;
  supportedModels: string[];
}

/**
 * Query the current platform's inference capabilities.
 * Cached after first call per session.
 */
let cachedCapabilities: BackendCapabilities | null = null;

export async function queryBackendCapabilities(): Promise<BackendCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  const caps: BackendCapabilities = {
    hasNativeOnnx: false,
    hasWebGpu: false,
    hasWasm: typeof WebAssembly !== 'undefined',
    maxMemoryBytes: 0,
    supportedModels: [],
  };

  // Check for Tauri native ONNX
  try {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke('native_ai_status');
      caps.hasNativeOnnx = status === true;
    }
  } catch {
    // Not in Tauri or command not available
  }

  // Check for WebGPU
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      caps.hasWebGpu = adapter !== null;
    }
  } catch {
    // WebGPU not available
  }

  // Estimate max memory
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    caps.maxMemoryBytes =
      (navigator as { deviceMemory?: number }).deviceMemory! * 1024 * 1024 * 1024;
  }

  // Determine supported models based on capabilities
  if (caps.hasNativeOnnx) {
    caps.supportedModels = ['scunet', 'sam2-hiera-tiny', 'ddcolor', 'lama', 'lineart'];
  } else if (caps.hasWebGpu) {
    caps.supportedModels = ['scunet', 'sam2-hiera-tiny', 'ddcolor'];
  } else if (caps.hasWasm) {
    // WASM has memory limits — only smaller models
    caps.supportedModels = ['scunet'];
  }

  cachedCapabilities = caps;
  return caps;
}

/**
 * Check whether a specific model is safe to run via WASM.
 * Large models (SAM2 encoder at 134MB, DDColor at 150MB) may exceed
 * the WASM linear memory ceiling.
 */
export function isWasmModelSafe(modelId: string): boolean {
  // Models under ~60MB are generally safe for WASM
  const wasmSafeModels = new Set(['scunet', 'lama', 'lineart']);
  return wasmSafeModels.has(modelId);
}
