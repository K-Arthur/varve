import { describe, expect, it } from 'vitest';
import { GpuAccelerator, getGpuCapabilities, gpuFeatherMask } from '../gpuAccelerator';
import { featherMaskArray, resizeMaskNearestNeighbor, thresholdMask } from '../maskOps';

describe('GpuAccelerator', () => {
  describe('getInstance (singleton)', () => {
    it('returns the same instance on repeated calls', () => {
      const a = GpuAccelerator.getInstance();
      const b = GpuAccelerator.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('initialize', () => {
    it('returns capabilities with available=false when WebGPU unavailable', async () => {
      const accel = GpuAccelerator.getInstance();
      const caps = await accel.initialize();

      expect(caps).toHaveProperty('available', false);
      expect(caps).toHaveProperty('maxTextureDimension', 0);
      expect(caps).toHaveProperty('acceleratedOps');
      expect(Array.isArray(caps.acceleratedOps)).toBe(true);
      expect(caps).toHaveProperty('adapterName', '');
    });

    it('can be called multiple times safely', async () => {
      const accel = GpuAccelerator.getInstance();
      const caps1 = await accel.initialize();
      const caps2 = await accel.initialize();

      // Both calls return the same capabilities object
      expect(caps1).toBe(caps2);
      expect(caps1.available).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('returns capabilities after initialize()', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();
      const caps = accel.getCapabilities();
      expect(caps).not.toBeNull();
      expect(caps).toHaveProperty('available');
    });
  });

  describe('initialize with a mocked navigator.gpu', () => {
    function mockGpu(adapterInfo: { device?: string; description?: string; vendor?: string }) {
      const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
      Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: {
          requestAdapter: async () => ({
            info: adapterInfo,
            requestDevice: async () => ({
              limits: { maxTextureDimension2D: 8192 },
              lost: new Promise(() => {}),
              destroy: () => {},
            }),
          }),
        },
      });
      return () =>
        Object.defineProperty(navigator, 'gpu', { configurable: true, value: originalGpu });
    }

    it('reports available=true and reads adapterName from the synchronous adapter.info property', async () => {
      // Regression test for GPUAdapter.requestAdapterInfo(), removed from
      // the spec/browsers in favor of `.info` (Chrome 131+) — the old code
      // called the removed method, always threw, and silently disabled GPU
      // acceleration on every current browser regardless of real hardware.
      const restore = mockGpu({ description: 'Mock GPU', vendor: 'MockVendor' });
      GpuAccelerator.resetInstance();
      try {
        const accel = GpuAccelerator.getInstance();
        const caps = await accel.initialize();
        expect(caps.available).toBe(true);
        expect(caps.adapterName).toBe('Mock GPU');
        expect(caps.maxTextureDimension).toBe(8192);
      } finally {
        GpuAccelerator.resetInstance();
        restore();
      }
    });

    it('declines a software-emulated adapter, consistent with the render compositor (ADR-0003)', async () => {
      const restore = mockGpu({ device: 'SwiftShader Device (LLVM)' });
      GpuAccelerator.resetInstance();
      try {
        const accel = GpuAccelerator.getInstance();
        const caps = await accel.initialize();
        expect(caps.available).toBe(false);
      } finally {
        GpuAccelerator.resetInstance();
        restore();
      }
    });
  });

  describe('gaussianBlur', () => {
    it('falls back to CPU when WebGPU unavailable', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const mask = new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0, 255]);
      const result = await accel.gaussianBlur(mask, 3, 3, 2);

      // Should produce the same result as the CPU implementation
      const expected = featherMaskArray(mask, 3, 3, 2);
      expect(Array.from(result)).toEqual(Array.from(expected));
    });

    it('produces valid mask data (values in 0-255 range)', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const mask = new Uint8Array([255, 0, 255, 0, 128, 64, 32, 16, 255]);
      const result = await accel.gaussianBlur(mask, 3, 3, 1);

      for (const v of result) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    });

    it('returns same result as featherMaskArray for small mask', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const w = 8;
      const h = 8;
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          mask[y * w + x] = x < 4 ? 255 : 0;
        }
      }

      const gpu = await accel.gaussianBlur(mask, w, h, 2);
      const cpu = featherMaskArray(mask, w, h, 2);

      expect(gpu.length).toBe(cpu.length);
      for (let i = 0; i < gpu.length; i++) {
        expect(gpu[i]).toBe(cpu[i]);
      }
    });

    it('returns same result as featherMaskArray for radius=0 (no-op)', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const mask = new Uint8Array([0, 255, 128, 64]);
      const gpu = await accel.gaussianBlur(mask, 2, 2, 0);
      const cpu = featherMaskArray(mask, 2, 2, 0);

      expect(Array.from(gpu)).toEqual(Array.from(cpu));
    });
  });

  describe('chwPack', () => {
    it('falls back to CPU when WebGPU unavailable', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
      const result = await accel.chwPack({ data, width: 2, height: 1 });

      expect(result.length).toBe(6);
      expect(result[0]).toBeCloseTo(1);
      expect(result[1]).toBeCloseTo(0);
      expect(result[3]).toBeCloseTo(1);
    });
  });

  describe('thresholdResizeConfidence', () => {
    it('falls back to CPU when WebGPU unavailable', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const outputData = new Float32Array([0.9, 0.1, 0.95, 0.05, 0.6, 0.4, 0.8, 0.2]);
      const result = await accel.thresholdResizeConfidence(outputData, 4, 2, 2, 1, 0.5);

      expect(result).toHaveProperty('mask');
      expect(result).toHaveProperty('confidence');
      expect(result.mask.length).toBe(2);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('returns same mask as CPU chain', async () => {
      const accel = GpuAccelerator.getInstance();
      await accel.initialize();

      const outputData = new Float32Array([0.9, 0.1, 0.95, 0.05]);
      const result = await accel.thresholdResizeConfidence(outputData, 2, 2, 4, 4, 0.5);

      const rawMask = thresholdMask(outputData, 0.5);
      const expectedMask = resizeMaskNearestNeighbor(rawMask, 2, 2, 4, 4);

      expect(Array.from(result.mask)).toEqual(Array.from(expectedMask));
    });
  });
});

