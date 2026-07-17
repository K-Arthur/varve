/**
 * Orchestrates background removal via an ordered provider chain (Strategy pattern).
 *
 * Quick mode bypasses AI providers entirely. AI modes try Worker ONNX first
 * (all platforms), then Tauri native IPC, then main-thread ONNX, then cloud API
 * fallback. AI requests never silently return heuristic output.
 *
 * Provider dispatch safety: each provider receives an independent immutable
 * pixel buffer clone. A worker transfer must never detach the source used by
 * a later fallback. Timeouts abort provider work rather than merely rejecting
 * the caller.
 */
import { removeBackgroundHeuristic } from '../heuristic';
import { cloneImageData } from '../protocol';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import { cloudRemovalProvider } from './cloudProvider';
import { directOnnxRemovalProvider } from './directOnnxProvider';
import { tauriRemovalProvider } from './tauriProvider';
import type { RemovalProvider } from './types';
import { workerRemovalProvider } from './workerProvider';

/** Ordered AI inference providers — first success wins. */
export const AI_PROVIDER_CHAIN: RemovalProvider[] = [
  workerRemovalProvider,
  tauriRemovalProvider,
  directOnnxRemovalProvider,
  cloudRemovalProvider,
];

/** Hard ceiling for any single provider attempt (including model loading). */
const BALANCED_PROVIDER_TIMEOUT = 125_000;
const QUALITY_PROVIDER_TIMEOUT = 310_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Provider timed out'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      controller.abort();
    };

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );

    signal?.addEventListener(
      'abort',
      () => {
        cleanup();
        reject(new Error('cancelled'));
      },
      { once: true },
    );
  });
}

export async function dispatchBackgroundRemoval(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  if (options.method === 'quick') {
    return removeBackgroundHeuristic(imageData, options);
  }

  const providerTimeout =
    options.method === 'ai-quality' ? QUALITY_PROVIDER_TIMEOUT : BALANCED_PROVIDER_TIMEOUT;
  const errors: string[] = [];
  let attempted = false;
  for (const provider of AI_PROVIDER_CHAIN) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }

    let available: boolean;
    try {
      available = await withTimeout(
        Promise.resolve(provider.isAvailable(options, signal)),
        providerTimeout,
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      // Timed-out/failed availability check: treat as unavailable and continue.
      continue;
    }
    if (!available) continue;
    attempted = true;

    try {
      // Clone the image data for each provider so destructive operations
      // (like Worker transfer) never detach the source buffer needed by
      // fallback providers.
      const clonedImage = cloneImageData(imageData);
      return await withTimeout(
        provider.remove(clonedImage, options, signal),
        providerTimeout,
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      errors.push(`${provider.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!attempted) {
    throw new Error('AI background removal is unavailable. Install the selected offline model.');
  }
  throw new Error(
    errors.length > 0
      ? `AI background removal failed (${errors.join('; ')})`
      : 'AI background removal failed',
  );
}
