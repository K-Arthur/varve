import { ImageCache } from '@varve/engine';
import {
  addNode,
  createDocument,
  createEmbeddedAsset,
  imageFill,
  makeShapeNode,
  type PatternDefinition,
  patternFill,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentImageSourceCollector,
  documentImageSourcesForFrame,
} from './documentImageSources';

vi.mock('../backgroundRemoval/maskRenderCache', () => ({
  maskRenderUrl: (source: string) => (source === 'mask.png' ? 'bounded-mask.png' : source),
}));

const TILE = 'data:image/png;base64,TILE';
const IMAGE = 'data:image/png;base64,IMAGE';

function patternDocument() {
  const document = addNode(createDocument('Pattern', true), {
    ...makeShapeNode('pattern', { kind: 'rect', x: 0, y: 0, w: 300, h: 200 }),
    fills: [patternFill(TILE, { spacing: 0, rotation: 0 })],
  });
  const asset = createEmbeddedAsset({
    dataUrl: IMAGE,
    mimeType: 'image/png',
    naturalWidth: 32,
    naturalHeight: 24,
  });
  return { ...document, assets: { [asset.id]: asset } };
}

function definition(id: string, source: PatternDefinition['source']): PatternDefinition {
  return {
    id,
    name: id,
    revision: 2,
    cell: { x: 0, y: 0, width: 8, height: 8 },
    repeat: {
      arrangement: 'grid',
      gapX: 0,
      gapY: 0,
      rowShift: 0,
      mirrorX: false,
      mirrorY: false,
      originX: 0,
      originY: 0,
    },
    source,
    previewSrc: `data:image/png;base64,${id}`,
    previewRevision: 2,
  };
}

describe('document image source ownership', () => {
  it('keeps an imported pattern loaded alongside unrelated embedded assets, then releases it on close', () => {
    const collect = createDocumentImageSourceCollector();
    const cache = new ImageCache();
    const close = vi.fn();
    cache.setLoaded(TILE, { width: 8, height: 8, close } as unknown as ImageBitmap);
    cache.setLoaded(IMAGE, { naturalWidth: 32, naturalHeight: 24 } as HTMLImageElement);

    expect(cache.retainSources(collect(patternDocument()))).toBe(0);
    expect(cache.isLoaded(TILE)).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(cache.retainSources(collect(createDocument('Next', true)))).toBe(2);
    expect(cache.isLoaded(TILE)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains inline images and hidden patterns even without an asset table', () => {
    const collect = createDocumentImageSourceCollector();
    const document = addNode(createDocument('Legacy', true), {
      ...makeShapeNode('hidden', { kind: 'rect', x: 0, y: 0, w: 8, h: 8 }),
      visible: false,
      fills: [imageFill(IMAGE), patternFill(TILE, { spacing: 0, rotation: 0 })],
    });
    expect(collect(document)).toEqual([IMAGE, TILE]);
  });

  it('includes shared paints and colour styles without resolving them on every frame', () => {
    const collect = createDocumentImageSourceCollector();
    const document = {
      ...createDocument('Reusable paints', true),
      paints: {
        pattern: {
          id: 'pattern',
          name: 'Pattern',
          fill: patternFill(TILE, { spacing: 0, rotation: 0 }),
        },
      },
      styles: {
        image: {
          id: 'image',
          name: 'Image',
          type: 'color' as const,
          fill: imageFill(IMAGE),
        },
      },
    };
    expect(collect(document)).toEqual([TILE, IMAGE]);
    expect(collect(document)).toBe(collect(document));
    expect(Object.isFrozen(collect(document))).toBe(true);
  });

  it('uses current vector/procedural previews and private motif images, dropping obsolete previews', () => {
    const collect = createDocumentImageSourceCollector();
    const vector = definition('vector', {
      kind: 'vector',
      rootIds: ['motif'],
      assetIds: [],
      styleIds: [],
      componentIds: [],
      nodes: {
        motif: {
          ...makeShapeNode('motif', { kind: 'rect', x: 0, y: 0, w: 8, h: 8 }),
          fills: [imageFill(IMAGE)],
        },
      },
    });
    const procedural = definition('procedural', {
      kind: 'procedural',
      recipe: {
        type: 'checkerboard',
        tileWidth: 8,
        tileHeight: 8,
        color1: '#fff',
        color2: '#000',
        seed: 0,
      },
    });
    const document = {
      ...patternDocument(),
      patternDefinitions: {
        vector,
        procedural,
        stale: { ...vector, id: 'stale', previewSrc: 'obsolete', previewRevision: 1 },
      },
      nodes: {
        pattern: {
          ...patternDocument().nodes.pattern!,
          fills: [
            patternFill('old-placement', { definitionId: 'vector', spacing: 0, rotation: 0 }),
          ],
        },
      },
    };
    expect(collect(document)).toEqual([IMAGE, vector.previewSrc, procedural.previewSrc]);
  });

  it('retains linked raster bytes and missing-definition inline fallbacks', () => {
    const collect = createDocumentImageSourceCollector();
    const base = patternDocument();
    const asset = Object.values(base.assets)[0]!;
    const raster = definition('raster', {
      kind: 'raster',
      assetId: asset.id,
      width: 32,
      height: 24,
    });
    const document = {
      ...base,
      patternDefinitions: { raster },
      nodes: {
        pattern: {
          ...base.nodes.pattern!,
          fills: [patternFill(TILE, { definitionId: 'missing', spacing: 0, rotation: 0 })],
        },
      },
    };
    expect(collect(document)).toEqual([IMAGE, TILE]);
    expect(collect(document)).not.toContain(raster.previewSrc);
  });

  it('resolves canonical image assets and includes legacy background-removal masks', () => {
    const collect = createDocumentImageSourceCollector();
    const base = patternDocument();
    const asset = Object.values(base.assets)[0]!;
    const document = {
      ...base,
      nodes: {
        masked: {
          ...makeShapeNode('masked', { kind: 'rect', x: 0, y: 0, w: 8, h: 8 }),
          fills: [imageFill(`asset:${asset.id}`)],
          backgroundRemoval: {
            maskDataUrl: 'mask.png',
            method: 'quick' as const,
            confidence: 1,
            appliedAt: 0,
          },
        },
      },
    };
    expect(collect(document)).toEqual([IMAGE, 'mask.png']);
    expect([...documentImageSourcesForFrame(document)]).toEqual([
      IMAGE,
      'mask.png',
      'bounded-mask.png',
    ]);
  });

  it('updates ownership after a document edit and does not retain history sources', () => {
    const collect = createDocumentImageSourceCollector();
    const document = patternDocument();
    const before = collect(document);
    const after = collect({ ...document, nodes: {} });
    expect(before).toEqual([IMAGE, TILE]);
    expect(after).toEqual([IMAGE]);
    expect(after).not.toBe(before);
  });

  it('does not override the decoded cache byte budget for owned sources', () => {
    const collect = createDocumentImageSourceCollector();
    const cache = new ImageCache({ maxBytes: 16 });
    const close = vi.fn();
    cache.setLoaded(TILE, { width: 8, height: 8, close } as unknown as ImageBitmap);
    cache.retainSources(collect(patternDocument()));
    expect(cache.isLoaded(TILE)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(cache.stats.bytes).toBe(0);
  });
});
