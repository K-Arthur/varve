/**
 * Tests for model catalog trust and verification.
 *
 * Covers: envelope verification, rollback protection, last-known-good
 * fallback, trust modes, and signature scheme handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastKnownGood,
  getTrustMode,
  type LastKnownGoodEntry,
  loadLastKnownGood,
  resetCatalogTrust,
  type SignedManifestEnvelope,
  saveLastKnownGood,
  setTrustMode,
  verifyCatalogEnvelope,
} from '../catalogTrust';
import type { ModelManifestEntry } from '../types';

// Mock localStorage
const localStorageMock: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(localStorageMock)) delete localStorageMock[key];
  }),
});

function makeManifestJson(version = 3): string {
  return JSON.stringify({ version, models: [] });
}

function makeEnvelope(
  manifestVersion?: number,
  overrides: Partial<SignedManifestEnvelope> = {},
): SignedManifestEnvelope {
  return {
    manifest: makeManifestJson(manifestVersion),
    scheme: 'sha256',
    ...overrides,
  };
}

describe('catalogTrust — trust modes', () => {
  beforeEach(() => {
    resetCatalogTrust();
  });

  it('defaults to lenient', () => {
    expect(getTrustMode()).toBe('lenient');
  });

  it('can set strict mode', () => {
    setTrustMode('strict');
    expect(getTrustMode()).toBe('strict');
  });

  it('can disable verification', () => {
    setTrustMode('disabled');
    expect(getTrustMode()).toBe('disabled');
  });
});

describe('catalogTrust — verifyCatalogEnvelope', () => {
  beforeEach(() => {
    resetCatalogTrust();
  });

  it('accepts all manifests in disabled mode', async () => {
    setTrustMode('disabled');
    const result = await verifyCatalogEnvelope(makeEnvelope());
    expect(result.trusted).toBe(true);
    expect(result.trustMode).toBe('disabled');
  });

  it('accepts sha256-signed envelope in lenient mode', async () => {
    const result = await verifyCatalogEnvelope(makeEnvelope());
    expect(result.trusted).toBe(true);
    expect(result.signature?.verified).toBe(true);
  });

  it('rejects unsigned manifest in strict mode', async () => {
    setTrustMode('strict');
    const result = await verifyCatalogEnvelope(
      makeEnvelope(undefined, { scheme: 'none', signature: undefined }),
    );
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('No signature provided');
  });

  it('warns about unverified GPG signature in lenient mode', async () => {
    const result = await verifyCatalogEnvelope(
      makeEnvelope(undefined, { scheme: 'gpg', signature: 'fake-sig' }),
    );
    // Lenient: accepted with warning
    expect(result.trusted).toBe(true);
    expect(result.signature?.verified).toBe(false);
    expect(result.reason).toContain('warnings');
  });

  it('rejects unverified GPG signature in strict mode', async () => {
    setTrustMode('strict');
    const result = await verifyCatalogEnvelope(
      makeEnvelope(undefined, { scheme: 'gpg', signature: 'fake-sig' }),
    );
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('Signature verification failed');
  });

  it('records integrity check result', async () => {
    const result = await verifyCatalogEnvelope(makeEnvelope());
    expect(result.integrity).toBeDefined();
    expect(result.integrity!.passed).toBe(true);
  });
});

describe('catalogTrust — rollback protection', () => {
  beforeEach(() => {
    resetCatalogTrust();
  });

  it('accepts manifest with version >= last seen', async () => {
    // First manifest sets the baseline
    const v3 = makeEnvelope();
    const r1 = await verifyCatalogEnvelope(v3);
    expect(r1.trusted).toBe(true);
    expect(r1.freshness?.passed).toBe(true);

    // Same version is accepted
    const r2 = await verifyCatalogEnvelope(makeEnvelope());
    expect(r2.trusted).toBe(true);
  });

  it('rejects manifest with lower version in strict mode', async () => {
    setTrustMode('strict');

    // Set baseline at version 3
    const baseline = await verifyCatalogEnvelope(makeEnvelope(3));
    expect(baseline.freshness?.passed).toBe(true);

    // Try version 2 — should be rejected
    const result = await verifyCatalogEnvelope(makeEnvelope(2));
    expect(result.trusted).toBe(false);
    expect(result.freshness?.passed).toBe(false);
    expect(result.reason).toContain('rollback rejected');
  });

  it('warns about version downgrade in lenient mode', async () => {
    setTrustMode('lenient');

    // Set baseline at version 3
    const baseline = await verifyCatalogEnvelope(makeEnvelope(3));
    expect(baseline.freshness?.passed).toBe(true);

    // Try version 2 — accepted with warning in lenient mode
    const result = await verifyCatalogEnvelope(makeEnvelope(2));
    expect(result.trusted).toBe(true);
    expect(result.freshness?.passed).toBe(false);
  });
});

describe('catalogTrust — last-known-good', () => {
  beforeEach(() => {
    resetCatalogTrust();
  });

  it('saves and loads LKG entry', () => {
    const entries: ModelManifestEntry[] = [
      {
        id: 'test',
        name: 'Test',
        description: '',
        sizeBytes: 100,
        remoteUrl: '',
        checksum: 'abc123',
        bundled: true,
        inputSpec: null,
        quality: 3,
      },
    ];
    saveLastKnownGood(entries, 3, 'hash123', 'downloaded');

    const loaded = loadLastKnownGood();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(3);
    expect(loaded!.entries).toHaveLength(1);
    expect(loaded!.entries[0]!.id).toBe('test');
    expect(loaded!.source).toBe('downloaded');
  });

  it('returns null for expired LKG entries', () => {
    const entry: LastKnownGoodEntry = {
      entries: [],
      version: 3,
      hash: 'hash',
      savedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), // 100 days ago
      source: 'downloaded',
    };
    localStorageMock['strata-model-catalog-lkg'] = JSON.stringify(entry);

    const loaded = loadLastKnownGood();
    expect(loaded).toBeNull();
  });

  it('clears LKG entry', () => {
    saveLastKnownGood([], 3, 'hash');
    expect(loadLastKnownGood()).not.toBeNull();

    clearLastKnownGood();
    expect(loadLastKnownGood()).toBeNull();
  });

  it('returns null when no LKG exists', () => {
    expect(loadLastKnownGood()).toBeNull();
  });
});
