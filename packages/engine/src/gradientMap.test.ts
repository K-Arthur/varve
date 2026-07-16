/**
 * Gradient map filter tests.
 *
 * Research basis: Adobe Photoshop Gradient Map adjustment layer. Maps each
 * pixel's luminance (Rec. 709 luma) through a gradient stop ramp.
 */
import { describe, expect, it } from 'vitest';
import { applyGradientMapFilter, type GradientMapParams } from './gradientMap';

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

describe('gradientMap filter', () => {
  it('maps black to leftmost stop and white to rightmost stop', () => {
    const img = createTestImageData(2, 1, [
      0,
      0,
      0,
      255, // black pixel
      255,
      255,
      255,
      255, // white pixel
    ]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [255, 0, 0, 255] }, // red
        { position: 1, color: [0, 0, 255, 255] }, // blue
      ],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    // Black pixel should map to red (leftmost stop)
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);

    // White pixel should map to blue (rightmost stop)
    expect(px[4]).toBe(0);
    expect(px[5]).toBe(0);
    expect(px[6]).toBe(255);
  });

  it('interpolates midtones between stops', () => {
    const img = createTestImageData(1, 1, [
      128,
      128,
      128,
      255, // 50% gray
    ]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    // 50% gray should map to ~50% between black and white
    expect(px[0]).toBeGreaterThanOrEqual(120);
    expect(px[0]).toBeLessThanOrEqual(135);
    expect(px[1]).toBeGreaterThanOrEqual(120);
    expect(px[1]).toBeLessThanOrEqual(135);
    expect(px[2]).toBeGreaterThanOrEqual(120);
    expect(px[2]).toBeLessThanOrEqual(135);
  });

  it('handles three-stop gradient (tritone)', () => {
    const img = createTestImageData(3, 1, [
      0,
      0,
      0,
      255, // black
      128,
      128,
      128,
      255, // gray
      255,
      255,
      255,
      255, // white
    ]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [255, 0, 0, 255] }, // red shadow
        { position: 0.5, color: [0, 255, 0, 255] }, // green midtone
        { position: 1, color: [0, 0, 255, 255] }, // blue highlight
      ],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    // Black → red
    expect(px[0]).toBe(255);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);

    // Gray → green-ish
    expect(px[4]).toBeLessThan(100);
    expect(px[5]).toBeGreaterThanOrEqual(120);
    expect(px[6]).toBeLessThan(100);

    // White → blue
    expect(px[8]).toBeLessThan(50);
    expect(px[10]).toBe(255);
  });

  it('preserves alpha channel', () => {
    const img = createTestImageData(1, 1, [
      100,
      100,
      100,
      128, // semi-transparent
    ]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [255, 0, 0, 255] },
        { position: 1, color: [0, 0, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    expect(px[3]).toBe(128);
  });

  it('handles identical color stops without division by zero', () => {
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [255, 0, 0, 255] },
        { position: 0, color: [255, 0, 0, 255] },
        { position: 1, color: [0, 0, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
    };

    expect(() => applyGradientMapFilter(img, params)).not.toThrow();
  });

  it('handles reversed colors (light shadows, dark highlights)', () => {
    const img = createTestImageData(2, 1, [
      0,
      0,
      0,
      255, // black
      255,
      255,
      255,
      255, // white
    ]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [255, 255, 255, 255] }, // white at shadow
        { position: 1, color: [0, 0, 0, 255] }, // black at highlight
      ],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    expect(px[0]).toBe(255);
    expect(px[1]).toBe(255);
    expect(px[2]).toBe(255);

    expect(px[4]).toBe(0);
    expect(px[5]).toBe(0);
    expect(px[6]).toBe(0);
  });

  it('preserves luminosity when preserveLuminosity is true', () => {
    const img = createTestImageData(1, 1, [200, 50, 30, 255]);

    const originalLum = 0.2126 * 200 + 0.7152 * 50 + 0.0722 * 30;

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 255, 255] },
        { position: 1, color: [255, 0, 0, 255] },
      ],
      dither: false,
      preserveLuminosity: true,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    const newLum = 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!;
    expect(Math.abs(newLum - originalLum)).toBeLessThanOrEqual(20);
  });

  it('returns input unchanged when fewer than 2 stops', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 255]);

    const params: GradientMapParams = {
      stops: [{ position: 0, color: [255, 0, 0, 255] }],
      dither: false,
      preserveLuminosity: false,
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    expect(px[0]).toBe(100);
    expect(px[1]).toBe(100);
    expect(px[2]).toBe(100);
  });
});
