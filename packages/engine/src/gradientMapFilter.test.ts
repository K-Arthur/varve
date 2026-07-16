/**
 * Gradient map filter module tests — tests the exported gradientMap.ts module
 * for alpha preservation, LUT building, and dithering behavior.
 */
import { describe, expect, it } from 'vitest';
import { applyGradientMapFilter, buildGradientLUT, type GradientMapStop } from './gradientMap';

function createTestImageData(width: number, height: number, pixels: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i] = pixels[i]!;
  }
  return { data, width, height, colorSpace: 'srgb' as const };
}

function extractPixels(imageData: ImageData): number[] {
  return Array.from(imageData.data);
}

const basicStops: GradientMapStop[] = [
  { position: 0, color: [255, 0, 0, 255] },
  { position: 1, color: [0, 0, 255, 255] },
];

describe('buildGradientLUT', () => {
  it('builds a 256-entry LUT for 2 stops', () => {
    const { r, g, b } = buildGradientLUT(basicStops);
    expect(r.length).toBe(256);
    expect(g.length).toBe(256);
    expect(b.length).toBe(256);
  });

  it('maps lum=0 to first stop color', () => {
    const { r, g, b } = buildGradientLUT(basicStops);
    expect(r[0]).toBe(255);
    expect(g[0]).toBe(0);
    expect(b[0]).toBe(0);
  });

  it('maps lum=255 to last stop color', () => {
    const { r, g, b } = buildGradientLUT(basicStops);
    expect(r[255]).toBe(0);
    expect(g[255]).toBe(0);
    expect(b[255]).toBe(255);
  });

  it('returns empty LUTs for fewer than 2 stops', () => {
    const { r, g, b } = buildGradientLUT([{ position: 0, color: [255, 0, 0, 255] }]);
    expect(r[0]).toBe(0);
    expect(g[0]).toBe(0);
    expect(b[0]).toBe(0);
  });

  it('interpolates midtone correctly', () => {
    const { r } = buildGradientLUT(basicStops);
    // At lum=128, t≈0.5, r should be ~127-128
    expect(r[128]).toBeGreaterThan(100);
    expect(r[128]).toBeLessThan(160);
  });
});

describe('applyGradientMapFilter', () => {
  it('maps black to leftmost stop and white to rightmost stop', () => {
    const img = createTestImageData(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    expect(px[0]).toBe(255); // black → red R
    expect(px[6]).toBe(255); // white → blue B
  });

  it('preserves alpha channel on semi-transparent pixels', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 128]);
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    expect(px[3]).toBe(128);
  });

  it('skips fully transparent pixels', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 0]);
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    expect(px[0]).toBe(100);
    expect(px[1]).toBe(100);
    expect(px[2]).toBe(100);
  });

  it('returns input unchanged when fewer than 2 stops', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 255]);
    applyGradientMapFilter(img, {
      stops: [{ position: 0, color: [255, 0, 0, 255] }],
      dither: false,
      preserveLuminosity: false,
    });
    const px = extractPixels(img);
    expect(px[0]).toBe(100);
  });

  it('handles 3-stop gradient (tritone-like)', () => {
    const stops: GradientMapStop[] = [
      { position: 0, color: [255, 0, 0, 255] },
      { position: 0.5, color: [0, 255, 0, 255] },
      { position: 1, color: [0, 0, 255, 255] },
    ];
    const img = createTestImageData(3, 1, [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    applyGradientMapFilter(img, { stops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    // Black → red
    expect(px[0]).toBe(255);
    // White → blue
    expect(px[10]).toBe(255);
  });

  it('preserveLuminosity maintains original luminance', () => {
    const img = createTestImageData(1, 1, [200, 50, 30, 255]);
    const originalLum = 0.2126 * 200 + 0.7152 * 50 + 0.0722 * 30;
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: true });
    const px = extractPixels(img);
    const newLum = 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!;
    expect(Math.abs(newLum - originalLum)).toBeLessThan(25);
  });

  it('handles identical position stops without division by zero', () => {
    const stops: GradientMapStop[] = [
      { position: 0, color: [255, 0, 0, 255] },
      { position: 0, color: [255, 0, 0, 255] },
      { position: 1, color: [0, 0, 255, 255] },
    ];
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);
    expect(() =>
      applyGradientMapFilter(img, { stops, dither: false, preserveLuminosity: false }),
    ).not.toThrow();
  });
});

// ── Independent property-based and edge-case tests ──────────────────────

