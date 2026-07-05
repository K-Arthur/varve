/**
 * Tests for pixel-level image processing pipeline.
 */
import { describe, expect, it } from 'vitest';
import {
  applyChannelMixer,
  applyColorBalance,
  applyCurves,
  applyExposure,
  applyLevels,
  applyPhotoFilter,
  applySelectiveColor,
  applySharpen,
  applyTemperature,
  hasPixelProcessor,
} from './pixelPipeline';

function makePattern(): Uint8ClampedArray {
  // 4×1 pixel RGBA: red, green, blue, gray
  return new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255,
  ]);
}

function clone(d: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(d);
}

// ── Curves ───────────────────────────────────────────────────────────────────

describe('applyCurves', () => {
  it('identity curve (empty points) produces no change', () => {
    const data = makePattern();
    const original = clone(data);
    applyCurves(data, 4, 1, 'rgb', []);
    expect([...data]).toEqual([...original]);
  });

  it('brighten curve increases channel values', () => {
    const data = new Uint8ClampedArray([64, 64, 64, 255]);
    applyCurves(data, 1, 1, 'rgb', [
      { input: 0, output: 0.2 },
      { input: 1, output: 1 },
    ]);
    // 64/255 = 0.251 → interp: 0.2 + 0.251*(1-0.2) = 0.4008 → 0.4008*255 = 102.2 → 102
    expect(data[0]).toBeGreaterThan(64);
    expect(data[1]).toBe(data[0]);
    expect(data[2]).toBe(data[0]);
  });

  it('darken curve decreases channel values', () => {
    const data = new Uint8ClampedArray([200, 200, 200, 255]);
    applyCurves(data, 1, 1, 'rgb', [
      { input: 0, output: 0 },
      { input: 1, output: 0.5 },
    ]);
    // 200/255 = 0.784 → output = 0.784*0.5 = 0.392 → 0.392*255 = 100
    expect(data[0]).toBeLessThan(200);
  });

  it('channel-specific curve only modifies that channel', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyCurves(data, 1, 1, 'red', [
      { input: 0, output: 0 },
      { input: 1, output: 0.5 },
    ]);
    // Red changed, green and blue unchanged
    expect(data[0]).toBeLessThan(100);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(100);
  });

  it('channel-specific blue curve only modifies blue', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyCurves(data, 1, 1, 'blue', [
      { input: 0, output: 0 },
      { input: 1, output: 0.5 },
    ]);
    expect(data[0]).toBe(100);
    expect(data[1]).toBe(100);
    expect(data[2]).toBeLessThan(100);
  });
});

// ── Levels ───────────────────────────────────────────────────────────────────

describe('applyLevels', () => {
  it('identity levels produce no change', () => {
    const data = makePattern();
    const original = clone(data);
    applyLevels(data, 4, 1, 'rgb', 0, 1, 255, 0, 255);
    expect([...data]).toEqual([...original]);
  });

  it('crush shadows maps dark values to outputShadows', () => {
    const data = new Uint8ClampedArray([32, 32, 32, 255, 200, 200, 200, 255]);
    applyLevels(data, 2, 1, 'rgb', 64, 1, 255, 0, 255);
    // 32 < 64 → t=0 → output=0
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    // 200: t=(200-64)/191=0.712 → output = 0 + 0.712*255 = 182 (rounded)
    expect(data[4]).toBeGreaterThan(150);
  });

  it('boost highlights increases bright values', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyLevels(data, 1, 1, 'rgb', 0, 0.5, 255, 0, 255);
    // t=128/255=0.502, gamma=2, t^2=0.252, output=0.252*255=64
    expect(data[0]).toBeLessThan(128);
  });

  it('channel-specific levels only modifies that channel', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyLevels(data, 1, 1, 'green', 50, 1, 255, 0, 255);
    // 100: t=(100-50)/205=0.244, output=62
    expect(data[0]).toBe(100);
    expect(data[1]).toBeLessThan(100);
    expect(data[2]).toBe(100);
  });
});

// ── Selective Color ──────────────────────────────────────────────────────────

describe('applySelectiveColor', () => {
  it('adjusting reds cyan affects red pixel but not gray', () => {
    const data = makePattern();
    applySelectiveColor(data, 4, 1, 'reds', 100, 0, 0, 0, false);
    expect(data[0]!).toBeLessThan(255);
    expect(Math.abs(data[12]! - 128)).toBeLessThan(5);
    expect(Math.abs(data[13]! - 128)).toBeLessThan(5);
    expect(Math.abs(data[14]! - 128)).toBeLessThan(5);
  });

  it('adjusting neutrals black darkens gray pixels', () => {
    const data = makePattern();
    applySelectiveColor(data, 4, 1, 'neutrals', 0, 0, 0, 50, false);
    expect(data[12]!).toBeLessThan(128);
    expect(data[13]!).toBeLessThan(128);
    expect(data[14]!).toBeLessThan(128);
    expect(data[0]!).toBeGreaterThan(240);
  });
});

