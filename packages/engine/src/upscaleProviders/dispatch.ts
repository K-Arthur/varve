/**
 * Native-first on desktop, worker-first in practice on the web because the
 * native provider is gated by the Tauri runtime. Keeping one chain preserves
 * the provider contract while making the installed app reach its native GPU
 * resampler and native ONNX inference before its browser/WASM fallback.
 */

import type { UpscaleOptions } from '../imageEnhancement';
import { directUpscaleProvider } from './directProvider';
import { nativeUpscaleProvider } from './nativeProvider';
import type { UpscaleProvider, UpscaleProviderResult } from './types';
import { workerUpscaleProvider } from './workerProvider';

/** Ordered providers — first available success wins. */
export const UPSCALE_PROVIDER_CHAIN: UpscaleProvider[] = [
  nativeUpscaleProvider,
  workerUpscaleProvider,
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
  onProvider?: (providerId: string) => void,
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
      const result: UpscaleProviderResult = await withTimeout(
        provider.upscaleWithMetadata
          ? provider.upscaleWithMetadata(imageData, options, signal)
          : provider.upscale(imageData, options, signal).then((resultImage) => ({
              imageData: resultImage,
            })),
        providerTimeoutMs,
        signal,
      );
      onProvider?.(result.executionProvider ?? provider.id);
      return result.imageData;
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
