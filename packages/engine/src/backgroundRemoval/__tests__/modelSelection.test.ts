import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveWebModel, resolveWebModelPeakBytes } from '../modelSelection';

describe('resolveWebModel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('uses bundled U2-Net Light when enhanced Balanced is not installed', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async (id: string) => `/models/${id}.onnx`),
    };
    await expect(resolveWebModel('ai-balanced', loader)).resolves.toEqual({
      modelId: 'u2netp',
      modelPath: '/models/u2netp.onnx',
      precision: 'fp32',
      precisionAdjusted: false,
      selectionReason: expect.stringContaining('FP32'),
    });
  });

  it('prefers explicitly installed IS-Net for Balanced', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };
    await expect(resolveWebModel('ai-balanced', loader)).resolves.toEqual({
      modelId: 'isnet-general-use',
      modelPath: 'blob:isnet-general-use',
      precision: 'fp32',
      precisionAdjusted: false,
      selectionReason: expect.stringContaining('User-downloaded'),
    });
  });

  it('falls back to FP32 when performance preference set but INT8 not faster', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async (id: string) => `/models/${id}.onnx`),
    };
    const result = await resolveWebModel('ai-balanced', loader, 'performance');
    expect(result).toMatchObject({
      modelId: 'u2netp',
      precision: 'fp32',
      precisionAdjusted: true,
    });
    expect(result?.selectionReason).toContain('INT8 not faster');
  });

  it('falls back to FP32 when INT8 not available for performance preference', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async (id: string) => {
        if (id.endsWith('-int8')) return null;
        return `/models/${id}.onnx`;
      }),
    };
    await expect(resolveWebModel('ai-balanced', loader, 'performance')).resolves.toMatchObject({
      modelId: 'u2netp',
      precision: 'fp32',
    });
  });
});

describe('resolveWebModelPeakBytes', () => {
  it('reports the bundled u2netp working set when no enhanced model is installed', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async (id: string) => `/models/${id}.onnx`),
    };
    await expect(resolveWebModelPeakBytes('ai-balanced', loader)).resolves.toEqual({
      modelId: 'u2netp',
      peakMemoryBytes: 330_000_000,
    });
  });

  it('reports the installed IS-Net working set instead of the u2netp fallback', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(true),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };
    await expect(resolveWebModelPeakBytes('ai-balanced', loader)).resolves.toEqual({
      modelId: 'isnet-general-use',
      peakMemoryBytes: 1_300_000_000,
    });
  });

  it('reports the installed BiRefNet Lite working set for quality requests', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn(async (id: string) => id === 'birefnet-general-lite'),
      getModelPath: vi.fn(async (id: string) => `blob:${id}`),
    };
    await expect(resolveWebModelPeakBytes('ai-quality', loader)).resolves.toEqual({
      modelId: 'birefnet-general-lite',
      peakMemoryBytes: 7_000_000_000,
    });
  });

  it('returns null for quick mode and when nothing resolves', async () => {
    const loader = {
      hasDownloadedBlob: vi.fn().mockResolvedValue(false),
      getModelPath: vi.fn(async () => null),
    };
    await expect(resolveWebModelPeakBytes('quick', loader)).resolves.toBeNull();
    await expect(resolveWebModelPeakBytes('ai-balanced', loader)).resolves.toBeNull();
  });
});
