import { describe, expect, it } from 'vitest';
import { warpImageToCylinder } from '../cylinderWarp';

function sourceImage(width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      image.data[index] = Math.round((x / Math.max(1, width - 1)) * 255);
      image.data[index + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      image.data[index + 2] = 127;
      image.data[index + 3] = 255;
    }
  }
  return image;
}

function alphaAt(image: ImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3]!;
}

describe('warpImageToCylinder', () => {
  it('fills a slot with a vertical-axis front-facing arc', () => {
    const source = sourceImage(16, 8);
    const output = warpImageToCylinder(source.data, source.width, source.height, 32, 16, {
      axis: 'vertical',
      wrapDegrees: 120,
      seam: 0,
      crop: 'slot',
    });
    expect(output).not.toBeNull();
    expect(alphaAt(output!, 0, 8)).toBeGreaterThan(0);
    expect(alphaAt(output!, 31, 8)).toBeGreaterThan(0);
    expect(alphaAt(output!, 16, 0)).toBeGreaterThan(0);
    expect(output!.data[(8 * output!.width + 16) * 4]!).toBeGreaterThan(80);
  });

  it('leaves the natural projected margins transparent in visible crop mode', () => {
    const source = sourceImage(8, 8);
    const output = warpImageToCylinder(source.data, source.width, source.height, 40, 8, {
      axis: 'vertical',
      wrapDegrees: 60,
      seam: 0,
      crop: 'visible',
    });
    expect(output).not.toBeNull();
    expect(alphaAt(output!, 0, 4)).toBe(0);
    expect(alphaAt(output!, 39, 4)).toBe(0);
    expect(alphaAt(output!, 20, 4)).toBeGreaterThan(0);
  });

  it('supports horizontal axes and deterministic seam changes', () => {
    const source = sourceImage(12, 12);
    const base = warpImageToCylinder(source.data, source.width, source.height, 12, 24, {
      axis: 'horizontal',
      wrapDegrees: 90,
      seam: 0,
      crop: 'slot',
    });
    const shifted = warpImageToCylinder(source.data, source.width, source.height, 12, 24, {
      axis: 'horizontal',
      wrapDegrees: 90,
      seam: 0.25,
      crop: 'slot',
    });
    expect(base).not.toBeNull();
    expect(shifted).not.toBeNull();
    expect(base!.data[1]).not.toBe(shifted!.data[1]);
  });

  it('rejects malformed options and bounded allocations', () => {
    const source = sourceImage(2, 2);
    expect(
      warpImageToCylinder(source.data, 2, 2, 8, 8, {
        axis: 'vertical',
        wrapDegrees: 2,
        seam: 0,
        crop: 'slot',
      }),
    ).toBeNull();
    expect(
      warpImageToCylinder(source.data, 2, 2, 10_000, 10_000, {
        axis: 'vertical',
        wrapDegrees: 90,
        seam: 0,
        crop: 'slot',
      }),
    ).toBeNull();
  });
});
