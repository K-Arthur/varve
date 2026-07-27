import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDiagnosticsLabel,
  getBestOnnxProviders,
  getRuntimeCapabilities,
  getRuntimeCapabilitiesSync,
  isQuantizationBeneficial,
  resetRuntimeCapabilities,
} from '../RuntimeCapabilities';

describe('RuntimeCapabilities', () => {
  beforeEach(() => {
    resetRuntimeCapabilities();
  });

  it('returns sync capabilities with conservative defaults', () => {
    const caps = getRuntimeCapabilitiesSync();
    expect(caps.hasWebGPU).toBe(false);
    expect(caps.preferredOnnxProviders).toContain('wasm');
    expect(caps.wasmSafeModelBytes).toBeGreaterThan(0);
  });

  it('returns async capabilities', async () => {
    const caps = await getRuntimeCapabilities();
    expect(caps.label).toBeTruthy();
    expect(caps.preferredOnnxProviders.length).toBeGreaterThanOrEqual(1);
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
