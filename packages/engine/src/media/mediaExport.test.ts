/**
 * Media export determinism: per-frame-delay GIF encoding and video-sample
 * frame overrides.
 */

import { describe, expect, it } from 'vitest';
import { exportAnimatedMediaToGif } from '../gifExport';
import { decodeGifFrames } from './tsGif';

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

describe('exportAnimatedMediaToGif', () => {
  it('preserves per-frame source timing and loop count', async () => {
    const frames = [solid(8, 8, 255), solid(8, 8, 128), solid(8, 8, 64)];
    const result = await exportAnimatedMediaToGif(async (i) => frames[i]!, {
      frameDelaysMs: [40, 100, 20],
      width: 8,
      height: 8,
      repeat: 0,
    });
    expect(result.supported).toBe(true);
    expect(result.frameCount).toBe(3);
    expect(result.bytes).toBeDefined();
    // round-trip through the TS decoder: delays come back at 40/100/20
    const decoded = decodeGifFrames(result.bytes!);
    expect(decoded.loopCount).toBe('infinite');
    expect(decoded.frames.map((f) => f.durationMs)).toEqual([40, 100, 20]);
    expect(decoded.frames.map((f) => f.rgba[0])).toEqual([255, 128, 64]);
  });

  it('cancels mid-export', async () => {
    const controller = new AbortController();
    const result = await exportAnimatedMediaToGif(async () => solid(8, 8, 1), {
      frameDelaysMs: [40, 40, 40, 40, 40],
      width: 8,
      height: 8,
      signal: controller.signal,
    });
    controller.abort();
    const cancelled = await exportAnimatedMediaToGif(
      async () => {
        controller.abort();
        return solid(8, 8, 1);
      },
      {
        frameDelaysMs: [40, 40, 40, 40, 40],
        width: 8,
        height: 8,
        signal: controller.signal,
      },
    );
    expect(cancelled.reason).toBe('Cancelled');
    expect(cancelled.frameCount).toBeLessThan(5);
    void result;
  });
});
