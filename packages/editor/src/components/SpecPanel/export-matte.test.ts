import { awaitExportsReady, createEngine, createRasterSurface } from '@varve/engine';
import { createDocument, makeGroupNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportNodeAsRaster } from './export';

const { imageLoad, matteFillCalls, resetImageState } = vi.hoisted(() => {
  const loaded = new Set<string>();
  return {
    imageLoad: vi.fn(async (source: string) => {
      loaded.add(source);
      return document.createElement('img');
    }),
    matteFillCalls: [] as Array<{ fillStyle: string; args: [number, number, number, number] }>,
    resetImageState: () => loaded.clear(),
  };
});

vi.mock('@varve/engine', async () => {
  const actual = await vi.importActual<typeof import('@varve/engine')>('@varve/engine');
  return {
    ...actual,
    awaitExportsReady: vi.fn(actual.awaitExportsReady),
    createRasterSurface: vi.fn(
      (width: number, height: number, attributes?: CanvasRenderingContext2DSettings) => {
        const surface = actual.createRasterSurface(width, height, attributes);
        const fillRect = surface.context.fillRect.bind(surface.context);
        surface.context.fillRect = ((x: number, y: number, w: number, h: number) => {
          matteFillCalls.push({
            fillStyle: surface.context.fillStyle,
            args: [x, y, w, h],
          });
          fillRect(x, y, w, h);
        }) as typeof surface.context.fillRect;
        return surface;
      },
    ),
    getImageCache: vi.fn(() => ({
      load: imageLoad,
      isLoaded: () => false,
      state: () => 'idle',
      get: () => undefined,
    })),
  };
});

function buildDoc() {
  const doc = createDocument('JPEG matte', true);
  const node = makeGroupNode('jpeg-matte');
  return { doc: { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } }, node };
}

describe('raster export flattening', () => {
  afterEach(() => {
    vi.mocked(awaitExportsReady).mockClear();
    vi.mocked(createRasterSurface).mockClear();
    imageLoad.mockClear();
    matteFillCalls.length = 0;
    resetImageState();
  });

  it('uses a visible white matte when flattening JPEG without an explicit background', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    const { warnings } = await exportNodeAsRaster(node, doc, eng, {
      format: 'image/jpeg',
      scale: 1,
    });

    expect(warnings).toContain(
      'JPEG cannot carry transparency; no matte was supplied, so the export was flattened to white.',
    );
    expect(matteFillCalls[0]).toEqual({
      fillStyle: 'rgba(255, 255, 255, 1)',
      args: [0, 0, 1, 1],
    });
  });

  it('uses a visible white matte when PNG transparency is explicitly disabled', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    const { warnings } = await exportNodeAsRaster(node, doc, eng, {
      format: 'image/png',
      scale: 1,
      transparency: false,
    });

    expect(warnings).toContain(
      'image/png transparency was disabled; no matte was supplied, so the export was flattened to white.',
    );
    expect(matteFillCalls[0]).toEqual({
      fillStyle: 'rgba(255, 255, 255, 1)',
      args: [0, 0, 1, 1],
    });
  });
});
