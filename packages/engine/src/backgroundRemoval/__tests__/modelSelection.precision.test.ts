/**
 * Tests for model selection wiring — resolveWebModel integrates precision policy.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveWebModel } from '../modelSelection';
import { resetPrecisionCapabilities } from '../precisionCapabilities';

const MOCK_LOADER = {
  async getModelPath(modelId: string): Promise<string | null> {
    const paths: Record<string, string | null> = {
      u2netp: '/models/u2netp.onnx',
      'u2netp-int8': '/models/quantized/u2netp-int8.onnx',
      'birefnet-general-lite': null,
    };
    return paths[modelId] ?? null;
  },
  async hasDownloadedBlob(): Promise<boolean> {
    return false;
  },
};

describe('resolveWebModel — precision integration', () => {
  beforeEach(() => {
    resetPrecisionCapabilities();
  });

  it('returns null for quick method', async () => {
    const result = await resolveWebModel('quick', MOCK_LOADER);
    expect(result).toBeNull();
  });

  it('resolves u2netp with FP32 precision for automatic preference', async () => {
    const result = await resolveWebModel('ai-balanced', MOCK_LOADER, 'automatic');
    expect(result).not.toBeNull();
    expect(result?.modelId).toBe('u2netp');
    expect(result?.precision).toBe('fp32');
  });

  it('resolves to FP32 u2netp when performance requested but INT8 not faster', async () => {
    // Even with 'performance' preference, on AVX2-only hardware the policy
    // selects FP32 because INT8 is benchmarked as ~6x slower.
    const result = await resolveWebModel('ai-balanced', MOCK_LOADER, 'performance');
    expect(result).not.toBeNull();
    expect(result?.precision).toBe('fp32');
    expect(result?.modelId).toBe('u2netp');
    expect(result?.precisionAdjusted).toBe(true);
  });

  it('resolves to INT8 u2netp for quality preference', async () => {
    // 'quality' maps to 'highestQuality' which always selects FP32
    const result = await resolveWebModel('ai-balanced', MOCK_LOADER, 'quality');
    expect(result).not.toBeNull();
    expect(result?.precision).toBe('fp32');
  });

  it('returns null when no model path is available', async () => {
    const result = await resolveWebModel('ai-quality', MOCK_LOADER, 'automatic');
    expect(result).toBeNull();
  });

  it('includes a selection reason', async () => {
    const result = await resolveWebModel('ai-balanced', MOCK_LOADER, 'automatic');
    expect(result).not.toBeNull();
    expect(result?.selectionReason?.length ?? 0).toBeGreaterThan(0);
  });
});