// ── Color Balance ────────────────────────────────────────────────────────────

describe('applyColorBalance', () => {
  it('shadows adjustment darkens shadow regions', () => {
    const data = new Uint8ClampedArray([30, 30, 30, 255, 200, 200, 200, 255]);
    applyColorBalance(
      data,
      2,
      1,
      { cyanRed: -30, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      false,
    );
    // Shadow pixel (30): L=30, sw=0.766, so cyanshadows * 0.766 → R ≈ 30 + (-30*0.766) = 7
    expect(data[0]).toBeLessThan(30);
    // Highlight pixel (200): L=200, hw=0.562, no highlight adjustment, so unchanged
    expect(data[4]).toBe(200);
  });

  it('midtones adjustment affects midtones more than extremes', () => {
    const data = new Uint8ClampedArray([30, 30, 30, 255, 128, 128, 128, 255, 220, 220, 220, 255]);
    applyColorBalance(
      data,
      3,
      1,
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 50, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      false,
    );
    // Midtone pixel (128): L=128, mw=1.0, sw=0, hw=0 → R += 50 = 178
    expect(data[4]).toBe(178);
    // Shadow pixel (30): L=30, mw=0.234 → R += 50*0.234 = 11.7 → ~42
    expect(data[0]).toBeLessThan(50);
    expect(data[0]).toBeGreaterThan(30);
  });
});

// ── Channel Mixer ────────────────────────────────────────────────────────────

describe('applyChannelMixer', () => {
  it('red output from green source replaces red with green', () => {
    const data = new Uint8ClampedArray([200, 50, 30, 255]);
    applyChannelMixer(data, 1, 1, 'red', 0, 100, 0, 0, false);
    // Red = (0*200 + 100*50 + 0*30)/100 + 0 = 50
    expect(data[0]).toBe(50);
    // Green and blue unchanged
    expect(data[1]).toBe(50);
    expect(data[2]).toBe(30);
  });

  it('monochrome applies same value to all channels', () => {
    const data = new Uint8ClampedArray([200, 50, 30, 255]);
    applyChannelMixer(data, 1, 1, 'red', 30, 60, 10, 0, true);
    // V = (30*200 + 60*50 + 10*30)/100 = (6000+3000+300)/100 = 93
    const expected = 93;
    expect(data[0]).toBe(expected);
    expect(data[1]).toBe(expected);
    expect(data[2]).toBe(expected);
  });

  it('constant offset shifts output', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyChannelMixer(data, 1, 1, 'red', 100, 0, 0, 20, false);
    // Red = (100*100 + 0*100 + 0*100)/100 + 20*255/100 = 100 + 51 = 151
    expect(data[0]).toBe(151);
  });
});

// ── Exposure ─────────────────────────────────────────────────────────────────

describe('applyExposure', () => {
  it('positive exposure brightens pixels', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyExposure(data, 1, 1, 1, 0, 1);
    // Linear: srgbToLinear(100) = ((100/255+0.055)/1.055)^2.4 ≈ 0.127
    // exposure=2^1=2, so 0.127*2 = 0.254 → linearToSrgb(0.254) ≈ 138
    expect(data[0]).toBeGreaterThan(100);
  });

  it('negative exposure darkens pixels', () => {
    const data = new Uint8ClampedArray([200, 200, 200, 255]);
    applyExposure(data, 1, 1, -1, 0, 1);
    expect(data[0]).toBeLessThan(200);
  });

  it('zero exposure and identity gamma produces no change', () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    const original = clone(data);
    applyExposure(data, 1, 1, 0, 0, 1);
    // Small floating point inaccuracies expected at extremes, but mid values should be exact
    expect(data[0]).toBe(original[0]);
    expect(data[1]).toBe(original[1]);
    expect(data[2]).toBe(original[2]);
  });

  it('alpha channel is preserved', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 200]);
    applyExposure(data, 1, 1, 2, 0, 1);
    expect(data[3]).toBe(200);
  });
});

// ── Temperature ──────────────────────────────────────────────────────────────

describe('applyTemperature', () => {
  it('warm temperature increases red, decreases blue', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyTemperature(data, 1, 1, 50);
    expect(data[0]).toBeGreaterThan(128);
    expect(data[2]).toBeLessThan(128);
  });

  it('cool temperature decreases red, increases blue', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyTemperature(data, 1, 1, -50);
    expect(data[0]).toBeLessThan(128);
    expect(data[2]).toBeGreaterThan(128);
  });

  it('alpha channel is preserved', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 100]);
    applyTemperature(data, 1, 1, 80);
    expect(data[3]).toBe(100);
  });
});

// ── Sharpen ──────────────────────────────────────────────────────────────────

