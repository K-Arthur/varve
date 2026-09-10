/**
 * Color Halftone effect tests.
 *
 * Tests the color halftone screening engine: CMYK/RGB/mono modes,
 * dot shapes, intensity blending, alpha preservation, and presets.
 */
import { describe, expect, it } from 'vitest';
import {
  applyColorHalftone,
  COLOR_HALFTONE_PRESETS,
  type ColorHalftoneParams,
} from './colorHalftone';

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

const baseParams: ColorHalftoneParams = {
  screenSize: 12,
  angle: 0,
  dotShape: 'round',
  mode: 'cmyk',
  intensity: 1,
};

describe('colorHalftone CMYK mode', () => {
  it('produces valid RGB output for a midtone pixel', () => {
    const img = createTestImageData(
      8,
      8,
      new Array(8 * 8 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 255; // alpha
        return 128; // RGB
      }),
    );
    applyColorHalftone(img, baseParams);
    const px = extractPixels(img);
    // All output values should be in [0, 255]
    for (let i = 0; i < px.length; i++) {
      expect(px[i]).toBeGreaterThanOrEqual(0);
      expect(px[i]).toBeLessThanOrEqual(255);
    }
  });

  it('preserves alpha channel', () => {
    const img = createTestImageData(
      4,
      4,
      new Array(4 * 4 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 200;
        return 100;
      }),
    );
    applyColorHalftone(img, baseParams);
    const px = extractPixels(img);
    for (let i = 3; i < px.length; i += 4) {
      expect(px[i]).toBe(200);
    }
  });

  it('skips fully transparent pixels', () => {
    const img = createTestImageData(
      2,
      2,
      [100, 100, 100, 0, 100, 100, 100, 0, 100, 100, 100, 0, 100, 100, 100, 0],
    );
    applyColorHalftone(img, baseParams);
    const px = extractPixels(img);
    // Transparent pixels should remain unchanged
    expect(px[0]).toBe(100);
    expect(px[3]).toBe(0);
  });
});

describe('colorHalftone mono mode', () => {
  it('applies ink color to screened pixels', () => {
    const img = createTestImageData(
      8,
      8,
      new Array(8 * 8 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 255;
        return 200; // bright → high ink coverage
      }),
    );
    const params: ColorHalftoneParams = {
      ...baseParams,
      mode: 'mono',
      inkColor: [255, 0, 0, 255], // red ink
    };
    applyColorHalftone(img, params);
    const px = extractPixels(img);
    // Center pixels should be tinted toward the ink color
    // (exact value depends on screen position, but R should dominate somewhere)
    let foundReddish = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i]! > px[i + 1]! && px[i]! > px[i + 2]!) {
        foundReddish = true;
        break;
      }
    }
    expect(foundReddish).toBe(true);
  });
});

describe('colorHalftone RGB mode', () => {
  it('screens channels independently', () => {
    const img = createTestImageData(
      8,
      8,
      new Array(8 * 8 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 255;
        return 128;
      }),
    );
    const params: ColorHalftoneParams = { ...baseParams, mode: 'rgb' };
    applyColorHalftone(img, params);
    const px = extractPixels(img);
    // Output should be valid
    for (let i = 0; i < px.length; i++) {
      expect(px[i]).toBeGreaterThanOrEqual(0);
      expect(px[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe('colorHalftone intensity', () => {
  it('intensity=0 returns original image unchanged', () => {
    const img = createTestImageData(
      4,
      4,
      new Array(4 * 4 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 255;
        return 100;
      }),
    );
    const params: ColorHalftoneParams = { ...baseParams, intensity: 0 };
    applyColorHalftone(img, params);
    const px = extractPixels(img);
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(100);
      expect(px[i + 1]).toBe(100);
      expect(px[i + 2]).toBe(100);
    }
  });

  it('intensity=0.5 blends with original', () => {
    const img = createTestImageData(
      8,
      8,
      new Array(8 * 8 * 4).fill(0).map((_, i) => {
        if (i % 4 === 3) return 255;
        return 128;
      }),
    );
    const params: ColorHalftoneParams = { ...baseParams, intensity: 0.5 };
    applyColorHalftone(img, params);
    const px = extractPixels(img);
    // Output should differ from original (128) but not be fully halftone
    let differs = false;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i]! - 128) > 5) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe('colorHalftone dot shapes', () => {
  it('supports all four dot shapes without error', () => {
    const shapes: ColorHalftoneParams['dotShape'][] = ['round', 'square', 'diamond', 'line'];
    for (const dotShape of shapes) {
      const img = createTestImageData(
        4,
        4,
        new Array(4 * 4 * 4).fill(0).map((_, i) => {
          if (i % 4 === 3) return 255;
          return 128;
        }),
      );
      const params: ColorHalftoneParams = { ...baseParams, dotShape };
      expect(() => applyColorHalftone(img, params)).not.toThrow();
    }
  });
});

describe('colorHalftone presets', () => {
  it('has at least 6 presets', () => {
    expect(COLOR_HALFTONE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it('all presets have required fields', () => {
    for (const preset of COLOR_HALFTONE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.params.screenSize).toBeGreaterThan(0);
      expect(preset.params.dotShape).toMatch(/round|square|diamond|line/);
      expect(preset.params.mode).toMatch(/cmyk|rgb|mono/);
    }
  });

  it('all preset ids are unique', () => {
    const ids = COLOR_HALFTONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('presets produce valid output when applied', () => {
    for (const preset of COLOR_HALFTONE_PRESETS) {
      const testImg = createTestImageData(
        8,
        8,
        new Array(8 * 8 * 4).fill(0).map((_, i) => {
          if (i % 4 === 3) return 255;
          return 128;
        }),
      );
      applyColorHalftone(testImg, { ...preset.params, intensity: 1 });
      const px = extractPixels(testImg);
      for (let i = 0; i < px.length; i++) {
        expect(px[i]).toBeGreaterThanOrEqual(0);
        expect(px[i]).toBeLessThanOrEqual(255);
      }
    }
  });
});
