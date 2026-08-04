import type { RenderItem } from '@varve/engine';
import { getImageCache, resetImageCache } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectImageBitmaps, replaceImageBitmapMap } from './collectImageBitmaps';

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

describe('worker ImageBitmap lifecycle', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    resetImageCache();
  });

  afterEach(() => {
    resetImageCache();
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
    expect(bmps[0]!.close).toHaveBeenCalledOnce();
    expect(bmps[1]!.close).toHaveBeenCalledOnce();
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
});
