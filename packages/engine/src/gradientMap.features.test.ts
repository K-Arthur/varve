/**
 * Gradient map feature tests — reverse, intensity, luminance modes,
 * opacity stops, alpha control, and interpolation spaces.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGradientMapFilter,
  buildGradientAlphaLut,
  buildGradientColorLut,
  type GradientMapParams,
  type GradientMapStop,
  interpolateGradientMapColor,
} from './gradientMap';

function createTestImageData(width: number, height: number, pixels: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i] = pixels[i]!;
  }
  return { data, width, height, colorSpace: 'srgb' as const };
}

const redBlue: GradientMapStop[] = [
  { position: 0, color: [255, 0, 0, 255] },
  { position: 1, color: [0, 0, 255, 255] },
];

function apply(img: ImageData, params: Partial<GradientMapParams>) {
  applyGradientMapFilter(img, {
    stops: redBlue,
    dither: false,
    preserveLuminosity: false,
    ...params,
  });
}

describe('reverse', () => {
  it('swaps the shadow and highlight mapping', () => {
    const img = createTestImageData(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    apply(img, { reverse: true });
    // Black (tonal 0) now samples the reversed ramp: last stop (blue)
    expect(img.data[0]).toBe(0);
    expect(img.data[2]).toBe(255);
    // White (tonal 255) samples the first stop (red)
    expect(img.data[4]).toBe(255);
    expect(img.data[6]).toBe(0);
  });
});

describe('intensity', () => {
  it('keeps the source unchanged at intensity 0', () => {
    const img = createTestImageData(1, 1, [200, 100, 50, 255]);
    apply(img, { intensity: 0 });
    expect(img.data[0]).toBe(200);
    expect(img.data[1]).toBe(100);
    expect(img.data[2]).toBe(50);
  });

  it('partially mixes at intensity 0.5', () => {
    const img = createTestImageData(1, 1, [200, 100, 50, 255]);
    apply(img, { intensity: 0.5 });
    const full = createTestImageData(1, 1, [200, 100, 50, 255]);
    apply(full, { intensity: 1 });
    const midR = (200 + full.data[0]!) / 2;
    expect(Math.abs(img.data[0]! - midR)).toBeLessThanOrEqual(1);
  });

  it('fully maps at intensity 1', () => {
    const img = createTestImageData(1, 1, [200, 100, 50, 255]);
    apply(img, { intensity: 1 });
    expect(img.data).not.toEqual(new Uint8ClampedArray([200, 100, 50, 255]));
  });
});

describe('luminance modes', () => {
  it('relative-luminance uses Rec.709 weights (gray scales match)', () => {
    // A pixel whose average equals luma will differ from average-rgb result.
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);
    apply(img, { luminanceMode: 'relative-luminance' });
    const rel = [...img.data];
    const img2 = createTestImageData(1, 1, [128, 128, 128, 255]);
    apply(img2, { luminanceMode: 'average-rgb' });
    // Gray has identical luma and average — same result for both modes.
    expect(rel).toEqual([...img2.data]);
  });

  it('max-channel maps to the max channel', () => {
    // Pure red: max-channel tonal = 255 → last stop (blue)
    const img = createTestImageData(1, 1, [255, 0, 0, 255]);
    apply(img, { luminanceMode: 'max-channel' });
    expect(img.data[0]).toBe(0);
    expect(img.data[2]).toBe(255);
  });

  it('red channel maps using the red channel value', () => {
    // red=255 → tonal 255 → last stop (blue)
    const img = createTestImageData(1, 1, [255, 0, 128, 255]);
    apply(img, { luminanceMode: 'red' });
    expect(img.data[2]).toBe(255);
  });

  it('blue channel maps using the blue channel value', () => {
    // blue=0 → tonal 0 → first stop (red)
    const img = createTestImageData(1, 1, [0, 128, 0, 255]);
    apply(img, { luminanceMode: 'blue' });
    expect(img.data[0]).toBe(255);
  });

  it('perceptual-lightness stays in bounds', () => {
    const img = createTestImageData(1, 1, [200, 30, 200, 255]);
    apply(img, { luminanceMode: 'perceptual-lightness' });
    for (let i = 0; i < 3; i++) {
      expect(img.data[i]!).toBeGreaterThanOrEqual(0);
      expect(img.data[i]!).toBeLessThanOrEqual(255);
    }
  });
});

describe('alpha handling', () => {
  it('preserves source alpha by default (no fringes on transparent edges)', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 40]);
    apply(img, {});
    expect(img.data[3]).toBe(40);
  });

  it('skips fully transparent pixels so no dark fringe appears', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 0]);
    apply(img, {});
    expect(img.data[0]).toBe(100);
    expect(img.data[1]).toBe(100);
    expect(img.data[2]).toBe(100);
    expect(img.data[3]).toBe(0);
  });

  it('modulates alpha from the opacity ramp when preserveSourceAlpha is false', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    apply(img, {
      preserveSourceAlpha: false,
      opacityStops: [
        { position: 0, opacity: 0 },
        { position: 1, opacity: 1 },
      ],
    });
    // Black → tonal 0 → opacity 0 → transparent
    expect(img.data[3]).toBe(0);
  });

  it('uses per-stop opacity as a fallback alpha ramp', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    applyGradientMapFilter(img, {
      stops: [
        { position: 0, color: [255, 0, 0, 255], opacity: 0 },
        { position: 1, color: [0, 0, 255, 255], opacity: 1 },
      ],
      dither: false,
      preserveLuminosity: false,
      preserveSourceAlpha: false,
    });
    expect(img.data[3]).toBe(0);
  });
});

describe('interpolation spaces', () => {
  it('oklab differs from srgb for a saturated pair', () => {
    const srgb = buildGradientColorLut(redBlue, { size: 256, interpolation: 'srgb' });
    const oklab = buildGradientColorLut(redBlue, { size: 256, interpolation: 'oklab' });
    // At least some midtone entries must differ meaningfully.
    let differs = false;
    for (let i = 32; i < 224; i++) {
      if (Math.abs(srgb.r[i]! - oklab.r[i]!) > 2) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('supports oklch and hsl without errors', () => {
    for (const space of ['oklch', 'hsl', 'srgb', 'oklab'] as const) {
      const lut = buildGradientColorLut(redBlue, { size: 128, interpolation: space });
      expect(lut.lutSize).toBe(128);
      expect(lut.r[127]).toBe(0);
      expect(lut.b[0]).toBe(0);
    }
  });
});

describe('lutSize', () => {
  it('builds 1024-entry LUTs when requested', () => {
    const lut = buildGradientColorLut(redBlue, { size: 1024 });
    expect(lut.lutSize).toBe(1024);
    expect(lut.r.length).toBe(1024);
  });

  it('clamps absurd LUT sizes in the filter path', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    applyGradientMapFilter(img, {
      stops: redBlue,
      dither: false,
      preserveLuminosity: false,
      lutSize: 10_000_000,
    });
    expect(img.data[0]).toBe(255);
  });

  // Regression: the apply loop derives a ramp index from an 8-bit tonal value.
  // When the LUT is built at a non-256 resolution that index must be rescaled
  // to the LUT's own domain, otherwise a high-resolution LUT is only ever
  // sampled across its first 256 entries (and a low-resolution one is indexed
  // out of bounds, yielding NaN -> 0). Both cases are reachable from the
  // serialized `lutSize` adjustment field, so they are document-visible.
  it.each([64, 128, 256, 512, 1024, 4096])(
    'maps a white pixel to the final stop at lutSize=%i',
    (lutSize) => {
      const img = createTestImageData(1, 1, [255, 255, 255, 255]);
      applyGradientMapFilter(img, {
        stops: redBlue,
        dither: false,
        preserveLuminosity: false,
        lutSize,
      });
      // redBlue ends at pure blue — a full-luminance pixel must land there.
      expect(img.data[0]).toBe(0);
      expect(img.data[2]).toBe(255);
    },
  );

  it.each([64, 512, 4096])('maps a mid-gray pixel to the ramp middle at lutSize=%i', (lutSize) => {
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);
    applyGradientMapFilter(img, {
      stops: redBlue,
      dither: false,
      preserveLuminosity: false,
      lutSize,
    });
    // Halfway along a red->blue ramp: both channels meaningfully mixed.
    expect(img.data[0]).toBeGreaterThan(80);
    expect(img.data[0]).toBeLessThan(180);
    expect(img.data[2]).toBeGreaterThan(80);
    expect(img.data[2]).toBeLessThan(180);
  });

  it('applies the opacity ramp at a non-256 lutSize', () => {
    const img = createTestImageData(1, 1, [255, 255, 255, 255]);
    applyGradientMapFilter(img, {
      stops: redBlue,
      dither: false,
      preserveLuminosity: false,
      preserveSourceAlpha: false,
      lutSize: 1024,
      opacityStops: [
        { position: 0, opacity: 1 },
        { position: 1, opacity: 0 },
      ],
    });
    // Tonal value 255 sits at the transparent end of the opacity ramp.
    expect(img.data[3]).toBeLessThan(8);
  });
});

describe('buildGradientAlphaLut', () => {
  it('fills 255 when no opacity data is present', () => {
    const lut = buildGradientAlphaLut(redBlue, undefined, 256);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it('interpolates the ramp', () => {
    const lut = buildGradientAlphaLut(
      redBlue,
      [
        { position: 0, opacity: 0 },
        { position: 1, opacity: 1 },
      ],
      256,
    );
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBeGreaterThan(100);
    expect(lut[128]).toBeLessThan(160);
    expect(lut[255]).toBe(255);
  });
});

describe('interpolateGradientMapColor', () => {
  it('uses the upper stop midpoint (Photoshop convention)', () => {
    const stops = [
      { position: 0, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } },
      {
        position: 0.5,
        color: { space: 'rgb' as const, r: 128, g: 128, b: 128, a: 255 },
        midpoint: 0.2,
      },
      { position: 1, color: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 } },
    ];
    const early = interpolateGradientMapColor(stops, 0.25, 'srgb');
    const linear = interpolateGradientMapColor(
      stops.map((s) => ({ ...s, midpoint: 0.5 })),
      0.25,
      'srgb',
    );
    expect(early.r).toBeGreaterThan(linear.r);
  });
});

describe('edge cases', () => {
  it('handles single stops without throwing', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 255]);
    applyGradientMapFilter(img, {
      stops: [{ position: 0, color: [255, 0, 0, 255] }],
      dither: false,
      preserveLuminosity: false,
      intensity: 0.5,
    });
    expect(img.data[0]).toBe(100);
  });

  it('handles NaN and out-of-range stop positions deterministically', () => {
    const lut = buildGradientColorLut(
      [
        { position: Number.NaN, color: [255, 0, 0, 255] },
        { position: 5, color: [0, 0, 255, 255] },
      ],
      { size: 256, interpolation: 'oklab' },
    );
    expect(lut.r[0]).toBeGreaterThanOrEqual(0);
    expect(lut.b[255]).toBeGreaterThanOrEqual(0);
  });

  it('reverse + dither + intensity compose without errors', () => {
    const img = createTestImageData(
      4,
      4,
      [10, 20, 30, 255, 200, 180, 160, 255, 90, 80, 70, 255, 30, 60, 90, 255],
    );
    apply(img, { reverse: true, dither: true, intensity: 0.8, luminanceMode: 'average-rgb' });
    for (const v of img.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
