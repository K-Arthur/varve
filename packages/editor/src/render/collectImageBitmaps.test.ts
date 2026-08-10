import type { RenderItem } from '@varve/engine';
import {
  getImageCache,
  registerImageResourceHandle,
  resetImageCache,
  resetImageResourceRegistry,
} from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectImageBitmaps,
  imageSrcsFromIr,
  irHasUnsupportedWorkerMasks,
  reconcileImageBitmapMap,
  replaceImageBitmapMap,
  resolveSourcesForLoad,
} from './collectImageBitmaps';

function bitmap(close: () => void): ImageBitmap {
  return { width: 1, height: 1, close } as unknown as ImageBitmap;
}

function image(src: string): HTMLImageElement {
  return { src, naturalWidth: 1, naturalHeight: 1 } as unknown as HTMLImageElement;
}

function imageItem(...srcs: string[]): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: srcs.map((src) => ({
      type: 'image',
      src,
      fit: 'fill',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    })),
    primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    opacity: 1,
    blendMode: 'normal',
  };
}

/** A compiled table item whose cells carry rich scene content (images). */
function tableItem(cellContents: RenderItem[]): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    primitive: {
      kind: 'table',
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      cornerRadius: 0,
      borderColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      borderWidth: 0,
      dividerColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      dividerWidth: 0,
      colPositions: [0, 100],
      rowPositions: [0, 60],
      cells: cellContents.map((content, index) => ({
        x: 0,
        y: index * 30,
        w: 100,
        h: 30,
        fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        content,
        rowIdx: index,
        columnIdx: 0,
        rowSpan: 1,
        columnSpan: 1,
      })),
    },
    opacity: 1,
    blendMode: 'normal',
  };
}

describe('worker ImageBitmap lifecycle', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    resetImageCache();
    resetImageResourceRegistry();
  });

  afterEach(() => {
    resetImageCache();
    resetImageResourceRegistry();
    globalThis.createImageBitmap = originalCreateImageBitmap;
    vi.restoreAllMocks();
  });

  it('closes bitmaps replaced or removed from the worker image map', () => {
    const oldA = bitmap(vi.fn());
    const oldB = bitmap(vi.fn());
    const retained = bitmap(vi.fn());
    const next = { a: bitmap(vi.fn()), retained };

    expect(replaceImageBitmapMap({ a: oldA, b: oldB, retained }, next)).toBe(next);
    expect(oldA.close).toHaveBeenCalledOnce();
    expect(oldB.close).toHaveBeenCalledOnce();
    expect(retained.close).not.toHaveBeenCalled();
  });

  it('reconciles a delta against the authoritative source manifest', () => {
    const retained = bitmap(vi.fn());
    const removed = bitmap(vi.fn());
    const added = bitmap(vi.fn());
    const unexpected = bitmap(vi.fn());

    const next = reconcileImageBitmapMap({ retained, removed }, { added, unexpected }, [
      'retained',
      'added',
    ]);

    expect(next).toEqual({ retained, added });
    expect(retained.close).not.toHaveBeenCalled();
    expect(removed.close).toHaveBeenCalledOnce();
    expect(added.close).not.toHaveBeenCalled();
    expect(unexpected.close).toHaveBeenCalledOnce();
  });

  it('closes already-created bitmaps when collection cannot finish', async () => {
    const first = bitmap(vi.fn());
    getImageCache().setLoaded('first.png', image('first.png'));
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(first);

    await expect(collectImageBitmaps([imageItem('first.png', 'missing.png')])).resolves.toBeNull();

    expect(first.close).toHaveBeenCalledOnce();
  });

  it('caps the number of decoded fills per transfer', async () => {
    const bmps = [bitmap(vi.fn()), bitmap(vi.fn()), bitmap(vi.fn())];
    getImageCache().setLoaded('a.png', image('a.png'));
    getImageCache().setLoaded('b.png', image('b.png'));
    getImageCache().setLoaded('c.png', image('c.png'));
    globalThis.createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(bmps[0])
      .mockResolvedValueOnce(bmps[1])
      .mockResolvedValueOnce(bmps[2]);

    await expect(
      collectImageBitmaps([imageItem('a.png', 'b.png', 'c.png')], { maxEntries: 2 }),
    ).resolves.toBeNull();
    // Reject before allocating any bitmap when the manifest itself is over
    // the worker's resident-entry budget.
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(bmps[0]!.close).not.toHaveBeenCalled();
    expect(bmps[1]!.close).not.toHaveBeenCalled();
    expect(bmps[2]!.close).not.toHaveBeenCalled();
  });

  it('reports the estimated bytes of the collected map', async () => {
    const bmp = { width: 40, height: 30, close: vi.fn() } as unknown as ImageBitmap;
    getImageCache().setLoaded('a.png', image('a.png'));
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);

    const collected = await collectImageBitmaps([imageItem('a.png')]);
    expect(collected).not.toBeNull();
    expect(collected!.bytes).toBe(40 * 30 * 4);
  });

  it('creates only missing bitmaps while returning the full required-source manifest', async () => {
    const fresh = bitmap(vi.fn());
    getImageCache().setLoaded('resident.png', image('resident.png'));
    getImageCache().setLoaded('fresh.png', image('fresh.png'));
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(fresh);

    const collected = await collectImageBitmaps([imageItem('resident.png', 'fresh.png')], {
      residentSources: new Set(['resident.png']),
    });

    expect(collected?.sources).toEqual(['resident.png', 'fresh.png']);
    expect(collected?.images).toEqual({ 'fresh.png': fresh });
    expect(globalThis.createImageBitmap).toHaveBeenCalledOnce();
  });
});

