import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInt8Variant,
  getModelEntry,
  getQuantizedModels,
  getSourceModels,
  isInt8Validated,
  loadModelCatalog,
  resetManifestCache,
} from './manifest';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const MANIFEST_BODY = {
  version: 2,
  models: [
    {
      id: 'u2netp',
      filename: 'u2netp.onnx',
      localPath: '/models/u2netp.onnx',
      sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
      bundled: true,
      remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
      precision: 'fp32',
    },
    {
      id: 'u2netp-int8',
      filename: 'u2netp-int8.onnx',
      localPath: '/models/quantized/u2netp-int8.onnx',
      sha256: '7b3355af9c9f76d75c3ad263f711c4ef20f812bae426b798d89c80e098b9edf3',
      bundled: true,
      remoteUrl: '',
      precision: 'int8',
      sourceModelId: 'u2netp',
      sourceSha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    },
    {
      id: 'upscale-realesr-general',
      filename: 'realesr-general-x4v3.onnx',
      localPath: '/models/realesr-general-x4v3.onnx',
      sha256: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
      bundled: true,
      remoteUrl: '',
      precision: 'fp32',
    },
    {
      id: 'upscale-realesr-general-int8',
      filename: 'realesr-general-x4v3-int8.onnx',
      localPath: '/models/quantized/realesr-general-x4v3-int8.onnx',
      sha256: '357ebd6732007dbb0d663931e8a7f923baaf9f20a4ca38511fbcd90a1fa06711',
      bundled: true,
      remoteUrl: '',
      precision: 'int8',
      sourceModelId: 'upscale-realesr-general',
      sourceSha256: '856e1f4d77f553e8871302f1782b58e315a12dac52bb0b856dde2dde149b96f7',
    },
  ],
};

describe('loadModelCatalog', () => {
  beforeEach(() => {
    resetManifestCache();
    mockFetch.mockReset();
  });

  it('loads and normalizes all models from manifest', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MANIFEST_BODY,
    });

    const catalog = await loadModelCatalog();
    expect(catalog).not.toBeNull();
    expect(catalog!.length).toBe(4);
  });

  it('assigns categories correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MANIFEST_BODY,
    });

    const catalog = await loadModelCatalog();
    const segModels = catalog!.filter((m) => m.category === 'segmentation');
    const upscaleModels = catalog!.filter((m) => m.category === 'upscaling');
    expect(segModels.length).toBe(2);
    expect(upscaleModels.length).toBe(2);
  });

  it('marks precision on all entries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MANIFEST_BODY,
    });

    const catalog = await loadModelCatalog();
    for (const entry of catalog!) {
      expect(['fp32', 'int8']).toContain(entry.precision);
    }
  });

  it('returns null on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const catalog = await loadModelCatalog();
    expect(catalog).toBeNull();
  });

  it('caches the result on repeated calls', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MANIFEST_BODY,
    });

    await loadModelCatalog();
    await loadModelCatalog();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('resets cache when requested', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MANIFEST_BODY,
    });

    await loadModelCatalog();
    resetManifestCache();
    await loadModelCatalog();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getModelEntry', () => {
  beforeEach(() => {
    resetManifestCache();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MANIFEST_BODY,
    });
  });

  it('finds a model by ID', async () => {
    const entry = await getModelEntry('u2netp');
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('u2netp');
    expect(entry!.bundled).toBe(true);
  });

  it('returns null for unknown model', async () => {
    const entry = await getModelEntry('nonexistent');
    expect(entry).toBeNull();
  });

  it('returns entry with precision metadata', async () => {
    const entry = await getModelEntry('u2netp-int8');
    expect(entry!.precision).toBe('int8');
    expect(entry!.sourceModelId).toBe('u2netp');
    expect(entry!.sourceSha256).toBeTruthy();
  });
});

describe('getSources / getQuantized / getInt8Variant', () => {
  beforeEach(() => {
    resetManifestCache();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MANIFEST_BODY,
    });
  });

  it('getSourceModels returns only FP32 models', async () => {
    const sources = await getSourceModels();
    expect(sources.every((m) => m.precision === 'fp32')).toBe(true);
  });

  it('getQuantizedModels returns only INT8 models', async () => {
    const quantized = await getQuantizedModels();
    expect(quantized.every((m) => m.precision === 'int8')).toBe(true);
  });

  it('getInt8Variant finds the INT8 variant for a source model', async () => {
    const variant = await getInt8Variant('u2netp');
    expect(variant).not.toBeNull();
    expect(variant!.id).toBe('u2netp-int8');
  });

  it('getInt8Variant returns null for model without INT8 variant', async () => {
    const variant = await getInt8Variant('nonexistent');
    expect(variant).toBeNull();
  });
});

describe('isInt8Validated', () => {
  beforeEach(() => {
    resetManifestCache();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MANIFEST_BODY,
    });
  });

  it('returns false for FP32 model', async () => {
    const validated = await isInt8Validated('u2netp');
    expect(validated).toBe(false);
  });

  it('returns false for bundled INT8 models — validation not assumed', async () => {
    // Quality validation is NOT assumed to pass. The actual validation
    // reports (apps/desktop/public/models/quantized/*-validation-report.json)
    // show overall_passed: false for both models on synthetic data.
    // normalizeEntry correctly reflects this.
    const validated = await isInt8Validated('u2netp-int8');
    expect(validated).toBe(false);
  });

  it('returns false for all bundled INT8 models without proof', async () => {
    const validated = await isInt8Validated('upscale-realesr-general-int8');
    expect(validated).toBe(false);
  });
});

describe('model catalog normalization', () => {
  beforeEach(() => {
    resetManifestCache();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MANIFEST_BODY,
    });
  });

  it('assigns descriptions to all models', async () => {
    const catalog = await loadModelCatalog();
    for (const entry of catalog!) {
      expect(entry.description).toBeTruthy();
    }
  });

  it('assigns quality ratings to all models', async () => {
    const catalog = await loadModelCatalog();
    for (const entry of catalog!) {
      expect(entry.quality).toBeGreaterThan(0);
    }
  });

  it('assigns peak memory estimates to all models', async () => {
    const catalog = await loadModelCatalog();
    for (const entry of catalog!) {
      expect(entry.peakMemoryBytes).toBeGreaterThan(0);
    }
  });

  it('INT8 variants have sourceModelId and sourceSha256', async () => {
    const catalog = await loadModelCatalog();
    for (const entry of catalog!.filter((m) => m.precision === 'int8')) {
      expect(entry.sourceModelId).toBeTruthy();
      expect(entry.sourceSha256).toBeTruthy();
    }
  });

  it('FP32 models do not have sourceModelId', async () => {
    const catalog = await loadModelCatalog();
    for (const entry of catalog!.filter((m) => m.precision === 'fp32')) {
      expect(entry.sourceModelId).toBeUndefined();
    }
  });
});
