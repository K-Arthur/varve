/**
 * Tests for precision capability detection — hardware-aware INT8 acceleration.
 *
 * Verifies that:
 * - Static detection returns conservative defaults for known providers
 * - WASMprovider correctly reports INT8 as not accelerated
 * - WebGPU reports FP16 supported but INT8 not accelerated
 * - Cache invalidation works
 * - Override works
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectPrecisionCapabilities,
  getPrecisionCapabilitiesSync,
  isInt8FasterOnThisCpu,
  overridePrecisionCapabilities,
  resetPrecisionCapabilities,
} from '../precisionCapabilities';

describe('static precision detection — WASM provider', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('reports INT8 as NOT accelerated on WASM', async () => {
    const caps = await detectPrecisionCapabilities('wasm');
    expect(caps.int8Accelerated).toBe(false);
    expect(caps.provider).toBe('wasm');
    expect(caps.detectionMethod).toBe('static');
  });

  it('reports FP16 as NOT supported on WASM', async () => {
    const caps = await detectPrecisionCapabilities('wasm');
    expect(caps.fp16Supported).toBe(false);
  });

  it('mentions dequantization overhead in the reason', async () => {
    const caps = await detectPrecisionCapabilities('wasm');
    expect(caps.reason.toLowerCase()).toContain('dequantization');
  });
});

describe('static precision detection — WebGPU provider', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('reports FP16 as supported on WebGPU', async () => {
    const caps = await detectPrecisionCapabilities('webgpu');
    expect(caps.fp16Supported).toBe(true);
  });

  it('reports INT8 as NOT accelerated on WebGPU', async () => {
    const caps = await detectPrecisionCapabilities('webgpu');
    expect(caps.int8Accelerated).toBe(false);
  });
});

describe('static precision detection — native provider', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('conservatively defaults native INT8 to not accelerated', async () => {
    const caps = await detectPrecisionCapabilities('native');
    expect(caps.int8Accelerated).toBe(false);
    expect(caps.detectionMethod).toBe('static');
  });
});

describe('isInt8FasterOnThisCpu', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('returns false for WASM (AVX2-only slowdown)', async () => {
    const faster = await isInt8FasterOnThisCpu('wasm');
    expect(faster).toBe(false);
  });
});

describe('getPrecisionCapabilitiesSync', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('returns a conservative default without prior detection', () => {
    const caps = getPrecisionCapabilitiesSync('wasm');
    expect(caps.int8Accelerated).toBe(false);
    expect(caps.provider).toBe('wasm');
  });
});

describe('overridePrecisionCapabilities', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('allows manual override of INT8 acceleration', () => {
    const caps = overridePrecisionCapabilities(true, 'User override for testing', 'wasm');
    expect(caps.int8Accelerated).toBe(true);
    expect(caps.detectionMethod).toBe('override');
    expect(caps.reason).toBe('User override for testing');
  });

  it('override is reflected in sync getter', () => {
    overridePrecisionCapabilities(true, 'test', 'wasm');
    const caps = getPrecisionCapabilitiesSync('wasm');
    expect(caps.int8Accelerated).toBe(true);
  });
});

describe('AVX2-only regression', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('WASM on AVX2-only CPU must not select INT8 for inference', async () => {
    // This is the core regression test for the verified benchmark result:
    // INT8 is ~6x slower than FP32 on AVX2-only CPUs (Ryzen 3 5300U).
    // The policy must never claim INT8 is faster without benchmark proof.
    const caps = await detectPrecisionCapabilities('wasm');
    expect(caps.int8Accelerated).toBe(false);

    const faster = await isInt8FasterOnThisCpu('wasm');
    expect(faster).toBe(false);
  });
});
