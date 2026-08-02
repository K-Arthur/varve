import { describe, expect, it } from 'vitest';
import {
  computeResampleDimensions,
  resampleImageData,
  selectResamplingAlgorithm,
} from './resample';

function imageData(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

function px(image: ImageData, x: number, y: number): [number, number, number, number] {
  const o = (y * image.width + x) * 4;
  return [
    image.data[o] as number,
    image.data[o + 1] as number,
    image.data[o + 2] as number,
    image.data[o + 3] as number,
  ];
}

describe('selectResamplingAlgorithm', () => {
  it('respects an explicit pixel-art hint', () => {
    const r = selectResamplingAlgorithm(64, 64, 128, 128, { pixelArt: true });
    expect(r.algorithm).toBe('nearest');
  });

  it('prefers area for heavy downscale, lanczos2 for mild', () => {
    expect(selectResamplingAlgorithm(4000, 4000, 1000, 1000).algorithm).toBe('area');
    expect(selectResamplingAlgorithm(4000, 4000, 2400, 2400).algorithm).toBe('lanczos2');
  });

  it('prefers lanczos3 for upscale', () => {
    expect(selectResamplingAlgorithm(100, 100, 300, 300).algorithm).toBe('lanczos3');
  });

  it('uses nearest for exact integer upscale when integerScale is set', () => {
    const r = selectResamplingAlgorithm(64, 64, 128, 128, { integerScale: true });
    expect(r.algorithm).toBe('nearest');
    expect(r.rationale.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = selectResamplingAlgorithm(1234, 567, 500, 200);
    const b = selectResamplingAlgorithm(1234, 567, 500, 200);
    expect(a.algorithm).toBe(b.algorithm);
    expect(a.rationale).toEqual(b.rationale);
  });
});

describe('computeResampleDimensions', () => {
  it('clamps to the pixel budget with a scale factor', () => {
    const r = computeResampleDimensions(2000, 2000, 4000, 4000, { maxPixels: 1_000_000 });
    expect(r.width * r.height).toBeLessThanOrEqual(1_000_000);
    expect(r.scaleFactor).toBeLessThan(1);
  });

  it('rejects non-positive inputs', () => {
    expect(() => computeResampleDimensions(0, 1, 2, 2)).toThrow(/Source dimensions/);
    expect(() => computeResampleDimensions(1, 1, 0, 2)).toThrow(/Target dimensions/);
  });
});

describe('resampleImageData', () => {
  it('is an identity when dimensions match', () => {
    const src = imageData(
      3,
      2,
      [
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 10, 10, 255, 200, 100, 50, 255, 0, 0, 0,
        0,
      ],
    );
    const out = resampleImageData(src, 3, 2, { algorithm: 'bilinear' });
    expect(out.algorithm).toBe('bilinear');
    expect(out.resolutionLog).toEqual(['explicit bilinear']);
    for (let i = 0; i < src.data.length; i += 1) {
      expect(out.imageData.data[i]).toBe(src.data[i]);
    }
  });

  it('replicates pixels exactly for nearest integer upscale (pixel art)', () => {
    const src = imageData(2, 2, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
    const out = resampleImageData(src, 4, 4, { algorithm: 'nearest' });
    expect(px(out.imageData, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out.imageData, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out.imageData, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(px(out.imageData, 3, 3)).toEqual([0, 0, 0, 255]);
  });

  it('never leaks hidden RGB from fully transparent source pixels', () => {
    // Left pixel: fully transparent but carries garbage RGB. Right: opaque red.
    // If premultiplication were not respected, the hidden RGB would tint the
    // interior of the opaque region a grayish mix instead of staying red.
    const src = imageData(2, 1, [0, 255, 0, 0, 255, 0, 0, 255]);
    const out = resampleImageData(src, 4, 1, { algorithm: 'bilinear' });
    expect(px(out.imageData, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(out.imageData, 1, 0)[0]).toBeGreaterThanOrEqual(252);
    expect(px(out.imageData, 1, 0)[1]).toBeLessThanOrEqual(3);
    expect(px(out.imageData, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it('keeps semi-transparent antialiased edges free of dark fringes', () => {
    // A 50%-alpha white pixel between opaque white and transparent.
    // Alpha-aware resampling keeps the color at its own value rather than
    // darkening it with transparent pixels' hidden black RGB.
    const src = imageData(3, 1, [255, 255, 255, 255, 255, 255, 255, 128, 0, 0, 0, 0]);
    const out = resampleImageData(src, 3, 1, { algorithm: 'bicubic' });
    const mid = px(out.imageData, 1, 0);
    expect(mid[3]).toBeGreaterThanOrEqual(120);
    expect(mid[3]).toBeLessThanOrEqual(136);
    expect(mid[0]).toBeGreaterThanOrEqual(252);
  });

  it('area-averages 2x2 checkers to mid gray in gamma space', () => {
    // Alternating black/white at 2:1 downscale. Gamma-encoded (srgb) averaging
    // of 0 and 255 is 127.5 → ~128. Linear-light averaging would be ~187.5.
    const pixels = new Array<number>(2 * 2 * 4);
    for (let i = 0; i < 4; i += 1) {
      const v = i % 2 === 0 ? 255 : 0;
      pixels[i * 4] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    }
    const src = imageData(2, 2, pixels);
    const out = resampleImageData(src, 1, 1, { algorithm: 'area' });
    const p = px(out.imageData, 0, 0);
    expect(p[0]).toBeGreaterThanOrEqual(120);
    expect(p[0]).toBeLessThanOrEqual(136);
    expect(p[3]).toBe(255);
  });

  it('produces physically-light values in linear-srgb mode', () => {
    const pixels = new Array<number>(2 * 2 * 4);
    for (let i = 0; i < 4; i += 1) {
      const v = i % 2 === 0 ? 255 : 0;
      pixels[i * 4] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    }
    const src = imageData(2, 2, pixels);
    const out = resampleImageData(src, 1, 1, {
      algorithm: 'area',
      workingSpace: 'linear-srgb',
    });
    const p = px(out.imageData, 0, 0);
    // 50% physical white → linear 0.5 → encoded ≈ 0.735 → ≈ 187.5
    expect(p[0]).toBeGreaterThanOrEqual(180);
    expect(p[0]).toBeLessThanOrEqual(194);
  });

  it('preserves luminance overall when downscaling a gradient (no drift)', () => {
    const src = imageData(
      64,
      1,
      Array.from({ length: 64 }, (_, x) => [x * 4, x * 4, x * 4, 255]).flat(),
    );
    const out = resampleImageData(src, 8, 1, { algorithm: 'lanczos2' });
    let sum = 0;
    for (let x = 0; x < 8; x += 1) sum += px(out.imageData, x, 0)[0];
    expect(sum / 8).toBeGreaterThan(116);
    expect(sum / 8).toBeLessThan(140);
  });

  it('handles one-pixel-wide and one-pixel-tall sources', () => {
    const wide = imageData(
      1,
      4,
      [50, 100, 150, 255, 50, 100, 150, 255, 50, 100, 150, 255, 50, 100, 150, 255],
    );
    const out1 = resampleImageData(wide, 3, 4, { algorithm: 'lanczos3' });
    expect(out1.imageData.width).toBe(3);
    expect(px(out1.imageData, 1, 2)[0]).toBe(50);

    const tall = imageData(
      4,
      1,
      [200, 50, 50, 255, 200, 50, 50, 255, 200, 50, 50, 255, 200, 50, 50, 255],
    );
    const out2 = resampleImageData(tall, 4, 2, { algorithm: 'bicubic' });
    expect(out2.imageData.height).toBe(2);
    expect(px(out2.imageData, 3, 1)[0]).toBe(200);
  });

  it('tiled output matches single-pass output within tolerance', () => {
    // Deterministic pseudo-random 37x23 image (seeded LCG) with transparency.
    const pixels = new Array<number>(37 * 23 * 4);
    let seed = 12345;
    for (let i = 0; i < 37 * 23; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = seed % 256;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const g = seed % 256;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const b = seed % 256;
      const a = i % 5 === 0 ? 0 : 64 + (i % 192);
      pixels[i * 4] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = a;
    }
    const src = imageData(37, 23, pixels);
    const single = resampleImageData(src, 61, 41, { algorithm: 'lanczos3' });
    const tiled = resampleImageData(src, 61, 41, { algorithm: 'lanczos3', tileHeight: 8 });
    expect(tiled.imageData.data.length).toBe(single.imageData.data.length);
    for (let i = 0; i < single.imageData.data.length; i += 1) {
      const a = single.imageData.data[i] as number;
      const b = tiled.imageData.data[i] as number;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    }
  });

  it('auto mode logs a deterministic rationale', () => {
    const src = imageData(4, 4, new Array<number>(64).fill(255));
    const out = resampleImageData(src, 16, 16);
    expect(out.algorithm).toBe('lanczos3');
    expect(out.resolutionLog[0]).toContain('lanczos3');
  });

  it('pixel-art algorithm maps to nearest', () => {
    const src = imageData(2, 1, [10, 20, 30, 255, 200, 100, 0, 255]);
    const out = resampleImageData(src, 4, 1, { algorithm: 'pixel-art' });
    expect(out.algorithm).toBe('nearest');
    expect(px(out.imageData, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(out.imageData, 2, 0)).toEqual([200, 100, 0, 255]);
  });

  it('reports progress through the callback', () => {
    const src = imageData(4, 4, new Array<number>(64).fill(255));
    let calls = 0;
    resampleImageData(src, 8, 8, { onProgress: () => (calls += 1) });
    expect(calls).toBe(8);
  });
});
