/**
 * Tests for precision selection policy — maps user intent to model/precision.
 *
 * Verifies that:
 * - 'automatic' selects FP32-safe (not INT8) without benchmark proof
 * - 'fastest' selects FP32 on AVX2-only hardware
 * - 'smallDownload' falls back to FP32 when INT8 failed quality validation
 * - 'lowMemory' falls back to FP32 when INT8 failed quality validation
 * - 'highestQuality' always selects FP32
 * - Models without INT8 variants always use FP32
 * - preferenceToMode maps legacy preferences correctly
 * - INT8 quality gate prevents selecting models that failed validation
 *
 * Quality gate rationale: u2netp-int8 and upscale-realesr-general-int8 both
 * failed quality validation (MAE 0.4177 / PSNR 3.8dB for u2netp; correlation
 * loss 0.22 for Real-ESRGAN). Selecting them would produce garbage output.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resetPrecisionCapabilities } from '../precisionCapabilities';
import {
  DEFAULT_PRECISION_MODE,
  preferenceToMode,
  selectModelVariant,
  selectModelVariantSync,
} from '../precisionPolicy';

describe('DEFAULT_PRECISION_MODE', () => {
  it('is automatic', () => {
    expect(DEFAULT_PRECISION_MODE).toBe('automatic');
  });
});

describe('preferenceToMode', () => {
  it('maps performance to fastest', () => {
    expect(preferenceToMode('performance')).toBe('fastest');
  });

  it('maps quality to highestQuality', () => {
    expect(preferenceToMode('quality')).toBe('highestQuality');
  });

  it('maps automatic to automatic', () => {
    expect(preferenceToMode('automatic')).toBe('automatic');
  });
});

describe('selectModelVariant — automatic mode (AVX2-only)', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('selects FP32 for u2netp without benchmark proof', async () => {
    const sel = await selectModelVariant('u2netp', 'automatic', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(false);
  });

  it('selects FP32 for upscaling model without benchmark proof', async () => {
    const sel = await selectModelVariant('upscale-realesr-general', 'automatic', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('upscale-realesr-general');
  });
});

describe('selectModelVariant — fastest mode (AVX2-only)', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('selects FP32 on AVX2-only hardware (INT8 is slower)', async () => {
    const sel = await selectModelVariant('u2netp', 'fastest', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(true);
    expect(sel.label).toContain('FP32');
  });

  it('fastest mode reason mentions the hardware', async () => {
    const sel = await selectModelVariant('u2netp', 'fastest', 'wasm');
    expect(sel.reason.length).toBeGreaterThan(0);
  });
});

describe('selectModelVariant — smallDownload mode', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('falls back to FP32 for u2netp (INT8 failed quality validation)', async () => {
    const sel = await selectModelVariant('u2netp', 'smallDownload', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(true);
    expect(sel.reason).toContain('quality validation');
  });

  it('falls back to FP32 for upscaling model (INT8 failed quality validation)', async () => {
    const sel = await selectModelVariant('upscale-realesr-general', 'smallDownload', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('upscale-realesr-general');
    expect(sel.adjusted).toBe(true);
  });

  it('reports the FP32 download size when INT8 is quality-failed', async () => {
    const sel = await selectModelVariant('u2netp', 'smallDownload', 'wasm');
    expect(sel.downloadSizeBytes).toBe(4_574_861);
  });
});

describe('selectModelVariant — lowMemory mode', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('falls back to FP32 for u2netp (INT8 failed quality validation)', async () => {
    const sel = await selectModelVariant('u2netp', 'lowMemory', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(true);
    expect(sel.reason).toContain('quality validation');
  });
});

describe('selectModelVariant — highestQuality mode', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('always selects FP32 for u2netp', async () => {
    const sel = await selectModelVariant('u2netp', 'highestQuality', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(false);
  });

  it('always selects FP32 for upscaling model', async () => {
    const sel = await selectModelVariant('upscale-realesr-general', 'highestQuality', 'wasm');
    expect(sel.precision).toBe('fp32');
  });
});

describe('selectModelVariant — models without INT8 variant', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('always returns FP32 for isnet-general-use', async () => {
    const sel = await selectModelVariant('isnet-general-use', 'smallDownload', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('isnet-general-use');
  });

  it('always returns FP32 for birefnet-general-lite', async () => {
    const sel = await selectModelVariant('birefnet-general-lite', 'fastest', 'wasm');
    expect(sel.precision).toBe('fp32');
  });
});

describe('selectModelVariantSync', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('returns FP32 for automatic mode synchronously', () => {
    const sel = selectModelVariantSync('u2netp', 'automatic', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
  });

  it('returns FP32 for smallDownload mode synchronously (INT8 quality-failed)', () => {
    const sel = selectModelVariantSync('u2netp', 'smallDownload', 'wasm');
    expect(sel.precision).toBe('fp32');
    expect(sel.modelId).toBe('u2netp');
    expect(sel.adjusted).toBe(true);
  });
});

describe('AVX2-only regression — policy never selects INT8 for inference', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('automatic mode on WASM must not select INT8', async () => {
    // Core regression: INT8 is ~6x slower on AVX2-only CPUs.
    // Automatic mode must default to FP32.
    const sel = await selectModelVariant('u2netp', 'automatic', 'wasm');
    expect(sel.precision).toBe('fp32');
  });

  it('fastest mode on WASM must not select INT8', async () => {
    const sel = await selectModelVariant('u2netp', 'fastest', 'wasm');
    expect(sel.precision).toBe('fp32');
  });

  it('no mode selects INT8 on WASM (quality gate + AVX2-only)', async () => {
    // INT8 is both slower on AVX2-only CPUs AND failed quality validation.
    // Every mode must fall back to FP32.
    const modes = ['automatic', 'fastest', 'highestQuality', 'smallDownload', 'lowMemory'] as const;
    for (const mode of modes) {
      const sel = await selectModelVariant('u2netp', mode, 'wasm');
      expect(sel.precision).toBe('fp32');
    }
  });

  it('no mode selects INT8 for upscaling model on WASM', async () => {
    const modes = ['automatic', 'fastest', 'smallDownload', 'lowMemory'] as const;
    for (const mode of modes) {
      const sel = await selectModelVariant('upscale-realesr-general', mode, 'wasm');
      expect(sel.precision).toBe('fp32');
    }
  });
});

describe('INT8 quality gate regression', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('smallDownload never selects u2netp-int8 (failed validation)', async () => {
    const sel = await selectModelVariant('u2netp', 'smallDownload', 'wasm');
    expect(sel.modelId).not.toBe('u2netp-int8');
    expect(sel.precision).toBe('fp32');
  });

  it('lowMemory never selects u2netp-int8 (failed validation)', async () => {
    const sel = await selectModelVariant('u2netp', 'lowMemory', 'wasm');
    expect(sel.modelId).not.toBe('u2netp-int8');
    expect(sel.precision).toBe('fp32');
  });

  it('smallDownload never selects realesr-general-x4v3-int8 (failed validation)', async () => {
    const sel = await selectModelVariant('upscale-realesr-general', 'smallDownload', 'wasm');
    expect(sel.modelId).not.toBe('upscale-realesr-general-int8');
    expect(sel.precision).toBe('fp32');
  });

  it('sync smallDownload never selects INT8 for quality-failed models', () => {
    const sel1 = selectModelVariantSync('u2netp', 'smallDownload', 'wasm');
    expect(sel1.modelId).not.toBe('u2netp-int8');
    const sel2 = selectModelVariantSync('upscale-realesr-general', 'smallDownload', 'wasm');
    expect(sel2.modelId).not.toBe('upscale-realesr-general-int8');
  });
});
