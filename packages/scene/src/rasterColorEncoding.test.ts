/**
 * Raster colour encoding model tests: structural validation, profile
 * registry enrichment, and document round-trip preservation.
 */

import { LEGACY_ASSUMED_ENCODING } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  createEmbeddedAsset,
  upsertIccProfile,
  validateDocumentAsset,
  validateIccProfileEntry,
  validateRasterColorEncoding,
} from './assets';
import { createDocument, type Document } from './document';
import { CURRENT_DOCUMENT_VERSION } from './version';
import { migrateDocument, serializeDocument } from './version';

const P3_ENCODING = {
  model: 'rgb',
  primaries: 'display-p3',
  transfer: 'gamma22',
  bitDepth: 16,
  alphaMode: 'straight',
  provenance: 'embedded-icc',
  profileId: 'icc-abc',
} as const;

describe('validateRasterColorEncoding', () => {
  it('accepts a well-formed encoding block', () => {
    expect(validateRasterColorEncoding('asset-1', P3_ENCODING)).toBeNull();
  });

  it('accepts an AVIF CICP block', () => {
    expect(
      validateRasterColorEncoding('asset-1', {
        model: 'rgb',
        primaries: 'rec2020',
        transfer: 'pq',
        matrixCoefficients: 'bt2020-ncl',
        videoRange: 'limited',
        bitDepth: 10,
        provenance: 'cicp',
        diagnostics: ['ICC and nclx both present'],
      }),
    ).toBeNull();
  });

  it('rejects unknown primaries and invalid provenance', () => {
    expect(
      validateRasterColorEncoding('a', {
        model: 'rgb',
        primaries: 'ntsc' as never,
        provenance: 'embedded-icc',
      }),
    ).toContain('primaries');
    expect(
      validateRasterColorEncoding('a', { model: 'rgb', provenance: 'made-up' as never }),
    ).toContain('provenance');
    expect(
      validateRasterColorEncoding('a', { model: 'hsv' as never, provenance: 'unknown' }),
    ).toContain(
      'model',
    );
    expect(
      validateRasterColorEncoding('a', {
        model: 'rgb',
        provenance: 'assumed',
        bitDepth: 9 as never,
      }),
    ).toContain('bitDepth');
  });

  it('rejects non-string diagnostics', () => {
    expect(
      validateRasterColorEncoding('a', {
        model: 'rgb',
        provenance: 'assumed',
        diagnostics: [42 as unknown as string],
      }),
    ).toContain('diagnostics');
  });
});

describe('validateDocumentAsset with colour metadata', () => {
  it('validates an asset carrying colorEncoding', () => {
    const asset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,aGk=',
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
      metadata: {
        iccStatus: 'valid',
        iccProfileId: 'icc-abc',
        colorEncoding: { ...P3_ENCODING },
      },
    });
    expect(validateDocumentAsset(asset)).toBeNull();
  });

  it('rejects an asset with a broken colorEncoding block', () => {
    const asset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,aGk=',
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
      metadata: {
        colorEncoding: {
          model: 'rgb',
          primaries: 'bogus' as never,
          provenance: 'embedded-icc',
        },
      },
    });
    expect(validateDocumentAsset(asset)).toContain('colorEncoding');
  });
});

describe('IccProfileEntry enrichment', () => {
  it('validates header info fields', () => {
    const entry = upsertIccProfile(
      { iccProfiles: {}, assets: {} } as never,
      'cHJvZmlsZQ=='.repeat(32),
      'sRGB',
    );
    const enriched = {
      ...(entry.document as { iccProfiles: Record<string, import('./types').IccProfileEntry> })
        .iccProfiles[entry.profileId]!,
      profileClass: 'mntr',
      colorSpace: 'RGB ',
      version: '4.3.0',
      renderingIntent: 1,
    };
    expect(validateIccProfileEntry(enriched)).toBeNull();
    expect(validateIccProfileEntry({ ...enriched, renderingIntent: 7 })).toContain(
      'renderingIntent',
    );
    expect(validateIccProfileEntry({ ...enriched, profileClass: 4 as never })).toContain(
      'profileClass',
    );
  });
});

describe('document round-trip', () => {
  it('migrates to 2.19 and preserves raster colour metadata', () => {
    let doc: Document = createDocument('colour-doc');
    doc = migrateDocument(doc) as unknown as Document;
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);

    // Add an asset with colour metadata, serialize, reload.
    const asset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,aGk=',
      mimeType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
      metadata: {
        orientation: 6,
        pixelWidth: 20,
        pixelHeight: 10,
        iccStatus: 'valid',
        iccProfileId: 'icc-abc',
        iccDescription: 'Display P3 test',
        colorEncoding: { ...P3_ENCODING, provenance: 'embedded-icc', profileId: 'icc-abc' },
      },
    });
    doc = { ...doc, assets: { [asset.id]: asset } } as Document;
    const serialized = serializeDocument(doc);
    const reloaded = migrateDocument(
      JSON.parse(serialized) as unknown as Record<string, unknown>,
    ) as unknown as Document;
    const reloadedAsset = reloaded.assets?.[asset.id];
    expect(reloadedAsset?.metadata?.colorEncoding).toMatchObject({
      primaries: 'display-p3',
      provenance: 'embedded-icc',
    });
    expect(reloadedAsset?.metadata?.colorEncoding?.bitDepth).toBe(16);
  });

  it('leaves legacy documents untagged (no fabricated encodings)', () => {
    const raw = {
      formatVersion: '2.18',
      id: 'd1',
      name: 'legacy',
      nodes: {},
      assets: {
        'asset-1': {
          id: 'asset-1',
          storage: 'embedded',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGk=',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 2,
          hash: 'h',
        },
      },
    };
    const migrated = migrateDocument(raw as never) as Record<string, never> & {
      formatVersion: string;
      assets?: Record<string, { metadata?: unknown }>;
    };
    expect(migrated.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    const asset = migrated.assets?.['asset-1'] as { metadata?: unknown };
    expect(asset.metadata).toBeUndefined();
  });

  it('keeps the legacy assumed encoding constant honest', () => {
    expect(LEGACY_ASSUMED_ENCODING.provenance).toBe('legacy-assumed-srgb');
    expect(LEGACY_ASSUMED_ENCODING.primaries).toBe('srgb');
  });
});
