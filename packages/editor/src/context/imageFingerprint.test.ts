import { describe, expect, it } from 'vitest';
import { fingerprintImageData } from './imageFingerprint';

function pixels(values: number[]): ImageData {
  return {
    data: new Uint8ClampedArray(values),
    width: 1,
    height: values.length / 4,
    colorSpace: 'srgb',
  };
}

describe('fingerprintImageData', () => {
  it('is stable for identical decoded pixels and changes with any channel', async () => {
    const first = pixels([255, 0, 0, 255, 0, 255, 0, 255]);
    const same = pixels([255, 0, 0, 255, 0, 255, 0, 255]);
    const changed = pixels([255, 0, 0, 255, 0, 255, 1, 255]);

    await expect(fingerprintImageData(first)).resolves.toBe(await fingerprintImageData(same));
    await expect(fingerprintImageData(changed)).resolves.not.toBe(
      await fingerprintImageData(first),
    );
  });

  it('includes decoded dimensions in the identity', async () => {
    const oneByTwo = pixels([0, 0, 0, 255, 0, 0, 0, 255]);
    const twoByOne: ImageData = {
      data: oneByTwo.data,
      width: 2,
      height: 1,
      colorSpace: 'srgb',
    };

    await expect(fingerprintImageData(oneByTwo)).resolves.not.toBe(
      await fingerprintImageData(twoByOne),
    );
  });
});