describe('canonical resource handles in worker collection', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    resetImageCache();
    resetImageResourceRegistry();
  });

  afterEach(() => {
    resetImageCache();
    resetImageResourceRegistry();
    globalThis.createImageBitmap = originalCreateImageBitmap;
    vi.restoreAllMocks();
  });

  it('collects the short handle from IR and keys the manifest by it', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    registerImageResourceHandle('asset-abc123', dataUrl);
    getImageCache().setLoaded(dataUrl, image(dataUrl));
    const bmp = bitmap(vi.fn());
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);

    const collected = await collectImageBitmaps([imageItem('asset-abc123')]);

    expect(collected?.images).toEqual({ 'asset-abc123': bmp });
    expect(collected?.sources).toEqual(['asset-abc123']);
    // The cache (not the IR) carries the payload: bitmap came from the
    // data URL entry.
    expect(getImageCache().isLoaded(dataUrl)).toBe(true);
  });

  it('refuses collection when a referenced handle is not registered', async () => {
    const bmp = bitmap(vi.fn());
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);
    await expect(collectImageBitmaps([imageItem('asset-unregistered')])).resolves.toBeNull();
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(bmp.close).not.toHaveBeenCalled();
  });

  it('resolves multiple identities through the registry', () => {
    registerImageResourceHandle('asset-a', 'data:image/png;base64,A');
    registerImageResourceHandle('asset-b', 'data:image/png;base64,B');
    expect(resolveSourcesForLoad(['asset-a', 'data:image/png;base64,RAW', 'asset-b'])).toEqual([
      'data:image/png;base64,A',
      'data:image/png;base64,RAW',
      'data:image/png;base64,B',
    ]);
  });

  it('returns null when any referenced handle is missing', () => {
    registerImageResourceHandle('asset-aaaaaaaaaaaaaaaa', 'data:image/png;base64,A');
    expect(resolveSourcesForLoad(['asset-aaaaaaaaaaaaaaaa', 'asset-bbbbbbbbbbbbbbbb'])).toBeNull();
  });

  it('passes handle-shaped legacy strings through only when registered', () => {
    // A raw source that is not handle-shaped never touches the registry.
    expect(resolveSourcesForLoad(['data:image/png;base64,RAW'])).toEqual([
      'data:image/png;base64,RAW',
    ]);
  });

  it('collects raster mask (alphaMask) resources alongside image fills', () => {
    const ir: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'asset-photo',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            alphaMask: 'data:image/png;base64,MASK',
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    expect(imageSrcsFromIr(ir)).toEqual(['asset-photo', 'data:image/png;base64,MASK']);
    expect(irHasUnsupportedWorkerMasks(ir)).toBe(true);
  });

  it('collects image fills inside table cell content', () => {
    const cellImage = imageItem('asset-cell-photo');
    cellImage.fills![0] = {
      ...(cellImage.fills![0] as Record<string, unknown>),
      alphaMask: 'data:image/png;base64,CELLMASK',
    } as RenderItem['fills'][number];
    const ir: RenderItem[] = [tableItem([cellImage])];
    expect(imageSrcsFromIr(ir)).toEqual(['asset-cell-photo', 'data:image/png;base64,CELLMASK']);
    expect(irHasUnsupportedWorkerMasks(ir)).toBe(true);
  });

  it('collects image fills inside nested table cell content', () => {
    const ir: RenderItem[] = [tableItem([tableItem([imageItem('asset-nested')])])];
    expect(imageSrcsFromIr(ir)).toEqual(['asset-nested']);
    expect(irHasUnsupportedWorkerMasks(ir)).toBe(false);
  });

  it('flags masked fills as worker-unready and keeps the frame on the main thread', async () => {
    registerImageResourceHandle('asset-photo', 'data:image/png;base64,PHOTO');
    getImageCache().setLoaded('data:image/png;base64,PHOTO', image('data:image/png;base64,PHOTO'));
    getImageCache().setLoaded('data:image/png;base64,MASK', image('data:image/png;base64,MASK'));
    const ir: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'asset-photo',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            alphaMask: 'data:image/png;base64,MASK',
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    const bmp = bitmap(vi.fn());
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);
    await expect(collectImageBitmaps(ir)).resolves.toBeNull();
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });
});
