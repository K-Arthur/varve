import { linearSrgbToOklab, oklabToOkLch, srgbToLinear } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  analogousHarmony,
  analyzePalette,
  complementaryHarmony,
  extractPalette,
  extractPaletteFromRgba,
  splitComplementaryHarmony,
  triadicHarmony,
} from './paletteExtractor';

/**
 * Create ImageData with RGBA pixel data.
 */
function createImageData(width: number, height: number, pixels: Uint8ClampedArray): ImageData {
  return { width, height, data: pixels, colorSpace: 'srgb' } as unknown as ImageData;
}

/**
 * Fill a region of an ImageData with an RGBA color.
 */
function fillRegion(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): void {
  for (let py = y; py < y + rh; py++) {
    for (let px = x; px < x + rw; px++) {
      const idx = (py * w + px) * 4;
      if (idx + 3 < data.length) {
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  }
}

function createRedBlueImage(): ImageData {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  fillRegion(data, w, 0, 0, w / 2, h, 255, 0, 0, 255);
  fillRegion(data, w, w / 2, 0, w / 2, h, 0, 0, 255, 255);
  return createImageData(w, h, data);
}

function createGrayscaleImage(): ImageData {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  fillRegion(data, w, 0, 0, w / 3, h, 51, 51, 51, 255);
  fillRegion(data, w, w / 3, 0, w / 3, h, 153, 153, 153, 255);
  fillRegion(data, w, (2 * w) / 3, 0, w / 3, h, 221, 221, 221, 255);
  return createImageData(w, h, data);
}

function createManyColorImage(): ImageData {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 128, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 165, 0],
    [128, 0, 128],
  ];
  const perRow = 4;
  const sw = w / perRow;
  const sh = h / Math.ceil(colors.length / perRow);
  for (let i = 0; i < colors.length; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const [cr, cg, cb] = colors[i]!;
    fillRegion(data, w, col * sw, row * sh, sw, sh, cr, cg, cb, 255);
  }
  return createImageData(w, h, data);
}

function createEmptyImage(): ImageData {
  return createImageData(1, 1, new Uint8ClampedArray(4));
}

function makeRgbColor(r: number, g: number, b: number, a: number = 255) {
  return { space: 'rgb' as const, r, g, b, a };
}

/**
 * Approximate the Oklch hue (in radians) of an sRGB color.
 */
function approximateHue(r: number, g: number, b: number): number {
  const linear: [number, number, number] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const oklab = linearSrgbToOklab(linear);
  const [, , H] = oklabToOkLch(oklab);
  return H;
}

/**
 * Compute the absolute circular difference between two angles in radians.
 */
function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  d = Math.min(d, 2 * Math.PI - d);
  return d;
}

