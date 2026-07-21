/**
 * Tritone filter tests.
 *
 * Tests the tritone tonal mapping: 3-color shadow/midtone/highlight mapping
 * with smoothstep interpolation, intensity blending, alpha preservation,
 * and luminosity preservation.
 */
import { describe, expect, it } from 'vitest';
import { applyTritone, type TritoneParams, tritoneMap } from './tritone';

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

const defaultParams: TritoneParams = {
  shadowColor: [0, 0, 255, 255],
  midtoneColor: [128, 128, 128, 255],
  highlightColor: [255, 255, 0, 255],
  shadowPoint: 0.33,
  highlightPoint: 0.67,
  intensity: 1,
  preserveLuminosity: false,
};

describe('tritoneMap', () => {
  it('maps pure black (lum=0) to shadow color', () => {
    const [r, g, b] = tritoneMap(0, defaultParams);
    expect(r).toBeCloseTo(0, 0);
    expect(g).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(255, 0);
  });

  it('maps pure white (lum=255) to highlight color', () => {
    const [r, g, b] = tritoneMap(255, defaultParams);
    expect(r).toBeCloseTo(255, 0);
    expect(g).toBeCloseTo(255, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it('maps midtone luminance toward midtone color', () => {
    const [r, g, b] = tritoneMap(128, defaultParams);
    // Should be closer to midtone gray than to either extreme
    expect(r).toBeGreaterThan(50);
    expect(r).toBeLessThan(220);
    expect(g).toBeGreaterThan(50);
    expect(g).toBeLessThan(220);
    expect(b).toBeGreaterThan(50);
    expect(b).toBeLessThan(220);
  });

  it('produces smooth transitions (no discontinuities)', () => {
    const params: TritoneParams = {
      ...defaultParams,
      shadowColor: [0, 0, 0, 255],
      midtoneColor: [128, 128, 128, 255],
      highlightColor: [255, 255, 255, 255],
    };
    let prevR = tritoneMap(0, params)[0]!;
    for (let lum = 1; lum < 256; lum++) {
      const r = tritoneMap(lum, params)[0]!;
      // Should be monotonically non-decreasing for a normal gradient
      expect(r).toBeGreaterThanOrEqual(prevR - 2); // allow small rounding
      prevR = r;
    }
  });
});

describe('applyTritone', () => {
  it('maps black pixel to shadow color', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    expect(px[2]).toBeGreaterThan(200); // blue dominant
    expect(px[0]).toBeLessThan(50);
  });

  it('maps white pixel to highlight color', () => {
    const img = createTestImageData(1, 1, [255, 255, 255, 255]);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    expect(px[0]).toBeGreaterThan(200); // red dominant (yellow)
    expect(px[1]).toBeGreaterThan(200); // green dominant (yellow)
  });

  it('preserves alpha channel on semi-transparent pixels', () => {
    const img = createTestImageData(1, 1, [128, 128, 128, 128]);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    expect(px[3]).toBe(128);
  });

  it('skips fully transparent pixels', () => {
    const img = createTestImageData(1, 1, [100, 100, 100, 0]);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    // Should be unchanged
    expect(px[0]).toBe(100);
    expect(px[1]).toBe(100);
    expect(px[2]).toBe(100);
  });

  it('intensity=0 returns input unchanged', () => {
    const img = createTestImageData(1, 1, [128, 64, 200, 255]);
    applyTritone(img, { ...defaultParams, intensity: 0 });
    const px = extractPixels(img);
    expect(px[0]).toBe(128);
    expect(px[1]).toBe(64);
    expect(px[2]).toBe(200);
  });

  it('intensity=0.5 blends original and mapped color', () => {
    const original = [128, 128, 128, 255];
    const img = createTestImageData(1, 1, [...original]);
    const fullImg = createTestImageData(1, 1, [...original]);

    applyTritone(img, { ...defaultParams, intensity: 0.5 });
    applyTritone(fullImg, { ...defaultParams, intensity: 1 });

    const px = extractPixels(img);
    const fullPx = extractPixels(fullImg);

    // Half-intensity should be between original and full mapping
    for (let c = 0; c < 3; c++) {
      const lo = Math.min(original[c]!, fullPx[c]!);
      const hi = Math.max(original[c]!, fullPx[c]!);
      expect(px[c]!).toBeGreaterThanOrEqual(lo - 2);
      expect(px[c]!).toBeLessThanOrEqual(hi + 2);
    }
  });

  it('preserveLuminosity maintains original luminance', () => {
    const img = createTestImageData(1, 1, [200, 100, 50, 255]);
    const originalLum = 0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50;

    applyTritone(img, { ...defaultParams, preserveLuminosity: true });
    const px = extractPixels(img);
    const newLum = 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!;

    expect(Math.abs(newLum - originalLum)).toBeLessThan(25);
  });

  it('handles edge case: shadowPoint === highlightPoint', () => {
    const img = createTestImageData(1, 1, [128, 128, 128, 255]);
    const params: TritoneParams = {
      ...defaultParams,
      shadowPoint: 0.5,
      highlightPoint: 0.5,
    };
    expect(() => applyTritone(img, params)).not.toThrow();
  });

  it('handles edge case: shadowPoint=0, highlightPoint=1', () => {
    const img = createTestImageData(3, 1, [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    const params: TritoneParams = {
      ...defaultParams,
      shadowPoint: 0,
      highlightPoint: 1,
    };
    expect(() => applyTritone(img, params)).not.toThrow();
    const px = extractPixels(img);
    // All pixels should be mapped (not unchanged) - either R or B channel differs from input
    expect(px[0] !== 0 || px[2] !== 0).toBe(true);
  });

  it('handles 2x2 image with mixed luminance', () => {
    const img = createTestImageData(
      2,
      2,
      [0, 0, 0, 255, 255, 255, 255, 255, 64, 64, 64, 255, 192, 192, 192, 255],
    );
    expect(() => applyTritone(img, defaultParams)).not.toThrow();
    const px = extractPixels(img);
    // All alpha preserved
    expect(px[3]).toBe(255);
    expect(px[7]).toBe(255);
    expect(px[11]).toBe(255);
    expect(px[15]).toBe(255);
  });

  it('produces different output for different shadow colors', () => {
    const img1 = createTestImageData(1, 1, [0, 0, 0, 255]);
    const img2 = createTestImageData(1, 1, [0, 0, 0, 255]);

    applyTritone(img1, { ...defaultParams, shadowColor: [255, 0, 0, 255] });
    applyTritone(img2, { ...defaultParams, shadowColor: [0, 255, 0, 255] });

    const px1 = extractPixels(img1);
    const px2 = extractPixels(img2);

    expect(px1[0]! > px2[0]!).toBe(true); // red shadow > green shadow in R channel
    expect(px2[1]! > px1[1]!).toBe(true); // green shadow > red shadow in G channel
  });
});

// ── Independent property-based and edge-case tests ──────────────────────

describe('tritoneMap continuity at boundary points', () => {
  it('tritoneMap is continuous at shadowPoint (no jump)', () => {
    const params: TritoneParams = {
      ...defaultParams,
      shadowPoint: 0.33,
      highlightPoint: 0.67,
    };
    const sp255 = Math.round(0.33 * 255);
    const below = tritoneMap(sp255 - 1, params);
    const at = tritoneMap(sp255, params);
    const above = tritoneMap(sp255 + 1, params);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(at[c]! - below[c]!)).toBeLessThanOrEqual(5);
      expect(Math.abs(above[c]! - at[c]!)).toBeLessThanOrEqual(5);
    }
  });

  it('tritoneMap is continuous at highlightPoint (no jump)', () => {
    const params: TritoneParams = {
      ...defaultParams,
      shadowPoint: 0.33,
      highlightPoint: 0.67,
    };
    const hp255 = Math.round(0.67 * 255);
    const below = tritoneMap(hp255 - 1, params);
    const at = tritoneMap(hp255, params);
    const above = tritoneMap(hp255 + 1, params);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(at[c]! - below[c]!)).toBeLessThanOrEqual(5);
      expect(Math.abs(above[c]! - at[c]!)).toBeLessThanOrEqual(5);
    }
  });
});

