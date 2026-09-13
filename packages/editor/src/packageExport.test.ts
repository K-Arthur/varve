import {
  createDocument,
  type Document,
  type DocumentAsset,
  type Fill,
  type GenerativeEditRecord,
  makeShapeNode,
  makeTextNode,
  type RasterMaskAsset,
  type ShapeNode,
} from '@varve/scene';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPackageExport, type PackageManifest } from './packageExport';

function docWithAssetsAndFonts(): Document {
  const imageFill: Fill = {
    type: 'image',
    image: {
      src: 'data:image/png;base64,AAAA',
      fit: 'fill',
      x: 0,
      y: 0,
      scale: 1,
    },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  const image: ShapeNode = {
    ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Image' }),
    fills: [imageFill],
  };
  const text = makeTextNode('n2', 'Hello', { name: 'Label', fontFamily: 'Inter' });
  return {
    ...createDocument('Package Doc', true),
    rootChildren: ['n1', 'n2'],
    nodes: { n1: image, n2: text },
    nextId: 3,
  };
}

function readJson<T>(entries: Record<string, Uint8Array>, path: string): T {
  const bytes = entries[path];
  if (!bytes) throw new Error(`Missing ${path}`);
  return JSON.parse(strFromU8(bytes)) as T;
}

describe('buildPackageExport', () => {
  it('creates a ZIP package with document, manifest, tokens, report, assets, and font notes', async () => {
    const result = await buildPackageExport(docWithAssetsAndFonts());
    const entries = unzipSync(result.bytes);

    expect(result.fileName).toBe('Package Doc.varve-package.zip');
    expect(entries['document.varve']).toBeDefined();
    expect(entries['manifest.json']).toBeDefined();
    expect(entries['tokens/tokens.dtcg.json']).toBeDefined();
    expect(entries['export-report.json']).toBeDefined();
    expect(entries['assets/0001.png']).toBeDefined();

    const manifest = readJson<PackageManifest>(entries, 'manifest.json');
    expect(manifest.kind).toBe('varve-package');
    expect(manifest.compatibility.tier).toBe('lossless-varve-document');
    expect(manifest.assets[0]).toMatchObject({
      status: 'embedded',
      path: 'assets/0001.png',
      mimeType: 'image/png',
    });
    expect(manifest.fonts[0]).toMatchObject({
      family: 'Inter',
      bundled: false,
      embeddingStatus: 'unknown',
      reason: expect.stringContaining('Family-only legacy request'),
    });
  });

  it('does not invent an exact face for legacy family-only text', async () => {
    const result = await buildPackageExport(docWithAssetsAndFonts());
    const entries = unzipSync(result.bytes);
    const manifest = readJson<PackageManifest>(entries, 'manifest.json');

    expect(manifest.fonts).toEqual([
      expect.objectContaining({
        family: 'Inter',
        bundled: false,
        reason: expect.stringContaining('choose a face before embedding'),
      }),
    ]);
    expect(manifest.fonts[0]!.fontReference).toBeUndefined();
    expect(Object.keys(entries).some((path) => path.endsWith('.font'))).toBe(false);
  });

  it('includes raster mask assets in the package', async () => {
    const maskDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
    const maskAsset: RasterMaskAsset = {
      id: 'mask-img-1',
      mimeType: 'image/png',
      dataUrl: maskDataUrl,
      width: 1,
      height: 1,
      byteLength: 68,
    };
    const doc: Document = {
      ...createDocument('MaskDoc', true),
      rasterMaskAssets: { 'mask-img-1': maskAsset },
    };
    const result = await buildPackageExport(doc);
    const entries = unzipSync(result.bytes);

    // The mask asset should be stored in the masks/ directory
    expect(entries['masks/mask-img-1.png']).toBeDefined();

    const manifest = readJson<PackageManifest>(entries, 'manifest.json');
    const maskEntry = manifest.assets.find((a) => a.nodeId === 'mask-img-1');
    expect(maskEntry).toBeDefined();
    expect(maskEntry!.path).toBe('masks/mask-img-1.png');
    expect(maskEntry!.mimeType).toBe('image/png');
    expect(maskEntry!.status).toBe('embedded');
    expect(maskEntry!.fillIndex).toBe(-1);
  });

  it('keeps same-family exact face references separate in the package manifest', async () => {
    const firstReference = { artifactHash: '1'.repeat(64), collectionIndex: 0 };
    const secondReference = { artifactHash: '2'.repeat(64), collectionIndex: 1 };
    const first = {
      ...makeTextNode('face-a', 'A', { fontFamily: 'Shared Family' }),
      fontReference: firstReference,
    };
    const second = {
      ...makeTextNode('face-b', 'B', { fontFamily: 'Shared Family' }),
      fontReference: secondReference,
    };
    const doc: Document = {
      ...createDocument('Exact Faces', true),
      rootChildren: ['face-a', 'face-b'],
      nodes: { 'face-a': first, 'face-b': second },
      nextId: 3,
    };

    const result = await buildPackageExport(doc);

    expect(result.manifest.fonts).toHaveLength(2);
    expect(result.manifest.fonts.map((font) => font.fontReference)).toEqual(
      expect.arrayContaining([firstReference, secondReference]),
    );
    expect(result.manifest.fonts.every((font) => font.bundled === false)).toBe(true);
  });

  it('packages retained generative sources, candidates, and contexts', async () => {
    const makeAsset = (id: string, payload: string): DocumentAsset => ({
      id,
      storage: 'embedded',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${payload}`,
      naturalWidth: 1,
      naturalHeight: 1,
      byteLength: 3,
      hash: id,
    });
    const source = makeAsset('gen-source', 'AQID');
    const variation = makeAsset('gen-variation', 'BAUG');
    const context = makeAsset('gen-context', 'BwgJ');
    const edit: GenerativeEditRecord = {
      schemaVersion: 2,
      id: 'gen-edit-1',
      mode: 'replace',
      sourceNodeId: 'n1',
      sourceAssetId: source.id,
      sourceSnapshotAssetId: source.id,
      sourceLocator: 'asset:gen-source',
      sourceRevision: 1,
      placementRevision: 'placement-1',
      masks: {
        userMaskAssetId: 'mask-img-1',
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        coordinateSpace: 'source-image-pixels',
      },
      outputFrame: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        sourceWidth: 1,
        sourceHeight: 1,
        coordinateSpace: 'source-image-pixels',
      },
      maskAssetId: 'mask-img-1',
      maskWidth: 1,
      maskHeight: 1,
      maskCoordinateSpace: 'source-image-pixels',
      settings: {
        quality: 'quality',
        contextPadding: 32,
        maskExpansion: 0,
        feather: 0,
        prompt: 'a red apple',
      },
      provider: { kind: 'local', id: 'test', runtime: 'native-cpu' },
      variations: [
        {
          id: 'variation-1',
          assetId: variation.id,
          contextAssetId: context.id,
          width: 1,
          height: 1,
          createdAt: 1,
        },
      ],
      activeVariationId: 'variation-1',
      acceptedVariationId: 'variation-1',
      resultNodeId: 'n1',
      createdAt: 1,
      updatedAt: 1,
    };
    const doc: Document = {
      ...createDocument('GenerativePackage', true),
      rootChildren: ['n1'],
      nodes: { n1: docWithAssetsAndFonts().nodes.n1! },
      assets: { [source.id]: source, [variation.id]: variation, [context.id]: context },
      generativeEdits: { [edit.id]: edit },
    };

    const result = await buildPackageExport(doc);
    const entries = unzipSync(result.bytes);
    expect(entries['generative/gen-source.png']).toBeDefined();
    expect(entries['generative/gen-variation.png']).toBeDefined();
    expect(entries['generative/gen-context.png']).toBeDefined();
    expect(
      result.manifest.assets.filter((asset) => asset.purpose?.startsWith('generative-')),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetId: source.id, purpose: 'generative-source' }),
        expect.objectContaining({ assetId: variation.id, purpose: 'generative-variation' }),
        expect.objectContaining({ assetId: context.id, purpose: 'generative-context' }),
      ]),
    );
  });
});
