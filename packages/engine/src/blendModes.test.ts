/**
 * Tests for individual software blend mode functions.
 *
 * Verifies each separable and non-separable blend mode by comparing
 * software output to Canvas2D `globalCompositeOperation` output.
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BLEND_CONFORMANCE_CASES } from './blendConformance';
import {
  blend,
  blendColorBurn,
  blendColorDodge,
  blendDarken,
  blendDifference,
  blendExclusion,
  blendHardLight,
  blendLighten,
  blendMultiply,
  blendNormal,
  blendOverlay,
  blendPixels,
  blendPlusDarker,
  blendPlusLighter,
  blendScreen,
  blendSoftLight,
} from './blendModes';
import { blendColorW3C, blendHueW3C, blendLuminosityW3C, blendSaturationW3C } from './nonSeparable';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a 1×1 ImageData with the given RGBA values. */
function makePixelData(r: number, g: number, b: number, a: number): ImageData {
  const data = new ImageData(1, 1);
  data.data[0] = r;
  data.data[1] = g;
  data.data[2] = b;
  data.data[3] = a;
  return data;
}

// ── Separable blend modes ────────────────────────────────────────────────────

describe('blendNormal', () => {
  it('source replaces backdrop', () => {
    const [r, g, b] = blendNormal(0.5, 0.3, 0.7, 0.8, 0.2, 0.6);
    expect(r).toBeCloseTo(0.8);
    expect(g).toBeCloseTo(0.2);
    expect(b).toBeCloseTo(0.6);
  });
});

describe('blendMultiply', () => {
  it('multiplies channels', () => {
    const [r, g, b] = blendMultiply(0.8, 0.5, 0.3, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.4);
    expect(g).toBeCloseTo(0.25);
    expect(b).toBeCloseTo(0.15);
  });

  it('black on anything is black', () => {
    const [r, g, b] = blendMultiply(0.8, 0.9, 0.7, 0, 0, 0);
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  it('white on anything is unchanged', () => {
    const [r, g, b] = blendMultiply(0.3, 0.5, 0.7, 1, 1, 1);
    expect(r).toBeCloseTo(0.3);
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.7);
  });
});

describe('blendScreen', () => {
  it('screens light values', () => {
    const [r, g, b] = blendScreen(0.3, 0.3, 0.3, 0.6, 0.6, 0.6);
    expect(r).toBeCloseTo(0.72);
    expect(g).toBeCloseTo(0.72);
    expect(b).toBeCloseTo(0.72);
  });

  it('white on anything is white', () => {
    const [r, g, b] = blendScreen(0.3, 0.5, 0.7, 1, 1, 1);
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(1);
    expect(b).toBeCloseTo(1);
  });

  it('black leaves backdrop unchanged', () => {
    const [r, g, b] = blendScreen(0.3, 0.5, 0.7, 0, 0, 0);
    expect(r).toBeCloseTo(0.3);
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.7);
  });
});

describe('blendOverlay', () => {
  it('light backdrop: screen mode', () => {
    const [r] = blendOverlay(0.8, 0.8, 0.8, 0.5, 0.5, 0.5);
    expect(r).toBeGreaterThanOrEqual(0.8);
  });

  it('dark backdrop: multiply mode', () => {
    const [r] = blendOverlay(0.3, 0.3, 0.3, 0.5, 0.5, 0.5);
    expect(r).toBeLessThanOrEqual(0.3);
  });
});

describe('blendDarken', () => {
  it('picks minimum per channel', () => {
    const [r, g, b] = blendDarken(0.8, 0.3, 0.6, 0.4, 0.7, 0.5);
    expect(r).toBeCloseTo(0.4);
    expect(g).toBeCloseTo(0.3);
    expect(b).toBeCloseTo(0.5);
  });
});

describe('blendLighten', () => {
  it('picks maximum per channel', () => {
    const [r, g, b] = blendLighten(0.8, 0.3, 0.6, 0.4, 0.7, 0.5);
    expect(r).toBeCloseTo(0.8);
    expect(g).toBeCloseTo(0.7);
    expect(b).toBeCloseTo(0.6);
  });
});