describe('gpuFeatherMask', () => {
  it('returns a Uint8Array', async () => {
    const mask = new Uint8Array([255, 0, 255, 0]);
    const result = await gpuFeatherMask(mask, 2, 2, 1);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(4);
  });

  it('matches CPU featherMaskArray output', async () => {
    const w = 6;
    const h = 6;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = x < 3 ? 255 : 0;
      }
    }

    const gpuResult = await gpuFeatherMask(mask, w, h, 2);
    const cpuResult = featherMaskArray(mask, w, h, 2);

    expect(Array.from(gpuResult)).toEqual(Array.from(cpuResult));
  });

  it('handles empty mask gracefully', async () => {
    const mask = new Uint8Array(0);
    const result = await gpuFeatherMask(mask, 0, 0, 2);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });
});

describe('resetInstance', () => {
  it('clears cached state and allows fresh initialization', () => {
    const accel = GpuAccelerator.getInstance();
    GpuAccelerator.resetInstance();
    const newAccel = GpuAccelerator.getInstance();
    expect(newAccel).not.toBe(accel);
  });
});

describe('getGpuCapabilities', () => {
  it('returns expected structure', async () => {
    const caps = await getGpuCapabilities();

    expect(caps).toHaveProperty('available');
    expect(caps).toHaveProperty('maxTextureDimension');
    expect(caps).toHaveProperty('acceleratedOps');
    expect(caps).toHaveProperty('adapterName');

    // In the test environment, WebGPU is unavailable
    expect(typeof caps.available).toBe('boolean');
    expect(typeof caps.maxTextureDimension).toBe('number');
    expect(Array.isArray(caps.acceleratedOps)).toBe(true);
    expect(typeof caps.adapterName).toBe('string');
  });

  it('returns consistent results on repeated calls', async () => {
    const caps1 = await getGpuCapabilities();
    const caps2 = await getGpuCapabilities();

    expect(caps1.available).toBe(caps2.available);
    expect(caps1.maxTextureDimension).toBe(caps2.maxTextureDimension);
  });
});