describe('applySharpen', () => {
  it('zero amount produces no change', () => {
    const data = makePattern();
    const original = clone(data);
    applySharpen(data, 4, 1, 0, 1, 0);
    expect([...data]).toEqual([...original]);
  });

  it('positive amount sharpens edges', () => {
    // A sharp edge: adjacent pixels with large difference
    const data = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]);
    applySharpen(data, 2, 1, 100, 1, 0);
    // After blur: pixel 0 avg ≈ (100+200)/2 = 150, pixel 1 avg ≈ (100+200)/2 = 150
    // Pixel 0: diff = 100-150 = -50, sharpened = 100 + 1.0*(-50) = 50
    // Pixel 1: diff = 200-150 = 50, sharpened = 200 + 1.0*(50) = 250
    // Edge is enhanced — darker side gets darker, lighter side gets lighter
    expect(data[0]).toBeLessThan(100);
    expect(data[4]).toBeGreaterThan(200);
  });

  it('threshold prevents sharpening small differences', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255, 105, 105, 105, 255]);
    const original = clone(data);
    applySharpen(data, 2, 1, 100, 1, 20);
    // Difference 5 < threshold 20, so no change
    expect([...data]).toEqual([...original]);
  });

  it('preserves alpha channel', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 50, 200, 200, 200, 150]);
    applySharpen(data, 2, 1, 100, 1, 0);
    expect(data[3]).toBe(50);
    expect(data[7]).toBe(150);
  });
});

// ── Photo Filter ─────────────────────────────────────────────────────────────

describe('applyPhotoFilter', () => {
  it('warm filter adds warmth to gray pixel', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyPhotoFilter(data, 1, 1, [255, 200, 100, 255], 50, false);
    // Should be warmer: R > G > B (or R > orig, B < orig)
    expect(data[0]!).toBeGreaterThan(data[2]!);
  });

  it('zero density produces no change', () => {
    const data = makePattern();
    const original = clone(data);
    applyPhotoFilter(data, 4, 1, [255, 0, 0, 255], 0, false);
    expect([...data]).toEqual([...original]);
  });

  it('full density produces filter color', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyPhotoFilter(data, 1, 1, [255, 100, 50, 255], 100, false);
    // d=1.0, fa=1.0 → result = filter color
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(50);
    expect(data[3]).toBe(255);
  });

  it('preserveLuminosity maintains brightness', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    const originalL = 100;
    applyPhotoFilter(data, 1, 1, [255, 50, 50, 255], 75, true);
    const newL = 0.299 * data[0]! + 0.587 * data[1]! + 0.114 * data[2]!;
    // Luminosity should be close to original (within rounding)
    expect(Math.abs(newL - originalL)).toBeLessThan(3);
  });

  it('alpha channel is preserved', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 80]);
    applyPhotoFilter(data, 1, 1, [255, 200, 100, 255], 50, false);
    expect(data[3]!).toBe(80);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty data array does not throw', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => applyCurves(data, 0, 0, 'rgb', [])).not.toThrow();
    expect(() => applyLevels(data, 0, 0, 'rgb', 0, 1, 255, 0, 255)).not.toThrow();
    expect(() => applyExposure(data, 0, 0, 1, 0, 1)).not.toThrow();
    expect(() => applyTemperature(data, 0, 0, 50)).not.toThrow();
  });

  it('zero width or height does not throw', () => {
    const data = new Uint8ClampedArray(4);
    expect(() => applySharpen(data, 0, 1, 50, 1, 0)).not.toThrow();
    expect(() => applySharpen(data, 1, 0, 50, 1, 0)).not.toThrow();
  });

  it('extreme values do not overflow', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(() => applyExposure(data, 2, 1, 5, 100, 5)).not.toThrow();
    // All channels should be in valid 0-255 range
    for (let i = 0; i < 8; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });

  it('selective color with zero adjustments is no-op', () => {
    const data = makePattern();
    const original = clone(data);
    applySelectiveColor(data, 4, 1, 'reds', 0, 0, 0, 0, false);
    expect([...data]).toEqual([...original]);
  });

  it('color balance with zero adjustments is no-op', () => {
    const data = makePattern();
    const original = clone(data);
    applyColorBalance(
      data,
      4,
      1,
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      false,
    );
    expect([...data]).toEqual([...original]);
  });
});

// ── Dispatch ─────────────────────────────────────────────────────────────────

describe('applyPixelFilter dispatch', () => {
  it('has registered processors for all pixel-level kinds', () => {
    expect(hasPixelProcessor('curves')).toBe(true);
    expect(hasPixelProcessor('levels')).toBe(true);
    expect(hasPixelProcessor('selectiveColor')).toBe(true);
    expect(hasPixelProcessor('colorBalance')).toBe(true);
    expect(hasPixelProcessor('channelMixer')).toBe(true);
    expect(hasPixelProcessor('exposure')).toBe(true);
    expect(hasPixelProcessor('temperature')).toBe(true);
    expect(hasPixelProcessor('sharpen')).toBe(true);
    expect(hasPixelProcessor('photoFilter')).toBe(true);
  });

  it('does not have processor for CSS-only kinds', () => {
    expect(hasPixelProcessor('brightness')).toBe(false);
    expect(hasPixelProcessor('blur')).toBe(false);
  });
});
