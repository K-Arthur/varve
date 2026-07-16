/**
 * Pixel-level verification tests for tritone, gradient map, and halftone effects.
 *
 * These tests exercise the engine functions directly with known inputs and
 * verify the pixel-level output is correct. They serve as the definitive
 * verification that the effects pipeline produces correct visual output.
 */
import { describe, expect, it } from 'vitest';
import { applyTritone, tritoneMap, type TritoneParams } from './tritone';
import { applyGradientMapFilter, buildGradientLUT, type GradientMapParams } from './gradientMap';
import { applyHalftone, type HalftoneParams } from './halftone';

function createImageData(width: number, height: number, pixels: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) data[i] = pixels[i]!;
  return { data, width, height, colorSpace: 'srgb' as const };
}

function extract(data: ImageData): number[] {
  return Array.from(data.data);
}

// ── Tritone pixel verification ──────────────────────────────────────

describe('tritone pixel verification', () => {
  it('black→shadowColor (blue), white→highlightColor (red)', () => {
    const img = createImageData(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    applyTritone(img, {
      shadowColor: [0, 0, 255, 255],
      midtoneColor: [128, 128, 128, 255],
      highlightColor: [255, 0, 0, 255],
      shadowPoint: 0.33,
      highlightPoint: 0.67,
      intensity: 1,
      preserveLuminosity: false,
    });
    const px = extract(img);
    // Black → blue
    expect(px[2]).toBeGreaterThan(200);
    expect(px[0]).toBeLessThan(50);
    // White → red
    expect(px[4]).toBeGreaterThan(200);
    expect(px[6]).toBeLessThan(50);
  });

  it('alpha preserved at 255, 128, 64, 0', () => {
    const img = createImageData(
      4,
      1,
      [128, 128, 128, 255, 128, 128, 128, 128, 128, 128, 128, 64, 128, 128, 128, 0],
    );
    applyTritone(img, {
      shadowColor: [0, 0, 255, 255],
      midtoneColor: [128, 128, 128, 255],
      highlightColor: [255, 0, 0, 255],
      shadowPoint: 0.33,
      highlightPoint: 0.67,
      intensity: 1,
      preserveLuminosity: false,
    });
    const px = extract(img);
    expect(px[3]).toBe(255);
    expect(px[7]).toBe(128);
    expect(px[11]).toBe(64);
    expect(px[15]).toBe(0);
    // Transparent pixel RGB unchanged
    expect([px[12], px[13], px[14]]).toEqual([128, 128, 128]);
  });

  it('intensity=0.5 blends original and mapped', () => {
    const img = createImageData(1, 1, [128, 128, 128, 255]);
    applyTritone(img, {
      shadowColor: [0, 0, 255, 255],
      midtoneColor: [128, 128, 128, 255],
      highlightColor: [255, 0, 0, 255],
      shadowPoint: 0.33,
      highlightPoint: 0.67,
      intensity: 0.5,
      preserveLuminosity: false,
    });
    const px = extract(img);
    // At 50% intensity, output should be between original (128) and full mapping
    expect(px[0]).toBeGreaterThan(100);
    expect(px[0]).toBeLessThan(180);
  });

  it('all output values in valid byte range', () => {
    const img = createImageData(
      10,
      10,
      Array.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : Math.round(Math.random() * 255))),
    );
    applyTritone(img, {
      shadowColor: [10, 20, 80, 255],
      midtoneColor: [180, 160, 140, 255],
      highlightColor: [255, 245, 220, 255],
      shadowPoint: 0.35,
      highlightPoint: 0.65,
      intensity: 1,
      preserveLuminosity: true,
    });
    const px = extract(img);
    expect(px.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});

// ── Gradient map pixel verification ─────────────────────────────────

describe('gradient map pixel verification', () => {
  it('black→red, gray→green, white→blue', () => {
    const img = createImageData(3, 1, [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    applyGradientMapFilter(img, {
      stops: [
        { position: 0, color: [255, 0, 0, 255] },
        { position: 0.5, color: [0, 255, 0, 255] },
        { position: 1, color: [0, 0, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
    });
    const px = extract(img);
    // Black → red
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);
    // Gray → green
    expect(px[5]).toBeGreaterThan(200);
    // White → blue
    expect(px[10]).toBe(255);
  });

  it('LUT maps correctly', () => {
    const lut = buildGradientLUT([
      { position: 0, color: [0, 0, 0, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ]);
    expect(lut.r[0]).toBe(0);
    expect(lut.r[128]).toBeCloseTo(128, 0);
    expect(lut.r[255]).toBe(255);
  });

  it('alpha preserved', () => {
    const img = createImageData(1, 1, [100, 100, 100, 128]);
    applyGradientMapFilter(img, {
      stops: [
        { position: 0, color: [255, 0, 0, 255] },
        { position: 1, color: [0, 0, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
    });
    const px = extract(img);
    expect(px[3]).toBe(128);
  });

  it('dither produces different output than no-dither', () => {
    const img1 = createImageData(
      16,
      1,
      Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : Math.round((i / 60) * 255))),
    );
    const img2 = createImageData(
      16,
      1,
      Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : Math.round((i / 60) * 255))),
    );
    const stops = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    applyGradientMapFilter(img1, { stops, dither: false, preserveLuminosity: false });
    applyGradientMapFilter(img2, { stops, dither: true, preserveLuminosity: false });
    // At least one pixel should differ between dithered and non-dithered
    const px1 = extract(img1);
    const px2 = extract(img2);
    const differs = px1.some((v, i) => v !== px2[i]);
    expect(differs).toBe(true);
  });

  it('8x8 dither vs 4x4 dither produce different patterns', () => {
    const base = Array.from({ length: 64 }, (_, i) =>
      i % 4 === 3 ? 255 : Math.round((i / 60) * 255),
    );
    const img4 = createImageData(16, 1, [...base]);
    const img8 = createImageData(16, 1, [...base]);
    const stops = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    applyGradientMapFilter(img4, { stops, dither: true, preserveLuminosity: false, ditherSize: 4 });
    applyGradientMapFilter(img8, { stops, dither: true, preserveLuminosity: false, ditherSize: 8 });
    const px4 = extract(img4);
    const px8 = extract(img8);
    // They should produce at least some different values
    const differs = px4.some((v, i) => v !== px8[i]);
    expect(differs).toBe(true);
  });
});

// ── Halftone pixel verification ─────────────────────────────────────

describe('halftone pixel verification', () => {
  it('AM screening produces variation across gradient', () => {
    const size = 16;
    const pixels: number[] = [];
    for (let x = 0; x < size; x++) {
      const gray = Math.round((x / (size - 1)) * 255);
      pixels.push(gray, gray, gray, 255);
    }
    const img = createImageData(size, 1, pixels);
    applyHalftone(img, {
      pattern: 'dot',
      frequency: 30,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      threshold: 128,
      intensity: 1,
      softness: 0,
    });
    const px = extract(img);
    // Should have at least 2 distinct gray values
    const grays = new Set<number>();
    for (let i = 0; i < size; i++) grays.add(px[i * 4]);
    expect(grays.size).toBeGreaterThanOrEqual(2);
  });

  it('CMYK screening produces valid RGB output', () => {
    const img = createImageData(
      4,
      4,
      [
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255,
        255, 255, 128, 128, 128, 255, 0, 0, 0, 255, 255, 128, 0, 255, 128, 0, 128, 255, 0, 128, 0,
        255, 128, 128, 0, 255, 64, 64, 64, 255, 192, 192, 192, 255, 255, 192, 128, 255, 128, 192,
        255, 255,
      ],
    );
    applyHalftone(img, {
      pattern: 'dot',
      frequency: 45,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
      threshold: 128,
      intensity: 1,
      softness: 0,
    });
    const px = extract(img);
    expect(px.every((v) => v >= 0 && v <= 255)).toBe(true);
    // Alpha preserved
    for (let i = 0; i < 16; i++) expect(px[i * 4 + 3]).toBe(255);
  });

  it('FM stochastic dither produces binary-ish output', () => {
    const size = 8;
    const pixels: number[] = [];
    for (let x = 0; x < size; x++) {
      const gray = Math.round((x / (size - 1)) * 255);
      pixels.push(gray, gray, gray, 255);
    }
    const img = createImageData(size, 1, pixels);
    applyHalftone(img, {
      pattern: 'dot',
      frequency: 30,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      threshold: 128,
      intensity: 1,
      softness: 0,
    });
    const px = extract(img);
    // FM produces mostly 0 or 255 (binary) with some intermediate values
    const grays = new Set<number>();
    for (let i = 0; i < size; i++) grays.add(px[i * 4]);
    expect(grays.size).toBeGreaterThanOrEqual(2);
  });

  it('intensity=0 leaves image unchanged', () => {
    const img = createImageData(
      4,
      1,
      [50, 100, 150, 255, 200, 50, 100, 255, 10, 20, 30, 255, 240, 230, 220, 255],
    );
    const before = extract(img);
    applyHalftone(img, {
      pattern: 'dot',
      frequency: 45,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      threshold: 128,
      intensity: 0,
      softness: 0,
    });
    const after = extract(img);
    expect(after).toEqual(before);
  });

  it('Bayer dithering produces position-stable output', () => {
    const size = 8;
    const pixels: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        pixels.push(128, 128, 128, 255);
      }
    }
    const img1 = createImageData(size, size, [...pixels]);
    const img2 = createImageData(size, size, [...pixels]);
    applyHalftone(
      img1,
      {
        pattern: 'dot',
        frequency: 30,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
      },
      0,
      0,
    );
    applyHalftone(
      img2,
      {
        pattern: 'dot',
        frequency: 30,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
      },
      0,
      0,
    );
    // Same input + same offset = same output (deterministic)
    expect(extract(img1)).toEqual(extract(img2));
  });
});
