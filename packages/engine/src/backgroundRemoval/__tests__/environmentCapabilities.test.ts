import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBestOnnxProviders,
  getEnvironmentCapabilities,
  getEnvironmentCapabilitiesSync,
  isWasmModelSafe,
  resetEnvironmentCapabilities,
} from '../environmentCapabilities';

beforeEach(() => {
  resetEnvironmentCapabilities();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getEnvironmentCapabilitiesSync', () => {
  it('returns sync snapshot without async WebGPU detection', () => {
    const caps = getEnvironmentCapabilitiesSync();
    expect(caps).toHaveProperty('crossOriginIsolated');
    expect(caps).toHaveProperty('isWebKitGTK');
    expect(caps).toHaveProperty('hasWebGPU', false);
    expect(caps).toHaveProperty('preferredOnnxProviders');
    expect(caps.wasmSafeModelBytes).toBeGreaterThan(0);
  });

  it('returns cached result after async init', async () => {
    const sync = getEnvironmentCapabilitiesSync();
    expect(sync.hasWebGPU).toBe(false);

    const async_ = await getEnvironmentCapabilities();
    const sync2 = getEnvironmentCapabilitiesSync();
    expect(sync2.hasWebGPU).toBe(async_.hasWebGPU);
  });
});

describe('getEnvironmentCapabilities', () => {
  it('has environment-appropriate fields', async () => {
    const caps = await getEnvironmentCapabilities();
    expect(typeof caps.crossOriginIsolated).toBe('boolean');
    expect(typeof caps.isWebKitGTK).toBe('boolean');
    expect(typeof caps.isTauri).toBe('boolean');
    expect(typeof caps.hasWorker).toBe('boolean');
    expect(typeof caps.hasWebGL).toBe('boolean');
    expect(typeof caps.hasWebGPU).toBe('boolean');
    expect(typeof caps.wasmSafeModelBytes).toBe('number');
    expect(Array.isArray(caps.preferredOnnxProviders)).toBe(true);
    expect(typeof caps.label).toBe('string');
  });

  it('includes wasm in preferred providers', async () => {
    const caps = await getEnvironmentCapabilities();
    expect(caps.preferredOnnxProviders).toContain('wasm');
  });

  it('caches result across calls', async () => {
    const a = await getEnvironmentCapabilities();
    const b = await getEnvironmentCapabilities();
    expect(a).toBe(b);
  });
});

describe('isWasmModelSafe', () => {
  it('allows u2netp in any environment', async () => {
    const safe = await isWasmModelSafe('u2netp');
    expect(safe).toBe(true);
  });

  it('rejects birefnet-general (928 MB) in all environments', async () => {
    const safe = await isWasmModelSafe('birefnet-general');
    expect(safe).toBe(false);
  });

  it('returns true for u2netp regardless of cross-origin isolation', async () => {
    const safe = await isWasmModelSafe('u2netp');
    expect(safe).toBe(true);
  });

  it('handles unknown model IDs gracefully', async () => {
    const safe = await isWasmModelSafe('unknown-model');
    expect(safe).toBe(true);
  });
});

describe('getBestOnnxProviders', () => {
  it('returns an array with at least wasm', async () => {
    const providers = await getBestOnnxProviders();
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(providers).toContain('wasm');
  });
});

describe('resetEnvironmentCapabilities', () => {
  it('clears cache so subsequent calls re-probe', async () => {
    const a = await getEnvironmentCapabilities();
    resetEnvironmentCapabilities();
    const b = await getEnvironmentCapabilities();
    expect(a).not.toBe(b);
  });
});
