import {
  addMockupTemplate,
  createDocument,
  findOrCreateEmbeddedAsset,
  getBuiltinMockupTemplates,
  hashMockupTemplate,
  type MockupTemplateAsset,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  exportMockupTemplateBundle,
  importMockupTemplateBundle,
  parseMockupTemplateBundle,
  serializeMockupTemplateBundle,
} from './mockupTemplatePackage';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4A==';

function fixtureTemplate(): MockupTemplateAsset {
  const base = getBuiltinMockupTemplates()[0]!;
  return {
    ...base,
    id: 'user:photo-template',
    source: 'user',
    library: true,
    plateImage: { assetId: 'placeholder', width: 64, height: 48, fit: 'cover' },
    surfaces: [
      {
        ...base.surfaces[0]!,
        id: 'artwork',
        sourceSlot: 'artwork',
        clipMaskAssetId: 'placeholder',
      },
    ],
  };
}

function fixtureDocWithAssets() {
  let doc = createDocument('bundle-test', { flat: true });
  const plate = findOrCreateEmbeddedAsset(doc, {
    dataUrl: PNG_DATA_URL,
    mimeType: 'image/png',
    naturalWidth: 64,
    naturalHeight: 48,
  });
  doc = plate.document;
  const mask = findOrCreateEmbeddedAsset(doc, {
    dataUrl: JPEG_DATA_URL,
    mimeType: 'image/jpeg',
    naturalWidth: 64,
    naturalHeight: 48,
  });
  doc = mask.document;
  const template = fixtureTemplate();
  template.plateImage = { assetId: plate.assetId, width: 64, height: 48, fit: 'cover' };
  template.surfaces = template.surfaces.map((surface) => ({
    ...surface,
    clipMaskAssetId: mask.assetId,
  }));
  const added = addMockupTemplate(doc, template);
  return {
    doc: added.document,
    templateId: added.templateId,
    plateId: plate.assetId,
    maskId: mask.assetId,
  };
}

