import { describe, expect, it } from 'vitest';
import { resizeImageCrop, resizeImageData } from '../imageResize';

function image(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('source-pixel image resize', () => {
  it('resizes pixels without changing the requested aspect-independent dimensions', () => {
    const output = resizeImageData(image(2, 2), {
      newWidth: 4,
      newHeight: 1,
      resample: 'nearest',
    });
    expect([output.width, output.height]).toEqual([4, 1]);
    expect([...output.data].filter((value) => value !== 0).length).toBe(8);
  });

  it('supports explicit linear-light resampling for translucent photo edges', () => {
    const src = new ImageData(new Uint8ClampedArray([128, 128, 128, 128, 0, 0, 0, 255]), 2, 1);
    const output = resizeImageData(src, {
      newWidth: 1,
      newHeight: 1,
      resample: 'bilinear',
      workingSpace: 'linear-srgb',
    });
    // The linear-light result is materially brighter than encoded-space
    // averaging for this translucent mid-tone over an opaque black sample.
    expect([...output.data]).toEqual([76, 76, 76, 191]);
  });

  it('scales a non-destructive crop in source-pixel coordinates', () => {
    expect(resizeImageCrop({ x: 10, y: 5, w: 20, h: 30 }, 100, 80, 200, 40)).toEqual({
      x: 20,
      y: 2.5,
      w: 40,
      h: 15,
    });
  });

  it('rejects output beyond the bounded allocation budget', () => {
    expect(() =>
      resizeImageData(image(1, 1), {
        newWidth: 64_001,
        newHeight: 1_000,
        resample: 'bilinear',
      }),
    ).toThrow(/64000000/);
  });
});
