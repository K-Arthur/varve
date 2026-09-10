import { markWebGPUDeviceLost } from './RuntimeCapabilities';
import type { ExecutionProvider } from './types';

export type WebGPURecoveryState = 'healthy' | 'recovering' | 'fallback' | 'permanent-loss';

export interface WebGPURecoveryResult {
  state: WebGPURecoveryState;
  fallbackProvider: ExecutionProvider;
  retryAttempts: number;
  recoveryTimeMs: number;
  reason?: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

let recoveryState: WebGPURecoveryState = 'healthy';
let retryAttempts = 0;
const activeJobs = new Set<string>();

export function getWebGPURecoveryState(): WebGPURecoveryState {
  return recoveryState;
}

export function registerActiveJob(jobId: string): void {
  activeJobs.add(jobId);
}

export function unregisterActiveJob(jobId: string): void {
  activeJobs.delete(jobId);
}

export function hasActiveJobs(): boolean {
  return activeJobs.size > 0;
}

export async function handleWebGPUDeviceLost(
  _device: GPUDevice | null,
  _adapter: GPUAdapter | null,
  signal?: AbortSignal,
): Promise<WebGPURecoveryResult> {
  const startTime = performance.now();

  if (signal?.aborted) {
    return {
      state: 'permanent-loss',
      fallbackProvider: 'wasm',
      retryAttempts,
      recoveryTimeMs: performance.now() - startTime,
      reason: 'Aborted by caller during recovery',
    };
  }

  recoveryState = 'recovering';
  markWebGPUDeviceLost();

  activeJobs.forEach((_jobId) => {});
  activeJobs.clear();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) break;

    try {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));

      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('WebGPU API not available after device loss');
      }

      const newAdapter = await navigator.gpu.requestAdapter();
      if (!newAdapter) {
        throw new Error('No GPU adapter available after device loss');
      }

      const newDevice = await newAdapter.requestDevice();
      if (!newDevice) {
        throw new Error('Failed to create GPU device after adapter reacquisition');
      }

      newDevice.lost.then((_info) => {
        if (recoveryState === 'healthy') {
          recoveryState = 'recovering';
          handleWebGPUDeviceLost(newDevice, newAdapter, signal).catch(() => {});
        }
      });

      retryAttempts = attempt;
      recoveryState = 'healthy';

      return {
        state: 'healthy',
        fallbackProvider: 'webgpu',
        retryAttempts: attempt,
        recoveryTimeMs: performance.now() - startTime,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  retryAttempts = MAX_RETRIES;
  recoveryState = 'permanent-loss';

  const result: WebGPURecoveryResult = {
    state: 'permanent-loss',
    fallbackProvider: 'wasm',
    retryAttempts: MAX_RETRIES,
    recoveryTimeMs: performance.now() - startTime,
    reason: lastError?.message ?? 'WebGPU recovery failed after max retries',
  };

  markWebGPUDeviceLost();
  return result;
}

export function resetRecoveryState(): void {
  recoveryState = 'healthy';
  retryAttempts = 0;
  activeJobs.clear();
}
