import { describe, expect, it } from 'vitest';
import {
  DETAIL_NEUTRAL,
  decodeResidualChannel,
  decomposeFrequencyBands,
  encodeResidualChannel,
  measureReconstruction,
  reconstructFrequencyBands,
} from './frequencySeparation';

function makeImage(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

describe('residual encoding', () => {
  it('maps zero residual to exact neutral gray', () => {
    expect(encodeResidualChannel(0)).toBe(DETAIL_NEUTRAL);
    expect(decodeResidualChannel(DETAIL_NEUTRAL)).toBe(0);
  });

  it('round-trips even residuals exactly and bounds odd residuals to one LSB', () => {
    for (let h = -254; h <= 254; h += 2) {
      expect(decodeResidualChannel(encodeResidualChannel(h))).toBe(h);
    }
    for (let h = -255; h <= 255; h++) {
      expect(Math.abs(decodeResidualChannel(encodeResidualChannel(h)) - h)).toBeLessThanOrEqual(1);
    }
  });

  it('saturates without wrapping at the extremes', () => {
    expect(encodeResidualChannel(10000)).toBe(255);
    expect(encodeResidualChannel(-10000)).toBe(0);
    expect(decodeResidualChannel(255)).toBe(254);
    expect(decodeResidualChannel(0)).toBe(-256);
  });
});

describe('frequency separation decomposition', () => {
  it('separates a flat image into tone and neutral detail', () => {
    const source = makeImage(16, 16, () => [200, 100, 50, 255]);
    const bands = decomposeFrequencyBands(source, { radius: 3 });
    for (let i = 0; i < source.data.length; i += 4) {
      expect(bands.low.data[i]).toBe(200);
      expect(bands.low.data[i + 1]).toBe(100);
      expect(bands.high.data[i]).toBe(DETAIL_NEUTRAL);
      expect(bands.high.data[i + 1]).toBe(DETAIL_NEUTRAL);
    }
    expect(measureReconstruction(source, bands.low, bands.high).max).toBe(0);
  });

  it('reconstructs a textured image within the declared tolerance', () => {
    // Deterministic pseudo-noise over a gradient.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const source = makeImage(64, 48, (x, y) => {
      const base = (x / 63) * 200 + (y / 47) * 40;
      const noise = (rand() - 0.5) * 90;
      return [
        Math.max(0, Math.min(255, base + noise)),
        Math.max(0, Math.min(255, base * 0.7 + noise)),
        Math.max(0, Math.min(255, base * 0.3 - noise)),
        255,
      ];
    });
    const bands = decomposeFrequencyBands(source, { radius: 4 });
    const error = measureReconstruction(source, bands.low, bands.high);
    expect(error.max).toBeLessThanOrEqual(1);
    expect(error.mean).toBeLessThanOrEqual(0.5);
  });

  it('keeps alpha out of the signed equation and preserves it exactly', () => {
    const source = makeImage(32, 32, (x, _y) => {
      const alpha = x < 16 ? 255 : x < 24 ? 128 : 0;
      return [200, 60, 20, alpha];
    });
    const bands = decomposeFrequencyBands(source, { radius: 2 });
    const reconstructed = reconstructFrequencyBands(bands.low, bands.high);
    for (let i = 0; i < source.data.length; i += 4) {
      expect(bands.low.data[i + 3]).toBe(source.data[i + 3]);
      expect(bands.high.data[i + 3]).toBe(source.data[i + 3]);
      expect(reconstructed.data[i + 3]).toBe(source.data[i + 3]);
    }
  });

  it('does not bleed hidden RGB from transparent pixels into the low band', () => {
    const source = makeImage(32, 8, (x) => (x < 16 ? [255, 255, 255, 0] : [0, 0, 0, 255]));
    // Transparent pixels carry white RGB that must not brighten the opaque half.
    const bands = decomposeFrequencyBands(source, { radius: 3 });
    for (let x = 17; x < 32; x++) {
      const i = (4 * 32 + x) * 4;
      expect(bands.low.data[i]).toBeLessThan(10);
    }
  });

  it('sigma zero is a defined identity split', () => {
    const source = makeImage(8, 8, (x, y) => [x * 30, y * 30, 128, 255]);
    const bands = decomposeFrequencyBands(source, { radius: 0 });
    expect(bands.support).toBe(0);
    for (let i = 0; i < source.data.length; i += 4) {
      expect(bands.high.data[i]).toBe(DETAIL_NEUTRAL);
      expect(bands.low.data[i]).toBe(source.data[i]);
    }
    expect(measureReconstruction(source, bands.low, bands.high).max).toBe(0);
  });

  it('near-black and near-white saturated content stays within tolerance', () => {
    const source = makeImage(32, 32, (x, y) =>
      (x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 0, 255, 255],
    );
    const bands = decomposeFrequencyBands(source, { radius: 2 });
    const error = measureReconstruction(source, bands.low, bands.high);
    expect(error.max).toBeLessThanOrEqual(1);
  });

  it('editing the low band changes tone without changing the stored detail', () => {
    const source = makeImage(24, 24, (x) => [40 + x * 4, 90, 140, 255]);
    const bands = decomposeFrequencyBands(source, { radius: 3 });
    const detailBefore = Array.from(bands.high.data);
    const editedLow = new ImageData(new Uint8ClampedArray(bands.low.data), 24, 24);
    for (let y = 8; y < 16; y++) {
      for (let x = 8; x < 16; x++) {
        const i = (y * 24 + x) * 4;
        editedLow.data[i] = 250;
        editedLow.data[i + 1] = 250;
        editedLow.data[i + 2] = 250;
      }
    }
    const recombined = reconstructFrequencyBands(editedLow, bands.high);
    const center = (12 * 24 + 12) * 4;
    expect(recombined.data[center]).toBeGreaterThan(200);
    // The stored detail band is untouched by tone editing.
    expect(Array.from(bands.high.data)).toEqual(detailBefore);
  });

  it('editing the detail band changes texture without changing the low band', () => {
    const source = makeImage(24, 24, () => [128, 128, 128, 255]);
    const bands = decomposeFrequencyBands(source, { radius: 3 });
    const lowBefore = Array.from(bands.low.data);
    const editedHigh = new ImageData(new Uint8ClampedArray(bands.high.data), 24, 24);
    const i = (12 * 24 + 12) * 4;
    editedHigh.data[i] = 160;
    const recombined = reconstructFrequencyBands(bands.low, editedHigh);
    expect(recombined.data[i]).toBe(128 + decodeResidualChannel(160));
    expect(Array.from(bands.low.data)).toEqual(lowBefore);
  });

  it('is deterministic across runs', () => {
    const source = makeImage(40, 40, (x, y) => [x * 5, y * 5, (x * y) % 255, 255]);
    const a = decomposeFrequencyBands(source, { radius: 5 });
    const b = decomposeFrequencyBands(source, { radius: 5 });
    expect(Array.from(a.low.data)).toEqual(Array.from(b.low.data));
    expect(Array.from(a.high.data)).toEqual(Array.from(b.high.data));
  });
});
