import { describe, it, expect, vi } from 'vitest';
import { runProviderChain } from './ProviderChain';
import type { InferenceProvider, InferenceRequest, InferenceResult } from './types';

function makeProvider(
  id: string,
  available: boolean,
  succeed: boolean,
): InferenceProvider<string, string> {
  return {
    id,
    isAvailable: () => Promise.resolve(available),
    run: async (req: InferenceRequest<string>): Promise<InferenceResult<string>> => {
      if (!succeed) throw new Error(`${id} failed`);
      return {
        output: `${id}-result`,
        executionProvider: id,
        processingTimeMs: 10,
        modelId: req.modelId,
      };
    },
  };
}

describe('runProviderChain', () => {
  it('returns the first successful provider result', async () => {
    const providers = [makeProvider('a', true, true), makeProvider('b', true, true)];
    const result = await runProviderChain(providers, { modelId: 'test', input: 'x' });
    expect(result.output).toBe('a-result');
    expect(result.executionProvider).toBe('a');
  });

  it('falls back to next provider when first fails', async () => {
    const providers = [makeProvider('a', true, false), makeProvider('b', true, true)];
    const result = await runProviderChain(providers, { modelId: 'test', input: 'x' });
    expect(result.output).toBe('b-result');
  });

  it('skips unavailable providers', async () => {
    const providers = [makeProvider('a', false, true), makeProvider('b', true, true)];
    const result = await runProviderChain(providers, { modelId: 'test', input: 'x' });
    expect(result.output).toBe('b-result');
  });

  it('throws when all providers fail', async () => {
    const providers = [makeProvider('a', true, false), makeProvider('b', true, false)];
    await expect(runProviderChain(providers, { modelId: 'test', input: 'x' })).rejects.toThrow(
      'all 2 provider(s) failed',
    );
  });

  it('throws when no provider is available', async () => {
    const providers = [makeProvider('a', false, true)];
    await expect(runProviderChain(providers, { modelId: 'test', input: 'x' })).rejects.toThrow(
      'No provider was available',
    );
  });

  it('respects skipProviders', async () => {
    const providers = [makeProvider('a', true, true), makeProvider('b', true, true)];
    const result = await runProviderChain(providers, {
      modelId: 'test',
      input: 'x',
      skipProviders: ['a'],
    });
    expect(result.output).toBe('b-result');
  });

  it('throws on cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const providers = [makeProvider('a', true, true)];
    await expect(
      runProviderChain(providers, { modelId: 'test', input: 'x', signal: controller.signal }),
    ).rejects.toThrow('cancelled');
  });

  it('respects fallbackEnabled=false', async () => {
    const providers = [makeProvider('a', true, false), makeProvider('b', true, true)];
    await expect(
      runProviderChain(providers, { modelId: 'test', input: 'x' }, { fallbackEnabled: false }),
    ).rejects.toThrow('all 2 provider(s) failed');
  });

  it('times out slow providers', async () => {
    const slow: InferenceProvider<string, string> = {
      id: 'slow',
      isAvailable: () => Promise.resolve(true),
      run: () => new Promise((_, reject) => setTimeout(() => reject(new Error('too slow')), 500)),
    };
    const fast = makeProvider('b', true, true);
    const providers = [slow, fast];
    const result = await runProviderChain(
      providers,
      { modelId: 'test', input: 'x' },
      { providerTimeoutMs: 50 },
    );
    expect(result.output).toBe('b-result');
  }, 10000);
});
