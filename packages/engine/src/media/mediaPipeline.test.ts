/**
 * Frame cache, checkpoint store, scheduler, and session tests (DOM-free).
 */

import { describe, expect, it } from 'vitest';
import { MediaCheckpointStore } from './checkpoints';
import { compositeRange, createCompositeState } from './compositor';
import { MediaFrameCache, mediaFrameCacheKey } from './frameCache';
import { AnimatedMediaSession, MediaRegistry } from './index';
import { MediaFrameScheduler } from './scheduler';
import type { AnimatedImageMetadata, DecodedSourceFrame } from './types';

function solid(w: number, h: number, value: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = value;
    px[i + 1] = value;
    px[i + 2] = value;
    px[i + 3] = 255;
  }
  return px;
}

function sourceFrame(index: number, value: number): DecodedSourceFrame {
  return {
    index,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    durationMs: 40,
    blend: 'source',
    disposal: 'none',
    preComposited: false,
    rgba: solid(4, 4, value),
  };
}

const metadata: AnimatedImageMetadata = {
  kind: 'gif',
  frameCount: 10,
  durationMs: 400,
  loopCount: 'infinite',
  width: 4,
  height: 4,
  frames: Array.from({ length: 10 }, (_, i) => ({
    index: i,
    durationMs: 40,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    blend: 'source' as const,
    disposal: 'none' as const,
  })),
  decoderVersion: 1,
};

describe('MediaFrameCache', () => {
  it('byte-budgeted LRU eviction with stats', () => {
    const cache = new MediaFrameCache({ maxBytes: 4 * 4 * 4 * 3 + 64 * 3 }); // ~3 frames
    for (let i = 0; i < 5; i++) {
      cache.set(
        mediaFrameCacheKey({ assetId: 'a', frameIndex: i, decoderVersion: 1, width: 4, height: 4 }),
        {
          frameIndex: i,
          width: 4,
          height: 4,
          rgba: solid(4, 4, i),
        },
      );
    }
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.stats.evictions).toBeGreaterThan(0);
    expect(
      cache.get(
        mediaFrameCacheKey({ assetId: 'a', frameIndex: 0, decoderVersion: 1, width: 4, height: 4 }),
      ),
    ).toBeUndefined();
    expect(
      cache.get(
        mediaFrameCacheKey({ assetId: 'a', frameIndex: 4, decoderVersion: 1, width: 4, height: 4 }),
      )?.frameIndex,
    ).toBe(4);
  });

  it('rejects oversize single frames but reports them', () => {
    const cache = new MediaFrameCache({ maxBytes: 100 });
    const key = mediaFrameCacheKey({
      assetId: 'a',
      frameIndex: 0,
      decoderVersion: 1,
      width: 64,
      height: 64,
    });
    cache.set(key, { frameIndex: 0, width: 64, height: 64, rgba: solid(64, 64, 1) });
    expect(cache.size).toBe(0);
    expect(cache.stats.rejectedOversize).toBe(1);
  });

  it('subscribes on set', () => {
    const cache = new MediaFrameCache({ maxBytes: 1 << 20 });
    const key = mediaFrameCacheKey({
      assetId: 'a',
      frameIndex: 0,
      decoderVersion: 1,
      width: 4,
      height: 4,
    });
    let notified = 0;
    cache.subscribe(key, () => notified++);
    cache.set(key, { frameIndex: 0, width: 4, height: 4, rgba: solid(4, 4, 9) });
    expect(notified).toBe(1);
  });

  it('clearForAsset evicts only that asset', () => {
    const cache = new MediaFrameCache({ maxBytes: 1 << 20 });
    const ka = mediaFrameCacheKey({
      assetId: 'a',
      frameIndex: 0,
      decoderVersion: 1,
      width: 4,
      height: 4,
    });
    const kb = mediaFrameCacheKey({
      assetId: 'b',
      frameIndex: 0,
      decoderVersion: 1,
      width: 4,
      height: 4,
    });
    cache.set(ka, { frameIndex: 0, width: 4, height: 4, rgba: solid(4, 4, 1) });
    cache.set(kb, { frameIndex: 0, width: 4, height: 4, rgba: solid(4, 4, 2) });
    cache.clearForAsset('a');
    expect(cache.get(ka)).toBeUndefined();
    expect(cache.get(kb)).toBeDefined();
  });
});

describe('MediaCheckpointStore', () => {
  it('stores at stride boundaries and finds the nearest predecessor', () => {
    const store = new MediaCheckpointStore({ stride: 32, maxBytes: 1 << 20 });
    const state = createCompositeState(4, 4);
    store.put('a', 0, state);
    store.put('a', 32, state);
    store.put('a', 64, state);
    // 32 is stored (32 % 32 === 0); 33 is not
    expect(store.put('a', 33, state), 'non-stride put is ignored').toBeUndefined();
    expect(store.nearest('a', 40)?.frameIndex).toBe(32);
    expect(store.nearest('a', 64)?.frameIndex).toBe(64);
    expect(store.nearest('a', 10)?.frameIndex).toBe(0);
  });

  it('byte budget evicts oldest', () => {
    const store = new MediaCheckpointStore({ stride: 1, maxBytes: 4 * 4 * 4 * 2 + 64 * 2 });
    const state = createCompositeState(4, 4);
    for (let i = 0; i < 5; i++) store.put('a', i, state);
    expect(store.stats.evictions).toBeGreaterThan(0);
  });
});