describe('tritone LUT consistency', () => {
  it('applyTritone output matches tritoneMap for same luminance', () => {
    const params: TritoneParams = {
      shadowColor: [20, 40, 60, 255],
      midtoneColor: [120, 80, 200, 255],
      highlightColor: [240, 200, 100, 255],
      shadowPoint: 0.3,
      highlightPoint: 0.7,
      intensity: 1,
      preserveLuminosity: false,
    };
    // Create a gradient image with known luminance values
    const pixels: number[] = [];
    for (let lum = 0; lum < 256; lum++) {
      pixels.push(lum, lum, lum, 255);
    }
    const img = createTestImageData(256, 1, pixels);
    applyTritone(img, params);
    const px = extractPixels(img);

    for (let lum = 0; lum < 256; lum++) {
      const [r, g, b] = tritoneMap(lum, params);
      const idx = lum * 4;
      expect(px[idx]!).toBeCloseTo(r, 0);
      expect(px[idx + 1]!).toBeCloseTo(g, 0);
      expect(px[idx + 2]!).toBeCloseTo(b, 0);
    }
  });
});

describe('tritone intensity clamping', () => {
  it('intensity > 1 is clamped to 1 (same as intensity=1)', () => {
    const pixels = [100, 150, 200, 255];
    const img1 = createTestImageData(1, 1, [...pixels]);
    const img2 = createTestImageData(1, 1, [...pixels]);
    applyTritone(img1, { ...defaultParams, intensity: 1 });
    applyTritone(img2, { ...defaultParams, intensity: 5 });
    expect(extractPixels(img1)).toEqual(extractPixels(img2));
  });

  it('intensity < 0 is clamped to 0 (same as intensity=0)', () => {
    const pixels = [100, 150, 200, 255];
    const img1 = createTestImageData(1, 1, [...pixels]);
    const img2 = createTestImageData(1, 1, [...pixels]);
    applyTritone(img1, { ...defaultParams, intensity: 0 });
    applyTritone(img2, { ...defaultParams, intensity: -3 });
    expect(extractPixels(img1)).toEqual(extractPixels(img2));
  });
});

