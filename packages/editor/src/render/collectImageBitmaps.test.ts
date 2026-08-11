import type { RenderItem } from '@varve/engine';
import {
  getImageCache,
  registerImageResourceHandle,
  resetImageCache,
  resetImageResourceRegistry,
} from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admitWorkerImagePayload,
  collectImageBitmaps,
  imageSrcsFromIr,
  irHasUnsupportedWorkerMasks,
  reconcileImageBitmapMap,
  replaceImageBitmapMap,
  resolveSourcesForLoad,
  workerSourceCapFor,
} from './collectImageBitmaps';

function bitmap(close: () => void): ImageBitmap {
  return { width: 1, height: 1, close } as unknown as ImageBitmap;
}

/** Mutable-dimension ImageBitmap mock (width/height are readonly on the real type). */
function sizedBitmap(close: () => void, width: number, height: number): ImageBitmap {
  return { width, height, close } as unknown as ImageBitmap;
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
    } as NonNullable<RenderItem['fills']>[number];
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

  it('rounds the worker source cap to powers of two with zoom hysteresis', () => {
    expect(workerSourceCapFor(1280, 1, 0.16)).toBe(2048);
    expect(workerSourceCapFor(1280, 1, 1)).toBe(2048);
    expect(workerSourceCapFor(1280, 2, 1)).toBe(4096);
    expect(workerSourceCapFor(1280, 1, 2)).toBe(4096);
    expect(workerSourceCapFor(1280, 1, 4)).toBe(8192);
    expect(workerSourceCapFor(1280, 1, 16)).toBe(8192);
    expect(workerSourceCapFor(800, 1, 0.5)).toBe(0);
  });

  it('transfers the at-size representation when the source exceeds the cap', async () => {
    registerImageResourceHandle('asset-big', 'data:image/png;base64,BIG');
    const dataUrl = 'data:image/png;base64,BIG';
    const ir: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'asset-big',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 6000,
            imageHeight: 4000,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    const cache = getImageCache();
    const preview = sizedBitmap(vi.fn(), 2048, 1365);

    // Frame 1: the at-size entry does not exist yet — the frame stays on the
    // main thread and the load is kicked for the next frame.
    const loadAtSizeSpy = vi.spyOn(cache, 'loadAtSize');
    loadAtSizeSpy.mockResolvedValue(
      preview as unknown as Awaited<ReturnType<typeof cache.loadAtSize>>,
    );
    await expect(collectImageBitmaps(ir, { maxSourceDim: 2048 })).resolves.toBeNull();
    expect(loadAtSizeSpy).toHaveBeenCalledWith(dataUrl, 2048, { width: 6000, height: 4000 });

    // Frame 2: the at-size entry is resident — the worker receives a clone
    // of the small bitmap (cache keeps ownership of its copy; the worker
    // closes the transferred one), never the 96 MP decode.
    cache.setLoaded(cache.atSizeKey(dataUrl, 2048), preview);
    const cloned = sizedBitmap(vi.fn(), 2048, 1365);
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(cloned);
    const collected = await collectImageBitmaps(ir, { maxSourceDim: 2048 });
    expect(collected).not.toBeNull();
    expect(collected?.images['asset-big']).toBe(cloned);
    expect(collected?.bytes).toBe(2048 * 1365 * 4);
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(preview);
  });

  it('keeps the full-res path when the source fits the cap or has no dims', async () => {
    registerImageResourceHandle('asset-small', 'data:image/png;base64,SMALL');
    const dataUrl = 'data:image/png;base64,SMALL';
    const full = {
      src: dataUrl,
      naturalWidth: 1024,
      naturalHeight: 768,
      width: 1024,
      height: 768,
    } as unknown as HTMLImageElement;
    getImageCache().setLoaded(dataUrl, full);
    const bmp = sizedBitmap(vi.fn(), 1024, 768);
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);

    const ir: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'asset-small',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 1024,
            imageHeight: 768,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    const collected = await collectImageBitmaps(ir, { maxSourceDim: 2048 });

    expect(collected).not.toBeNull();
    expect(collected?.images['asset-small']).toBe(bmp);
    expect(collected?.bytes).toBe(1024 * 768 * 4);
  });

  it('collects at-size dims from table cell content fills', async () => {
    registerImageResourceHandle('asset-cell', 'data:image/png;base64,CELL');
    const cellImage = imageItem('asset-cell');
    cellImage.fills![0] = {
      ...(cellImage.fills![0] as Record<string, unknown>),
      imageWidth: 6000,
      imageHeight: 4000,
    } as NonNullable<RenderItem['fills']>[number];
    const ir: RenderItem[] = [tableItem([cellImage])];

    const cache = getImageCache();
    const preview = sizedBitmap(vi.fn(), 2048, 1365);
    const loadAtSizeSpy = vi.spyOn(cache, 'loadAtSize');
    loadAtSizeSpy.mockResolvedValue(
      preview as unknown as Awaited<ReturnType<typeof cache.loadAtSize>>,
    );

    // First frame kicks the at-size load with the cell content's dims.
    await expect(collectImageBitmaps(ir, { maxSourceDim: 2048 })).resolves.toBeNull();
    expect(loadAtSizeSpy).toHaveBeenCalledWith('data:image/png;base64,CELL', 2048, {
      width: 6000,
      height: 4000,
    });

    // Next frame transfers a clone of the resident at-size entry (cache
    // keeps ownership of its copy; the worker closes the transferred one).
    cache.setLoaded(cache.atSizeKey('data:image/png;base64,CELL', 2048), preview);
    const cloned = sizedBitmap(vi.fn(), 2048, 1365);
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(cloned);
    const collected = await collectImageBitmaps(ir, { maxSourceDim: 2048 });
    expect(collected).not.toBeNull();
    expect(collected?.images['asset-cell']).toBe(cloned);
  });
});

