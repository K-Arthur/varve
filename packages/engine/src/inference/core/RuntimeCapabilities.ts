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
    if (typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)) {
      if (nav.deviceMemory > 0) return nav.deviceMemory * 1024;
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

interface UserAgentDataHints {
  platform?: string;
  architecture?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    platform?: string;
    architecture?: string;
  }>;
}

async function detectUserAgentDataHints(): Promise<UserAgentDataHints> {
  if (typeof navigator === 'undefined') return {};
  const userAgentData = (navigator as Navigator & { userAgentData?: UserAgentDataHints })
    .userAgentData;
  if (!userAgentData) return {};
  try {
    const highEntropy = await userAgentData.getHighEntropyValues?.(['architecture']);
    return { ...userAgentData, ...highEntropy };
  } catch {
    return userAgentData;
  }
}

async function buildCapabilities(hasWebGPU: boolean): Promise<RuntimeCapabilities> {
  const crossOriginIsolated = detectCrossOriginIsolated();
  const isWebKitGTK = detectWebKitGTK();
  const isTauri = detectTauri();
  const sharedMemoryAvailable = detectSharedMemory();
  const memoryMB = approximateMemoryMB();
  const userAgentData = await detectUserAgentDataHints();
  const os = detectOsFromSignal(userAgentData.platform) ?? detectOs();
  const cpuArch = detectCpuArch() ?? detectCpuArchFromSignal(userAgentData.architecture);
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
    os,
    cpuArch,
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

function detectOsFromSignal(signal: string | undefined): string | undefined {
  if (!signal) return undefined;
  if (/windows/i.test(signal)) return 'windows';
  if (/mac os|macintosh|darwin/i.test(signal)) return 'macos';
  if (/cros|chrome os/i.test(signal)) return 'chromeos';
  if (/android/i.test(signal)) return 'android';
  if (/ios|iphone|ipad/i.test(signal)) return 'ios';
  if (/linux/i.test(signal)) return 'linux';
  return undefined;
}

function detectOs(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return detectOsFromSignal(navigator.userAgent);
}

function detectCpuArchFromSignal(signal: string | undefined): string | undefined {
  if (!signal) return undefined;
  const normalized = signal.toLowerCase();
  if (/\b(?:aarch64|arm64|armv8\w*|arm64e)\b/.test(normalized)) return 'arm64';
  if (/\b(?:armv[5-7]\w*|armhf|arm32|arm)\b/.test(normalized)) return 'arm32';
  if (/\b(?:x86_64|amd64|win64)\b/.test(normalized)) return 'x86_64';
  if (/\b(?:x86|i386|i686)\b/.test(normalized)) return 'x86';
  return undefined;
}

function detectCpuArch(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as unknown as Record<string, string | undefined>;
  const signals = [nav.platform, navigator.userAgent];
  for (const signal of signals) {
    const architecture = detectCpuArchFromSignal(signal);
    if (architecture) return architecture;
  }
  return undefined;
}

async function detectWebGPUAsync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    const { probeWebGpuDevice } = await import('../../gpuAdapter');
    const probe = await probeWebGpuDevice(navigator.gpu);
    return probe.status === 'supported';
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
  const userAgentData =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { userAgentData?: UserAgentDataHints }).userAgentData
      : undefined;
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
    os: detectOsFromSignal(userAgentData?.platform) ?? detectOs(),
    cpuArch: detectCpuArch() ?? detectCpuArchFromSignal(userAgentData?.architecture),
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

/**
 * Why a WASM model was admitted or refused.
 *
 * The refusal reason is part of the contract: a user who is told "not enough
 * memory" cannot tell a genuinely small device from a browser session that
 * simply lacks cross-origin isolation, and the two have different remedies.
 * The assessment separates the peak the decision was made against, its
 * provenance, and the session budget.
 */
