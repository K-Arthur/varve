import { isTauriRuntime as detectTauri } from '@varve/platform';
import type { ExecutionProvider, RuntimeCapabilities } from './types';

let cachedCapabilities: RuntimeCapabilities | null = null;
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

function approximateMemoryMB(): number {
  if (typeof navigator === 'undefined') return 2048;
  try {
    const nav = navigator as unknown as Record<string, unknown>;
    if (nav.deviceMemory !== undefined) {
      return (nav.deviceMemory as number) * 1024;
    }
  } catch {}
  return 2048;
}

function detectNetworkType(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  try {
    const conn = (navigator as unknown as Record<string, unknown>).connection as
      | { effectiveType?: string }
      | undefined;
    return conn?.effectiveType ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function detectBatteryPoweredAsync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const battery = await (
      navigator as unknown as { getBattery?: () => Promise<{ charging: boolean }> }
    ).getBattery?.();
    if (battery) return !battery.charging;
  } catch {}
  return false;
}

/**
 * Peak-memory ceiling for WASM inference, scaled by device memory.
 *
 * Separate from the model-file budget: peak runs several times file size, so
 * testing a peak figure against the file budget rejects models that run
 * comfortably (SCUNet loads and infers in under a second at a 280MB peak).
 * Stays below BiRefNet's 896MB-lite / 3.9GB-full peaks, the documented case
 * that exhausts wasm32 and aborts the webview.
 */
function estimateWasmSafePeakBytes(crossOriginIsolated: boolean, memoryMB: number): number {
  const baseLimit = crossOriginIsolated ? 1_500_000_000 : 600_000_000;
  const memoryFactor = Math.min(memoryMB / 2048, 2.0);
  const result = Math.round(baseLimit * memoryFactor);
  if (memoryMB < 4096) {
    return Math.min(result, 400_000_000);
  }
  return result;
}

function estimateWasmSafeModelBytes(crossOriginIsolated: boolean, memoryMB: number): number {
  const baseLimit = crossOriginIsolated ? 400_000_000 : 50_000_000;
  const memoryFactor = Math.min(memoryMB / 2048, 2.0);
  const result = Math.round(baseLimit * memoryFactor);
  if (memoryMB < 4096) {
    return Math.min(result, 200_000_000);
  }
  return result;
}

function memoryTier(memoryMB: number): 'low' | 'medium' | 'high' {
  if (memoryMB < 4096) return 'low';
  if (memoryMB < 8192) return 'medium';
  return 'high';
}

function computePreferredProviders(caps: {
  hasWebGPU: boolean;
  hasWebGL: boolean;
  isWebKitGTK: boolean;
  crossOriginIsolated: boolean;
  isTauri: boolean;
}): ExecutionProvider[] {
  const providers: ExecutionProvider[] = [];

  if (caps.hasWebGPU) {
    providers.push('webgpu');
  }

  if (caps.hasWebGL && !caps.isWebKitGTK) {
    providers.push('webgl');
  }

  providers.push('wasm');

  return providers;
}

async function buildCapabilities(hasWebGPU: boolean): Promise<RuntimeCapabilities> {
  const crossOriginIsolated = detectCrossOriginIsolated();
  const isWebKitGTK = detectWebKitGTK();
  const isTauri = detectTauri();
  const sharedMemoryAvailable = detectSharedMemory();
  const memoryMB = approximateMemoryMB();
  const logicalProcessors =
    typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 0) : 0;
  const batteryPowered = await detectBatteryPoweredAsync();

  return {
    crossOriginIsolated,
    isWebKitGTK,
    isTauri,
    hasWorker: detectWorker(),
    hasWebGL: detectWebGL(),
    hasWebGPU,
    sharedMemoryAvailable,
    wasmSafeModelBytes: estimateWasmSafeModelBytes(crossOriginIsolated, memoryMB),
    wasmSafePeakBytes: estimateWasmSafePeakBytes(crossOriginIsolated, memoryMB),
    preferredOnnxProviders: computePreferredProviders({
      hasWebGPU,
      hasWebGL: detectWebGL(),
      isWebKitGTK,
      crossOriginIsolated,
      isTauri,
    }),
    label: isTauri
      ? isWebKitGTK
        ? 'Tauri/WebKitGTK'
        : 'Tauri/Chromium'
      : crossOriginIsolated
        ? 'Browser (cross-origin isolated)'
        : 'Browser (standard)',
    os: detectOs(),
    cpuArch: detectCpuArch(),
    logicalProcessors,
    approximateMemoryMB: memoryMB,
    memoryTier: memoryTier(memoryMB),
    hasAvx2: false,
    hasAvx512: false,
    hasVnni: false,
    hasNeon: false,
    hasDotProduct: false,
    batteryPowered,
    networkType: detectNetworkType(),
    webgpuDeviceLost: false,
  };
}

function detectOs(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Mac OS')) return 'macos';
  if (ua.includes('Linux')) return 'linux';
  if (ua.includes('Android')) return 'android';
  if (ua.includes('iOS') || ua.includes('iPhone')) return 'ios';
  return undefined;
}

function detectCpuArch(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as unknown as Record<string, string | undefined>;
  if (nav.platform) {
    const p = nav.platform.toLowerCase();
    if (p.includes('arm') || p.includes('aarch')) return 'arm64';
    if (p.includes('x86_64') || p.includes('amd64') || p.includes('win64')) return 'x86_64';
    if (p.includes('x86') || p.includes('i386') || p.includes('i686')) return 'x86';
  }
  return undefined;
}