describe('synchronous worker image-payload admission', () => {
  beforeEach(() => {
    resetImageCache();
    resetImageResourceRegistry();
  });

  it('admits a frame whose sources fit the transfer budget', () => {
    expect(admitWorkerImagePayload([imageItem('a.png', 'b.png')], { maxEntries: 2 })).toBeNull();
  });

  it('admits a frame with no image fills at all', () => {
    expect(admitWorkerImagePayload([], { maxEntries: 0 })).toBeNull();
  });

  it('refuses a frame carrying more distinct sources than the transfer budget', () => {
    expect(admitWorkerImagePayload([imageItem('a.png', 'b.png', 'c.png')], { maxEntries: 2 })).toBe(
      'source-count',
    );
  });

  it('counts only sources that still need transferring, so a resident scene is admitted', () => {
    // Regression: counting residents too refused a fully-resident scene
    // forever — a refused frame transfers nothing, so residency could never
    // grow past the cap and the worker never rendered the document again.
    expect(
      admitWorkerImagePayload([imageItem('a.png', 'b.png', 'c.png')], {
        maxEntries: 1,
        residentSources: new Set(['a.png', 'b.png']),
      }),
    ).toBeNull();
  });

  it('refuses masked fills the worker cannot composite', () => {
    const masked = imageItem('a.png');
    (masked.fills![0] as unknown as Record<string, unknown>).alphaMask = 'mask.png';
    expect(admitWorkerImagePayload([masked])).toBe('masked');
  });

  it('refuses unregistered canonical resource handles', () => {
    expect(admitWorkerImagePayload([imageItem('asset-0123456789abcdef')])).toBe(
      'unresolvable-source',
    );
  });

  it('agrees with collectImageBitmaps: every refusal reason also refuses collection', async () => {
    // The paint gate and the transfer path must never disagree about whether
    // a fresh worker frame is coming.
    getImageCache().setLoaded('a.png', image('a.png'));
    getImageCache().setLoaded('b.png', image('b.png'));
    getImageCache().setLoaded('c.png', image('c.png'));
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap(vi.fn()));

    const ir = [imageItem('a.png', 'b.png', 'c.png')];
    expect(admitWorkerImagePayload(ir, { maxEntries: 2 })).not.toBeNull();
    await expect(collectImageBitmaps(ir, { maxEntries: 2 })).resolves.toBeNull();

    expect(admitWorkerImagePayload(ir, { maxEntries: 3 })).toBeNull();
    await expect(collectImageBitmaps(ir, { maxEntries: 3 })).resolves.not.toBeNull();
  });
});
