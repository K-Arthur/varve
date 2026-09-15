/**
 * Animated-media pipeline benchmarks (run: pnpm bench).
 *
 * Covers the time→frame resolver on large timing tables, the compositor on
 * realistic frame sizes, the frame cache under byte pressure, and scheduler
 * dedup/cancellation overhead.
 */

import { bench, describe } from 'vitest';
import { MediaCheckpointStore } from './checkpoints';
import { compositeAll, compositeRange } from './compositor';
import { MediaFrameCache, mediaFrameCacheKey } from './frameCache';
import { buildFrameTiming, frameIndexForTime } from './frameResolver';
import { resolveUsageFrame, usageTiming } from './playback';
import { MediaFrameScheduler } from './scheduler';
import type { DecodedSourceFrame, MediaFillSettings } from './types';

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

function sourceFrames(count: number, w: number, h: number): DecodedSourceFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    x: 0,
    y: 0,
    width: w,
    height: h,
    durationMs: 40 + (i % 5) * 7,
    blend: 'source' as const,
    disposal: 'none' as const,
    preComposited: false,
    rgba: solid(w, h, i % 255),
  }));
}

describe('frame resolver', () => {
  const small = buildFrameTiming(Array.from({ length: 10 }, () => 40));
  const large = buildFrameTiming(Array.from({ length: 10_000 }, (_, i) => 40 + (i % 7)));
  const durations = Array.from({ length: 10_000 }, (_, i) => 40 + (i % 7));

  bench('binary search, 10 frames', () => {
    for (let t = 0; t < 400; t += 7) frameIndexForTime(small, t);
  });

  bench('binary search, 10k frames', () => {
    for (let t = 0; t < 400_000; t += 37) frameIndexForTime(large, t);
  });

  bench('build timing table, 10k frames', () => {
    buildFrameTiming(durations);
  });
});

describe('compositor', () => {
  const full = sourceFrames(64, 1024, 1024);
  const delta = sourceFrames(64, 1024, 1024).map((f, i) => ({
    ...f,
    x: (i % 8) * 128,
    y: Math.floor(i / 8) * 128,
    width: 128,
    height: 128,
    rgba: solid(128, 128, i),
  }));

  bench('full-canvas composite, 64 frames 1024x1024', () => {
    compositeAll(1024, 1024, full);
  });

  bench('delta-rect composite, 64 frames 1024x1024', () => {
    compositeAll(1024, 1024, delta);
  });

  bench('checkpoint resume, 32-frame tail', () => {
    const { finalState } = compositeRange(undefined, full.slice(0, 32));
    compositeRange(finalState, full.slice(32));
  });
});

describe('frame cache', () => {
  const cache = new MediaFrameCache({ maxBytes: 256 * 1024 * 1024 });
  const frame = { frameIndex: 0, width: 1024, height: 1024, rgba: solid(1024, 1024, 1) };

  bench('cache set + get (LRU touch), 1024x1024', () => {
    for (let i = 0; i < 100; i++) {
      const key = mediaFrameCacheKey({
        assetId: 'a',
        frameIndex: i % 64,
        decoderVersion: 1,
        width: 1024,
        height: 1024,
      });
      cache.set(key, { ...frame, frameIndex: i % 64 });
      cache.get(key);
    }
  });
});

describe('playback resolution', () => {
  const timing = usageTiming(
    Array.from({ length: 1000 }, (_, i) => ({ durationMs: 40 + (i % 7) })),
  );
  const settings: MediaFillSettings = {
    loopMode: 'loop',
    rate: 1,
    startOffsetMs: 0,
    inPointMs: 0,
    outPointMs: 0,
    posterFrame: 0,
  };

  bench('resolveUsageFrame, 1k frames, 1000 samples', () => {
    for (let t = 0; t < 1_000_000; t += 1000) {
      resolveUsageFrame({ settings, sourceLoopCount: 'infinite', timing }, t);
    }
  });
});

describe('scheduler', () => {
  const cache = new MediaFrameCache({ maxBytes: 1 << 30 });
  const checkpoints = new MediaCheckpointStore({ stride: 32, maxBytes: 1 << 28 });
  const scheduler = new MediaFrameScheduler({
    cache,
    checkpoints,
    decodeFrames: async (_bytes, range) => sourceFrames(range.end - range.start + 1, 256, 256),
  });
  const bytes = new Uint8Array(4);
  const metadata = {
    kind: 'gif' as const,
    frameCount: 100,
    durationMs: 4000,
    loopCount: 'infinite' as const,
    width: 256,
    height: 256,
    frames: Array.from({ length: 100 }, (_, i) => ({
      index: i,
      durationMs: 40,
      x: 0,
      y: 0,
      width: 256,
      height: 256,
      blend: 'source' as const,
      disposal: 'none' as const,
    })),
    decoderVersion: 1,
  };

  bench('requestFrame cache hit, 256x256', async () => {
    await scheduler.requestFrame({ id: 'a', bytes, metadata }, 5, { prefetch: false });
  });
});
