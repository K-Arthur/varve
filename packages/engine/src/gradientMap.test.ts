/**
 * Gradient map filter tests.
 *
 * Research basis: Adobe Photoshop Gradient Map adjustment layer. Maps each
 * pixel's luminance (Rec. 709 luma) through a gradient stop ramp.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGradientMapFilter,
  buildGradientLUT,
  type GradientMapParams,
  type GradientMapStop,
} from './gradientMap';

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

describe('gradient map channel mode', () => {
  it('maps R, G, B independently through per-channel stops', () => {
    // Pure red pixel: R=255, G=0, B=0
    const img = createTestImageData(1, 1, [255, 0, 0, 255]);

    // R channel: 255→0 (invert), G channel: 0→255, B channel: 0→128
    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
      mode: 'channel',
      channelStops: {
        r: [
          { position: 0, color: [255, 0, 0, 255] },
          { position: 1, color: [0, 0, 0, 255] },
        ],
        g: [
          { position: 0, color: [0, 0, 0, 255] },
          { position: 1, color: [255, 0, 0, 255] },
        ],
        b: [
          { position: 0, color: [0, 0, 0, 255] },
          { position: 1, color: [128, 0, 0, 255] },
        ],
      },
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    // R=255 → inverted to 0
    expect(px[0]).toBe(0);
    // G=0 → mapped to 0 (start of g gradient)
    expect(px[1]).toBe(0);
    // B=0 → mapped to 0 (start of b gradient)
    expect(px[2]).toBe(0);
  });

  it('channel mode produces different output than luminance mode', () => {
    // A colored pixel where luma-based and channel-based mapping diverge
    const imgLum = createTestImageData(1, 1, [200, 50, 50, 255]);
    const imgCh = createTestImageData(1, 1, [200, 50, 50, 255]);

    const lumParams: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
      mode: 'luminance',
    };

    const chParams: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
      mode: 'channel',
    };

    applyGradientMapFilter(imgLum, lumParams);
    applyGradientMapFilter(imgCh, chParams);

    // Luminance mode: maps based on luma (≈89 for [200,50,50])
    // Channel mode: R=200→200, G=50→50, B=50→50 (identity gradient)
    // They should differ
    const lumPx = extractPixels(imgLum);
    const chPx = extractPixels(imgCh);
    expect(lumPx[0]).not.toBe(chPx[0]); // R channel differs
  });

  it('channel mode falls back to main stops when channelStops not provided', () => {
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
      mode: 'channel',
      // No channelStops — should use main stops for all channels
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);

    // 128 → ~128 (identity mapping through black→white)
    expect(px[0]).toBeCloseTo(128, 0);
    expect(px[1]).toBeCloseTo(128, 0);
    expect(px[2]).toBeCloseTo(128, 0);
  });

  it('channel mode preserves alpha', () => {
    const img = createTestImageData(1, 1, [200, 100, 50, 128]);

    const params: GradientMapParams = {
      stops: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] },
      ],
      dither: false,
      preserveLuminosity: false,
      mode: 'channel',
    };

    applyGradientMapFilter(img, params);
    const px = extractPixels(img);
    expect(px[3]).toBe(128); // alpha unchanged
  });
});

describe('gradient map midpoint', () => {
  it('midpoint < 0.5 pushes transition earlier', () => {
    // Build two LUTs with different midpoints
    const stopsLinear: GradientMapStop[] = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.5, color: [128, 128, 128, 255], midpoint: 0.5 },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    const stopsEarly: GradientMapStop[] = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.5, color: [128, 128, 128, 255], midpoint: 0.2 },
      { position: 1, color: [255, 255, 255, 255] },
    ];

    const lutLinear = buildGradientLUT(stopsLinear);
    const lutEarly = buildGradientLUT(stopsEarly);

    // At position 0.25 (between 0 and 0.5):
    // Linear midpoint=0.5: t=0.5 → output ≈ 64
    // Early midpoint=0.2: transition happens earlier, so at t=0.25 we're
    // already past the midpoint → output should be higher than linear
    const idx = Math.round(0.25 * 255);
    expect(lutEarly.r[idx]!).toBeGreaterThan(lutLinear.r[idx]!);
  });

  it('midpoint > 0.5 pushes transition later', () => {
    const stopsLinear: GradientMapStop[] = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.5, color: [128, 128, 128, 255], midpoint: 0.5 },
      { position: 1, color: [255, 255, 255, 255] },
    ];
    const stopsLate: GradientMapStop[] = [
      { position: 0, color: [0, 0, 0, 255] },
      { position: 0.5, color: [128, 128, 128, 255], midpoint: 0.8 },
      { position: 1, color: [255, 255, 255, 255] },
    ];

    const lutLinear = buildGradientLUT(stopsLinear);
    const lutLate = buildGradientLUT(stopsLate);

    // At position 0.25 (between 0 and 0.5):
    // Late midpoint=0.8: transition happens later, so at t=0.25 we're
    // still before the midpoint → output should be lower than linear
    const idx = Math.round(0.25 * 255);
    expect(lutLate.r[idx]!).toBeLessThan(lutLinear.r[idx]!);
  });
});
