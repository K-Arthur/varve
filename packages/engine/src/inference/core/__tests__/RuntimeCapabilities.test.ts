import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGenerativeEditResourceProfile } from '../../../generativeEdit/resourcePolicy';
import {
  createDiagnosticsLabel,
  getBestOnnxProviders,
  getRuntimeCapabilities,
  getRuntimeCapabilitiesSync,
  isQuantizationBeneficial,
  resetRuntimeCapabilities,
} from '../RuntimeCapabilities';

describe('RuntimeCapabilities', () => {
  const navigatorDescriptors = new Map<string, PropertyDescriptor | undefined>();

  function emulateNavigator(values: {
    userAgent: string;
    platform: string;
    deviceMemory: number;
    userAgentData?: unknown;
  }): void {
    for (const [key, value] of Object.entries(values)) {
      navigatorDescriptors.set(key, Object.getOwnPropertyDescriptor(navigator, key));
      Object.defineProperty(navigator, key, {
        configurable: true,
        value,
      });
    }
  }

  afterEach(() => {
    for (const [key, descriptor] of navigatorDescriptors) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    }
    navigatorDescriptors.clear();
    resetRuntimeCapabilities();
  });

  beforeEach(() => {
    resetRuntimeCapabilities();
  });

  it('returns sync capabilities with conservative defaults', () => {
    const caps = getRuntimeCapabilitiesSync();
    expect(caps.hasWebGPU).toBe(false);
    expect(caps.preferredOnnxProviders).toContain('wasm');
    expect(caps.wasmSafeModelBytes).toBeGreaterThan(0);
  });

  it('classifies a low-memory ARM Chromebook conservatively', () => {
    emulateNavigator({
      userAgent:
        'Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      platform: 'Linux aarch64',
      deviceMemory: 2,
    });

    const caps = getRuntimeCapabilitiesSync();
    expect(caps.os).toBe('chromeos');
    expect(caps.cpuArch).toBe('arm64');
    expect(caps.memoryTier).toBe('low');
    expect(caps.approximateMemoryMB).toBe(2048);
    expect(caps.wasmSafePeakBytes).toBeLessThanOrEqual(400_000_000);
    expect(caps.preferredOnnxProviders).toEqual(['wasm']);

    expect(getGenerativeEditResourceProfile(caps)).toMatchObject({
      tier: 'constrained',
      platform: 'chromeos',
      architecture: 'arm64',
      executionBackend: 'wasm',
      approximateMemoryBytes: 2_048_000_000,
    });
  });

  it('uses reduced Chromium client hints for a Chromebook ARM profile', async () => {
    emulateNavigator({
      userAgent: 'Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      platform: 'Linux',
      deviceMemory: 2,
      userAgentData: {
        platform: 'Chrome OS',
        architecture: 'arm64',
        getHighEntropyValues: async () => ({ architecture: 'arm64' }),
      },
    });

    const caps = await getRuntimeCapabilities();
    expect(caps.os).toBe('chromeos');
    expect(caps.cpuArch).toBe('arm64');
  });

  it('recognises an ARM browser even when the user agent is not ChromeOS', () => {
    emulateNavigator({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel Tablet arm64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      platform: 'Linux aarch64',
      deviceMemory: 4,
    });

    const caps = getRuntimeCapabilitiesSync();
    expect(caps.os).toBe('android');
    expect(caps.cpuArch).toBe('arm64');
    expect(caps.memoryTier).toBe('medium');
  });

  it('keeps 32-bit ARM distinct from ARM64', () => {
    emulateNavigator({
      userAgent: 'Mozilla/5.0 (X11; CrOS armv7l) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      platform: 'Linux armv7l',
      deviceMemory: 2,
    });

    expect(getRuntimeCapabilitiesSync().cpuArch).toBe('arm32');
  });

  it('returns async capabilities', async () => {
    const caps = await getRuntimeCapabilities();
    expect(caps.label).toBeTruthy();
    expect(caps.preferredOnnxProviders.length).toBeGreaterThanOrEqual(1);
  });

  it('only advertises WebGPU after a real device probe succeeds', async () => {
    const destroy = () => {};
    emulateNavigator({
      userAgent: 'Mozilla/5.0 (X11; CrOS aarch64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      platform: 'Linux aarch64',
      deviceMemory: 8,
    });
    const adapter = {
      info: { vendor: 'Test', architecture: 'gpu', device: 'test', description: 'hardware' },
      limits: { maxTextureDimension2D: 8192 },
      requestDevice: async () => ({ destroy }),
    } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: async () => adapter,
    } as unknown as GPU;
    const previousGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu });
    try {
      const caps = await getRuntimeCapabilities();

      expect(caps.hasWebGPU).toBe(true);
      expect(caps.preferredOnnxProviders[0]).toBe('webgpu');
    } finally {
      if (previousGpu) Object.defineProperty(navigator, 'gpu', previousGpu);
      else Reflect.deleteProperty(navigator, 'gpu');
    }
  });

  it('caches capabilities after first call', async () => {
    const caps1 = await getRuntimeCapabilities();
    const caps2 = await getRuntimeCapabilities();
    expect(caps1).toBe(caps2);
  });

  it('reports WebGPU as not beneficial for quantization', async () => {
    const result = await isQuantizationBeneficial('webgpu', 'conv');
    expect(result.beneficial).toBe(false);
    expect(result.reason).toContain('webgpu');
  });

  it('reports WebGL as not beneficial for quantization', async () => {
    const result = await isQuantizationBeneficial('webgl', 'conv');
    expect(result.beneficial).toBe(false);
  });

  it('reports WASM as not beneficial for quantization', async () => {
    const result = await isQuantizationBeneficial('wasm', 'conv-heavy');
    expect(result.beneficial).toBe(false);
  });

  it('creates diagnostics label', async () => {
    const caps = await getRuntimeCapabilities();
    const label = createDiagnosticsLabel(caps);
    expect(label).toBeTruthy();
    expect(typeof label).toBe('string');
  });

  it('returns best ONNX providers', async () => {
    const providers = await getBestOnnxProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(1);
  });

  it('resets cache', async () => {
    await getRuntimeCapabilities();
    resetRuntimeCapabilities();
    const caps = getRuntimeCapabilitiesSync();
    expect(caps.hasWebGPU).toBe(false);
  });
});
