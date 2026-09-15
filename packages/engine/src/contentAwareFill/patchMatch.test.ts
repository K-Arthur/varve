// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isPatchSourceUsable, patchMatchFill } from './patchMatch';

function makeImage(width: number, height: number, pixel: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = pixel[0];
    data[offset + 1] = pixel[1];
    data[offset + 2] = pixel[2];
    data[offset + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('PatchMatch source safety', () => {
  it('rejects a source patch that intersects an offset mask', () => {
    const mask = new Uint8Array(5 * 5);
    mask[2 * 5 + 2] = 255;

    expect(isPatchSourceUsable(7, 8, 16, 16, mask, 5, 5, 5, 6, 1)).toBe(false);
    expect(isPatchSourceUsable(2, 2, 16, 16, mask, 5, 5, 5, 6, 1)).toBe(true);
    expect(isPatchSourceUsable(1, 1, 16, 16, mask, 5, 5, 5, 6, 3)).toBe(false);
  });

  it('does not copy marked object pixels back into a separate hole', () => {
    const source = makeImage(40, 20, [18, 36, 54]);
    const mask = new Uint8Array(40 * 20);
    for (let y = 8; y <= 11; y += 1) {
      for (let x = 18; x <= 21; x += 1) {
        mask[y * 40 + x] = 255;
        const offset = (y * 40 + x) * 4;
        source.data[offset] = 240;
        source.data[offset + 1] = 12;
        source.data[offset + 2] = 220;
      }
    }

    const result = patchMatchFill(source, mask, 40, 20, 0, 0, undefined, 17).imageData;

    for (let y = 8; y <= 11; y += 1) {
      for (let x = 18; x <= 21; x += 1) {
        const offset = (y * 40 + x) * 4;
        expect(Array.from(result.data.slice(offset, offset + 4))).toEqual([18, 36, 54, 255]);
      }
    }
    expect(Array.from(result.data.slice(0, 4))).toEqual([18, 36, 54, 255]);
  });

  it('leaves a fully masked context unchanged when no source patch exists', () => {
    const source = makeImage(5, 5, [80, 90, 100]);
    const mask = new Uint8Array(25).fill(255);
    const result = patchMatchFill(source, mask, 5, 5, 0, 0).imageData;

    expect(Array.from(result.data)).toEqual(Array.from(source.data));
  });

  it('computes bounds for a large real-photo selection without spreading arguments', () => {
    const width = 400;
    const height = 400;
    const source = makeImage(width, height, [80, 90, 100]);
    const mask = new Uint8Array(width * height);
    for (let y = 40; y < 360; y += 1) {
      mask.fill(255, y * width + 40, y * width + 360);
    }
    const controller = new AbortController();
    controller.abort();

    const result = patchMatchFill(source, mask, width, height, 0, 0, controller.signal);
    expect(result.filledBounds).toEqual({ x: 40, y: 40, w: 320, h: 320 });
  });
});
