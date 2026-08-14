import { act, renderHook } from '@testing-library/react';
import { getImageCache, resetImageCache } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { thumbnailCacheKey } from './thumbnailCache';
import { sharedThumbnailCache, useThumbnail } from './useThumbnail';

function makeShapeNode(id: string): SceneNode {
  return {
    id,
    name: 'Rect',
    kind: 'shape',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
    index: 0,
    order: 'a0',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  } as unknown as SceneNode;
}

// requestIdleCallback isn't polyfilled in the test environment, so
// useThumbnail always takes its setTimeout(50ms) fallback path here —
// making fake timers a reliable way to drive it deterministically.
async function flushRenderTimer() {
  await act(async () => {
    // FileReader's onloadend fires via jsdom's own internal scheduling on
    // top of the blob promise, so a plain timer-advance + microtask flush
    // isn't enough — runAllTimersAsync repeatedly drains both until settled.
    await vi.runAllTimersAsync();
  });
}

describe('useThumbnail caching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetImageCache();
  });

  it('starts null and renders asynchronously on first mount (cache miss)', async () => {
    const node = makeShapeNode('thumb-test-1');
    const { result, unmount } = renderHook(() => useThumbnail(node));
    expect(result.current).toBeNull();

    await flushRenderTimer();

    expect(result.current).not.toBeNull();
    unmount();
  });

  it('returns the cached thumbnail synchronously on re-mount (cache hit)', async () => {
    const node = makeShapeNode('thumb-test-2');
    const first = renderHook(() => useThumbnail(node));
    await flushRenderTimer();
    expect(first.result.current).not.toBeNull();
    const cachedUrl = first.result.current;
    first.unmount();

    // Re-mount the same node (same id/kind/fill => same cache key). No timer
    // advance here — this is exactly the virtualizer scroll-out/scroll-in
    // pattern this cache exists to make cheap.
    const second = renderHook(() => useThumbnail(node));
    expect(second.result.current).toBe(cachedUrl);
    second.unmount();
  });

  it('does not share cache entries across different node ids', () => {
    const nodeB = makeShapeNode('thumb-test-3b');
    const { result, unmount } = renderHook(() => useThumbnail(nodeB));
    // Never rendered/cached before — must start null regardless of what
    // other nodes have already populated the shared cache.
    expect(result.current).toBeNull();
    unmount();
  });

  it('invalidates the cache when the node fill changes (same id/kind)', async () => {
    const node = makeShapeNode('thumb-test-4');
    const first = renderHook(({ n }: { n: SceneNode }) => useThumbnail(n), {
      initialProps: { n: node },
    });
    await flushRenderTimer();
    const firstUrl = first.result.current;
    expect(firstUrl).not.toBeNull();

    const recolored: SceneNode = {
      ...node,
      fill: { space: 'rgb', r: 200, g: 0, b: 0, a: 255 },
    } as SceneNode;
    // Cache key includes a fill hash, so this is a fresh key — must
    // re-render (start null again) rather than reuse the old thumbnail.
    first.rerender({ n: recolored });
    expect(first.result.current).toBeNull();

    await flushRenderTimer();
    expect(first.result.current).not.toBeNull();
    expect(sharedThumbnailCache.get(thumbnailCacheKey(node))).toBe(firstUrl);
    first.unmount();
  });

  it('uses the bounded image representation for image layer thumbnails', async () => {
    const node = {
      ...makeShapeNode('thumb-image'),
      fills: [
        {
          type: 'image',
          image: {
            src: 'data:image/png;base64,LAYER_THUMB',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 4000,
            imageHeight: 3000,
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    } as unknown as SceneNode;
    const loadAtSize = vi.spyOn(getImageCache(), 'loadAtSize').mockResolvedValue({
      width: 28,
      height: 21,
    } as ImageBitmap);

    const { result, unmount } = renderHook(() => useThumbnail(node));
    await flushRenderTimer();

    expect(result.current).not.toBeNull();
    expect(loadAtSize).toHaveBeenCalledWith('data:image/png;base64,LAYER_THUMB', 28, {
      width: 4000,
      height: 3000,
    });
    unmount();
  });
});