describe('blendColorDodge', () => {
  it('light source dodges dark backdrop', () => {
    const [r] = blendColorDodge(0.5, 0.5, 0.5, 0.8, 0.8, 0.8);
    expect(r).toBeGreaterThan(0.5);
  });

  it('white source is white result', () => {
    const [r] = blendColorDodge(0.3, 0.3, 0.3, 1, 1, 1);
    expect(r).toBeCloseTo(1);
  });

  it('black backdrop stays black', () => {
    const [r] = blendColorDodge(0, 0, 0, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0);
  });
});

describe('blendColorBurn', () => {
  it('dark source burns backdrop', () => {
    const [r] = blendColorBurn(0.7, 0.7, 0.7, 0.3, 0.3, 0.3);
    expect(r).toBeLessThan(0.7);
  });

  it('black source is black result', () => {
    const [r] = blendColorBurn(0.8, 0.8, 0.8, 0, 0, 0);
    expect(r).toBeCloseTo(0);
  });

  it('white backdrop stays white', () => {
    const [r] = blendColorBurn(1, 1, 1, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(1);
  });
});

describe('blendHardLight', () => {
  it('source < 0.5: multiply', () => {
    const [r, g, b] = blendHardLight(0.8, 0.6, 0.4, 0.3, 0.3, 0.3);
    expect(r).toBeCloseTo(2 * 0.8 * 0.3);
    expect(g).toBeCloseTo(2 * 0.6 * 0.3);
    expect(b).toBeCloseTo(2 * 0.4 * 0.3);
  });

  it('source > 0.5: screen', () => {
    const [r, g, b] = blendHardLight(0.3, 0.3, 0.3, 0.7, 0.7, 0.7);
    expect(r).toBeCloseTo(1 - 2 * (1 - 0.3) * (1 - 0.7));
    expect(g).toBeCloseTo(1 - 2 * (1 - 0.3) * (1 - 0.7));
    expect(b).toBeCloseTo(1 - 2 * (1 - 0.3) * (1 - 0.7));
  });
});

describe('blendSoftLight', () => {
  it('mid-gray source is identity', () => {
    const [r, g, b] = blendSoftLight(0.4, 0.6, 0.8, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0.4, 0);
    expect(g).toBeCloseTo(0.6, 0);
    expect(b).toBeCloseTo(0.8, 0);
  });
});

describe('blendDifference', () => {
  it('computes absolute difference', () => {
    const [r, g, b] = blendDifference(0.8, 0.3, 0.6, 0.3, 0.7, 0.2);
    expect(r).toBeCloseTo(0.5);
    expect(g).toBeCloseTo(0.4);
    expect(b).toBeCloseTo(0.4);
  });

  it('white - black = 1', () => {
    const [r] = blendDifference(1, 1, 1, 0, 0, 0);
    expect(r).toBeCloseTo(1);
  });

  it('same color is zero', () => {
    const [r, g, b] = blendDifference(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });
});

describe('blendExclusion', () => {
  it('computes Cs + Cb - 2*Cs*Cb', () => {
    const [r] = blendExclusion(0.6, 0.6, 0.6, 0.4, 0.4, 0.4);
    expect(r).toBeCloseTo(0.6 + 0.4 - 2 * 0.6 * 0.4);
  });

  it('black is identity', () => {
    const [r, g, b] = blendExclusion(0.5, 0.3, 0.7, 0, 0, 0);
    expect(r).toBeCloseTo(0.5);
    expect(g).toBeCloseTo(0.3);
    expect(b).toBeCloseTo(0.7);
  });
});

describe('blendPlusDarker', () => {
  it('sum - 1 clamped to 0', () => {
    const [r] = blendPlusDarker(0.3, 0.3, 0.3, 0.4, 0.4, 0.4);
    expect(r).toBeCloseTo(0);
  });

  it('darkens when sum < 1', () => {
    const [r] = blendPlusDarker(0.3, 0.3, 0.3, 0.2, 0.2, 0.2);
    expect(r).toBeCloseTo(0);
  });
});

describe('blendPlusLighter', () => {
  it('sum clamped to 1', () => {
    const [r] = blendPlusLighter(0.6, 0.6, 0.6, 0.6, 0.6, 0.6);
    expect(r).toBeCloseTo(1);
  });

  it('additive < 1', () => {
    const [r] = blendPlusLighter(0.3, 0.3, 0.3, 0.4, 0.4, 0.4);
    expect(r).toBeCloseTo(0.7);
  });
});

// ── Non-separable blend modes ────────────────────────────────────────────────

describe('non-separable (W3C)', () => {
  it('blendHueW3C preserves backdrop luminosity', () => {
    const gray = [0.5, 0.5, 0.5] as const;
    const red = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendHueW3C(gray[0], gray[1], gray[2], red[0], red[1], red[2]);
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    expect(lum).toBeCloseTo(0.5, 1);
  });

  it('blendSaturationW3C transfers saturation', () => {
    const backdrop = [0.6, 0.3, 0.5] as const;
    const red = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendSaturationW3C(
      backdrop[0],
      backdrop[1],
      backdrop[2],
      red[0],
      red[1],
      red[2],
    );
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    expect(s).toBeGreaterThan(0);
    const lResult = 0.3 * r + 0.59 * g + 0.11 * b;
    const lBackdrop = 0.3 * backdrop[0] + 0.59 * backdrop[1] + 0.11 * backdrop[2];
    expect(lResult).toBeCloseTo(lBackdrop, 1);
  });

  it('blendColorW3C transfers hue and saturation', () => {
    const gray = [0.5, 0.5, 0.5] as const;
    const red = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendColorW3C(gray[0], gray[1], gray[2], red[0], red[1], red[2]);
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    expect(lum).toBeCloseTo(0.5, 1);
    expect(r).toBeGreaterThan(g);
  });

  it('blendLuminosityW3C transfers luminance', () => {
    const dark = [0.2, 0.2, 0.2] as const;
    const bright = [0.8, 0.8, 0.8] as const;
    const [r, g, b] = blendLuminosityW3C(
      dark[0],
      dark[1],
      dark[2],
      bright[0],
      bright[1],
      bright[2],
    );
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    expect(lum).toBeGreaterThan(0.5);
  });
});

// ── blend() with alpha compositing ───────────────────────────────────────────

describe('blend (unified)', () => {
  for (const testCase of BLEND_CONFORMANCE_CASES) {
    it(testCase.name, () => {
      const actual = blend(testCase.backdrop, testCase.source, testCase.mode, testCase.opacity);
      for (const [channel, expected] of testCase.expected.entries()) {
        expect(actual[channel]).toBeCloseTo(expected, 8);
      }
    });
  }

  it('opaque normal: source over backdrop', () => {
    const [r, g, b, a] = blend([0.5, 0.3, 0.7, 1], [0.2, 0.8, 0.4, 1], 'normal', 1);
    expect(r).toBeCloseTo(0.2);
    expect(g).toBeCloseTo(0.8);
    expect(b).toBeCloseTo(0.4);
    expect(a).toBeCloseTo(1);
  });

  it('transparent source leaves backdrop', () => {
    const [r, g, b, a] = blend([0.5, 0.5, 0.5, 1], [1, 0, 0, 0], 'normal', 1);
    expect(r).toBeCloseTo(0.5);
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.5);
    expect(a).toBeCloseTo(1);
  });

  it('transparent backdrop shows source', () => {
    const [r, g, b, a] = blend([0, 0, 0, 0], [0.3, 0.6, 0.9, 0.8], 'normal', 1);
    expect(r).toBeCloseTo(0.3, 0);
    expect(g).toBeCloseTo(0.6, 0);
    expect(b).toBeCloseTo(0.9, 0);
    expect(a).toBeCloseTo(0.8, 0);
  });

  it('canonicalizes fully transparent standard-mode output', () => {
    const actual = blend([0.8, 0.2, 0.1, 0], [0.2, 0.4, 0.6, 0], 'screen', 1);
    expect(actual).toEqual([0, 0, 0, 0]);
  });

  it('partial opacity blends', () => {
    const [r, g, b, a] = blend([0, 0, 0, 1], [1, 1, 1, 1], 'normal', 0.5);
    expect(r).toBeCloseTo(0.5, 1);
    expect(g).toBeCloseTo(0.5, 1);
    expect(b).toBeCloseTo(0.5, 1);
    expect(a).toBeCloseTo(1);
  });

  it('multiply with partial opacity', () => {
    const [r] = blend([0.8, 0.3, 0.5, 1], [0.5, 0.5, 0.5, 0.5], 'multiply', 1);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.8);
  });

  it('rejects an unknown blend mode', () => {
    expect(() => blend([1, 0, 0, 1], [0, 0, 1, 1], 'mystery', 1)).toThrow(
      'Unsupported blend mode: mystery',
    );
  });

  it.each(['passThrough', 'plusDarker'])(
    'rejects non-pixel or unsupported %s before transparent-pixel early returns',
    (mode) => {
      expect(() => blend([0, 0, 0, 0], [0, 0, 0, 0], mode, 1)).toThrow(
        `Unsupported blend mode: ${mode}`,
      );
    },
  );

  it('composites plusLighter in premultiplied space', () => {
    const actual = blend([1, 0, 0, 0.5], [0, 0, 1, 0.5], 'plusLighter', 1);
    expect(actual).toEqual([0.5, 0, 0.5, 1]);
  });

  it('canonicalizes fully transparent plusLighter output', () => {
    const actual = blend([1, 0, 0, 0], [0, 0, 1, 0], 'plusLighter', 1);
    expect(actual).toEqual([0, 0, 0, 0]);
  });

  it('applies opacity to plusLighter source alpha', () => {
    const actual = blend([1, 0, 0, 0.5], [0, 0, 1, 0.5], 'plusLighter', 0.5);
    expect(actual[0]).toBeCloseTo(2 / 3, 8);
    expect(actual[1]).toBe(0);
    expect(actual[2]).toBeCloseTo(1 / 3, 8);
    expect(actual[3]).toBeCloseTo(0.75, 8);
  });
});

