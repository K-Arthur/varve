import { describe, expect, it } from 'vitest';
import type { FontsourceCatalogRecord } from '../catalogSchema';
import { semanticRecordFromFontsource } from './semanticEnrichment';
import {
  findFontAlternatives,
  findFontPairings,
  findSimilarFonts,
} from './semanticRecommendations';

function record(
  familyId: string,
  familyName: string,
  category: 'sans-serif' | 'serif',
): ReturnType<typeof semanticRecordFromFontsource> {
  const value: FontsourceCatalogRecord = {
    providerId: 'fontsource',
    familyId,
    familyName,
    aliases: [],
    category,
    subsets: ['latin'],
    defaultSubset: 'latin',
    weights: [400, 700],
    styles: ['normal'],
    variable: false,
    axes: [],
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
  };
  return semanticRecordFromFontsource(value);
}

describe('font recommendations', () => {
  it('keeps similarity, alternatives, and pairing as distinct lanes', () => {
    const target = record('target', 'Target', 'serif');
    const sans = record('sans', 'Support Sans', 'sans-serif');
    const serif = record('serif', 'Another Serif', 'serif');
    expect(
      findSimilarFonts(target, [target, sans, serif]).every(
        (item) => item.record.familyId !== 'target',
      ),
    ).toBe(true);
    expect(
      findFontAlternatives(target, [target, sans, serif]).every(
        (item) => item.record.familyId !== 'target',
      ),
    ).toBe(true);
    expect(findFontPairings(target, [target, sans, serif])[0]?.record.familyId).toBe('sans');
  });
});
