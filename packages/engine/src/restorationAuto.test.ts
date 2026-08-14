import { describe, expect, it } from 'vitest';
import {
  analyzeImageForRestoration,
  type RestorationSuggestion,
  recommendationLabel,
} from './restorationAuto';

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = paint(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

function sharpImage(width = 1024, height = 768): ImageData {
  // Design-like content: flat gradient + sparse 1px lines + a textured band
  // (enough Laplacian energy for the blur estimator, sparse enough for the
  // noise MAD estimator to read ~0).
  return makeImage(width, height, (x, y) => {
    const gradient = (x / width) * 60 + 90;
    const line = y % 48 === 24 ? 40 : 0;
    const inTextureBand = y > 500 && y < 620;
    const texture = inTextureBand && (x * 3 + y) % 4 === 0 ? 45 : 0;
    return clamp(gradient - line - texture);
  });
}

function addGaussianNoise(img: ImageData, sigma: number, seed = 42): ImageData {
  const rng = mulberry32(seed);
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < out.data.length; i += 4) {
    const n1 = rng();
    const n2 = rng();
    const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, n1))) * Math.cos(2 * Math.PI * n2);
    out.data[i] = clamp(img.data[i]! + g * sigma);
    out.data[i + 1] = clamp(img.data[i + 1]! + g * sigma);
    out.data[i + 2] = clamp(img.data[i + 2]! + g * sigma);
  }
  return out;
}

function blurImage(img: ImageData, radius: number): ImageData {
  const { width, height } = img;
  const out = new ImageData(new Uint8ClampedArray(img.data), width, height);
  const r = Math.max(1, Math.floor(radius));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          sum += img.data[(sy * width + sx) * 4]!;
          count++;
        }
      }
      const v = count > 0 ? sum / count : 0;
      const i = (y * width + x) * 4;
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = v;
    }
  }
  return out;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('analyzeImageForRestoration', () => {
  const options = { lowResolutionShortEdge: 700 };

  it('recommends nothing for a clean sharp image', () => {
    const result = analyzeImageForRestoration(sharpImage(), options);
    expect(result.recommendation[0]).toBe('none');
    expect(result.findings).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('detects heavy noise and recommends denoise', () => {
    const noisy = addGaussianNoise(sharpImage(), 18);
    const result = analyzeImageForRestoration(noisy, options);
    expect(result.noise.level).not.toBe('none');
    expect(result.recommendation).toContain('denoise');
    expect(result.findings.join(' ')).toMatch(/noise/i);
  });

  it('detects heavy blur and recommends deblur', () => {
    const blurred = blurImage(sharpImage(), 5);
    const result = analyzeImageForRestoration(blurred, options);
    expect(result.blur.level).not.toBe('none');
    expect(result.recommendation).toContain('deblur');
  });

  it('flags low resolution and recommends upscale', () => {
    const small = sharpImage(400, 300);
    const result = analyzeImageForRestoration(small);
    expect(result.lowResolution).toBe(true);
    expect(result.recommendation).toContain('upscale');
  });

  it('keeps the recommendation in human terms', () => {
    expect(recommendationLabel(['none'])).toBe('No specific restoration suggested');
    expect(recommendationLabel(['denoise', 'upscale'])).toBe('denoise + upscale');
    expect(
      recommendationLabel(['compression-restoration', 'upscale'] as RestorationSuggestion[]),
    ).toBe('clean up compression artifacts + upscale');
  });

  it('runs quickly on a large image (bounded sampling)', () => {
    const start = performance.now();
    analyzeImageForRestoration(makeImage(4096, 3072, () => 128));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