describe('extractPalette', () => {
  it('detects 2 dominant colors from a red+blue image', () => {
    const data = createRedBlueImage();
    const result = extractPalette(data);

    expect(result.colors.length).toBeGreaterThanOrEqual(2);
    expect(result.colors[0]).toHaveProperty('space', 'rgb');
    expect(result.colors[0]).toHaveProperty('r');
    expect(result.colors[0]).toHaveProperty('g');
    expect(result.colors[0]).toHaveProperty('b');
    expect(result.colors[0]).toHaveProperty('a');
    expect(result.coverage).toBeGreaterThan(0);
  });

  it('extracts grayscale tones from a grayscale image', () => {
    const data = createGrayscaleImage();
    const result = extractPalette(data, 3);

    expect(result.colors.length).toBeLessThanOrEqual(3);
    expect(result.colors.length).toBeGreaterThan(0);
    for (const c of result.colors) {
      if (c.space === 'rgb') {
        const diff = Math.abs(c.r - c.g) + Math.abs(c.g - c.b) + Math.abs(c.b - c.r);
        expect(diff).toBeLessThan(100);
      }
    }
  });

  it('returns empty for empty/no-data image', () => {
    const data = createEmptyImage();
    const result = extractPalette(data);

    expect(result.colors).toHaveLength(0);
    expect(result.coverage).toBe(0);
  });

  it('respects the colorCount parameter', () => {
    const data = createManyColorImage();
    const result3 = extractPalette(data, 3);
    const result6 = extractPalette(data, 6);

    expect(result3.colors.length).toBeLessThanOrEqual(3);
    expect(result6.colors.length).toBeLessThanOrEqual(6);
    expect(result6.colors.length).toBeGreaterThanOrEqual(result3.colors.length);
  });

  it('reports coverage of nearly 100% for a simple 2-color image', () => {
    const data = createRedBlueImage();
    const result = extractPalette(data, 6);

    expect(result.coverage).toBeGreaterThan(0.85);
  });

  it('is deterministic for identical pixels and configuration', () => {
    const data = createManyColorImage();
    const first = extractPalette(data, 6);
    const second = extractPalette(data, 6);

    expect(second.extracted.map((swatch) => swatch.color)).toEqual(
      first.extracted.map((swatch) => swatch.color),
    );
    expect(second.extracted.map((swatch) => swatch.roleCandidate)).toEqual(
      first.extracted.map((swatch) => swatch.roleCandidate),
    );
  });

  it('does not return duplicate clusters when fewer colors exist than requested', () => {
    const data = createImageData(
      2,
      2,
      new Uint8ClampedArray([12, 34, 56, 255, 12, 34, 56, 255, 12, 34, 56, 255, 12, 34, 56, 255]),
    );
    const result = extractPalette(data, 12);

    expect(result.extracted).toHaveLength(1);
    expect(result.extracted[0]?.color).toMatchObject({ r: 12, g: 34, b: 56, a: 255 });
  });

  it('ignores transparent pixels and preserves a small saturated accent', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    fillRegion(data, width, 0, 0, width, height, 248, 248, 248, 255);
    fillRegion(data, width, 30, 30, 2, 2, 255, 80, 0, 255);
    const result = extractPalette(createImageData(width, height, data), 6);

    expect(result.extracted.some((swatch) => swatch.roleCandidate === 'accent')).toBe(true);
    expect(
      result.extracted.some((swatch) => {
        const color = swatch.color;
        return color.space === 'rgb' && color.r > 220 && color.g < 120 && color.b < 40;
      }),
    ).toBe(true);

    const transparent = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]);
    const transparentResult = extractPaletteFromRgba(2, 1, transparent, 6);
    expect(transparentResult.extracted).toHaveLength(1);
    expect(transparentResult.warnings.map((warning) => warning.code)).toContain(
      'transparent-pixels-ignored',
    );
  });

  it('preserves a tiny saturated accent on a dominant dark background', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    fillRegion(data, width, 0, 0, width, height, 18, 20, 24, 255);
    fillRegion(data, width, 30, 30, 2, 2, 0, 210, 190, 255);
    const result = extractPalette(createImageData(width, height, data), 6);

    expect(
      result.extracted.some((swatch) => {
        const color = swatch.color;
        return color.space === 'rgb' && color.g > 150 && color.b > 130 && color.r < 80;
      }),
    ).toBe(true);
    expect(result.extracted.some((swatch) => swatch.roleCandidate === 'dark-neutral')).toBe(true);
  });

  it('does not collapse a gradient into a single washed-out cluster', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = Math.round((x / width) * 255);
        data[offset + 1] = 0;
        data[offset + 2] = Math.round((y / height) * 255);
        data[offset + 3] = 255;
      }
    }
    const result = extractPalette(createImageData(width, height, data), 6);

    expect(result.extracted.length).toBeGreaterThanOrEqual(3);
    const chromas = result.extracted.map((swatch) =>
      Math.hypot(swatch.oklab[1]!, swatch.oklab[2]!),
    );
    expect(Math.max(...chromas)).toBeGreaterThan(0.03);
  });

  it('returns WCAG 2.1 contrast pair measurements with explicit criteria', () => {
    const data = createImageData(2, 1, new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]));
    const result = analyzePalette({ width: 2, height: 1, data: data.data }, { colorCount: 2 });

    expect(result.contrastPairs.length).toBeGreaterThan(0);
    expect(result.contrastPairs[0]).toMatchObject({
      criterion: 'WCAG 2.1',
      passesAA: true,
      passesAAA: true,
    });
  });

  it('keeps output bounded and finite for a large synthetic source', () => {
    const width = 512;
    const height = 512;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 255;
      data[i + 1] = 128;
      data[i + 2] = 32;
      data[i + 3] = 255;
    }
    const result = analyzePalette({ width, height, data }, { colorCount: 12, maxSamples: 256 });

    expect(result.extracted.length).toBeLessThanOrEqual(12);
    for (const swatch of result.extracted) {
      expect(swatch.oklab.every(Number.isFinite)).toBe(true);
      expect(swatch.oklch.every(Number.isFinite)).toBe(true);
      expect(swatch.weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('honors user-selected palette counts beyond the legacy six-color default', () => {
    const width = 32;
    const height = 32;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const offset = i * 4;
      const channel = Math.floor(i / 32) * 8;
      data[offset] = channel;
      data[offset + 1] = 255 - channel;
      data[offset + 2] = (i % 32) * 8;
      data[offset + 3] = 255;
    }
    const result = analyzePalette({ width, height, data }, { colorCount: 24 });

    expect(result.config.colorCount).toBe(24);
    expect(result.extracted.length).toBeLessThanOrEqual(24);
  });
});

