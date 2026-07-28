/**
 * Worker-first upscale dispatch with a direct CPU fallback.
 */

import type { UpscaleOptions } from '../imageEnhancement';
import { directUpscaleProvider } from './directProvider';
import { nativeUpscaleProvider } from './nativeProvider';
import type { UpscaleProvider } from './types';
import { workerUpscaleProvider } from './workerProvider';

/** Ordered providers — first available success wins. */
export const UPSCALE_PROVIDER_CHAIN: UpscaleProvider[] = [
  workerUpscaleProvider,
  nativeUpscaleProvider,
  directUpscaleProvider,
];

const CPU_PROVIDER_TIMEOUT_MS = 125_000;
const AI_PROVIDER_TIMEOUT_MS = 600_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const timeout = setTimeout(() => reject(new Error('Provider timed out')), timeoutMs);
    const cleanup = () => clearTimeout(timeout);
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

export async function dispatchUpscale(
  imageData: ImageData,
  options: UpscaleOptions = {},
  signal?: AbortSignal,
  chain: UpscaleProvider[] = UPSCALE_PROVIDER_CHAIN,
): Promise<ImageData> {
  if (signal?.aborted) throw new Error('cancelled');

  const errors: string[] = [];
  const providerTimeoutMs =
    options.method === 'ai' ? AI_PROVIDER_TIMEOUT_MS : CPU_PROVIDER_TIMEOUT_MS;
  for (const provider of chain) {
    if (signal?.aborted) throw new Error('cancelled');
    let available: boolean;
    try {
      available = await provider.isAvailable(options, signal);
    } catch {
      available = false;
    }
    if (!available) continue;

    try {
      return await withTimeout(
        provider.upscale(imageData, options, signal),
        providerTimeoutMs,
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw new Error('cancelled');
      // Tauri rejects with a bare string rather than an Error, so normalize
      // before inspecting or rethrowing — propagating the raw value strips the
      // message at the UI boundary, where `instanceof Error` decides whether a
      // real diagnostic or a generic fallback is shown.
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled') throw new Error('cancelled');
      errors.push(`${provider.id}: ${message}`);
    }
  }

  if (options.method === 'ai') {
    throw new Error(
      errors.length > 0
        ? `AI upscaling failed (${errors.join('; ')})`
        : 'AI upscaling is unavailable because its model or worker runtime is not ready',
    );
  }
  throw new Error(
    errors.length > 0 ? `Upscale failed (${errors.join('; ')})` : 'No upscale provider available',
  );
}
