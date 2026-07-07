import { strFromU8, unzipSync } from 'fflate';
import {
  createDocument,
  makeShapeNode,
  makeTextNode,
  type Document,
  type Fill,
  type ShapeNode,
} from '@strata/scene';
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
  it('creates a ZIP package with document, manifest, tokens, report, assets, and font notes', () => {
    const result = buildPackageExport(docWithAssetsAndFonts());
    const entries = unzipSync(result.bytes);

    expect(result.fileName).toBe('Package Doc.strata-package.zip');
    expect(entries['document.strata']).toBeDefined();
    expect(entries['manifest.json']).toBeDefined();
    expect(entries['tokens/tokens.dtcg.json']).toBeDefined();
    expect(entries['export-report.json']).toBeDefined();
    expect(entries['assets/0001.png']).toBeDefined();

    const manifest = readJson<PackageManifest>(entries, 'manifest.json');
    expect(manifest.kind).toBe('strata-package');
    expect(manifest.compatibility.tier).toBe('lossless-strata-document');
    expect(manifest.assets[0]).toMatchObject({
      status: 'embedded',
      path: 'assets/0001.png',
      mimeType: 'image/png',
    });
    expect(manifest.fonts[0]).toMatchObject({
      family: 'Inter',
      bundled: false,
    });
  });
});
