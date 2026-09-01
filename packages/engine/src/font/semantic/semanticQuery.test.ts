import { describe, expect, it } from 'vitest';
import { parseFontSemanticQuery } from './semanticQuery';

describe('parseFontSemanticQuery', () => {
  it('separates hard technical requirements from soft design language', () => {
    const query = parseFontSemanticQuery(
      'Friendly rounded sans for a finance dashboard with Vietnamese support and tabular numerals',
    );
    expect(query.required.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'classification.sans',
        'coverage.language.vietnamese',
        'feature.tnum',
      ]),
    );
    expect(query.preferred.map((item) => item.id)).toEqual(
      expect.arrayContaining(['tone.friendly', 'morphology.rounded', 'use.dense-data-ui']),
    );
  });

  it('supports exclusions, synonyms, ranges, and availability', () => {
    const query = parseFontSemanticQuery(
      'condensed variable Cyrillic, weight 300–800, without italics, installed only',
    );
    expect(query.required.map((item) => item.id)).toEqual(
      expect.arrayContaining(['feature.variable', 'coverage.script.cyrl']),
    );
    expect(query.excluded.map((item) => item.id)).toContain('feature.italic');
    expect(query.numericRanges).toEqual([
      { field: 'weight', min: 300, max: 800, raw: 'weight 300-800' },
    ]);
    expect(query.availability).toBe('installed');
  });

  it('keeps ambiguity visible and supports font references', () => {
    const query = parseFontSemanticQuery('similar to IBM Plex Sans but more modern');
    expect(query.similarityTarget?.familyName).toBe('IBM Plex Sans');
    expect(query.ambiguities.map((item) => item.term)).toContain('modern');
  });

  it('bounds hostile input', () => {
    expect(() => parseFontSemanticQuery('x'.repeat(1001))).toThrow(/exceeds/);
  });
});