export interface WasmAdmissionAssessment {
  modelId: string;
  allowed: boolean;
  /** Peak working set the decision was made against, in bytes. */
  peakBytes: number;
  /** Safe peak budget for this session, in bytes. */
  budgetBytes: number;
  peakSource: 'catalog-measurement' | 'file-size-estimate' | 'unlisted-model';
  crossOriginIsolated: boolean;
  approximateMemoryMB: number;
  /** One sentence a person can act on; never a raw byte count alone. */
  detail: string;
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** Pure admission decision, so tests and the worker cannot disagree. */
export function evaluateWasmAdmission(input: {
  modelId: string;
  peakBytes?: number;
  modelFileSizeBytes?: number;
  peakSource: WasmAdmissionAssessment['peakSource'];
  crossOriginIsolated: boolean;
  approximateMemoryMB: number;
  wasmSafePeakBytes: number;
}): WasmAdmissionAssessment {
  const peakBytes =
    input.peakSource === 'catalog-measurement'
      ? (input.peakBytes ?? 0)
      : input.peakSource === 'file-size-estimate'
        ? (input.modelFileSizeBytes ?? 0) * (input.modelId === 'u2netp' ? 3 : 4)
        : 0;
  const allowed = input.peakSource === 'unlisted-model' || peakBytes <= input.wasmSafePeakBytes;

  let detail: string;
  if (input.peakSource === 'unlisted-model') {
    detail = `No admission record for '${input.modelId}'; the session runs with the shared budget checks only.`;
  } else if (allowed) {
    detail = `Needs about ${formatGigabytes(peakBytes)}; this session can reserve ${formatGigabytes(input.wasmSafePeakBytes)}.`;
  } else if (!input.crossOriginIsolated && input.wasmSafePeakBytes < 1_500_000_000) {
    detail = `Needs about ${formatGigabytes(peakBytes)}, more than this session's ${formatGigabytes(input.wasmSafePeakBytes)} budget. The budget is raised by cross-origin isolation, which this page does not have.`;
  } else if (input.approximateMemoryMB > 0) {
    detail = `Needs about ${formatGigabytes(peakBytes)}, more than this session's ${formatGigabytes(input.wasmSafePeakBytes)} budget (browser reports about ${input.approximateMemoryMB} MB of device memory).`;
  } else {
    detail = `Needs about ${formatGigabytes(peakBytes)}, more than this session's ${formatGigabytes(input.wasmSafePeakBytes)} budget.`;
  }

  return {
    modelId: input.modelId,
    allowed,
    peakBytes,
    budgetBytes: input.wasmSafePeakBytes,
    peakSource: input.peakSource,
    crossOriginIsolated: input.crossOriginIsolated,
    approximateMemoryMB: input.approximateMemoryMB,
    detail,
  };
}

/**
 * Resolve a model's declared peak (or the legacy file-size estimate) against
 * the session budget. Prefer this over `isWasmModelSafe` when the caller needs
 * to explain the decision.
 */
export async function assessWasmModelAdmission(
  modelId: string,
  caps?: RuntimeCapabilities,
): Promise<WasmAdmissionAssessment> {
  const resolved = caps ?? (await getRuntimeCapabilities());
  let peakBytes: number | undefined;
  let modelFileSizeBytes: number | undefined;
  let peakSource: WasmAdmissionAssessment['peakSource'] = 'unlisted-model';

  try {
    const { getModelById } = await import('../modelCatalog');
    const entry = getModelById(modelId);
    if (entry) {
      if (entry.peakMemoryBytes) {
        peakBytes = entry.peakMemoryBytes;
        peakSource = 'catalog-measurement';
      } else {
        modelFileSizeBytes = entry.sizeBytes;
        peakSource = 'file-size-estimate';
      }
    }
  } catch {
    const fallbackSizes: Record<string, number> = {
      u2netp: 4_574_861,
      'isnet-general-use': 178_648_008,
      'birefnet-general-lite': 224_000_000,
      'birefnet-general': 972_666_916,
    };
    const fallback = fallbackSizes[modelId];
    if (fallback !== undefined) {
      modelFileSizeBytes = fallback;
      peakSource = 'file-size-estimate';
    }
  }

  return evaluateWasmAdmission({
    modelId,
    ...(peakBytes !== undefined ? { peakBytes } : {}),
    ...(modelFileSizeBytes !== undefined ? { modelFileSizeBytes } : {}),
    peakSource,
    crossOriginIsolated: resolved.crossOriginIsolated,
    approximateMemoryMB: resolved.approximateMemoryMB ?? 0,
    wasmSafePeakBytes: resolved.wasmSafePeakBytes,
  });
}

export async function isWasmModelSafe(modelId: string): Promise<boolean> {
  return (await assessWasmModelAdmission(modelId)).allowed;
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
