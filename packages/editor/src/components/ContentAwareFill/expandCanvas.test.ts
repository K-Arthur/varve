import { describe, expect, it } from 'vitest';
import { prepareExpandedGenerationInput } from './expandCanvas';

function sourceImage(): ImageData {
  const image = new ImageData(2, 2);
  image.data.set([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 255, 100, 110, 120, 0]);
  return image;
}

describe('prepareExpandedGenerationInput', () => {
  it('copies source pixels at an offset and masks only new bounds', () => {
    const result = prepareExpandedGenerationInput(
      sourceImage(),
      Uint8Array.from([0, 64, 128, 255]),
      {
        top: 1,
        right: 1,
        bottom: 0,
        left: 1,
      },
    );

    expect([result.imageData.width, result.imageData.height]).toEqual([4, 3]);
    expect([result.sourceOffsetX, result.sourceOffsetY]).toEqual([1, 1]);
    expect(Array.from(result.mask)).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    expect(Array.from(result.imageData.data.slice(4 * (1 * 4 + 1), 4 * (1 * 4 + 1) + 8))).toEqual([
      10, 20, 30, 255, 40, 50, 60, 128,
    ]);
  });

  it('rejects mismatched masks and oversized frames', () => {
    expect(() =>
      prepareExpandedGenerationInput(sourceImage(), new Uint8Array(3), {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      prepareExpandedGenerationInput(sourceImage(), new Uint8Array(4), {
        top: Number.MAX_SAFE_INTEGER,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    ).toThrow(/invalid|too large/i);
  });
});
