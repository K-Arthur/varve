import type { MissingFontInfo } from '@varve/engine/font';
import { type FontsourceCatalogSnapshot, FontsourceCatalogStore } from '@varve/engine/font';
import { describe, expect, it } from 'vitest';
import { findMissingFontRecoveryMatch } from './missingFontRecovery';

const snapshot: FontsourceCatalogSnapshot = {
  schemaVersion: 1,
  providerId: 'fontsource',
  sourceUrl: 'https://api.fontsource.org/v1/fonts',
  generatedBy: 'test',
  generatedAt: '2026-09-01T00:00:00.000Z',
  sourceRevision: 'test',
  checksum: 'test',
  families: [
    {
      providerId: 'fontsource',
      familyId: 'example-sans',
      familyName: 'Example Sans',
      aliases: ['Example UI'],
      category: 'sans-serif',
      subsets: ['latin'],
      defaultSubset: 'latin',
      weights: [400, 700],
      styles: ['normal', 'italic'],
      variable: false,
      axes: [],
      unicodeRange: {},
      upstreamVersion: '1.0.0',
      packageVersion: '5.3.0',
      lastModified: '2026-01-01',
      license: {
        id: 'OFL-1.1',
        name: 'SIL Open Font License 1.1',
        commercial: true,
        modification: true,
        redistribution: true,
        embedding: true,
      },
    },
  ],
};

function missing(overrides: Partial<MissingFontInfo> = {}): MissingFontInfo {
  return {
    familyName: 'Example Sans',
    originalReference: 'Example Sans',
    requestedWeight: 700,
    requestedStyle: 'italic',
    nodeIds: ['text-1'],
    status: 'missing',
    substitutes: [],
    ...overrides,
  };
}

describe('findMissingFontRecoveryMatch', () => {
  it('resolves the requested family and face to an immutable Fontsource artifact', () => {
    const match = findMissingFontRecoveryMatch(missing(), new FontsourceCatalogStore(snapshot));

    expect(match?.artifact).toMatchObject({
      familyId: 'example-sans',
      weight: 700,
      style: 'italic',
      packageVersion: '5.3.0',
    });
    expect(match?.artifact.url).toContain('@5.3.0/latin-700-italic.woff2');
    expect(match?.exactFace).toBe(true);
    expect(match?.matchedByAlias).toBe(false);
  });

  it('accepts a catalog alias but reports that the canonical family differs', () => {
    const match = findMissingFontRecoveryMatch(
      missing({ familyName: 'Example UI', originalReference: 'Example UI' }),
      new FontsourceCatalogStore(snapshot),
    );

    expect(match?.record.familyName).toBe('Example Sans');
    expect(match?.matchedByAlias).toBe(true);
  });

  it('uses the nearest available face without presenting it as exact', () => {
    const match = findMissingFontRecoveryMatch(
      missing({ requestedWeight: 600, requestedStyle: 'oblique' }),
      new FontsourceCatalogStore(snapshot),
    );

    expect(match?.artifact.weight).toBe(700);
    expect(match?.artifact.style).toBe('normal');
    expect(match?.exactFace).toBe(false);
  });

  it('does not turn fuzzy catalog search results into exact recovery actions', () => {
    const match = findMissingFontRecoveryMatch(
      missing({ familyName: 'Example', originalReference: 'Example' }),
      new FontsourceCatalogStore(snapshot),
    );

    expect(match).toBeUndefined();
  });
});
