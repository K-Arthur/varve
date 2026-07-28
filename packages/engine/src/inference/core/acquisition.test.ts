import { describe, expect, it } from 'vitest';
import type { ModelManifestEntry } from '../types';
import { deriveAcquisition, resolveAcquisition } from './types';

function makeEntry(overrides: Partial<ModelManifestEntry> = {}): ModelManifestEntry {
  return {
    id: 'test-model',
    name: 'Test Model',
    description: 'Test',
    sizeBytes: 10_000_000,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3,
    speed: 3,
    peakMemoryBytes: 40_000_000,
    gpuRecommended: false,
    maxSessions: 1,
    precision: 'fp32',
    category: 'classification',
    ...overrides,
  };
}

describe('deriveAcquisition', () => {
  it('returns bundled for bundled models', () => {
    const entry = makeEntry({ bundled: true, localPath: '/models/test.onnx' });
    const result = deriveAcquisition(entry);
    expect(result.kind).toBe('bundled');
    if (result.kind === 'bundled') {
      expect(result.assetPath).toBe('/models/test.onnx');
    }
  });

  it('returns remote for models with URL and checksum', () => {
    const entry = makeEntry({
      remoteUrl: 'https://example.com/model.onnx',
      checksum: 'abc123',
    });
    const result = deriveAcquisition(entry);
    expect(result.kind).toBe('remote');
    if (result.kind === 'remote') {
      expect(result.sources[0]?.url).toBe('https://example.com/model.onnx');
      expect(result.sha256).toBe('abc123');
    }
  });

  it('returns unavailable for empty URL and not bundled', () => {
    const entry = makeEntry({ remoteUrl: '', bundled: false });
    const result = deriveAcquisition(entry);
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reasonCode).toBe('source-unavailable');
    }
  });

  it('returns unavailable for URL without checksum', () => {
    const entry = makeEntry({ remoteUrl: 'https://example.com/model.onnx', checksum: '' });
    const result = deriveAcquisition(entry);
    expect(result.kind).toBe('unavailable');
  });
});

describe('resolveAcquisition', () => {
  it('prefers explicit acquisition over legacy derivation', () => {
    const entry = makeEntry({
      remoteUrl: 'https://example.com/model.onnx',
      checksum: 'abc123',
      acquisition: {
        kind: 'generated',
        recipeId: 'test-recipe',
        sourceWeights: [{ url: 'https://upstream.com/weights.pth', sha256: 'def456' }],
      },
    });
    const result = resolveAcquisition(entry);
    expect(result.kind).toBe('generated');
    if (result.kind === 'generated') {
      expect(result.recipeId).toBe('test-recipe');
    }
  });

  it('falls back to deriveAcquisition when no explicit field', () => {
    const entry = makeEntry({ bundled: true });
    const result = resolveAcquisition(entry);
    expect(result.kind).toBe('bundled');
  });
});

describe('acquisition discriminated union', () => {
  it('bundled requires assetPath and sha256', () => {
    const entry: ModelManifestEntry = makeEntry({
      acquisition: {
        kind: 'bundled',
        assetPath: '/models/x.onnx',
        sha256: 'deadbeef',
      },
    });
    expect(entry.acquisition!.kind).toBe('bundled');
  });

  it('generated requires recipeId and sourceWeights', () => {
    const entry: ModelManifestEntry = makeEntry({
      acquisition: {
        kind: 'generated',
        recipeId: 'ddcolor-v1',
        sourceWeights: [
          {
            url: 'https://huggingface.co/p/resolve/main/w.pth',
            sha256: 'abc',
          },
        ],
      },
    });
    expect(entry.acquisition!.kind).toBe('generated');
  });

  it('unavailable requires reasonCode and detail', () => {
    const entry: ModelManifestEntry = makeEntry({
      acquisition: {
        kind: 'unavailable',
        reasonCode: 'no-public-onnx',
        detail: 'No public ONNX export exists',
      },
    });
    expect(entry.acquisition!.kind).toBe('unavailable');
  });
});
