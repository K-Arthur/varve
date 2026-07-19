import { describe, expect, it } from 'vitest';
import {
  AI_BALANCED_MODEL_INFO,
  AI_QUALITY_MODEL_INFO,
  getModelInfo,
  MODEL_INFO_MAP,
} from '../modelInfo';

describe('modelInfo', () => {
  it('returns info for quick mode', () => {
    const info = getModelInfo('quick');
    expect(info).toBeDefined();
    expect(info!.diskSizeBytes).toBe(0);
    expect(info!.wasmSafe).toBe(true);
  });

  it('returns info for ai-balanced mode', () => {
    const info = getModelInfo('ai-balanced');
    expect(info).toBeDefined();
    expect(info!.diskSizeBytes).toBe(178_648_008);
    expect(info!.wasmSafe).toBe(false);
    expect(info!.description).toContain('fallback');
  });

  it('returns info for ai-quality mode', () => {
    const info = getModelInfo('ai-quality');
    expect(info).toBeDefined();
    expect(info!.diskSizeBytes).toBe(224_000_000);
    expect(info!.wasmSafe).toBe(false);
    expect(info!.gpuRecommended).toBe(true);
  });

  it('returns undefined for unknown method', () => {
    expect(getModelInfo('unknown')).toBeUndefined();
  });

  it('has all three modes in the map', () => {
    expect(Object.keys(MODEL_INFO_MAP)).toEqual(['quick', 'ai-balanced', 'ai-quality']);
  });

  it('peak RAM is larger than disk for AI models', () => {
    expect(AI_BALANCED_MODEL_INFO.estimatedPeakRamBytes).toBeGreaterThan(
      AI_BALANCED_MODEL_INFO.diskSizeBytes,
    );
    expect(AI_QUALITY_MODEL_INFO.estimatedPeakRamBytes).toBeGreaterThan(
      AI_QUALITY_MODEL_INFO.diskSizeBytes,
    );
  });

  it('all display strings are non-empty', () => {
    for (const info of Object.values(MODEL_INFO_MAP)) {
      expect(info.peakRamDisplay).toBeTruthy();
      expect(info.diskSizeDisplay).toBeTruthy();
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.quality).toBeTruthy();
    }
  });
});
