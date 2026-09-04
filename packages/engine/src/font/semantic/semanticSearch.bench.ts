import { bench, describe } from 'vitest';
import { getFontsourceCatalog } from '../fontsourceCatalog';
import { semanticRecordFromFontsource } from './semanticEnrichment';
import { searchFontSemanticRecords } from './semanticRanking';

const records = getFontsourceCatalog()
  .families()
  .map((record) => semanticRecordFromFontsource(record));

describe(`semantic font search (${records.length} catalog families)`, () => {
  bench('natural-language intent, top 24', () => {
    searchFontSemanticRecords(records, 'friendly rounded sans for UI', { limit: 24 });
  });

  bench('hard coverage and variable constraints, top 24', () => {
    searchFontSemanticRecords(records, 'variable with Vietnamese and Cyrillic', {
      limit: 24,
      strictness: 'strict',
    });
  });

  bench('exact family plus provider constraint, top 8', () => {
    searchFontSemanticRecords(records, 'Inter Fontsource', { limit: 8, diversity: false });
  });
});
