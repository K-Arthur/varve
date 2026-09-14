// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GenerativeEditError } from '../generativeEdit/types';
import { QUICK_CLEANUP_PROVIDER, runQuickCleanup } from './quickCleanup';

function makeImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 7 + y * 3) % 256;
      data[offset + 1] = (x * 5 + y * 11) % 256;
      data[offset + 2] = (x * 13 + y * 2) % 256;
      data[offset + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('runQuickCleanup', () => {
  it('runs the constrained local provider and preserves pixels outside the mask', async () => {
    const source = makeImage(40, 24);
    const original = new Uint8ClampedArray(source.data);
    const mask = new Uint8Array(40 * 24);
    for (let y = 9; y <= 14; y += 1) {
      for (let x = 17; x <= 22; x += 1) {
        mask[y * 40 + x] = 255;
      }
    }

    const result = await runQuickCleanup({
      imageData: source,
      mask,
      maskWidth: 40,
      maskHeight: 24,
      contextPadding: 6,
      seed: 23,
    });

    expect(result.provider).toBe(QUICK_CLEANUP_PROVIDER);
    expect(result.width).toBe(40);
    expect(result.height).toBe(24);
    expect(result.filledBounds).toEqual({ x: 17, y: 9, w: 6, h: 6 });
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);

    for (let y = 0; y < 24; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const pixel = (y * 40 + x) * 4;
        const isMasked = x >= 17 && x <= 22 && y >= 9 && y <= 14;
        if (!isMasked) {
          expect(Array.from(result.imageData.data.slice(pixel, pixel + 4))).toEqual(
            Array.from(original.slice(pixel, pixel + 4)),
          );
        }
      }
    }
  });

  it('rejects a mask whose dimensions do not match its pixels', async () => {
    await expect(
      runQuickCleanup({
        imageData: makeImage(8, 8),
        mask: new Uint8Array(3),
        maskWidth: 2,
        maskHeight: 2,
      }),
    ).rejects.toMatchObject<GenerativeEditError>({ code: 'invalid-mask' });
  });

  it('rejects an empty cleanup mask', async () => {
    await expect(
      runQuickCleanup({
        imageData: makeImage(8, 8),
        mask: new Uint8Array(64),
        maskWidth: 8,
        maskHeight: 8,
      }),
    ).rejects.toMatchObject<GenerativeEditError>({ code: 'empty-mask' });
  });
});