describe('mockup template bundles', () => {
  it('round-trips template geometry and referenced assets without bound artwork', () => {
    const { doc, templateId } = fixtureDocWithAssets();
    const exported = exportMockupTemplateBundle(doc, templateId);
    if ('errors' in exported) throw new Error(exported.errors.join('; '));
    const serialized = serializeMockupTemplateBundle(exported.bundle);
    expect(serialized).not.toContain('surfaceBindings');

    const parsed = parseMockupTemplateBundle(serialized);
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
    expect(parsed.bundle.assets).toHaveLength(2);

    const target = createDocument('bundle-target', { flat: true });
    const imported = importMockupTemplateBundle(target, parsed.bundle);
    if ('errors' in imported) throw new Error(imported.errors.join('; '));
    const template = imported.document.mockupTemplates?.[imported.templateId];
    expect(template).toBeDefined();
    expect(template!.library).toBe(true);
    expect(template!.source).toBe('user');
    expect(Object.keys(imported.document.assets ?? {})).toHaveLength(2);
    expect(imported.document.assets?.[template!.plateImage!.assetId]).toBeDefined();
    const clipId = template!.surfaces[0]!.clipMaskAssetId!;
    expect(imported.document.assets?.[clipId]).toBeDefined();
    expect(template!.contentHash).toBe(hashMockupTemplate(template!));
  });

  it('rejects malformed, oversized, and incomplete bundles', () => {
    expect(parseMockupTemplateBundle('not json')).toMatchObject({
      errors: ['Bundle is not valid JSON'],
    });
    expect(parseMockupTemplateBundle(JSON.stringify({ format: 'other' }))).toMatchObject({
      errors: [expect.stringContaining('Unsupported bundle format')],
    });

    const { doc, templateId } = fixtureDocWithAssets();
    const exported = exportMockupTemplateBundle(doc, templateId);
    if ('errors' in exported) throw new Error(exported.errors.join('; '));

    // Missing referenced asset.
    const incomplete = {
      ...exported.bundle,
      assets: exported.bundle.assets.slice(0, 1),
    };
    expect(parseMockupTemplateBundle(JSON.stringify(incomplete))).toMatchObject({
      errors: [expect.stringContaining('missing referenced asset')],
    });

    // Disallowed MIME.
    const badMime = {
      ...exported.bundle,
      assets: [
        {
          ...exported.bundle.assets[0]!,
          mimeType: 'image/svg+xml',
          dataUrl: 'data:image/svg+xml;base64,AAAA',
        },
        exported.bundle.assets[1]!,
      ],
    };
    expect(parseMockupTemplateBundle(JSON.stringify(badMime))).toMatchObject({
      errors: expect.arrayContaining([expect.stringContaining('unsupported MIME')]),
    });

    // A MIME-correct data URL is not enough: reject malformed base64 before
    // any decoder or embedded-asset allocation sees it.
    const malformedBase64 = {
      ...exported.bundle,
      assets: [
        {
          ...exported.bundle.assets[0]!,
          dataUrl: 'data:image/png;base64,not-base64!',
        },
        exported.bundle.assets[1]!,
      ],
    };
    expect(parseMockupTemplateBundle(JSON.stringify(malformedBase64))).toMatchObject({
      errors: [expect.stringContaining('invalid data URL')],
    });

    // Duplicate asset ids.
    const duplicate = {
      ...exported.bundle,
      assets: [exported.bundle.assets[0]!, exported.bundle.assets[0]!],
    };
    expect(parseMockupTemplateBundle(JSON.stringify(duplicate))).toMatchObject({
      errors: [expect.stringContaining('Duplicate bundle asset id')],
    });

    const pixelBomb = {
      ...exported.bundle,
      assets: exported.bundle.assets.map((asset) => ({
        ...asset,
        naturalWidth: 16_384,
        naturalHeight: 16_384,
      })),
    };
    expect(parseMockupTemplateBundle(JSON.stringify(pixelBomb))).toMatchObject({
      errors: [expect.stringContaining('invalid dimensions')],
    });

    // Oversized raw input is rejected before parsing.
    expect(parseMockupTemplateBundle('x'.repeat(33 * 1024 * 1024))).toMatchObject({
      errors: ['Bundle exceeds the maximum size'],
    });
  });

  it('mints a content-derived id on collision instead of overwriting', () => {
    const { doc, templateId } = fixtureDocWithAssets();
    const exported = exportMockupTemplateBundle(doc, templateId);
    if ('errors' in exported) throw new Error(exported.errors.join('; '));
    const parsed = parseMockupTemplateBundle(serializeMockupTemplateBundle(exported.bundle));
    if ('errors' in parsed) throw new Error(parsed.errors.join('; '));

    // Import into the same document: identical content dedupes to the same id.
    const same = importMockupTemplateBundle(doc, parsed.bundle);
    if ('errors' in same) throw new Error(same.errors.join('; '));
    expect(same.templateId).toBe(templateId);

    // Colliding id with different content mints a new id and keeps both.
    const colliding = {
      ...parsed.bundle,
      template: { ...parsed.bundle.template, name: 'Different name', contentHash: 'other' },
    };
    const result = importMockupTemplateBundle(doc, colliding);
    if ('errors' in result) throw new Error(result.errors.join('; '));
    expect(result.templateId).not.toBe(templateId);
    expect(result.document.mockupTemplates?.[templateId]).toBeDefined();
    expect(result.document.mockupTemplates?.[result.templateId]).toBeDefined();
  });

  it('export fails clearly when a referenced asset is missing', () => {
    const { doc, templateId } = fixtureDocWithAssets();
    const assets = { ...doc.assets };
    const plateId = doc.mockupTemplates?.[templateId]?.plateImage?.assetId;
    if (plateId) delete assets[plateId];
    const result = exportMockupTemplateBundle({ ...doc, assets }, templateId);
    expect('errors' in result).toBe(true);
  });
});
