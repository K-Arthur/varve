import { describe, expect, it } from 'vitest';
import type { FontsourceCatalogRecord } from '../catalogSchema';
import { semanticRecordFromFontsource } from './semanticEnrichment';
import { searchFontSemanticRecords } from './semanticRanking';

function family(overrides: Partial<FontsourceCatalogRecord> = {}): FontsourceCatalogRecord {
  return {
    providerId: 'fontsource',
    familyId: 'demo-sans',
    familyName: 'Demo Sans',
    aliases: [],
    category: 'sans-serif',
    subsets: ['latin', 'cyrillic', 'vietnamese'],
    defaultSubset: 'latin',
    weights: [300, 400, 500, 600, 700, 800],
    styles: ['normal', 'italic'],
    variable: true,
    axes: [{ tag: 'wght', default: 400, min: 300, max: 800, step: 1 }],
    unicodeRange: {},
    upstreamVersion: '1.0.0',
    packageVersion: '1.0.0',
    lastModified: '2026-01-01',
    license: {
      id: 'OFL-1.1',
      name: 'SIL Open Font License 1.1',
      commercial: true,
      modification: true,
      redistribution: true,
      embedding: true,
    },
    ...overrides,
  };
}

describe('font semantic ranking', () => {
  it('keeps hard constraints hard and explains unknown metadata', () => {
    const records = [semanticRecordFromFontsource(family())];
    expect(
      searchFontSemanticRecords(records, 'variable Cyrillic with Vietnamese', {
        strictness: 'strict',
      }),
    ).toHaveLength(1);
    expect(
      searchFontSemanticRecords(records, 'with tabular numerals', { strictness: 'strict' }),
    ).toHaveLength(0);
    const balanced = searchFontSemanticRecords(records, 'with tabular numerals', {
      strictness: 'balanced',
    });
    expect(balanced[0]?.status).toBe('unknown');
    expect(balanced[0]?.reasons.some((reason) => reason.label.includes('not verified'))).toBe(true);
  });

  it('ranks curated semantic language without making it a hard requirement', () => {
    const records = [
      semanticRecordFromFontsource(family({ familyId: 'nunito', familyName: 'Nunito' })),
      semanticRecordFromFontsource(family({ familyId: 'inter', familyName: 'Inter' })),
    ];
    const results = searchFontSemanticRecords(records, 'friendly rounded sans');
    expect(results[0]?.record.familyName).toBe('Nunito');
    expect(results[0]?.reasons.map((reason) => reason.label)).toEqual(
      expect.arrayContaining(['Friendly', 'Rounded forms']),
    );
  });

  it('supports exact family identity and provider filters', () => {
    const records = [
      semanticRecordFromFontsource(family({ familyId: 'inter', familyName: 'Inter' })),
    ];
    const result = searchFontSemanticRecords(records, 'Inter Fontsource');
    expect(result[0]?.record.familyId).toBe('inter');
    expect(result[0]?.reasons.some((reason) => reason.label === 'Exact family match')).toBe(true);
  });

  it('treats similarity and same-width references as explicit local relations', () => {
    const target = semanticRecordFromFontsource(
      family({ familyId: 'target', familyName: 'Target' }),
    );
    const sibling = semanticRecordFromFontsource(
      family({ familyId: 'sibling', familyName: 'Sibling' }),
    );
    const similar = searchFontSemanticRecords([target, sibling], 'similar to Target');
    expect(similar.some((result) => result.record.familyId === 'target')).toBe(false);
    expect(similar[0]?.reasons.some((reason) => reason.label === 'Similar to Target')).toBe(true);
  });
});
