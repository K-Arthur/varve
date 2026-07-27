import { describe, expect, it } from 'vitest';
import { FontCatalog } from './fontCatalog';
import {
  attachFontManifestToDocument,
  resolveFontManifestForLoadedDocument,
} from './fontPersistence';
import type { UsageDocument } from './fontUsageIndex';

function makeStubCatalog(): FontCatalog {
  const c = new FontCatalog();
  c.addEntry({
    identity: {
      contentHash: 'aaa'.repeat(22),
      postScriptName: 'Inter-Regular',
      familyName: 'Inter',
      subfamilyName: 'Regular',
      fullName: 'Inter Regular',
    },
    format: 'ttf',
    fileSize: 100_000,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 1000,
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
    sourceLocation: '/usr/share/fonts/Inter-Regular.ttf',
  });
  c.addEntry({
    identity: {
      contentHash: 'bbb'.repeat(22),
      postScriptName: 'NotoSans-Regular',
      familyName: 'Noto Sans',
      subfamilyName: 'Regular',
      fullName: 'Noto Sans Regular',
    },
    format: 'otf',
    fileSize: 200_000,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 3000,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: ['latn', 'cyrl', 'grek'],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'system',
  });
  return c;
}

function makeTestDoc(overrides?: Partial<UsageDocument>): UsageDocument {
  return {
    nodes: {
      n1: {
        id: 'n1',
        kind: 'text',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        text: 'Hello world',
      },
      n2: {
        id: 'n2',
        kind: 'text',
        fontFamily: 'Inter',
        fontWeight: 700,
        fontStyle: 'normal',
        text: 'Bold text',
      },
      n3: {
        id: 'n3',
        kind: 'rect',
      },
    },
    ...overrides,
  };
}

describe('attachFontManifestToDocument', () => {
  it('stamps a manifest onto a document before save', () => {
    const doc = makeTestDoc();
    const catalog = makeStubCatalog();
    const { manifest, document: updated } = attachFontManifestToDocument(doc, catalog);

    expect(manifest.version).toBe(1);
    expect(manifest.fonts).toHaveLength(1); // Inter appears twice but deduped
    expect(manifest.fonts[0]!.familyName).toBe('Inter');
    expect(manifest.fonts[0]!.status).toBe('available');
    expect((updated as Record<string, unknown>).fontManifest).toBe(manifest);
  });

  it('detects missing fonts and marks them as missing', () => {
    const doc = makeTestDoc();
    doc.nodes.n1 = { ...doc.nodes.n1, fontFamily: 'MissingFont' } as typeof doc.nodes.n1;
    const catalog = makeStubCatalog();
    const { manifest } = attachFontManifestToDocument(doc, catalog);

    const missing = manifest.fonts.find((f) => f.familyName === 'MissingFont');
    expect(missing).toBeDefined();
    expect(missing!.status).toBe('missing');
  });

  it('flags restricted-embedding fonts', () => {
    const catalog = makeStubCatalog();
    catalog.addEntry({
      identity: {
        contentHash: 'ccc'.repeat(22),
        postScriptName: 'Restricted-Regular',
        familyName: 'Restricted',
        subfamilyName: 'Regular',
        fullName: 'Restricted Regular',
      },
      format: 'ttf',
      fileSize: 50_000,
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      glyphCount: 500,
      isVariable: false,
      axes: [],
      namedInstances: [],
      openTypeFeatures: [],
      unicodeRanges: [],
      scripts: ['latn'],
      embeddingRights: 'restricted',
      hasColorGlyphs: false,
      category: 'serif',
      source: 'system',
    });

    const doc = makeTestDoc();
    doc.nodes.n1 = { ...doc.nodes.n1, fontFamily: 'Restricted' } as typeof doc.nodes.n1;
    doc.nodes.n2 = { ...doc.nodes.n2, fontFamily: 'Inter' } as typeof doc.nodes.n2;

    const { manifest } = attachFontManifestToDocument(doc, catalog);
    const restricted = manifest.fonts.find((f) => f.familyName === 'Restricted');
    expect(restricted).toBeDefined();
    expect(restricted!.status).toBe('restricted');
  });
});

describe('resolveFontManifestForLoadedDocument', () => {
  it('returns warnings for unresolved fonts', () => {
    const catalog = makeStubCatalog();
    const manifest = {
      version: 1 as const,
      fonts: [
        {
          familyName: 'Inter',
          identity: {
            contentHash: 'aaa'.repeat(22),
            postScriptName: 'Inter-Regular',
            familyName: 'Inter',
            subfamilyName: 'Regular',
            fullName: 'Inter Regular',
          },
          source: 'system' as const,
          embeddingRights: 'installable' as const,
          status: 'available' as const,
        },
        {
          familyName: 'MissingFont',
          identity: {
            contentHash: '',
            postScriptName: '',
            familyName: 'MissingFont',
            subfamilyName: 'Regular',
            fullName: 'MissingFont',
          },
          source: 'missing' as const,
          embeddingRights: 'unknown' as const,
          status: 'missing' as const,
        },
      ],
    };

    const { resolved, warnings } = resolveFontManifestForLoadedDocument(manifest, catalog);
    expect(resolved.fonts).toHaveLength(2);
    // MissingFont is auto-substituted to a sans-serif fallback (Inter) by the resolver
    // since they share the 'sans-serif' category
    expect(resolved.fonts[1]!.status).toBe('substituted');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('MissingFont');
  });

  it('leaves fonts as missing when no catalog entries exist for fallback', () => {
    const emptyCatalog = new FontCatalog();
    const manifest = {
      version: 1 as const,
      fonts: [
        {
          familyName: 'MissingFont',
          identity: {
            contentHash: '',
            postScriptName: '',
            familyName: 'MissingFont',
            subfamilyName: 'Regular',
            fullName: 'MissingFont',
          },
          source: 'missing' as const,
          embeddingRights: 'unknown' as const,
          status: 'missing' as const,
        },
      ],
    };

    const { resolved, warnings } = resolveFontManifestForLoadedDocument(manifest, emptyCatalog);
    expect(resolved.fonts).toHaveLength(1);
    expect(resolved.fonts[0]!.status).toBe('missing');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('MissingFont');
  });

  it('does not warn when all fonts are available', () => {
    const catalog = makeStubCatalog();
    const manifest = {
      version: 1 as const,
      fonts: [
        {
          familyName: 'Inter',
          identity: {
            contentHash: 'aaa'.repeat(22),
            postScriptName: 'Inter-Regular',
            familyName: 'Inter',
            subfamilyName: 'Regular',
            fullName: 'Inter Regular',
          },
          source: 'system' as const,
          embeddingRights: 'installable' as const,
          status: 'available' as const,
        },
      ],
    };

    const { resolved, warnings } = resolveFontManifestForLoadedDocument(manifest, catalog);
    expect(resolved.fonts).toHaveLength(1);
    expect(resolved.fonts[0]!.status).toBe('available');
    expect(warnings).toHaveLength(0);
  });
});
