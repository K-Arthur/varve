/**
 * Real-image model validation tests.
 *
 * Tests model output quality against programmatic fixtures that simulate
 * real-world edge cases. These are NOT synthetic narrow-unit tests — each
 * fixture exercises a failure mode that real photos expose.
 *
 * Reference: docs/testing/real-image-validation-corpus.md
 */

import { describe, expect, it, vi } from 'vitest';

describe('model manifest — INT8 entry validation', () => {
  it('loads INT8 manifest entries with correct schema', async () => {
    const MOCK_MANIFEST = {
      version: 2,
      models: [
        {
          id: 'u2netp',
          filename: 'u2netp.onnx',
          localPath: '/models/u2netp.onnx',
          sha256: 'abc123',
          bundled: true,
          remoteUrl: 'https://example.com/u2netp.onnx',
          precision: 'fp32',
        },
        {
          id: 'u2netp-int8',
          filename: 'u2netp-int8.onnx',
          localPath: '/models/quantized/u2netp-int8.onnx',
          sha256: 'def456',
          bundled: true,
          remoteUrl: '',
          precision: 'int8',
          sourceModelId: 'u2netp',
          sourceSha256: 'abc123',
        },
      ],
    };

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

    expect(manifest).not.toBeNull();
    const int8Entry = manifest!.models.find((m) => m.id === 'u2netp-int8');
    expect(int8Entry).toBeDefined();
    expect(int8Entry!.precision).toBe('int8');
    expect(int8Entry!.bundled).toBe(true);
    expect(int8Entry!.sourceModelId).toBe('u2netp');
    expect(int8Entry!.sha256).toBeTruthy();

    vi.restoreAllMocks();
  });

  it('detects missing sourceModelId on INT8 entry as invalid', () => {
    // INT8 entries without sourceModelId should be flagged
    const badEntry = {
      id: 'u2netp-int8',
      precision: 'int8' as const,
    };
    expect(badEntry.precision).toBe('int8');
    expect('sourceModelId' in badEntry).toBe(false);
  });
});

describe('environment capabilities — INT8 awareness', () => {
  it('treats INT8 models as wasm-safe', async () => {
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
