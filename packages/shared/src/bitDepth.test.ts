import { describe, expect, it } from 'vitest';
import type { BitDepth } from './colorConversion';
import {
  channelMax,
  clampChannel,
  DEFAULT_BIT_DEPTH,
  denormalizeChannel,
  normalizeChannel,
} from './colorConversion';

describe('BitDepth', () => {
  it('DEFAULT_BIT_DEPTH is uint8 for backward compat', () => {
    expect(DEFAULT_BIT_DEPTH).toBe('uint8');
  });

  describe('channelMax', () => {
    it('returns 255 for uint8', () => {
      expect(channelMax('uint8')).toBe(255);
    });

    it('returns 65535 for uint16', () => {
      expect(channelMax('uint16')).toBe(65535);
    });

    it('returns 1 for float depths', () => {
      expect(channelMax('float16')).toBe(1);
      expect(channelMax('float32')).toBe(1);
    });
  });

  describe('normalizeChannel', () => {
    it('divides by 255 for uint8', () => {
      expect(normalizeChannel(0, 'uint8')).toBe(0);
      expect(normalizeChannel(255, 'uint8')).toBe(1);
      expect(normalizeChannel(128, 'uint8')).toBeCloseTo(0.50196, 4);
    });

    it('divides by 65535 for uint16', () => {
      expect(normalizeChannel(0, 'uint16')).toBe(0);
      expect(normalizeChannel(65535, 'uint16')).toBe(1);
      expect(normalizeChannel(32768, 'uint16')).toBeCloseTo(0.5000076, 4);
    });

    it('clamps to [0,1] for float depths', () => {
      expect(normalizeChannel(0, 'float32')).toBe(0);
      expect(normalizeChannel(1, 'float32')).toBe(1);
      expect(normalizeChannel(0.5, 'float16')).toBe(0.5);
    });

    it('clamps HDR values > 1 to 1', () => {
      expect(normalizeChannel(1.5, 'float32')).toBe(1);
      expect(normalizeChannel(2.0, 'float16')).toBe(1);
    });

    it('clamps out-of-range values for float depths', () => {
      expect(normalizeChannel(-0.5, 'float32')).toBe(0);
    });

    it('does not clamp integer depths (linear map only — use clampChannel for clamping)', () => {
      // uint8 normalize is pure division; negatives produce negatives
      expect(normalizeChannel(-1, 'uint8')).toBeCloseTo(-0.00392, 4);
    });
  });

  describe('denormalizeChannel', () => {
    it('multiplies by 255 and rounds for uint8', () => {
      expect(denormalizeChannel(0, 'uint8')).toBe(0);
      expect(denormalizeChannel(1, 'uint8')).toBe(255);
      expect(denormalizeChannel(0.5, 'uint8')).toBe(128);
    });

    it('multiplies by 65535 and rounds for uint16', () => {
      expect(denormalizeChannel(0, 'uint16')).toBe(0);
      expect(denormalizeChannel(1, 'uint16')).toBe(65535);
      expect(denormalizeChannel(0.5, 'uint16')).toBe(32768);
    });

    it('returns float values as-is for float depths', () => {
      expect(denormalizeChannel(0.5, 'float32')).toBe(0.5);
      expect(denormalizeChannel(0.25, 'float16')).toBe(0.25);
    });
  });

  describe('clampChannel', () => {
    it('clamps uint8 to [0, 255]', () => {
      expect(clampChannel(-1, 'uint8')).toBe(0);
      expect(clampChannel(0, 'uint8')).toBe(0);
      expect(clampChannel(255, 'uint8')).toBe(255);
      expect(clampChannel(300, 'uint8')).toBe(255);
      expect(clampChannel(128.7, 'uint8')).toBe(129);
    });

    it('clamps uint16 to [0, 65535]', () => {
      expect(clampChannel(-1, 'uint16')).toBe(0);
      expect(clampChannel(65535, 'uint16')).toBe(65535);
      expect(clampChannel(70000, 'uint16')).toBe(65535);
    });

    it('allows extended range for float depths', () => {
      expect(clampChannel(1.5, 'float32')).toBe(1.5);
      expect(clampChannel(-0.2, 'float32')).toBe(-0.2);
    });

    it('treats NaN and Infinity as 0', () => {
      expect(clampChannel(NaN, 'uint8')).toBe(0);
      expect(clampChannel(Infinity, 'uint16')).toBe(0);
      expect(clampChannel(-Infinity, 'float32')).toBe(0);
      expect(clampChannel(NaN, 'float32')).toBe(0);
    });
  });

  describe('round-trip precision', () => {
    it('uint8 round-trips exact values', () => {
      for (const v of [0, 1, 127, 128, 254, 255]) {
        expect(denormalizeChannel(normalizeChannel(v, 'uint8'), 'uint8')).toBe(v);
      }
    });

    it('uint16 round-trips values within its precision', () => {
      for (const v of [0, 1, 32767, 32768, 65534, 65535]) {
        expect(denormalizeChannel(normalizeChannel(v, 'uint16'), 'uint16')).toBe(v);
      }
    });

    it('float round-trips preserves sub-8-bit precision', () => {
      const v = 1 / 512; // smaller than 1/255
      expect(denormalizeChannel(normalizeChannel(v, 'float32'), 'float32')).toBe(v);
    });

    it('uint8 cannot represent sub-8-bit precision (quantization)', () => {
      // 0.5 / 255 is lost when round-tripped through uint8
      const sub = 0.5 / 255;
      expect(denormalizeChannel(normalizeChannel(sub, 'uint8'), 'uint8')).toBe(0);
    });
  });

  describe('cross-depth conversion accuracy', () => {
    it('uint16 mid-gray normalizes to same as uint8 mid-gray', () => {
      const u8 = normalizeChannel(128, 'uint8');
      const u16 = normalizeChannel(32768, 'uint16');
      expect(u8).toBeCloseTo(u16, 2);
    });

    it('float32 0.5 denormalizes to uint8 128', () => {
      expect(denormalizeChannel(0.5, 'uint8')).toBe(128);
    });

    it('float32 0.5 denormalizes to uint16 32768', () => {
      expect(denormalizeChannel(0.5, 'uint16')).toBe(32768);
    });
  });
});

describe('BitDepth compile-time checks', () => {
  it('all four bit depths are valid', () => {
    const depths: BitDepth[] = ['uint8', 'uint16', 'float16', 'float32'];
    expect(depths).toHaveLength(4);
  });
});
