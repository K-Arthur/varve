/**
 * Tests for model verification status assessment.
 *
 * Covers all verification levels: fully-verified, partially-verified,
 * unverified, verification-failed, and disabled. Ensures the UI
 * receives correct status messages and safe-for-inference flags.
 */

import { describe, expect, it } from 'vitest';
import type { ModelManifestEntry } from '../../inference/types';
import { assessModelVerification } from '../modelVerification';

function makeModel(overrides: Partial<ModelManifestEntry> = {}): ModelManifestEntry {
  return {
    id: 'test-model',
    name: 'Test Model',
    description: 'Test',
    sizeBytes: 100_000,
    remoteUrl: 'https://example.com/model.onnx',
    checksum: 'abc123',
    bundled: false,
    inputSpec: null,
    quality: 3,
    ...overrides,
  };
}

describe('assessModelVerification — fully verified', () => {
  it('returns fully-verified for a model with all checks passed', () => {
    const model = makeModel({
      validation: {
        contractVerified: true,
        contractVerifiedAt: '2026-07-21T00:00:00Z',
        contractVersion: 1,
        integrityVerified: true,
        integrityVerifiedAt: '2026-07-21T00:00:00Z',
        provenanceStatus: 'verified',
        provenanceVerifiedAt: '2026-07-21T00:00:00Z',
        inferenceVerified: true,
        inferenceVerifiedAt: '2026-07-21T00:00:00Z',
        validationSummary: 'All checks passed',
      },
      tensorContract: {
        version: 1,
        inputs: [{ name: 'input', dims: [1, 3, 100, 100], dtype: 'float32' }],
        outputs: [{ name: 'output', dims: [1, 1, 100, 100], dtype: 'float32' }],
        outputActivation: 'sigmoid',
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('fully-verified');
    expect(result.safeForInference).toBe(true);
    expect(result.checks.integrity.passed).toBe(true);
    expect(result.checks.contract.passed).toBe(true);
    expect(result.checks.inference.passed).toBe(true);
  });

  it('returns fully-verified for bundled models with SHA-256', () => {
    const model = makeModel({
      id: 'u2netp',
      bundled: true,
      checksum: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
      validation: {
        contractVerified: true,
        contractVerifiedAt: '2026-07-21T00:00:00Z',
        contractVersion: 1,
        integrityVerified: true,
        integrityVerifiedAt: '2026-07-21T00:00:00Z',
        provenanceStatus: 'unverified',
        inferenceVerified: true,
        inferenceVerifiedAt: '2026-07-21T00:00:00Z',
        validationSummary: 'Bundled model verified',
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('fully-verified');
    expect(result.safeForInference).toBe(true);
  });
});

describe('assessModelVerification — disabled', () => {
  it('returns disabled for BiRefNet Full without SHA-256', () => {
    const model = makeModel({
      id: 'birefnet-general',
      checksum: '',
      tensorContract: {
        version: 1,
        inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
        outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
        outputActivation: 'sigmoid',
      },
      validation: {
        contractVerified: false,
        integrityVerified: false,
        provenanceStatus: 'unverified',
        inferenceVerified: false,
        validationSummary: 'No SHA-256',
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('disabled');
    expect(result.safeForInference).toBe(false);
    expect(result.action?.kind).toBe('disable');
    expect(result.statusMessage).toContain('SHA-256');
  });

  it('returns disabled for BiRefNet Full with null checksum', () => {
    const model = makeModel({
      id: 'birefnet-general',
      checksum: null as unknown as string,
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('disabled');
    expect(result.safeForInference).toBe(false);
  });
});

describe('assessModelVerification — partially verified', () => {
  it('returns partially-verified for BiRefNet Lite with unverified contract', () => {
    const model = makeModel({
      id: 'birefnet-general-lite',
      checksum: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
      tensorContract: {
        version: 1,
        inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
        outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
        outputActivation: 'sigmoid',
      },
      validation: {
        contractVerified: false,
        integrityVerified: true,
        integrityVerifiedAt: '2026-07-21T00:00:00Z',
        provenanceStatus: 'unverified',
        inferenceVerified: false,
        validationSummary: 'SHA-256 verified but contract not verified',
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('partially-verified');
    expect(result.safeForInference).toBe(false);
    expect(result.checks.integrity.passed).toBe(true);
    expect(result.checks.contract.passed).toBe(false);
    expect(result.action?.kind).toBe('verify-manually');
  });
});

describe('assessModelVerification — unverified', () => {
  it('returns unverified for model without SHA-256', () => {
    const model = makeModel({
      checksum: '',
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('unverified');
    expect(result.safeForInference).toBe(false);
    expect(result.checks.integrity.passed).toBe(false);
    expect(result.action?.kind).toBe('disable');
  });

  it('returns unverified for model with null checksum', () => {
    const model = makeModel({
      checksum: null as unknown as string,
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('unverified');
    expect(result.safeForInference).toBe(false);
  });
});

describe('assessModelVerification — BiRefNet-specific', () => {
  it('BiRefNet Lite is partially-verified (contract declared but not graph-verified)', () => {
    const model = makeModel({
      id: 'birefnet-general-lite',
      checksum: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
      tensorContract: {
        version: 1,
        inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
        outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
        outputActivation: 'sigmoid',
      },
      validation: {
        contractVerified: false,
        integrityVerified: true,
        provenanceStatus: 'unverified',
        inferenceVerified: false,
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('partially-verified');
    expect(result.safeForInference).toBe(false);
    expect(result.statusMessage).toContain('NOT been verified');
  });

  it('BiRefNet Full is disabled (no SHA-256)', () => {
    const model = makeModel({
      id: 'birefnet-general',
      checksum: '',
      tensorContract: {
        version: 1,
        inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
        outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
        outputActivation: 'sigmoid',
      },
    });

    const result = assessModelVerification(model);
    expect(result.level).toBe('disabled');
    expect(result.safeForInference).toBe(false);
    expect(result.checks.integrity.passed).toBe(false);
  });
});
