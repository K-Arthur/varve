// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSoftwareAdapter, selectWebGpuAdapter } from './gpuAdapter';

function fakeAdapter(info: {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}): GPUAdapter {
  return { info } as unknown as GPUAdapter;
}

describe('isSoftwareAdapter', () => {
  it.each([
    ['device field: SwiftShader', { device: 'SwiftShader Device (LLVM)' }],
    ['description field: fallback adapter', { description: 'Fallback Adapter' }],
    [
      'vendor field: llvmpipe (Mesa software rasterizer, this project’s Linux CI/VM path)',
      { vendor: 'llvmpipe' },
    ],
    ['architecture field: lavapipe', { architecture: 'lavapipe' }],
    ['case-insensitive match', { device: 'SWIFTSHADER' }],
  ])('flags a software adapter — %s', (_label, info) => {
    expect(isSoftwareAdapter(fakeAdapter(info))).toBe(true);
  });

  it('does not flag a real hardware adapter', () => {
    expect(
      isSoftwareAdapter(
        fakeAdapter({ vendor: 'nvidia', architecture: 'ampere', device: 'GeForce RTX 3080' }),
      ),
    ).toBe(false);
  });

  it('does not flag an adapter with no info at all', () => {
    expect(isSoftwareAdapter(fakeAdapter({}))).toBe(false);
  });
});

describe('selectWebGpuAdapter', () => {
  function fakeGpu(adapters: Array<GPUAdapter | null>): GPU {
    let call = 0;
    return {
      requestAdapter: async () => adapters[call++] ?? null,
    } as unknown as GPU;
  }

  it('returns the first accepted adapter and reports it as non-fallback', async () => {
    const hw = fakeAdapter({ vendor: 'amd', device: 'Radeon' });
    const gpu = fakeGpu([hw]);
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
    expect(result).toEqual({ kind: 'accepted', adapter: hw, isFallbackAdapter: false });
  });

  it('falls back from high-performance to low-power when the first preference yields nothing', async () => {
    const hw = fakeAdapter({ vendor: 'intel', device: 'Iris Xe' });
    const gpu = fakeGpu([null, hw]);
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
    expect(result).toEqual({ kind: 'accepted', adapter: hw, isFallbackAdapter: false });
  });

  it('declines a software adapter when requireHardwareAdapter is true, across both preferences', async () => {
    const sw = fakeAdapter({ device: 'SwiftShader Device (LLVM)' });
    const gpu = fakeGpu([sw, sw]);
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
    expect(result).toEqual({ kind: 'declined-software' });
  });

  it('accepts a software adapter when requireHardwareAdapter is false, flagged as fallback', async () => {
    const sw = fakeAdapter({ device: 'SwiftShader Device (LLVM)' });
    const gpu = fakeGpu([sw]);
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: false });
    expect(result).toEqual({ kind: 'accepted', adapter: sw, isFallbackAdapter: true });
  });

  it('returns unavailable when no adapter is returned for any preference', async () => {
    const gpu = fakeGpu([null, null]);
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('treats a requestAdapter rejection the same as a null adapter and keeps trying other preferences', async () => {
    const hw = fakeAdapter({ vendor: 'apple', device: 'M-series GPU' });
    let call = 0;
    const gpu = {
      requestAdapter: async () => {
        call++;
        if (call === 1) throw new Error('transient failure');
        return hw;
      },
    } as unknown as GPU;
    const result = await selectWebGpuAdapter(gpu, { requireHardwareAdapter: true });
    expect(result).toEqual({ kind: 'accepted', adapter: hw, isFallbackAdapter: false });
  });
});
