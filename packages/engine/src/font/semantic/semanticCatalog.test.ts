import { describe, expect, it } from 'vitest';
import type { FontsourceCatalogRecord } from '../catalogSchema';
import type { FontCatalogEntry } from '../fontCatalog';
import { FontSemanticCatalog, migrateLegacyFontCatalogTags } from './semanticCatalog';

function sourceRecord(familyId: string, familyName: string): FontsourceCatalogRecord {
  return {
    providerId: 'fontsource',
    familyId,
    familyName,
    aliases: [],
    category: 'sans-serif',
    subsets: ['latin'],
    defaultSubset: 'latin',
    weights: [400],
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
}

function legacyEntry(familyName: string, tags: string[]): FontCatalogEntry {
  return {
    identity: {
      contentHash: '0'.repeat(64),
      familyName,
      subfamilyName: 'Regular',
      fullName: `${familyName} Regular`,
      postScriptName: `${familyName.replaceAll(' ', '')}-Regular`,
    },
    source: 'user',
    format: 'ttf',
    fileSize: 100,
    category: 'sans-serif',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 100,
    isVariable: false,
    axes: [],
    namedInstances: [],
    unicodeRanges: [],
    scripts: ['latn'],
    openTypeFeatures: [],
    hasColorGlyphs: false,
    colorFormats: [],
    embeddingRights: 'installable',
    license: 'OFL-1.1',
    isActive: true,
    isFavorite: false,
    tags,
    id: `legacy:${familyName}`,
  };
}

describe('FontSemanticCatalog legacy migration', () => {
  it('groups face tags by family, preserves existing tags, and skips unknown families', () => {
    const catalog = new FontSemanticCatalog({
      fontsource: [sourceRecord('inter', 'Inter')],
      registry: { families: () => [], getEntries: () => [] } as never,
    });
    const legacy = {
      all: () => [
        legacyEntry('Inter', ['interface', 'preferred']),
        legacyEntry('inter', ['preferred']),
        legacyEntry('Missing Family', ['ignored']),
      ],
    };
    const result = migrateLegacyFontCatalogTags(legacy, catalog);
    expect(result).toEqual({ migrated: 1, skipped: 1 });
    expect(catalog.findByFamilyName('Inter')?.userTags).toEqual(['interface', 'preferred']);
    expect(catalog.findByFamilyName('Inter')?.profile).toEqual(
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });
});
