import { describe, expect, it } from 'vitest';
import {
  determineModelAvailability,
  validateManifest,
  validateManifestEntry,
} from '../ManifestValidator';
import type { ManifestEntry } from '../types';

function makeEntry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    id: 'test-model',
    filename: 'test.onnx',
    localPath: '/models/test.onnx',
    sha256: 'abc123def456',
    bundled: false,
    remoteUrl: 'https://example.com/models/test.onnx',
    precision: 'fp32',
    modelVersion: '1.0.0',
    sourceLicense: 'MIT',
    preprocessingVersion: 1,
    postprocessingVersion: 1,
    supportedProviders: ['wasm', 'webgpu'],
    ...overrides,
  };
}

describe('ManifestValidator', () => {
  describe('validateManifestEntry', () => {
    it('accepts a valid entry without issues', () => {
      const issues = validateManifestEntry(makeEntry({}));
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('rejects entry with no ID', () => {
      const entry = makeEntry({ id: '' });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('rejects entry with placeholder URL', () => {
      const entry = makeEntry({ remoteUrl: '' });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.field === 'remoteUrl' && i.severity === 'error')).toBe(true);
    });

    it('rejects non-bundled entry with missing SHA-256', () => {
      const entry = makeEntry({ sha256: null, bundled: false });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.field === 'sha256' && i.severity === 'error')).toBe(true);
    });

    it('does not require SHA-256 for bundled models', () => {
      const entry = makeEntry({ sha256: null, bundled: true, localPath: '/models/bundled.onnx' });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.field === 'sha256' && i.severity === 'error')).toBe(false);
    });

    it('warns about missing license', () => {
      const entry = makeEntry({ sourceLicense: '' });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.field === 'sourceLicense')).toBe(true);
    });

    it('flags non-HTTPS URL as warning', () => {
      const entry = makeEntry({ remoteUrl: 'http://example.com/model.onnx' });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.field === 'remoteUrl' && i.message.includes('HTTPS'))).toBe(true);
    });

    it('detects duplicate component filenames', () => {
      const entry = makeEntry({
        components: [
          {
            id: 'comp1',
            role: 'encoder',
            filename: 'same.onnx',
            sizeBytes: 100,
            remoteUrl: 'https://example.com/a.onnx',
          },
          {
            id: 'comp2',
            role: 'decoder',
            filename: 'same.onnx',
            sizeBytes: 200,
            remoteUrl: 'https://example.com/b.onnx',
          },
        ],
      });
      const issues = validateManifestEntry(entry);
      expect(issues.some((i) => i.message.includes('Duplicate filenames'))).toBe(true);
    });

    it('flags duplicate model IDs', () => {
      const issues = validateManifest([makeEntry({ id: 'dup' }), makeEntry({ id: 'dup' })]);
      expect(issues.errors.some((i) => i.message.includes('Duplicate model ID'))).toBe(true);
    });
  });

  describe('determineModelAvailability', () => {
    it('returns installed for bundled models', () => {
      expect(determineModelAvailability(makeEntry({ bundled: true }))).toBe('installed');
    });

    it('returns source-unavailable for empty URL', () => {
      expect(determineModelAvailability(makeEntry({ remoteUrl: '' }))).toBe('source-unavailable');
    });

    it('returns security-verification-missing for null sha256', () => {
      expect(determineModelAvailability(makeEntry({ sha256: null }))).toBe(
        'security-verification-missing',
      );
    });

    it('returns available for complete entry', () => {
      expect(determineModelAvailability(makeEntry({}))).toBe('available');
    });
  });
});