describe('tritone determinism', () => {
  it('pixels with same luminance produce identical output regardless of position', () => {
    const pixels = [
      100,
      50,
      200,
      255, // same luminance as pixel 2
      80,
      80,
      80,
      255, // luminance ≈ 80
      100,
      50,
      200,
      255, // same luminance as pixel 1
    ];
    const img = createTestImageData(3, 1, pixels);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    // Pixel 1 and 3 should be identical (same input, same luminance)
    expect(px[0]).toBe(px[8]);
    expect(px[1]).toBe(px[9]);
    expect(px[2]).toBe(px[10]);
  });
});

describe('tritone preserveLuminosity edge cases', () => {
  it('does not crash on near-black pixel (lum ≈ 0)', () => {
    const img = createTestImageData(1, 1, [1, 1, 1, 255]);
    expect(() => applyTritone(img, { ...defaultParams, preserveLuminosity: true })).not.toThrow();
    const px = extractPixels(img);
    for (let c = 0; c < 3; c++) {
      expect(px[c]).toBeGreaterThanOrEqual(0);
      expect(px[c]).toBeLessThanOrEqual(255);
    }
  });

  it('does not crash on pure black pixel (lum = 0)', () => {
    const img = createTestImageData(1, 1, [0, 0, 0, 255]);
    expect(() => applyTritone(img, { ...defaultParams, preserveLuminosity: true })).not.toThrow();
  });

  it('clamps output to [0, 255] after luminosity scaling', () => {
    // Use extreme colors that will cause scaling to push values out of range
    const params: TritoneParams = {
      shadowColor: [255, 255, 255, 255],
      midtoneColor: [255, 255, 255, 255],
      highlightColor: [255, 255, 255, 255],
      shadowPoint: 0.3,
      highlightPoint: 0.7,
      intensity: 1,
      preserveLuminosity: true,
    };
    const img = createTestImageData(1, 1, [10, 10, 10, 255]);
    applyTritone(img, params);
    const px = extractPixels(img);
    for (let c = 0; c < 3; c++) {
      expect(px[c]).toBeGreaterThanOrEqual(0);
      expect(px[c]).toBeLessThanOrEqual(255);
    }
  });
});

describe('tritone colored pixel luminance mapping', () => {
  it('uses Rec. 709 luma for colored pixels', () => {
    // Pure red: luma = 0.2126 * 255 ≈ 54
    // Pure green: luma = 0.7152 * 255 ≈ 182
    // These should map to different tritone colors
    const img = createTestImageData(2, 1, [
      255,
      0,
      0,
      255, // red, luma ≈ 54
      0,
      255,
      0,
      255, // green, luma ≈ 182
    ]);
    applyTritone(img, defaultParams);
    const px = extractPixels(img);
    // The two pixels should have different mapped colors
    // (because their luma values differ significantly)
    const rDiff = Math.abs(px[0]! - px[4]!);
    const gDiff = Math.abs(px[1]! - px[5]!);
    const bDiff = Math.abs(px[2]! - px[6]!);
    expect(rDiff + gDiff + bDiff).toBeGreaterThan(20);
  });
});