describe('MediaFrameScheduler', () => {
  function makeScheduler(opts: { decodeDelayMs?: number; stride?: number } = {}) {
    const cache = new MediaFrameCache({ maxBytes: 1 << 20 });
    const checkpoints = new MediaCheckpointStore({ stride: opts.stride ?? 1, maxBytes: 1 << 20 });
    const decodeCalls: Array<{ start: number; end: number }> = [];
    const scheduler = new MediaFrameScheduler({
      cache,
      checkpoints,
      decodeFrames: async (bytes, range) => {
        decodeCalls.push({ start: range.start, end: range.end });
        if (opts.decodeDelayMs) {
          await new Promise((r) => setTimeout(r, opts.decodeDelayMs));
        }
        return Array.from({ length: range.end - range.start + 1 }, (_, i) =>
          sourceFrame(range.start + i, range.start + i),
        );
      },
    });
    const bytes = new Uint8Array(8);
    return { scheduler, cache, checkpoints, decodeCalls, bytes };
  }

  it('decodes from zero and caches every frame in the range', async () => {
    const { scheduler, cache, decodeCalls, bytes } = makeScheduler();
    const frame = await scheduler.requestFrame({ id: 'a', bytes, metadata }, 3, {
      prefetch: false,
    });
    expect(frame.frameIndex).toBe(3);
    // decoded 0..3 and cached all four
    expect(decodeCalls).toEqual([{ start: 0, end: 3 }]);
    for (let i = 0; i <= 3; i++) {
      expect(
        cache.get(
          mediaFrameCacheKey({
            assetId: 'a',
            frameIndex: i,
            decoderVersion: 1,
            width: 4,
            height: 4,
          }),
        )?.frameIndex,
      ).toBe(i);
    }
  });

  it('resumes from the nearest checkpoint instead of zero', async () => {
    const { scheduler, decodeCalls, bytes } = makeScheduler();
    await scheduler.requestFrame({ id: 'a', bytes, metadata }, 3, { prefetch: false });
    await scheduler.requestFrame({ id: 'a', bytes, metadata }, 5, { prefetch: false });
    // second request resumes from the checkpoint at 3 (stride 32 → every
    // frame is a checkpoint in this store)
    expect(decodeCalls).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it('deduplicates in-flight requests', async () => {
    const { scheduler, decodeCalls, bytes } = makeScheduler({ decodeDelayMs: 20 });
    const [a, b] = await Promise.all([
      scheduler.requestFrame({ id: 'a', bytes, metadata }, 2, { prefetch: false }),
      scheduler.requestFrame({ id: 'a', bytes, metadata }, 2, { prefetch: false }),
    ]);
    expect(a.frameIndex).toBe(2);
    expect(b.frameIndex).toBe(2);
    expect(decodeCalls).toHaveLength(1);
  });

  it('stale results never present after invalidation', async () => {
    const { scheduler, decodeCalls, bytes } = makeScheduler({ decodeDelayMs: 30 });
    const slow = scheduler.requestFrame({ id: 'a', bytes, metadata }, 4, { onReady: () => {} });
    scheduler.invalidate('a'); // seek elsewhere
    await expect(slow).rejects.toThrow();
    expect(decodeCalls).toHaveLength(1);
  });

  it('latest-wins: onReady only fires for the current generation', async () => {
    const { scheduler, bytes } = makeScheduler({ decodeDelayMs: 20 });
    const presented: number[] = [];
    const first = scheduler.requestFrame({ id: 'a', bytes, metadata }, 4, {
      onReady: (f) => presented.push(f.frameIndex),
    });
    scheduler.invalidate('a');
    await first.catch(() => {});
    const second = await scheduler.requestFrame({ id: 'a', bytes, metadata }, 6, {
      onReady: (f) => presented.push(f.frameIndex),
    });
    expect(second.frameIndex).toBe(6);
    expect(presented).toEqual([6]);
  });
});

describe('AnimatedMediaSession + MediaRegistry', () => {
  it('registry dedups sessions by asset id', async () => {
    const registry = new MediaRegistry({
      providers: [
        {
          id: 'fake',
          supports: () => true,
          isAvailable: () => true,
          decodeFrames: async (_b, range) =>
            Array.from({ length: range.end - range.start + 1 }, (_, i) =>
              sourceFrame(range.start + i, i),
            ),
        },
      ],
    });
    const bytes = new Uint8Array(4);
    const a = registry.acquire('asset-1', bytes, metadata);
    const b = registry.acquire('asset-1', bytes, metadata);
    expect(a).toBe(b);
    expect(registry.stats.sessions).toBe(1);
    // multiple usages share the session
    const frame = await a.requestFrame(2);
    expect(frame.frameIndex).toBe(2);
    expect(a.getComposited(2)?.frameIndex).toBe(2);
    registry.release('asset-1');
    expect(registry.stats.sessions).toBe(0);
  });

  it('session clamps out-of-range frames', async () => {
    const registry = new MediaRegistry({
      providers: [
        {
          id: 'f',
          supports: () => true,
          isAvailable: () => true,
          decodeFrames: async (_b, range) =>
            Array.from({ length: range.end - range.start + 1 }, (_, i) =>
              sourceFrame(range.start + i, i),
            ),
        },
      ],
    });
    const session = registry.acquire('x', new Uint8Array(2), metadata);
    const frame = await session.requestFrame(99, { prefetch: false });
    expect(frame.frameIndex).toBe(9); // clamped to frameCount - 1
    await expect(session.requestFrame(-3, { prefetch: false })).resolves.toBeDefined();
  });
});
