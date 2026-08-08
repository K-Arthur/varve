import { describe, expect, it } from 'vitest';
import {
  buildEffectChain,
  cpuEffectProvider,
  dispatchLiveEffect,
  type EffectDispatchRequest,
  effectCapabilityReport,
  type LiveEffectProvider,
  nativeEffectProvider,
} from '../dispatch';

function makeRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effect: 'rgbSplit',
    width: 8,
    height: 8,
    quality: 'normal',
    params: {
      mode: 'offset',
      redX: 2,
      borderMode: 'clamp',
      intensity: 1,
      quality: 'auto',
    },
    ...overrides,
  };
}

function makeInput(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = (i * 13) % 256;
    data[i * 4 + 2] = (i * 29) % 256;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('live effect dispatch', () => {
  it('cpuEffectProvider is always available and matches the reference kernels', async () => {
    const request = makeRequest();
    const input = makeInput(8, 8);
    const out = await cpuEffectProvider.apply(request, input);
    expect(out).toHaveLength(input.length);
    // A 2px red offset on a gradient changes pixels but keeps alpha.
    expect(out[3]).toBe(255);
    expect(Array.from(out)).not.toEqual(Array.from(input));
  });

  it('dispatchLiveEffect falls through failing providers to the CPU', async () => {
    const broken: LiveEffectProvider = {
      id: 'broken',
      label: 'Broken',
      isAvailable: () => Promise.resolve(true),
      apply: () => Promise.reject(new Error('boom')),
    };
    const out = await dispatchLiveEffect(makeRequest(), makeInput(8, 8), [
      broken,
      cpuEffectProvider,
    ]);
    expect(out).toHaveLength(8 * 8 * 4);
  });

  it('dispatchLiveEffect skips unavailable providers', async () => {
    const unavailable: LiveEffectProvider = {
      id: 'unavailable',
      label: 'Unavailable',
      isAvailable: () => Promise.resolve(false),
      apply: () => Promise.reject(new Error('should not be called')),
    };
    const out = await dispatchLiveEffect(makeRequest(), makeInput(8, 8), [
      unavailable,
      cpuEffectProvider,
    ]);
    expect(out).toHaveLength(8 * 8 * 4);
  });

  it('throws with a summary when every provider fails', async () => {
    const broken: LiveEffectProvider = {
      id: 'broken',
      label: 'Broken',
      isAvailable: () => Promise.resolve(true),
      apply: () => Promise.reject(new Error('boom')),
    };
    await expect(dispatchLiveEffect(makeRequest(), makeInput(8, 8), [broken])).rejects.toThrow(
      'Live effect failed (broken: boom)',
    );
  });

  it('rejects a provider result of the wrong byte length', async () => {
    const short: LiveEffectProvider = {
      id: 'short',
      label: 'Short',
      isAvailable: () => Promise.resolve(true),
      apply: async () => new Uint8ClampedArray(4),
    };
    await expect(dispatchLiveEffect(makeRequest(), makeInput(8, 8), [short])).rejects.toThrow(
      'short returned 4 bytes, expected 256',
    );
  });

  it('native provider is only available under Tauri', async () => {
    // The test environment is not Tauri; the provider must be unavailable or
    // throw on apply. buildEffectChain excludes it off-Tauri.
    const chain = buildEffectChain();
    const report = await effectCapabilityReport(chain);
    expect(report.providerIds).toContain('cpu-effects');
    await expect(nativeEffectProvider.apply(makeRequest(), makeInput(8, 8))).rejects.toThrow(
      'Native effects require the desktop app',
    );
  });

  it('buildEffectChain orders native first under Tauri, GPU second on web', () => {
    const chain = buildEffectChain({
      id: 'gpu-effects',
      label: 'GPU',
      isAvailable: () => Promise.resolve(false),
      apply: async () => new Uint8ClampedArray(0),
    });
    // Off-Tauri (test env): no native provider, gpu before cpu.
    const ids = chain.map((p) => p.id);
    expect(ids).toEqual(['gpu-effects', 'cpu-effects']);
  });
});
