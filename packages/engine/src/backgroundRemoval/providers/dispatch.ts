/**
 * Orchestrates background removal via an ordered provider chain (Strategy pattern).
 *
 * Quick mode bypasses AI providers entirely. Browser AI tries Worker ONNX,
 * main-thread ONNX, then cloud. Desktop prefers native ONNX when its runtime
 * is ready, then follows the browser chain. AI never silently returns a
 * heuristic result.
 *
 * Provider dispatch safety: each provider receives an independent immutable
 * pixel buffer clone. A worker transfer must never detach the source used by
 * a later fallback. Timeouts abort provider work rather than merely rejecting
 * the caller.
 *
 * Memory-aware fallback: if ai-quality (BiRefNet) fails through every provider,
 * the dispatch automatically retries with ai-balanced (u2netp) instead of
 * crashing or showing a cryptic error. The caller receives the fallback result
 * with method set to 'ai-balanced' and can check whether the quality was
 * reduced.
 */
import { removeBackgroundHeuristic } from '../heuristic';
import { cloneImageData } from '../protocol';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import { cloudRemovalProvider } from './cloudProvider';
import { directOnnxRemovalProvider } from './directOnnxProvider';
import { isNativeAiReady, tauriRemovalProvider } from './tauriProvider';
import type { RemovalProvider } from './types';
import { workerRemovalProvider } from './workerProvider';

/**
 * Ordered AI inference providers — first success wins. This is the default/
 * base order (ADR-0005): Worker ONNX first on every platform, since it's
 * the one path guaranteed to exist everywhere, with Tauri-native as a
 * second-tier fallback.
 *
 * Native-ready desktop builds reorder this below so enhanced Balanced and
 * Quality can run outside the webview's WASM memory ceiling.
 */
export const AI_PROVIDER_CHAIN: RemovalProvider[] = [
  workerRemovalProvider,
  tauriRemovalProvider,
  directOnnxRemovalProvider,
  cloudRemovalProvider,
];

/**
 * Enhanced Balanced (IS-Net) and Quality (BiRefNet) can exceed safe bare-WASM
 * memory and, in the worst case, crash with std::bad_alloc on
 * GPU-less hosts (docs/audits/background-removal-wasm-memory-hardening-
 * 2026-07-18.md — reproduced deterministically at ~4GB RSS, the wasm32
 * linear-memory ceiling). Native execution of the same model peaks around
 * 445MB. When the Tauri desktop build has successfully loaded a native
 * onnxruntime dylib (`isNativeAiReady()` — a runtime-verified check, not
 * just "the ai feature was compiled in"), prefer it over Worker ONNX. If the
 * selected native model is absent, dispatch continues to the worker fallback
 * (U²-Net Light for Balanced).
 */
async function getProviderOrder(options: BackgroundRemovalOptions): Promise<RemovalProvider[]> {
  if (options.method !== 'quick' && (await isNativeAiReady())) {
    return [
      tauriRemovalProvider,
      workerRemovalProvider,
      directOnnxRemovalProvider,
      cloudRemovalProvider,
    ];
  }
  return AI_PROVIDER_CHAIN;
}

/** Hard ceiling for any single provider attempt (including model loading). */
const BALANCED_PROVIDER_TIMEOUT = 125_000;
const QUALITY_PROVIDER_TIMEOUT = 310_000;

function withTimeout<T>(
  start: (attemptSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const controller = new AbortController();
    const onCallerAbort = () => {
      controller.abort();
      reject(new Error('cancelled'));
    };
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Provider timed out'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      controller.abort();
      signal?.removeEventListener('abort', onCallerAbort);
    };

    signal?.addEventListener('abort', onCallerAbort, { once: true });

    let promise: Promise<T>;
    try {
      promise = start(controller.signal);
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
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
  });
}

/**
 * Run the full provider chain with the given options.
 * Returns the result on success, or null if all providers failed.
 */
async function tryProviderChain(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult | null> {
  const providerTimeout =
    options.method === 'ai-quality' ? QUALITY_PROVIDER_TIMEOUT : BALANCED_PROVIDER_TIMEOUT;
  const errors: string[] = [];
  let attempted = false;

  const providers = await getProviderOrder(options);
  for (const provider of providers) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }

    let available: boolean;
    try {
      available = await withTimeout(
        (attemptSignal) => Promise.resolve(provider.isAvailable(options, attemptSignal)),
        providerTimeout,
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      continue;
    }
    if (!available) continue;
    attempted = true;

    try {
      const clonedImage = cloneImageData(imageData);
      return await withTimeout(
        (attemptSignal) => provider.remove(clonedImage, options, attemptSignal),
        providerTimeout,
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      errors.push(`${provider.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // If we get here and attempted but all failed, log diagnostics and return null
  if (attempted && errors.length > 0) {
    console.warn(`[bg-removal] All providers failed for ${options.method}:`, errors.join('; '));
  }

  return null; // All providers failed or none available
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

  // Try the requested method first.
  const result = await tryProviderChain(imageData, options, signal);
  if (result) return result;

  // Failed at the requested quality. If this was ai-quality, automatically
  // fall back to ai-balanced (u2netp) — the bundled model is always safe
  // and doesn't risk crashing on WASM memory limits.
  if (options.method === 'ai-quality') {
    console.warn(
      '[bg-removal] ai-quality failed through all providers; falling back to ai-balanced (u2netp)',
    );

    const fallbackOptions: BackgroundRemovalOptions = {
      ...options,
      method: 'ai-balanced',
    };

    const fallbackResult = await tryProviderChain(imageData, fallbackOptions, signal);
    if (fallbackResult) {
      return {
        ...fallbackResult,
        method: 'ai-balanced',
      };
    }

    throw new Error(
      'AI background removal failed in all quality modes. Switch to Quick mode or try again later.',
    );
  }

  // For ai-balanced that failed, give a clear error.
  throw new Error(
    'AI background removal is unavailable. The bundled model (u2netp) could not run. Try Quick mode, or check the developer console for details.',
  );
}
