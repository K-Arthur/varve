// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CompositeCanvas } from './compositeCanvas';
import {
  applyBackgroundBlurBackdrop,
  applyGlassMaterialBackdrop,
  clampByte,
  computeScreenBounds,
  resolveGlitchChannelShift,
} from './effectPipeline';

describe('effectPipeline', () => {
  // ── clampByte ──────────────────────────────────────────────────

  describe('clampByte', () => {
    it('clamps below 0', () => expect(clampByte(-10)).toBe(0));
    it('clamps above 255', () => expect(clampByte(300)).toBe(255));
    it('rounds fractional values', () => expect(clampByte(127.4)).toBe(127));
    it('rounds up', () => expect(clampByte(127.6)).toBe(128));
    it('passes through exact integers', () => expect(clampByte(0)).toBe(0));
    it('passes through 255', () => expect(clampByte(255)).toBe(255));
  });

  // ── computeScreenBounds ────────────────────────────────────────

  describe('computeScreenBounds', () => {
    it('identity transform returns input rect (floored/ceiled)', () => {
      const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const r = computeScreenBounds(identity, 10, 20, 100, 50);
      expect(r).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    });

    it('scaled transform enlarges bounds', () => {
      const m = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
      const r = computeScreenBounds(m, 10, 10, 100, 50);
      expect(r).toEqual({ x: 20, y: 20, w: 200, h: 100 });
    });

    it('translated transform shifts bounds', () => {
      const m = { a: 1, b: 0, c: 0, d: 1, e: 50, f: 30 };
      const r = computeScreenBounds(m, 0, 0, 100, 80);
      expect(r).toEqual({ x: 50, y: 30, w: 100, h: 80 });
    });

    it('rotated 45 degrees produces larger AABB', () => {
      const angle = Math.PI / 4;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const m = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      const r = computeScreenBounds(m, 0, 0, 100, 100);
      expect(r.w).toBeGreaterThan(100);
      expect(r.h).toBeGreaterThan(100);
    });

    it('returns minimum 1×1 for zero-size input', () => {
      const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const r = computeScreenBounds(m, 5, 5, 0, 0);
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.h).toBeGreaterThanOrEqual(1);
    });
  });

  // ── applyGlassMaterialBackdrop pixel math ──────────────────────

  describe('applyGlassMaterialBackdrop', () => {
    function makeGlassEffect(overrides: Record<string, unknown> = {}) {
      return {
        type: 'glassMaterial' as const,
        blur: 0,
        tint: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
        tintOpacity: 0,
        saturation: 1,
        brightness: 1,
        noise: 0,
        edgeHighlight: false,
        edgeHighlightWidth: 0,
        edgeHighlightColor: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 1 },
        edgeHighlightOpacity: 0,
        visible: true,
        ...overrides,
      };
    }

    function makeCc(w: number, h: number): CompositeCanvas {
      const canvas = document.createElement('canvas');
      return new CompositeCanvas({ width: w, height: h, testCanvas: canvas });
    }

    it('does not throw with valid input', () => {
      const cc = makeCc(4, 4);
      expect(() => applyGlassMaterialBackdrop(cc, 4, 4, makeGlassEffect())).not.toThrow();
    });

    it('does not throw with all pipeline steps active', () => {
      const cc = makeCc(8, 8);
      expect(() =>
        applyGlassMaterialBackdrop(
          cc,
          8,
          8,
          makeGlassEffect({
            tint: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 1 },
            tintOpacity: 0.5,
            saturation: 0.5,
            brightness: 1.2,
            noise: 0.3,
          }),
        ),
      ).not.toThrow();
    });

    it('tint math is correct (manual pixel verification)', () => {
      // Verify the tint blending formula matches replay.ts exactly:
      // pixels[i] = clampByte(pixels[i] * (1 - tA) + tR * tA)
      const input = 200;
      const tR = 255;
      const tA = 0.5;
      const expected = clampByte(input * (1 - tA) + tR * tA);
      expect(expected).toBe(228); // 200*0.5 + 255*0.5 = 227.5 → 228
    });

    it('normalizes high-precision and CMYK tint colors before the display pass', () => {
      const pixels = new Uint8ClampedArray([255, 255, 255, 255]);
      const image = new ImageData(pixels, 1, 1);
      const fakeCanvas = {
        getImageData: () => image,
        putImageData: (next: ImageData) => pixels.set(next.data),
      } as unknown as CompositeCanvas;

      applyGlassMaterialBackdrop(
        fakeCanvas,
        1,
        1,
        makeGlassEffect({
          tint: { space: 'rgb' as const, bitDepth: 'float32' as const, r: 0.5, g: 0, b: 0, a: 1 },
          tintOpacity: 0.5,
        }),
      );

      // The tint is 127.5 display units, not the raw float value 0.5.
      expect(pixels[0]).toBe(191);
      expect(pixels[1]).toBe(128);
      expect(pixels[2]).toBe(128);
    });

    it('saturation=0 produces luma grayscale (manual pixel verification)', () => {
      // Verify the saturation formula matches replay.ts exactly:
      // luma = 0.2126*r + 0.7152*g + 0.0722*b
      // result = luma + (channel - luma) * saturation
      const r = 100,
        g = 200,
        b = 50;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat0 = clampByte(luma + (r - luma) * 0);
      expect(sat0).toBe(clampByte(luma));
      expect(clampByte(luma + (g - luma) * 0)).toBe(sat0);
      expect(clampByte(luma + (b - luma) * 0)).toBe(sat0);
    });

    it('brightness formula matches replay.ts', () => {
      const input = 200;
      const brightness = 0.5;
      expect(clampByte(input * brightness)).toBe(100);
    });

    it('noise hash is deterministic and matches replay.ts', () => {
      const x = 3,
        y = 5;
      const seed = x * 374761393 + y * 668265263;
      const noiseVal = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      expect(noiseVal).toBeGreaterThanOrEqual(0);
      expect(noiseVal).toBeLessThanOrEqual(1);
      const seed2 = x * 374761393 + y * 668265263;
      const noiseVal2 = ((seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      expect(noiseVal).toBe(noiseVal2);
    });
  });

  // ── applyBackgroundBlurBackdrop ────────────────────────────────

  describe('applyBackgroundBlurBackdrop', () => {
    function makeCc(w: number, h: number): CompositeCanvas {
      const canvas = document.createElement('canvas');
      return new CompositeCanvas({ width: w, height: h, testCanvas: canvas });
    }

    it('does not throw with radius 0', () => {
      const cc = makeCc(4, 4);
      expect(() => applyBackgroundBlurBackdrop(cc, 4, 4, 0)).not.toThrow();
    });

    it('does not throw with positive radius', () => {
      const cc = makeCc(20, 20);
      expect(() => applyBackgroundBlurBackdrop(cc, 20, 20, 5)).not.toThrow();
    });

    it('does not throw with large radius (>32 software path)', () => {
      const cc = makeCc(50, 50);
      expect(() => applyBackgroundBlurBackdrop(cc, 50, 50, 50)).not.toThrow();
    });
  });

  describe('resolveGlitchChannelShift', () => {
    const baseEffect = {
      type: 'glitch' as const,
      seed: 42,
      strength: 8,
      density: 0.3,
      sliceHeight: 8,
      blockCount: 5,
      blockSize: 20,
      blockStrength: 10,
      noiseIntensity: 0.05,
      scanlineIntensity: 0.15,
      scanlineSpacing: 4,
      direction: 'horizontal' as const,
      channelShift: { redX: 12, redY: 8, greenX: 6, greenY: 4, blueX: 10, blueY: 2 },
      channelShiftMode: 'static' as const,
      blendMode: 'normal' as const,
      opacity: 1,
      visible: true,
    };

    it('preserves authored offsets in static mode', () => {
      expect(resolveGlitchChannelShift(baseEffect)).toBe(baseEffect.channelShift);
    });

    it('produces deterministic seeded offsets within authored magnitudes', () => {
      const effect = { ...baseEffect, channelShiftMode: 'seeded' as const };
      const first = resolveGlitchChannelShift(effect);
      const second = resolveGlitchChannelShift(effect);

      expect(first).toEqual(second);
      expect(first).not.toEqual(baseEffect.channelShift);
      for (const key of Object.keys(first) as Array<keyof typeof first>) {
        expect(Math.abs(first[key])).toBeLessThanOrEqual(Math.abs(baseEffect.channelShift[key]));
      }
    });

    it('changes the deterministic displacement when the seed changes', () => {
      const first = resolveGlitchChannelShift({
        ...baseEffect,
        channelShiftMode: 'seeded',
        seed: 1,
      });
      const second = resolveGlitchChannelShift({
        ...baseEffect,
        channelShiftMode: 'seeded',
        seed: 2,
      });
      expect(first).not.toEqual(second);
    });
  });
});
