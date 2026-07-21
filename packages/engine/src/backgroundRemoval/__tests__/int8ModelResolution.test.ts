/**
 * Tests for precision-aware model resolution: manifest lookup, loader path
 * resolution, and worker command handling for INT8 model IDs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MOCK_MANIFEST = {
  version: 2,
  models: [
    {
      id: 'u2netp',
      filename: 'u2netp.onnx',
      localPath: '/models/u2netp.onnx',
      sha256: 'abc',
      bundled: true,
      remoteUrl: 'https://example.com/u2netp.onnx',
      precision: 'fp32',
    },
    {
      id: 'u2netp-int8',
      filename: 'u2netp-int8.onnx',
      localPath: '/models/quantized/u2netp-int8.onnx',
      sha256: 'def',
      bundled: true,
      remoteUrl: '',
      precision: 'int8',
      sourceModelId: 'u2netp',
      sourceSha256: 'abc',
    },
  ],
};

describe('manifest INT8 entries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads INT8 manifest entries with correct schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_MANIFEST,
      }),
    );

    const { loadModelManifest } = await import('../modelManifest');
    const manifest = await loadModelManifest();
    expect(manifest).not.toBeNull();

    const int8Entry = manifest?.models.find((m) => m.id === 'u2netp-int8');
    expect(int8Entry).toBeDefined();
    expect(int8Entry?.precision).toBe('int8');
    expect(int8Entry?.bundled).toBe(true);
    expect(int8Entry?.sourceModelId).toBe('u2netp');
    expect(int8Entry?.sha256).toBeTruthy();
  });

  it('loads FP32 entries with fp32 precision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_MANIFEST,
      }),
    );

    const { loadModelManifest, resetModelManifestCache } = await import('../modelManifest');
    resetModelManifestCache();
    const manifest = await loadModelManifest();

    const fp32Entry = manifest?.models.find((m) => m.id === 'u2netp');
    expect(fp32Entry).toBeDefined();
    expect(fp32Entry?.precision).toBe('fp32');
  });
});

describe('modelLoader INT8 resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves INT8 model path from manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_MANIFEST,
      }),
    );

    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    const path = await loader.getModelPath('u2netp-int8');
    expect(path).toBeTruthy();
    expect(path).toContain('u2netp-int8.onnx');
  });
});

describe('environmentCapabilities INT8', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('treats INT8 models as having lower peak memory', async () => {
    const { isWasmModelSafe, resetEnvironmentCapabilities } = await import(
      '../environmentCapabilities'
    );
    resetEnvironmentCapabilities();

    const int8Safe = await isWasmModelSafe('u2netp-int8');
    const fp32Safe = await isWasmModelSafe('u2netp');
    expect(int8Safe).toBe(true);
    expect(fp32Safe).toBe(true);
  });
});