// ── Linear-light blending (physically correct) ───────────────────────────────

describe('blend evaluation space', () => {
  it('multiply in linear space differs from gamma space', () => {
    // sRGB 0.5 × 0.5 in gamma = 0.25
    // sRGB 0.5 → linear ~0.214, × = 0.0458, → sRGB ~0.237
    const gamma = blend([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'multiply', 1, 'legacy-srgb');
    const linear = blend([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'multiply', 1, 'linear-srgb');
    // Linear multiply is darker than gamma multiply (0.237 < 0.25)
    expect(linear[0]).toBeLessThan(gamma[0]);
    expect(linear[0]).toBeCloseTo(0.237, 2);
  });

  it('screen in linear space differs from gamma space', () => {
    // Gamma screen of 0.5,0.5 = 1 - 0.5*0.5 = 0.75
    // Linear: sRGB 0.5 → lin 0.214, screen = 1-(1-0.214)^2 = 0.382, → sRGB 0.652
    const gamma = blend([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'screen', 1, 'legacy-srgb');
    const linear = blend([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'screen', 1, 'linear-srgb');
    // Linear screen is darker than gamma screen for midtones (0.652 < 0.75)
    expect(linear[0]).toBeLessThan(gamma[0]);
    expect(linear[0]).toBeCloseTo(0.652, 2);
  });

  it('linear light normal mode produces same result as gamma (normal is identity)', () => {
    // Normal mode ignores backdrop; linearize shouldn't change it
    const gamma = blend([0.2, 0.4, 0.6, 1], [0.8, 0.3, 0.1, 1], 'normal', 1, 'legacy-srgb');
    const linear = blend([0.2, 0.4, 0.6, 1], [0.8, 0.3, 0.1, 1], 'normal', 1, 'linear-srgb');
    expect(linear[0]).toBeCloseTo(gamma[0], 10);
    expect(linear[1]).toBeCloseTo(gamma[1], 10);
    expect(linear[2]).toBeCloseTo(gamma[2], 10);
  });

  it('linear multiply of black backdrop remains black', () => {
    // Multiply with black (0) in any space = 0
    const linear = blend([0, 0, 0, 1], [0.8, 0.3, 0.1, 1], 'multiply', 1, 'linear-srgb');
    expect(linear[0]).toBe(0);
    expect(linear[1]).toBe(0);
    expect(linear[2]).toBe(0);
  });

  it('linear multiply of white backdrop returns source', () => {
    // Multiply with white (1) in any space = source. The linearize path
    // decodes source to linear, multiplies by backdrop-linear (1), and
    // re-encodes — net result is the original source value.
    const linear = blend([1, 1, 1, 1], [0.3, 0.6, 0.9, 1], 'multiply', 1, 'linear-srgb');
    expect(linear[0]).toBeCloseTo(0.3, 1);
    expect(linear[1]).toBeCloseTo(0.6, 1);
    expect(linear[2]).toBeCloseTo(0.9, 1);
  });

  it('preserves alpha in linear mode', () => {
    const linear = blend([0.5, 0.5, 0.5, 0.8], [0.5, 0.5, 0.5, 0.4], 'multiply', 1, 'linear-srgb');
    // ao = sa + ba * (1 - sa) = 0.4 + 0.8 * 0.6 = 0.88
    expect(linear[3]).toBeCloseTo(0.88, 5);
  });

  it('legacy encoded sRGB is the default (backward compat)', () => {
    // Same inputs, explicit false should match no-arg call
    const default_ = blend([0.5, 0.3, 0.7, 1], [0.2, 0.8, 0.4, 1], 'multiply', 1);
    const explicit = blend([0.5, 0.3, 0.7, 1], [0.2, 0.8, 0.4, 1], 'multiply', 1, 'legacy-srgb');
    expect(explicit).toEqual(default_);
  });

  it('keeps non-separable W3C modes encoded when linear is requested', () => {
    const legacy = blend([0.2, 0.4, 0.6, 1], [0.8, 0.3, 0.1, 1], 'hue', 1, 'legacy-srgb');
    const requestedLinear = blend([0.2, 0.4, 0.6, 1], [0.8, 0.3, 0.1, 1], 'hue', 1, 'linear-srgb');
    expect(requestedLinear).toEqual(legacy);
  });
});

// ── blendPixels (ImageData) ──────────────────────────────────────────────────

describe('blendPixels', () => {
  it('normal mode copies source over backdrop', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 50, 255);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(50);
  });

  it('multiply produces darker result', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'multiply', 1);
    expect(result.data[0]).toBeLessThan(150);
  });

  it('screen produces lighter result', () => {
    const backdrop = makePixelData(50, 50, 50, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'screen', 1);
    expect(result.data[0]).toBeGreaterThan(100);
  });

  it('difference returns absolute difference', () => {
    const backdrop = makePixelData(200, 100, 50, 255);
    const source = makePixelData(100, 200, 30, 255);
    const result = blendPixels(backdrop, source, 'difference', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(20);
  });

  it('overlay preserves highlights and shadows', () => {
    const light = makePixelData(200, 200, 200, 255);
    const dark = makePixelData(100, 100, 100, 255);
    const gray = makePixelData(128, 128, 128, 255);
    const resultLight = blendPixels(light, gray, 'overlay', 1);
    const resultDark = blendPixels(dark, gray, 'overlay', 1);
    expect(resultLight.data[0]).toBeGreaterThanOrEqual(200);
    expect(resultDark.data[0]).toBeLessThanOrEqual(100);
  });

  it('colorBurn darkens backdrop', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'colorBurn', 1);
    expect(result.data[0]).toBeLessThan(150);
  });

  it('colorDodge lightens backdrop', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 200, 200, 255);
    const result = blendPixels(backdrop, source, 'colorDodge', 1);
    expect(result.data[0]).toBeGreaterThan(150);
  });

  it('hardLight combines multiply and screen', () => {
    const backdrop = makePixelData(128, 128, 128, 255);
    const dark = makePixelData(64, 64, 64, 255);
    const light = makePixelData(192, 192, 192, 255);
    const resultDark = blendPixels(backdrop, dark, 'hardLight', 1);
    const resultLight = blendPixels(backdrop, light, 'hardLight', 1);
    expect(resultDark.data[0]).toBeLessThan(128);
    expect(resultLight.data[0]).toBeGreaterThan(128);
  });

  it('softLight uses W3C formula', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(128, 128, 128, 255);
    const result = blendPixels(backdrop, source, 'softLight', 1);
    expect(result.data[0]).toBeCloseTo(100, 0);
  });

  it('darken picks minimum per channel', () => {
    const backdrop = makePixelData(200, 50, 150, 255);
    const source = makePixelData(100, 100, 200, 255);
    const result = blendPixels(backdrop, source, 'darken', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(50);
    expect(result.data[2]).toBe(150);
  });

  it('lighten picks maximum per channel', () => {
    const backdrop = makePixelData(200, 50, 150, 255);
    const source = makePixelData(100, 100, 200, 255);
    const result = blendPixels(backdrop, source, 'lighten', 1);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(200);
  });

  it('exclusion produces lower contrast difference', () => {
    const backdrop = makePixelData(200, 100, 50, 255);
    const source = makePixelData(100, 200, 30, 255);
    const result = blendPixels(backdrop, source, 'exclusion', 1);
    expect(result.data[0]).toBeLessThan(200);
    expect(result.data[0]).toBeGreaterThan(0);
  });

  it('rejects plusDarker as a legacy non-pixel mode', () => {
    const backdrop = makePixelData(128, 128, 128, 255);
    const source = makePixelData(128, 128, 128, 255);
    expect(() => blendPixels(backdrop, source, 'plusDarker', 1)).toThrow(
      'Unsupported blend mode: plusDarker',
    );
  });

  it('plusLighter adds clamped', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'plusLighter', 1);
    expect(result.data[0]).toBe(255);
  });

  it('transparent source leaves backdrop unchanged', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(255, 0, 0, 0);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(100);
  });

  it('transparent backdrop composites with source', () => {
    const backdrop = makePixelData(0, 0, 0, 0);
    const source = makePixelData(100, 150, 200, 255);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[3]).toBe(255);
  });

  it('opacity 0.5 produces semi-transparent result', () => {
    const backdrop = makePixelData(0, 0, 0, 255);
    const source = makePixelData(255, 255, 255, 255);
    const result = blendPixels(backdrop, source, 'normal', 0.5);
    expect(result.data[0]).toBeGreaterThan(100);
    expect(result.data[0]).toBeLessThan(200);
  });

  it('hue blend mode preserves some color', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 50, 255);
    const result = blendPixels(backdrop, source, 'hue', 1);
    expect(result.data[0]).toBeGreaterThan(0);
    expect(result.data[3]).toBe(255);
  });

  it('saturation blend mode works', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(50, 200, 50, 255);
    const result = blendPixels(backdrop, source, 'saturation', 1);
    expect(result.data[3]).toBe(255);
  });

  it('color blend mode transfers hue and saturation', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 150, 255);
    const result = blendPixels(backdrop, source, 'color', 1);
    expect(result.data[3]).toBe(255);
  });

  it('luminosity blend mode transfers luma', () => {
    const backdrop = makePixelData(200, 50, 50, 255);
    const source = makePixelData(50, 100, 150, 255);
    const result = blendPixels(backdrop, source, 'luminosity', 1);
    expect(result.data[3]).toBe(255);
  });

  it('handles both transparent (alpha 0)', () => {
    const backdrop = makePixelData(204, 51, 26, 0);
    const source = makePixelData(51, 102, 153, 0);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(Array.from(result.data)).toEqual([0, 0, 0, 0]);
  });

  it('handles all supported pixel blend modes without error', () => {
    const b = makePixelData(100, 100, 100, 255);
    const s = makePixelData(200, 50, 50, 200);
    const modes = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'colorDodge',
      'colorBurn',
      'hardLight',
      'softLight',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
      'plusLighter',
    ];
    for (const mode of modes) {
      const result = blendPixels(b, s, mode, 1);
      expect(result.data[3]).toBeGreaterThanOrEqual(0);
    }
  });
});
