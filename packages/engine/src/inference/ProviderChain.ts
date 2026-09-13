/**
 * Generic provider chain — runs inference through an ordered list of
 * providers (Strategy pattern), with timeout, fallback, and cancellation.
 *
 * Extracted from bg-removal's `dispatch.ts` provider-chain pattern
 * (ADR-0005) so that any future model family automatically gets the
 * same fallback, timing, and error-handling behaviour.
 */
import type { InferenceProvider, InferenceRequest, InferenceResult } from './types';

export interface ProviderChainOptions {
  /** Per-provider timeout in milliseconds. */
  providerTimeoutMs: number;
  /** Whether to fall back through remaining providers on failure. */
  fallbackEnabled: boolean;
}

const DEFAULT_OPTIONS: ProviderChainOptions = {
  providerTimeoutMs: 120_000,
  fallbackEnabled: true,
};

/**
 * Chain an ordered list of providers, returning the first successful result.
 * Falls back through remaining providers when `fallbackEnabled` is true.
 */
export async function runProviderChain<TInput, TOutput>(
  providers: InferenceProvider<TInput, TOutput>[],
  request: InferenceRequest<TInput>,
  options: Partial<ProviderChainOptions> = {},
): Promise<InferenceResult<TOutput>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  let attempted = false;

  for (const provider of providers) {
    if (request.signal?.aborted) {
      throw new Error('cancelled');
    }

    if (request.skipProviders?.includes(provider.id)) {
      continue;
    }

    let available: boolean;
    try {
      available = await withTimeout(
        (attemptSignal) =>
          Promise.resolve(provider.isAvailable({ ...request, signal: attemptSignal })),
        opts.providerTimeoutMs,
        request.signal,
      );
    } catch (error) {
      // A timed-out availability probe may still be touching runtime state.
      // Do not start another provider while that unknown work is in flight.
      if (isProviderTimeout(error)) break;
      continue;
    }
    if (!available) continue;
    attempted = true;

    try {
      return await withTimeout(
        (attemptSignal) => provider.run({ ...request, signal: attemptSignal }),
        opts.providerTimeoutMs,
        request.signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      errors.push(`${provider.id}: ${e instanceof Error ? e.message : String(e)}`);
      if (isProviderTimeout(e) && !provider.supportsHardCancellation) {
        // AbortSignal is delivery, not proof that native/WASM/GPU work has
        // stopped. A generic provider has no way to make a safe fallback
        // promise, so fail closed instead of doubling peak memory/CPU.
        break;
      }
      if (!opts.fallbackEnabled) break;
    }
  }

  if (attempted && errors.length > 0) {
    console.warn(`[inference] All providers failed for ${request.modelId}:`, errors.join('; '));
  }

  throw new Error(
    `Inference failed for '${request.modelId}': all ${providers.length} provider(s) failed. ${
      errors.length > 0 ? `Last error: ${errors[errors.length - 1]}` : 'No provider was available.'
    }`,
  );
}

class ProviderTimeoutError extends Error {
  constructor() {
    super('Provider timed out');
    this.name = 'ProviderTimeoutError';
  }
}

function isProviderTimeout(error: unknown): error is ProviderTimeoutError {
  return error instanceof ProviderTimeoutError;
}

function withTimeout<T>(
  fn: (attemptSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const controller = new AbortController();
    const operation = Promise.resolve().then(() => fn(controller.signal));
    const onCallerAbort = () => {
      controller.abort();
      reject(new Error('cancelled'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onCallerAbort);
    };
    const timeout = setTimeout(() => {
      controller.abort();
      cleanup();
      reject(new ProviderTimeoutError());
    }, timeoutMs);

    signal?.addEventListener('abort', onCallerAbort, { once: true });

    operation.then(
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
