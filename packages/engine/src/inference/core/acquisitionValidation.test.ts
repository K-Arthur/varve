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

describe('acquisition schema validation', () => {
  describe('deriveAcquisition', () => {
    it('bundled models resolve to kind=bundled with assetPath', () => {
      const entry = makeEntry({ bundled: true, localPath: '/models/test.onnx' });
      const result = deriveAcquisition(entry);
      expect(result.kind).toBe('bundled');
      if (result.kind === 'bundled') {
        expect(result.assetPath).toBe('/models/test.onnx');
        expect(result.sha256).toBe('');
      }
    });

    it('bundled without localPath uses default path', () => {
      const entry = makeEntry({ bundled: true, localPath: undefined });
      const result = deriveAcquisition(entry);
      expect(result.kind).toBe('bundled');
      if (result.kind === 'bundled') {
        expect(result.assetPath).toBe('/models/test-model.onnx');
      }
    });

    it('remote URL with checksum resolves to kind=remote', () => {
      const entry = makeEntry({
        remoteUrl: 'https://example.com/model.onnx',
        checksum: 'abc123def',
      });
      const result = deriveAcquisition(entry);
      expect(result.kind).toBe('remote');
      if (result.kind === 'remote') {
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0]?.url).toBe('https://example.com/model.onnx');
        expect(result.sources[0]?.sha256).toBe('abc123def');
        expect(result.sha256).toBe('abc123def');
      }
    });

    it('remote URL without checksum resolves to kind=unavailable', () => {
      const entry = makeEntry({
        remoteUrl: 'https://example.com/model.onnx',
        checksum: '',
      });
      const result = deriveAcquisition(entry);
      expect(result.kind).toBe('unavailable');
    });

    it('empty URL and not bundled resolves to kind=unavailable', () => {
      const entry = makeEntry({ remoteUrl: '', bundled: false });
      const result = deriveAcquisition(entry);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reasonCode).toBe('source-unavailable');
        expect(result.detail).toBeTruthy();
      }
    });
  });

  describe('resolveAcquisition', () => {
    it('uses explicit acquisition when present', () => {
      const entry = makeEntry({
        remoteUrl: '',
        bundled: false,
        acquisition: {
          kind: 'generated',
          recipeId: 'test-recipe',
          sourceWeights: [{ url: 'https://upstream.com/w.pth', sha256: 'xyz' }],
        },
      });
      const result = resolveAcquisition(entry);
      expect(result.kind).toBe('generated');
    });

    it('falls back to deriveAcquisition when no explicit field', () => {
      const entry = makeEntry({ bundled: true });
      const result = resolveAcquisition(entry);
      expect(result.kind).toBe('bundled');
    });

    it('explicit unavailable overrides legacy fields', () => {
      const entry = makeEntry({
        remoteUrl: 'https://has-url.com/model.onnx',
        checksum: 'haschecksum',
        acquisition: {
          kind: 'unavailable',
          reasonCode: 'license-restricted',
          detail: 'Non-commercial license only',
        },
      });
      const result = resolveAcquisition(entry);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reasonCode).toBe('license-restricted');
      }
    });
  });

  describe('acquisition invariants', () => {
    it('every model state maps to exactly one acquisition kind', () => {
      const cases = [
        makeEntry({ bundled: true }),
        makeEntry({ remoteUrl: 'https://x.com/m.onnx', checksum: 'abc' }),
        makeEntry({ remoteUrl: '', bundled: false }),
        makeEntry({ remoteUrl: 'https://x.com/m.onnx', checksum: '' }),
      ];
      for (const entry of cases) {
        const result = resolveAcquisition(entry);
        expect(['bundled', 'remote', 'generated', 'manual-import', 'unavailable']).toContain(
          result.kind,
        );
      }
    });

    it('remote acquisition always has at least one source', () => {
      const entry = makeEntry({
        remoteUrl: 'https://x.com/m.onnx',
        checksum: 'abc',
      });
      const result = deriveAcquisition(entry);
      if (result.kind === 'remote') {
        expect(result.sources.length).toBeGreaterThan(0);
      }
    });

    it('bundled acquisition always has assetPath', () => {
      const entry = makeEntry({ bundled: true });
      const result = deriveAcquisition(entry);
      if (result.kind === 'bundled') {
        expect(result.assetPath).toBeTruthy();
      }
    });
  });
});
