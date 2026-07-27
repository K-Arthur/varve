import { describe, expect, it } from 'vitest';
import { FontCatalog } from './fontCatalog';
import type { FontIdentity, ParsedFontMetadata } from './fontIdentity';
import {
  buildDocumentFontManifest,
  type FontManifest,
  resolveManifestAgainstCatalog,
} from './fontManifest';
import type { UsageDocument } from './fontUsageIndex';

function makeEntry(
  family: string,
  subfamily: string,
  source: ParsedFontMetadata['source'] = 'system',
  embeddingRights: ParsedFontMetadata['embeddingRights'] = 'installable',
): ParsedFontMetadata {
  const identity: FontIdentity = {
    contentHash: `${family}-${subfamily}`,
    postScriptName: `${family.replace(/\s+/g, '')}-${subfamily}`,
    familyName: family,
    subfamilyName: subfamily,
    fullName: `${family} ${subfamily}`,
  };
  return {
    identity,
    format: 'ttf',
    fileSize: 1000,
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
    scripts: [],
    languages: [],
    embeddingRights,
    hasColorGlyphs: false,
    category: 'sans-serif',
    source,
  };
}

function catalogWith(entries: ParsedFontMetadata[]): FontCatalog {
  const catalog = new FontCatalog();
  for (const e of entries) catalog.addEntry(e);
  return catalog;
}

const docWith = (nodes: Record<string, unknown>): UsageDocument => ({
  nodes: {
    ...nodes,
  } as UsageDocument['nodes'],
});

describe('buildDocumentFontManifest', () => {
  it('records available fonts referenced by text nodes', () => {
    const catalog = catalogWith([makeEntry('Inter', 'Regular')]);
    const doc = docWith({
      t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
    });

    const manifest = buildDocumentFontManifest(doc, catalog);
    expect(manifest.fonts).toHaveLength(1);
    expect(manifest.fonts[0]!.familyName).toBe('Inter');
    expect(manifest.fonts[0]!.status).toBe('available');
    expect(manifest.fonts[0]!.embeddingRights).toBe('installable');
  });

  it('detects missing fonts and marks them missing', () => {
    const catalog = catalogWith([makeEntry('Inter', 'Regular')]);
    const doc = docWith({
      t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'UnknownFont' },
    });

    const manifest = buildDocumentFontManifest(doc, catalog);
    const missing = manifest.fonts.find((f) => f.familyName === 'UnknownFont');
    expect(missing).toBeDefined();
    expect(missing!.status).toBe('missing');
    expect(missing!.source).toBe('missing');
  });

  it('flags restricted embedding fonts as restricted', () => {
    const catalog = catalogWith([makeEntry('RestrictedFont', 'Regular', 'system', 'restricted')]);
    const doc = docWith({
      t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'RestrictedFont' },
    });

    const manifest = buildDocumentFontManifest(doc, catalog);
    expect(manifest.fonts[0]!.status).toBe('restricted');
  });

  it('auto-substitutes missing fonts when requested', () => {
    const catalog = catalogWith([makeEntry('Arial', 'Regular')]);
    const doc = docWith({
      t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Helvetica' },
    });

    const manifest = buildDocumentFontManifest(doc, catalog, { autoSubstitute: true });
    const entry = manifest.fonts[0]!;
    expect(entry.familyName).toBe('Arial');
    expect(entry.status).toBe('substituted');
    expect(entry.substituteFor).toBe('Helvetica');
    expect(manifest.replacements?.[0]?.replacement).toBe('Arial');
  });

  it('deduplicates fonts by family name', () => {
    const catalog = catalogWith([makeEntry('Inter', 'Regular')]);
    const doc = docWith({
      t1: { id: 't1', kind: 'text', text: 'Hello', fontFamily: 'Inter' },
      t2: { id: 't2', kind: 'text', text: 'World', fontFamily: 'inter' },
    });

    const manifest = buildDocumentFontManifest(doc, catalog);
    expect(manifest.fonts).toHaveLength(1);
  });
});

describe('resolveManifestAgainstCatalog', () => {
  it('re-resolves missing entries against a new catalog', () => {
    const manifest: FontManifest = {
      version: 1,
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
          source: 'missing',
          embeddingRights: 'unknown',
          status: 'missing',
        },
      ],
    };

    const catalog = catalogWith([makeEntry('MissingFont', 'Regular')]);
    const resolved = resolveManifestAgainstCatalog(manifest, catalog);
    expect(resolved.fonts[0]!.status).toBe('available');
    expect(resolved.fonts[0]!.identity.postScriptName).toBe('MissingFont-Regular');
  });

  it('falls back to substituted if a missing font has a substitute in the new catalog', () => {
    const manifest: FontManifest = {
      version: 1,
      fonts: [
        {
          familyName: 'Helvetica',
          identity: {
            contentHash: '',
            postScriptName: '',
            familyName: 'Helvetica',
            subfamilyName: 'Regular',
            fullName: 'Helvetica',
          },
          source: 'missing',
          embeddingRights: 'unknown',
          status: 'missing',
        },
      ],
    };

    const catalog = catalogWith([makeEntry('Arial', 'Regular')]);
    const resolved = resolveManifestAgainstCatalog(manifest, catalog);
    expect(resolved.fonts[0]!.status).toBe('substituted');
    expect(resolved.fonts[0]!.familyName).toBe('Arial');
    expect(resolved.fonts[0]!.substituteFor).toBe('Helvetica');
  });
});
