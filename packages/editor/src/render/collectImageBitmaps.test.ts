import type { RenderItem } from '@strata/engine';
import { getImageCache, resetImageCache } from '@strata/engine';
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
});
