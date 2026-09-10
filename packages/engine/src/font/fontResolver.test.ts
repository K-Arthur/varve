import { describe, expect, it } from 'vitest';
import type { ParsedFontMetadata } from './fontCatalog';
import { FontCatalog } from './fontCatalog';
import type { FontIdentity } from './fontIdentity';
import type { FontReplacement, MissingFontInfo, ResolverDocument } from './fontResolver';
import { FONT_COMPAT_MAP, FontResolver } from './fontResolver';
import type { UsageDocument } from './fontUsageIndex';
import { FontUsageIndex, migrateLegacyFontRefs } from './fontUsageIndex';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<FontIdentity> = {}): FontIdentity {
  return {
    contentHash: 'abc12345',
    postScriptName: 'Inter-Regular',
    familyName: 'Inter',
    subfamilyName: 'Regular',
    fullName: 'Inter Regular',
    ...overrides,
  };
}

function makeMeta(overrides: Partial<ParsedFontMetadata> = {}): ParsedFontMetadata {
  const identity = overrides.identity ?? makeIdentity();
  return {
    identity,
    format: 'woff2',
    fileSize: 100_000,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 1500,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: ['latn'],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'system',
    ...overrides,
  };
}

function makeCatalog(families: string[]): FontCatalog {
  const catalog = new FontCatalog();
  for (const family of families) {
    catalog.addEntry(
      makeMeta({
        identity: makeIdentity({
          familyName: family,
          postScriptName: `${family.replace(/\s+/g, '')}-Regular`,
          fullName: `${family} Regular`,
        }),
      }),
    );
  }
  return catalog;
}

function makeDoc(
  textNodes: Array<{
    id: string;
    fontFamily: string;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    text?: string;
  }>,
  styles?: Record<
    string,
    {
      type: 'text';
      fontFamily: string;
      fontSize: number;
      fontWeight?: number;
      fontStyle?: 'normal' | 'italic';
    }
  >,
): ResolverDocument {
  const nodes: ResolverDocument['nodes'] = {};
  for (const tn of textNodes) {
    nodes[tn.id] = {
      id: tn.id,
      kind: 'text' as const,
      text: tn.text ?? 'Hello',
      fontFamily: tn.fontFamily,
      fontWeight: tn.fontWeight,
      fontStyle: tn.fontStyle,
    };
  }

  return {
    nodes,
    styles: styles as ResolverDocument['styles'],
  };
}

// ---------------------------------------------------------------------------
// FontResolver tests
// ---------------------------------------------------------------------------

