// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  autoContrastParams,
  autoLevelsParams,
  autoWhiteBalanceParams,
  computeHistogram,
  computeHistogramStats,
} from './histogram';

function makeImageData(pixels: number[][], w: number, h: number): ImageData {
  const data = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      const p = pixels[y * w + x] ?? [0, 0, 0, 0];
      data.data[off] = p[0]!;
      data.data[off + 1] = p[1]!;
      data.data[off + 2] = p[2]!;
      data.data[off + 3] = p[3]!;
    }
  }
  return data;
}

describe('computeHistogram', () => {
  it('computes histogram for uniform black image', () => {
    const data = makeImageData([[0, 0, 0, 255]], 1, 1);
    const hist = computeHistogram(data);
    expect(hist.luminance[0]).toBe(1);
    expect(hist.totalPixels).toBe(1);
    expect(hist.opaquePixels).toBe(1);
  });

  it('computes histogram for uniform white image', () => {
    const data = makeImageData([[255, 255, 255, 255]], 1, 1);
    const hist = computeHistogram(data);
    expect(hist.luminance[255]).toBe(1);
  });

  it('computes histogram for gradient image', () => {
    const data = makeImageData(
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ],
      2,
      1,
    );
    const hist = computeHistogram(data);
    expect(hist.red[255]).toBe(1);
    expect(hist.green[255]).toBe(1);
    expect(hist.totalPixels).toBe(2);
  });

  it('counts opaque vs transparent', () => {
    const data = makeImageData(
      [
        [255, 0, 0, 255],
        [0, 0, 0, 0],
      ],
      2,
      1,
    );
    const hist = computeHistogram(data);
    expect(hist.opaquePixels).toBe(1);
    expect(hist.totalPixels).toBe(2);
    expect(hist.luminance[0]).toBe(0);
    expect(hist.red[0]).toBe(0);
    expect(hist.alpha[0]).toBe(1);
  });

  it('handles empty image', () => {
    const data = makeImageData([], 0, 0);
    const hist = computeHistogram(data);
    expect(hist.totalPixels).toBe(0);
    expect(hist.opaquePixels).toBe(0);
  });
});

describe('computeHistogramStats', () => {
  it('computes stats for black image', () => {
    const hist = new Uint32Array(256);
    hist[0] = 100;
    const stats = computeHistogramStats(hist, 100);
    expect(stats.mean).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.blackClipped).toBe(100);
    expect(stats.whiteClipped).toBe(0);
  });

  it('computes stats for uniform mid-gray image', () => {
    const hist = new Uint32Array(256);
    hist[128] = 100;
    const stats = computeHistogramStats(hist, 100);
    expect(stats.mean).toBe(128);
    expect(stats.median).toBe(128);
  });

  it('computes percentile boundaries', () => {
    const hist = new Uint32Array(256);
    for (let i = 0; i < 100; i++) hist[100 + i] = 1;
    const stats = computeHistogramStats(hist, 100);
    expect(stats.percentile5).toBeGreaterThanOrEqual(100);
    expect(stats.percentile95).toBeLessThanOrEqual(199);
  });
});

describe('autoLevelsParams', () => {
  it('returns sensible params for uniform image', () => {
    const data = makeImageData([[128, 128, 128, 255]], 1, 1);
    const hist = computeHistogram(data);
    const params = autoLevelsParams(hist);
    expect(params.inputBlack).toBeGreaterThanOrEqual(0);
    expect(params.inputWhite).toBeLessThanOrEqual(255);
    expect(params.gamma).toBeGreaterThan(0);
  });

  it('returns identity for full-range image', () => {
    const pixels: number[][] = [];
    for (let i = 0; i < 256; i++) pixels.push([i, i, i, 255]);
    const data = makeImageData(pixels, 256, 1);
    const hist = computeHistogram(data);
    const params = autoLevelsParams(hist);
    expect(params.inputBlack).toBeLessThanOrEqual(10);
    expect(params.inputWhite).toBeGreaterThanOrEqual(245);
  });

  it('ignores transparent black backdrop pixels', () => {
    const data = makeImageData(
      [
        [80, 80, 80, 255],
        [160, 160, 160, 255],
        [0, 0, 0, 0],
      ],
      3,
      1,
    );
    const params = autoLevelsParams(computeHistogram(data));
    expect(params.inputBlack).toBeGreaterThan(50);
    expect(params.inputWhite).toBeLessThan(200);
  });
});

describe('automatic tonal/color corrections', () => {
  it('computes Auto Contrast without changing gamma', () => {
    const hist = computeHistogram(
      makeImageData(
        [
          [40, 40, 40, 255],
          [200, 200, 200, 255],
        ],
        2,
        1,
      ),
    );
    expect(autoContrastParams(hist).inputBlack).toBeLessThan(40);
    expect(autoContrastParams(hist).inputWhite).toBeGreaterThan(200);
  });

  it('returns a correction toward the neutral channel mean', () => {
    const hist = computeHistogram(makeImageData([[200, 100, 100, 255]], 1, 1));
    const correction = autoWhiteBalanceParams(hist);
    expect(correction.cyanRed).toBeLessThan(0);
    expect(correction.magentaGreen).toBeGreaterThan(0);
    expect(correction.yellowBlue).toBeGreaterThan(0);
  });
});