describe('gradient map dithering behavior', () => {
  it('dither=true produces different output than dither=false', () => {
    const w = 16;
    const h = 16;
    const pixels: number[] = [];
    for (let i = 0; i < w * h; i++) {
      pixels.push(128, 128, 128, 255);
    }
    const img1 = createTestImageData(w, h, [...pixels]);
    const img2 = createTestImageData(w, h, [...pixels]);

    applyGradientMapFilter(img1, { stops: basicStops, dither: false, preserveLuminosity: false });
    applyGradientMapFilter(img2, { stops: basicStops, dither: true, preserveLuminosity: false });

    const px1 = extractPixels(img1);
    const px2 = extractPixels(img2);
    // With uniform input, dithering should introduce variation
    let diffCount = 0;
    for (let i = 0; i < px1.length; i += 4) {
      if (px1[i] !== px2[i] || px1[i + 1] !== px2[i + 1] || px1[i + 2] !== px2[i + 2]) {
        diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('dithering does not systematically shift average brightness', () => {
    const w = 32;
    const h = 32;
    const pixels: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        pixels.push(128, 128, 128, 255);
      }
    }
    const img1 = createTestImageData(w, h, [...pixels]);
    const img2 = createTestImageData(w, h, [...pixels]);

    applyGradientMapFilter(img1, { stops: basicStops, dither: false, preserveLuminosity: false });
    applyGradientMapFilter(img2, { stops: basicStops, dither: true, preserveLuminosity: false });

    function avgLum(d: ImageData): number {
      let sum = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        sum += 0.2126 * d.data[i]! + 0.7152 * d.data[i + 1]! + 0.0722 * d.data[i + 2]!;
      }
      return sum / (d.data.length / 4);
    }

    // Dithering should approximately preserve average luminance (within 10%)
    expect(Math.abs(avgLum(img1) - avgLum(img2))).toBeLessThan(25);
  });
});

describe('gradient map unsorted stops', () => {
  it('stops provided out of order still produce correct LUT', () => {
    const unsortedStops: GradientMapStop[] = [
      { position: 1, color: [0, 0, 255, 255] },
      { position: 0, color: [255, 0, 0, 255] },
    ];
    const { r, b } = buildGradientLUT(unsortedStops);
    // After sorting, position 0 → red, position 1 → blue
    expect(r[0]).toBe(255);
    expect(b[0]).toBe(0);
    expect(r[255]).toBe(0);
    expect(b[255]).toBe(255);
  });

  it('3 stops out of order produce correct mapping', () => {
    const unsortedStops: GradientMapStop[] = [
      { position: 1, color: [0, 0, 255, 255] },
      { position: 0.5, color: [0, 255, 0, 255] },
      { position: 0, color: [255, 0, 0, 255] },
    ];
    const img = createTestImageData(3, 1, [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    applyGradientMapFilter(img, { stops: unsortedStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    // Black → red (first stop after sorting)
    expect(px[0]).toBe(255);
    // White → blue (last stop after sorting)
    expect(px[10]).toBe(255);
  });
});

describe('gradient map LUT monotonicity', () => {
  it('monotonically increasing gradient produces non-decreasing LUT', () => {
    const stops: GradientMapStop[] = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.5, color: [128, 128, 128, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    const { r, g, b } = buildGradientLUT(stops);
    for (let i = 1; i < 256; i++) {
      expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]!);
      expect(g[i]).toBeGreaterThanOrEqual(g[i - 1]!);
      expect(b[i]).toBeGreaterThanOrEqual(b[i - 1]!);
    }
  });
});

describe('gradient map Rec. 709 luminance mapping', () => {
  it('pure red pixel maps to correct luminance bin (luma ≈ 54)', () => {
    // Red luma = 0.2126 * 255 ≈ 54
    // Blue luma = 0.0722 * 255 ≈ 18
    // With stops red→blue, lower luma maps closer to position 0 (red).
    // So blue pixel (luma 18) should have MORE red than red pixel (luma 54).
    const img = createTestImageData(2, 1, [
      255,
      0,
      0,
      255, // red, luma ≈ 54
      0,
      0,
      255,
      255, // blue, luma ≈ 18
    ]);
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    // Blue pixel (luma 18, closer to position 0) should have more red
    expect(px[4]! > px[0]!).toBe(true);
  });
});

describe('gradient map preserveLuminosity edge cases', () => {
  it('does not crash on pure black pixel (lum = 0)', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    expect(() =>
      applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: true }),
    ).not.toThrow();
    const px = extractPixels(img);
    for (let c = 0; c < 3; c++) {
      expect(px[c]).toBeGreaterThanOrEqual(0);
      expect(px[c]).toBeLessThanOrEqual(255);
    }
  });

  it('clamps output to [0, 255] after luminosity scaling', () => {
    // Use a gradient that maps to white at low luminance, then scale down
    const stops: GradientMapStop[] = [
      { position: 0, color: [255, 255, 255, 255] },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    const img = createTestImageData(1, 1, [10, 10, 10, 255]);
    applyGradientMapFilter(img, { stops, dither: false, preserveLuminosity: true });
    const px = extractPixels(img);
    for (let c = 0; c < 3; c++) {
      expect(px[c]).toBeGreaterThanOrEqual(0);
      expect(px[c]).toBeLessThanOrEqual(255);
    }
  });
});

describe('gradient map nearly transparent pixel', () => {
  it('alpha=1 pixel is still processed (not skipped)', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 1]);
    applyGradientMapFilter(img, { stops: basicStops, dither: false, preserveLuminosity: false });
    const px = extractPixels(img);
    // Should be mapped (not original 100,100,100)
    // With basic stops, lum=100 → t≈0.39, should be between red and blue
    expect(px[0]).not.toBe(100);
    expect(px[3]).toBe(1); // alpha preserved
  });
});