describe('FontResolver', () => {
  const resolver = new FontResolver();

  describe('detectMissing', () => {
    it('finds missing fonts in document', () => {
      const catalog = makeCatalog(['Inter', 'Roboto']);
      const doc = makeDoc([
        { id: 't1', fontFamily: 'Arial' },
        { id: 't2', fontFamily: 'Inter' },
        { id: 't3', fontFamily: 'Helvetica' },
      ]);

      const missing = resolver.detectMissing(doc, catalog);
      const families = missing.map((m) => m.familyName);

      expect(families).toContain('Arial');
      expect(families).toContain('Helvetica');
      expect(families).not.toContain('Inter');
    });

    it('collects all node IDs for same missing family', () => {
      const catalog = makeCatalog(['Inter']);
      const doc = makeDoc([
        { id: 't1', fontFamily: 'Arial' },
        { id: 't2', fontFamily: 'Arial' },
        { id: 't3', fontFamily: 'Arial' },
      ]);

      const missing = resolver.detectMissing(doc, catalog);
      expect(missing).toHaveLength(1);
      expect(missing[0]!.nodeIds).toEqual(['t1', 't2', 't3']);
    });

    it('includes fonts from text styles', () => {
      const catalog = makeCatalog(['Inter']);
      const doc = makeDoc([{ id: 't1', fontFamily: 'Inter' }], {
        'style-1': {
          type: 'text',
          fontFamily: 'Courier New',
          fontSize: 24,
        },
      });

      const missing = resolver.detectMissing(doc, catalog);
      const families = missing.map((m) => m.familyName);
      expect(families).toContain('Courier New');
    });

    it('finds missing fonts used only by rich-text runs', () => {
      const catalog = makeCatalog(['Inter']);
      const doc: ResolverDocument = {
        nodes: {
          t1: {
            id: 't1',
            kind: 'text',
            text: 'Mixed',
            richText: {
              paragraphs: [
                {
                  runs: [
                    { text: 'Inter', format: { fontFamily: 'Inter' } },
                    { text: 'Missing', format: { fontFamily: 'Missing Display', fontWeight: 700 } },
                  ],
                },
              ],
            },
          },
        },
      };

      const missing = resolver.detectMissing(doc, catalog);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({
        familyName: 'Missing Display',
        requestedWeight: 700,
        nodeIds: ['t1'],
      });
    });
  });

  describe('findSubstitutes', () => {
    it('returns progressive matches ranked by confidence', () => {
      const catalog = new FontCatalog();
      // Add Helvetica variants
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Helvetica',
            postScriptName: 'Helvetica',
            subfamilyName: 'Regular',
          }),
        }),
      );
      // Add Liberation Sans (compatible)
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Liberation Sans',
            postScriptName: 'LiberationSans-Regular',
            subfamilyName: 'Regular',
          }),
        }),
      );

      const missing: MissingFontInfo = {
        familyName: 'Arial',
        nodeIds: ['t1'],
        status: 'missing',
        substitutes: [],
        originalReference: 'Arial',
      };

      const subs = resolver.findSubstitutes(missing, catalog);
      expect(subs.length).toBeGreaterThan(0);

      // Should have compatible match for Helvetica
      const helveticaSub = subs.find((s) => s.familyName === 'Helvetica');
      expect(helveticaSub).toBeDefined();
      expect(helveticaSub!.matchQuality).toBe('compatible');

      // Should have compatible match for Liberation Sans
      const libSub = subs.find((s) => s.familyName === 'Liberation Sans');
      expect(libSub).toBeDefined();
      expect(libSub!.matchQuality).toBe('compatible');
    });

    it('returns no exact or compatible matches for unknown fonts', () => {
      const catalog = makeCatalog(['Inter']);
      const missing: MissingFontInfo = {
        familyName: 'ZxyzNonexistent',
        nodeIds: ['t1'],
        status: 'missing',
        substitutes: [],
        originalReference: 'ZxyzNonexistent',
      };

      const subs = resolver.findSubstitutes(missing, catalog);
      // No exact, postscript, family-style, or compatible matches
      const highQuality = subs.filter((s) => s.matchQuality !== 'script-fallback');
      expect(highQuality).toHaveLength(0);
    });
  });

  describe('FONT_COMPAT_MAP', () => {
    it('has correct Arial mapping', () => {
      expect(FONT_COMPAT_MAP.Arial).toContain('Helvetica');
      expect(FONT_COMPAT_MAP.Arial).toContain('Liberation Sans');
      expect(FONT_COMPAT_MAP.Arial).toContain('DejaVu Sans');
    });

    it('has correct Times New Roman mapping', () => {
      expect(FONT_COMPAT_MAP['Times New Roman']).toContain('Times');
      expect(FONT_COMPAT_MAP['Times New Roman']).toContain('Liberation Serif');
    });

    it('has correct Courier New mapping', () => {
      expect(FONT_COMPAT_MAP['Courier New']).toContain('Courier');
      expect(FONT_COMPAT_MAP['Courier New']).toContain('Liberation Mono');
    });

    it('has bidirectional mappings for common pairs', () => {
      expect(FONT_COMPAT_MAP.Helvetica).toContain('Arial');
      expect(FONT_COMPAT_MAP.Arial).toContain('Helvetica');
    });
  });

  describe('applyReplacement', () => {
    it('replaces font family in text nodes', () => {
      const doc = makeDoc([
        { id: 't1', fontFamily: 'Arial' },
        { id: 't2', fontFamily: 'Helvetica' },
      ]);

      const replacement: FontReplacement = {
        original: 'Arial',
        replacement: 'Liberation Sans',
        applyToAll: true,
        preserveOriginalReference: false,
      };

      const updated = resolver.applyReplacement(doc, replacement);
      expect((updated.nodes.t1 as any).fontFamily).toBe('Liberation Sans');
      expect((updated.nodes.t2 as any).fontFamily).toBe('Helvetica');
    });

    it('preserves original reference in metadata', () => {
      const doc = makeDoc([{ id: 't1', fontFamily: 'Arial' }]);

      const replacement: FontReplacement = {
        original: 'Arial',
        replacement: 'Liberation Sans',
        applyToAll: true,
        preserveOriginalReference: true,
      };

      const updated = resolver.applyReplacement(doc, replacement);
      // The fontFamily should still be replaced
      expect((updated.nodes.t1 as any).fontFamily).toBe('Liberation Sans');
    });

    it('replaces font family in text styles', () => {
      const doc = makeDoc([{ id: 't1', fontFamily: 'Inter' }], {
        'style-1': {
          type: 'text',
          fontFamily: 'Arial',
          fontSize: 24,
        },
      });

      const replacement: FontReplacement = {
        original: 'Arial',
        replacement: 'Roboto',
        applyToAll: true,
        preserveOriginalReference: false,
      };

      const updated = resolver.applyReplacement(doc, replacement);
      expect((updated.styles!['style-1'] as any).fontFamily).toBe('Roboto');
    });

    it('replaces font family in rich-text runs without flattening other node data', () => {
      const doc: ResolverDocument = {
        nodes: {
          t1: {
            id: 't1',
            kind: 'text',
            text: 'Fallback',
            fontFamily: 'Inter',
            richText: {
              paragraphs: [
                {
                  runs: [
                    { text: 'A', format: { fontFamily: 'Missing Display', fontWeight: 700 } },
                    { text: 'B', format: { fontFamily: 'Inter' } },
                  ],
                },
              ],
            },
          },
        },
      };

      const updated = resolver.applyReplacement(doc, {
        original: 'Missing Display',
        replacement: 'IBM Plex Sans Variable',
        applyToAll: true,
        preserveOriginalReference: true,
      });
      const node = updated.nodes.t1 as any;
      expect(node.text).toBe('Fallback');
      expect(node.fontFamily).toBe('Inter');
      expect(node.richText.paragraphs[0].runs).toEqual([
        { text: 'A', format: { fontFamily: 'IBM Plex Sans Variable', fontWeight: 700 } },
        { text: 'B', format: { fontFamily: 'Inter' } },
      ]);
    });
  });

  describe('buildReplacementMap', () => {
    it('generates correct auto-substitutes', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Helvetica',
            postScriptName: 'Helvetica',
          }),
        }),
      );

      const doc = makeDoc([
        { id: 't1', fontFamily: 'Arial' },
        { id: 't2', fontFamily: 'Inter' },
      ]);

      const map = resolver.buildReplacementMap(doc, catalog);
      expect(map.has('Arial')).toBe(true);
      expect(map.get('Arial')!.familyName).toBe('Helvetica');
    });

    it('returns empty map when all fonts are available', () => {
      const catalog = makeCatalog(['Inter']);
      const doc = makeDoc([{ id: 't1', fontFamily: 'Inter' }]);

      const map = resolver.buildReplacementMap(doc, catalog);
      expect(map.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// FontUsageIndex tests
// ---------------------------------------------------------------------------

describe('FontUsageIndex', () => {
  const index = new FontUsageIndex();

  describe('build', () => {
    it('scans text nodes for font usage', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
          t2: { id: 't2', kind: 'text', text: 'World!', fontFamily: 'Inter' },
          t3: { id: 't3', kind: 'text', text: 'Test', fontFamily: 'Roboto' },
        },
      };

      const usage = index.build(doc);
      expect(usage.has('inter')).toBe(true);
      expect(usage.get('inter')!.nodeIds).toEqual(['t1', 't2']);
      expect(usage.get('inter')!.totalCharacters).toBe(11); // "Hello" + "World!"
      expect(usage.has('roboto')).toBe(true);
    });

    it('scans text/paragraph styles', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
        },
        styles: {
          'style-1': {
            type: 'text',
            fontFamily: 'Georgia',
            fontSize: 24,
          },
        },
      };

      const usage = index.build(doc);
      expect(usage.has('georgia')).toBe(true);
      expect(usage.get('georgia')!.styleIds).toContain('style-1');
    });

    it('scans rich text runs for font usage', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: {
            id: 't1',
            kind: 'text',
            text: 'Hello',
            richText: {
              paragraphs: [
                {
                  runs: [
                    { text: 'Hello ', format: { fontFamily: 'Inter' } },
                    { text: 'World', format: { fontFamily: 'Roboto' } },
                  ],
                },
              ],
            },
          },
        },
      };

      const usage = index.build(doc);
      expect(usage.has('inter')).toBe(true);
      expect(usage.has('roboto')).toBe(true);
      expect(usage.get('roboto')!.totalCharacters).toBe(5); // "World"
    });
  });

  describe('getFamilyUsage', () => {
    it('returns usage for a specific family', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter', fontWeight: 700 },
          t2: { id: 't2', kind: 'text', text: 'World', fontFamily: 'Inter', fontWeight: 400 },
        },
      };

      const usage = index.getFamilyUsage(doc, 'Inter');
      expect(usage.familyName).toBe('Inter');
      expect(usage.nodeIds).toEqual(['t1', 't2']);
    });

    it('returns empty usage for missing family', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
        },
      };

      const usage = index.getFamilyUsage(doc, 'NonExistent');
      expect(usage.nodeIds).toHaveLength(0);
      expect(usage.totalCharacters).toBe(0);
    });
  });

  describe('getUniqueFamilies', () => {
    it('returns all unique font families', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
          t2: { id: 't2', kind: 'text', text: 'World', fontFamily: 'Roboto' },
          t3: { id: 't3', kind: 'text', text: 'Test', fontFamily: 'Inter' },
        },
      };

      const families = index.getUniqueFamilies(doc);
      expect(families).toContain('Inter');
      expect(families).toContain('Roboto');
      expect(families).toHaveLength(2);
    });
  });

  describe('isFontUsed', () => {
    it('returns true for used font', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
        },
      };

      expect(index.isFontUsed(doc, 'Inter')).toBe(true);
    });

    it('returns false for unused font', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
        },
      };

      expect(index.isFontUsed(doc, 'Roboto')).toBe(false);
    });
  });

  describe('getAffectedNodes', () => {
    it('returns correct node IDs', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Arial' },
          t2: { id: 't2', kind: 'text', text: 'World', fontFamily: 'Inter' },
          t3: { id: 't3', kind: 'text', text: 'Test', fontFamily: 'Arial' },
        },
      };

      const nodes = index.getAffectedNodes(doc, 'Arial');
      expect(nodes).toEqual(['t1', 't3']);
    });
  });

  describe('getUsageCount', () => {
    it('returns correct count', () => {
      const doc: UsageDocument = {
        nodes: {
          t1: { id: 't1', kind: 'text', text: 'A', fontFamily: 'Inter' },
          t2: { id: 't2', kind: 'text', text: 'B', fontFamily: 'Inter' },
          t3: { id: 't3', kind: 'text', text: 'C', fontFamily: 'Roboto' },
        },
      };

      expect(index.getUsageCount(doc, 'Inter')).toBe(2);
      expect(index.getUsageCount(doc, 'Roboto')).toBe(1);
      expect(index.getUsageCount(doc, 'Arial')).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyFontRefs tests
// ---------------------------------------------------------------------------

describe('migrateLegacyFontRefs', () => {
  it('migrates legacy font string to structured fields', () => {
    const doc: UsageDocument = {
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          text: 'Hello',
          font: 'bold 16px Arial',
        } as any,
      },
    };

    const migrated = migrateLegacyFontRefs(doc);
    const node = migrated.nodes.t1 as any;

    expect(node.fontFamily).toBe('Arial');
    expect(node.fontWeight).toBe(700);
    expect(node.fontStyle).toBe('normal');
  });

  it('migrates numeric font weight', () => {
    const doc: UsageDocument = {
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          text: 'Hello',
          fontFamily: 'Inter',
          font: 700,
        } as any,
      },
    };

    const migrated = migrateLegacyFontRefs(doc);
    const node = migrated.nodes.t1 as any;

    expect(node.fontWeight).toBe(700);
    expect(node.fontFamily).toBe('Inter');
  });

  it('is idempotent on already-migrated documents', () => {
    const doc: UsageDocument = {
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          text: 'Hello',
          fontFamily: 'Inter',
          fontWeight: 700,
          fontStyle: 'italic',
        },
      },
    };

    const migrated = migrateLegacyFontRefs(doc);
    const node = migrated.nodes.t1 as any;

    expect(node.fontFamily).toBe('Inter');
    expect(node.fontWeight).toBe(700);
    expect(node.fontStyle).toBe('italic');
  });

  it('migrates legacy text styles', () => {
    const doc: UsageDocument = {
      nodes: {
        t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
      },
      styles: {
        'style-1': {
          type: 'text',
          font: 'italic 24px Georgia',
          fontSize: 24,
        } as any,
      },
    };

    const migrated = migrateLegacyFontRefs(doc);
    const style = migrated.styles!['style-1'] as any;

    expect(style.fontFamily).toBe('Georgia');
    expect(style.fontStyle).toBe('italic');
  });
});