describe('tritone monotonicity for identity gradient (all channels)', () => {
  it('all 3 channels are monotonically non-decreasing for black→gray→white', () => {
    const params: TritoneParams = {
      shadowColor: [0, 0, 0, 255],
      midtoneColor: [128, 128, 128, 255],
      highlightColor: [255, 255, 255, 255],
      shadowPoint: 0.33,
      highlightPoint: 0.67,
      intensity: 1,
      preserveLuminosity: false,
    };
    for (let c = 0; c < 3; c++) {
      let prev = tritoneMap(0, params)[c]!;
      for (let lum = 1; lum < 256; lum++) {
        const val = tritoneMap(lum, params)[c]!;
        expect(val).toBeGreaterThanOrEqual(prev - 2); // allow small rounding
        prev = val;
      }
    }
  });
});

describe('tritone interpolation modes', () => {
  const linearParams: TritoneParams = {
    shadowColor: [0, 0, 0, 255],
    midtoneColor: [128, 128, 128, 255],
    highlightColor: [255, 255, 255, 255],
    shadowPoint: 0.5,
    highlightPoint: 0.5,
    intensity: 1,
    preserveLuminosity: false,
    interpolation: 'linear',
  };

  it('linear interpolation produces a linear ramp in the shadow region', () => {
    // At exactly half of shadowPoint (t=0.25), linear should give midpoint color
    const [r, g, b] = tritoneMap(64, linearParams); // lum=64 → normalized=0.25
    expect(r).toBeCloseTo(64, 0);
    expect(g).toBeCloseTo(64, 0);
    expect(b).toBeCloseTo(64, 0);
  });

  it('linear and smoothstep produce different values in the early shadow region', () => {
    const smoothParams = { ...linearParams, interpolation: 'smoothstep' as const };
    // lum=32 → normalized≈0.125. In shadow region (sp=0.5):
    //   linear t = 0.125/0.5 = 0.25
    //   smoothstep(0,0.5,0.125) = smoothstep(0.25) ≈ 0.156 (slower start)
    // So smooth gives a darker (closer to shadow [0,0,0]) value than linear
    const linear = tritoneMap(32, linearParams);
    const smooth = tritoneMap(32, smoothParams);
    expect(smooth[0]).toBeLessThan(linear[0]);
    // Both should be between shadow (0) and midtone (128)
    expect(linear[0]).toBeGreaterThan(0);
    expect(linear[0]).toBeLessThan(128);
  });

  it('linear interpolation is C0 continuous at the shadowPoint boundary', () => {
    const below = tritoneMap(127, linearParams); // just below shadowPoint (0.5)
    const at = tritoneMap(128, linearParams); // just at shadowPoint
    const diff = Math.abs(below[0]! - at[0]!);
    expect(diff).toBeLessThanOrEqual(2); // small step
  });

  it('default interpolation (undefined) behaves as smoothstep', () => {
    const defaultP = { ...linearParams };
    delete defaultP.interpolation;
    const result = tritoneMap(64, defaultP);
    const smooth = tritoneMap(64, { ...linearParams, interpolation: 'smoothstep' });
    expect(result[0]).toBe(smooth[0]);
    expect(result[1]).toBe(smooth[1]);
    expect(result[2]).toBe(smooth[2]);
  });

  it('applyTritone respects the interpolation field end-to-end', () => {
    const data = createTestImageData(
      4,
      4,
      [
        32, 32, 32, 255, 64, 64, 64, 255, 96, 96, 96, 255, 128, 128, 128, 255, 160, 160, 160, 255,
        192, 192, 192, 255, 224, 224, 224, 255, 255, 255, 255, 255, 0, 0, 0, 255, 50, 50, 50, 255,
        100, 100, 100, 255, 150, 150, 150, 255, 200, 200, 200, 255, 250, 250, 250, 255, 128, 128,
        128, 255, 64, 64, 64, 255,
      ],
    );

    const linearData = createTestImageData(4, 4, Array.from(data.data));
    const smoothData = createTestImageData(4, 4, Array.from(data.data));

    applyTritone(linearData, { ...linearParams });
    applyTritone(smoothData, { ...linearParams, interpolation: 'smoothstep' });

    // The two outputs should differ for mid-transition pixels
    let differs = false;
    for (let i = 0; i < data.data.length; i += 4) {
      if (Math.abs(linearData.data[i]! - smoothData.data[i]!) > 2) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});
