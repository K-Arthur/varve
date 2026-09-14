import { describe, expect, it } from 'vitest';
import { decomposeFrequencyBands, reconstructFrequencyBands } from './frequencySeparation';

function image(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 42;
    data[i + 1] = 128;
    data[i + 2] = 211;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('frequency separation runtime contracts', () => {
  it('does not report an unsupported method as if it had been applied', () => {
    const bands = decomposeFrequencyBands(image(8, 8), {
      radius: 2,
      method: 'median' as never,
    });

    expect(bands.method).toBe('gaussian');
  });

  it('rejects mismatched reconstruction dimensions instead of mixing bands', () => {
    const low = image(4, 4);
    const high = image(2, 2);

    expect(() => reconstructFrequencyBands(low, high)).toThrow(/dimensions/i);
  });
});