describe('Harmony generation', () => {
  const seed = makeRgbColor(255, 0, 0, 255);

  it('complementaryHarmony rotates hue by 180 degrees', () => {
    const pal = complementaryHarmony(seed);
    expect(pal.name).toBe('Complementary');
    expect(pal.colors).toHaveLength(1);

    const c = pal.colors[0]!;
    expect(c.space).toBe('rgb');
    const rgb = c as { r: number; g: number; b: number };

    const seedH = approximateHue(255, 0, 0);
    const compH = approximateHue(rgb.r, rgb.g, rgb.b);
    const diff = angleDiff(compH, seedH);
    expect(diff).toBeGreaterThan(2.5);
    expect(diff).toBeLessThan(3.8);
  });

  it('triadicHarmony produces 2 colors at 120-degree offsets from seed', () => {
    const pal = triadicHarmony(seed);
    expect(pal.name).toBe('Triadic');
    expect(pal.colors).toHaveLength(2);

    const h0 = approximateHue(255, 0, 0);
    for (const c of pal.colors) {
      if (c.space === 'rgb') {
        const rgb = c as { r: number; g: number; b: number };
        const h = approximateHue(rgb.r, rgb.g, rgb.b);
        const diff = angleDiff(h, h0);
        expect(diff).toBeGreaterThan(1.5);
      }
    }
  });

  it('analogousHarmony produces 2 colors', () => {
    const pal = analogousHarmony(seed);
    expect(pal.name).toBe('Analogous');
    expect(pal.colors).toHaveLength(2);

    const h0 = approximateHue(255, 0, 0);
    for (const c of pal.colors) {
      if (c.space === 'rgb') {
        const rgb = c as { r: number; g: number; b: number };
        const h = approximateHue(rgb.r, rgb.g, rgb.b);
        const diff = angleDiff(h, h0);
        expect(diff).toBeLessThan(1.1);
      }
    }
  });

  it('splitComplementaryHarmony produces 2 colors', () => {
    const pal = splitComplementaryHarmony(seed);
    expect(pal.name).toBe('Split Complementary');
    expect(pal.colors).toHaveLength(2);

    const h0 = approximateHue(255, 0, 0);
    for (const c of pal.colors) {
      if (c.space === 'rgb') {
        const rgb = c as { r: number; g: number; b: number };
        const h = approximateHue(rgb.r, rgb.g, rgb.b);
        const diff = angleDiff(h, h0);
        expect(diff).toBeGreaterThan(1.5);
      }
    }
  });

  it('harmony colors have hues different from the seed color', () => {
    const seed2 = makeRgbColor(0, 128, 255, 255);
    const pal = complementaryHarmony(seed2);
    const h0 = approximateHue(0, 128, 255);
    for (const c of pal.colors) {
      if (c.space === 'rgb') {
        const rgb = c as { r: number; g: number; b: number };
        const h = approximateHue(rgb.r, rgb.g, rgb.b);
        expect(angleDiff(h, h0)).toBeGreaterThan(0.01);
      }
    }
  });
});