async function detectWebGPUAsync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    const { selectWebGpuAdapter } = await import('../../gpuAdapter');
    const selection = await selectWebGpuAdapter(navigator.gpu, {
      requireHardwareAdapter: true,
    });
    return selection.kind === 'accepted';
  } catch {
    return false;
  }
}

export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  if (!webGpuResolve) {
    webGpuResolve = detectWebGPUAsync();
  }

  const hasWebGPU = await webGpuResolve;
  if (!cachedCapabilities) {
    cachedCapabilities = await buildCapabilities(hasWebGPU);
  }
  return cachedCapabilities;
}

export function markWebGPUDeviceLost(): void {
  if (cachedCapabilities) {
    cachedCapabilities = { ...cachedCapabilities, hasWebGPU: false, webgpuDeviceLost: true };
  }
}

export function getRuntimeCapabilitiesSync(): RuntimeCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const memoryMB = approximateMemoryMB();
  const crossOriginIsolated = detectCrossOriginIsolated();
  return {
    crossOriginIsolated,
    isWebKitGTK: detectWebKitGTK(),
    isTauri: detectTauri(),
    hasWorker: detectWorker(),
    hasWebGL: detectWebGL(),
    hasWebGPU: false,
    sharedMemoryAvailable: detectSharedMemory(),
    wasmSafeModelBytes: estimateWasmSafeModelBytes(crossOriginIsolated, memoryMB),
    wasmSafePeakBytes: estimateWasmSafePeakBytes(crossOriginIsolated, memoryMB),
    preferredOnnxProviders: ['wasm'],
    label: 'Sync snapshot (no async probes)',
    os: detectOs(),
    cpuArch: detectCpuArch(),
    logicalProcessors: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 0) : 0,
    approximateMemoryMB: memoryMB,
    memoryTier: memoryTier(memoryMB),
    hasAvx2: false,
    hasAvx512: false,
    hasVnni: false,
    hasNeon: false,
    hasDotProduct: false,
    batteryPowered: false,
    networkType: detectNetworkType(),
    webgpuDeviceLost: false,
  };
}

export async function isWasmModelSafe(modelId: string): Promise<boolean> {
  const caps = await getRuntimeCapabilities();
  let modelFileSize: number;
  let peakMultiplier = 3;

  try {
    const { getModelById } = await import('../modelCatalog');
    const entry = getModelById(modelId);
    if (entry) {
      if (entry.peakMemoryBytes) {
        return entry.peakMemoryBytes <= caps.wasmSafePeakBytes;
      }
      modelFileSize = entry.sizeBytes;
    } else {
      return true;
    }
  } catch {
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
  return estimatedPeakBytes <= caps.wasmSafePeakBytes;
}

export async function getBestOnnxProviders(): Promise<ExecutionProvider[]> {
  const caps = await getRuntimeCapabilities();
  return caps.preferredOnnxProviders;
}

export function resetRuntimeCapabilities(): void {
  cachedCapabilities = null;
  webGpuResolve = null;
}

export async function isQuantizationBeneficial(
  provider: ExecutionProvider,
  modelArchitecture: string,
): Promise<{ beneficial: boolean; reason: string }> {
  const caps = await getRuntimeCapabilities();

  if (provider === 'webgpu' || provider === 'webgl') {
    return {
      beneficial: false,
      reason: `${provider} has no INT8 dot-product instruction; FP16 is the native reduced precision.`,
    };
  }

  if (provider === 'wasm') {
    return {
      beneficial: false,
      reason:
        'WASM SIMD has no INT8 dot-product; INT8 dequantization overhead dominates on AVX2-only CPUs.',
    };
  }

  if (provider === 'native' || provider === 'cpu') {
    if (caps.hasVnni) {
      return {
        beneficial: true,
        reason: 'CPU has VNNI instructions that accelerate INT8 GEMM.',
      };
    }
    if (caps.hasAvx512) {
      return {
        beneficial: true,
        reason: 'CPU has AVX-512 which may accelerate INT8 operations.',
      };
    }
    if (caps.hasDotProduct) {
      return {
        beneficial: true,
        reason: 'CPU has dot-product instructions (ARM) that accelerate INT8.',
      };
    }
    if (modelArchitecture === 'conv-heavy' && !caps.hasAvx2) {
      return {
        beneficial: false,
        reason:
          'Conv-heavy model on CPU without AVX2: INT8 dequantization overhead is significant.',
      };
    }
  }

  return {
    beneficial: false,
    reason: 'No positive evidence of INT8 acceleration. Defaulting to FP32-safe.',
  };
}

export function createDiagnosticsLabel(caps: RuntimeCapabilities): string {
  const parts: string[] = [caps.label];
  if (caps.logicalProcessors) parts.push(`${caps.logicalProcessors} CPU`);
  if (caps.approximateMemoryMB)
    parts.push(`~${Math.round(caps.approximateMemoryMB / 1024)} GB RAM`);
  if (caps.hasWebGPU) parts.push('WebGPU');
  if (caps.sharedMemoryAvailable) parts.push('SAB');
  if (caps.networkType && caps.networkType !== 'unknown')
    parts.push(`${caps.networkType} connection`);
  return parts.join(' · ');
}
