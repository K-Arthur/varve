import { describe, expect, it } from 'vitest';
import { harmonize } from './harmonize';

describe('harmonize', () => {
  it('preserves image dimensions', () => {
    const src = new ImageData(4, 4);
    const ref = new ImageData(4, 4);
    const result = harmonize(src, ref, 0.5, true);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it('does not change original when strength is 0', () => {
    const data = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i += 4) {
      data[i] = 100;
      data[i + 1] = 150;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    const src = new ImageData(4, 4);
    src.data.set(data);
    const ref = new ImageData(4, 4);
    ref.data.set(
      new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]),
    );
    const result = harmonize(src, ref, 0, true);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });
});
