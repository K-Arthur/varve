/**
 * Native acceleration contract — mirrors `crates/varve-accel` capability
 * reports and commands. Desktop-only: everything returns `null` outside the
 * Tauri runtime, so browser callers must keep using the browser capability
 * model in `inference/core/RuntimeCapabilities.ts`.
 *
 * This is deliberately separate from `gpuAdapter.ts`: that module selects a
 * *browser* WebGPU adapter for presentation/compute. A native device found
 * here does not make the DOM canvas draw on it.
 */

import { isTauriRuntime } from '@varve/platform';

export type DeviceKind = 'cpu' | 'gpu' | 'npu';

export type AccelStage =
  | 'unknown'
  | 'discovered'
  | 'runtimeLoadable'
  | 'deviceUsable'
  | 'executionVerified'
  | 'unavailable';

export type UnavailableReason =
  | 'notPresent'
  | 'driverMissing'
  | 'runtimeMissing'
  | 'artifactMissing'
  | 'permissionDenied'
  | 'softwareOnly'
  | 'unsupportedPlatform'
  | 'unsupportedOperator'
  | 'initFailed'
  | 'timeout'
  | 'deviceLost'
  | 'userDisabled'
  | 'unknown';

export interface AcceleratorDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  vendor: string;
  backend: string;
  driver: string | null;
  deviceType: string;
  software: boolean;
  stage: AccelStage;
  reason: UnavailableReason | null;
  detail: string | null;
  limits: Record<string, number>;
}

export interface ComputeCapabilities {
  available: boolean;
  selectedId: string | null;
  devices: AcceleratorDevice[];
}

export interface CpuCapabilities {
  architecture: string;
  logicalCores: number;
  features: string[];
}

export interface InferenceProviderStatus {
  id: string;
  label: string;
  deviceKind: DeviceKind;
  stage: AccelStage;
  reason: UnavailableReason | null;
  detail: string | null;
}

export interface InferenceCapabilities {
  runtimeLoaded: boolean;
  runtimeVersion: string | null;
  library: string | null;
  providers: InferenceProviderStatus[];
}

export interface NativeAccelerationReport {
  schemaVersion: number;
  generatedAtMs: number;
  hostOs: string;
  hostArch: string;
  cpu: CpuCapabilities;
  compute: ComputeCapabilities;
  inference: InferenceCapabilities;
}

export interface NativeAccelerationStatus {
  report: NativeAccelerationReport;
  /** A GPU device was actually created this session. */
  engineReady: boolean;
  verifiedDeviceId: string | null;
  lastError: string | null;
  /** Native inference provider policy: `auto`, `cpu`, or `gpu`. */
  inferencePolicy: 'auto' | 'cpu' | 'gpu';
}

export interface NativeSelfTestReport {
  deviceId: string;
  deviceName: string;
  backend: string;
  elementsChecked: number;
  durationMs: number;
}

const STATUS_TTL_MS = 30_000;

let cached: { at: number; value: NativeAccelerationStatus } | null = null;

export function isNativeAccelerationAvailable(): boolean {
  return isTauriRuntime();
}

/**
 * Read the native capability report. Cheap (no device creation); pass
 * `redetect: true` after a driver/device change. Returns `null` on web.
 */
export async function getNativeAccelerationStatus(options?: {
  redetect?: boolean;
  maxAgeMs?: number;
}): Promise<NativeAccelerationStatus | null> {
  if (!isTauriRuntime()) return null;
  const maxAge = options?.maxAgeMs ?? STATUS_TTL_MS;
  if (!options?.redetect && cached && Date.now() - cached.at < maxAge) {
    return cached.value;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const value = await invoke<NativeAccelerationStatus>('native_acceleration_status', {
    redetect: options?.redetect === true,
  });
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Bounded hardware self-test: creates a device if needed, runs a small
 * compute shader, and verifies the readback. Returns `null` on web.
 */
export async function runNativeGpuSelfTest(): Promise<NativeSelfTestReport | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const report = await invoke<NativeSelfTestReport>('native_gpu_self_test');
  cached = null;
  return report;
}

/**
 * True when a hardware compute device is present. This does not mean a
 * device has been created or that any workload ran on it; use
 * `runNativeGpuSelfTest` for execution verification.
 */
export async function isNativeGpuComputeUsable(): Promise<boolean> {
  try {
    const status = await getNativeAccelerationStatus();
    return status?.report.compute.available === true;
  } catch {
    return false;
  }
}

export function nativeAccelerationClearCache(): void {
  cached = null;
}

export type NativeInferenceProviderPolicy = 'auto' | 'cpu' | 'gpu';

const POLICY_STORAGE_KEY = 'varve.native.inferenceProvider';

/** Locally persisted provider preference (never stored in documents). */
export function storedNativeInferenceProviderPolicy(): NativeInferenceProviderPolicy | null {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(POLICY_STORAGE_KEY);
  return value === 'auto' || value === 'cpu' || value === 'gpu' ? value : null;
}

export function storeNativeInferenceProviderPolicy(policy: NativeInferenceProviderPolicy): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(POLICY_STORAGE_KEY, policy);
}

/**
 * Set the native inference provider policy. `gpu` is rejected by the native
 * side when the WebGPU execution provider is not actually registered, so the
 * UI never shows an enabled choice backed by a stub.
 */
export async function setNativeInferenceProviderPolicy(
  policy: NativeInferenceProviderPolicy,
): Promise<NativeInferenceProviderPolicy | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const applied = await invoke<string>('native_set_inference_provider', { policy });
  cached = null;
  storeNativeInferenceProviderPolicy(applied as NativeInferenceProviderPolicy);
  return applied as NativeInferenceProviderPolicy;
}

/** Stage-aware label for diagnostics surfaces. */
export function describeAccelStage(stage: AccelStage): string {
  switch (stage) {
    case 'unknown':
      return 'Not checked';
    case 'discovered':
      return 'Detected';
    case 'runtimeLoadable':
      return 'Runtime available';
    case 'deviceUsable':
      return 'Device ready';
    case 'executionVerified':
      return 'Verified';
    case 'unavailable':
      return 'Unavailable';
  }
}
