/**
 * Color edge case tests: NaN/Infinity, transparent channels, HDR values,
 * profile assignment vs conversion.
 *
 * Research basis: IEEE 754, ADR-0009 bit depth model.
 */

import {
  clampChannel,
  denormalizeChannel,
  managedColorToRgba,
  normalizeChannel,
} from '@varve/shared';
import { describe, expect, it } from 'vitest';

// Use the shim types from @varve/shared for the color conversions
type RgbColorShim = {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
  bitDepth?: string;
  profile?: string;
};

describe('clampChannel — NaN/Infinity/negative', () => {
  it('clamps NaN to 0 for uint8', () => {
    expect(clampChannel(NaN, 'uint8')).toBe(0);
  });

  it('clamps Infinity to 0 for uint8', () => {
    expect(clampChannel(Infinity, 'uint8')).toBe(0);
  });

  it('clamps negative values to 0 for uint8', () => {
    expect(clampChannel(-10, 'uint8')).toBe(0);
  });

  it('clamps values above max to max for uint8', () => {
    expect(clampChannel(300, 'uint8')).toBe(255);
  });

  it('clamps NaN to 0 for uint16', () => {
    expect(clampChannel(NaN, 'uint16')).toBe(0);
  });

  it('clamps Infinity to 0 for uint16', () => {
    expect(clampChannel(Infinity, 'uint16')).toBe(0);
  });

  it('clamps negative values to 0 for uint16', () => {
    expect(clampChannel(-10, 'uint16')).toBe(0);
  });

  it('clamps values above max to max for uint16', () => {
    expect(clampChannel(100000, 'uint16')).toBe(65535);
  });
});

describe('clampChannel — float depths allow extended range', () => {
  it('allows HDR values > 1 for float32', () => {
    expect(clampChannel(1.5, 'float32')).toBe(1.5);
  });

  it('allows values > 1 for float16', () => {
    expect(clampChannel(2.0, 'float16')).toBe(2.0);
  });

  it('clamps NaN to 0 for float32', () => {
    expect(clampChannel(NaN, 'float32')).toBe(0);
  });

  it('clamps Infinity to 0 for float32', () => {
    expect(clampChannel(Infinity, 'float32')).toBe(0);
  });
});

describe('normalizeChannel — all depths', () => {
  it('correctly normalizes uint8 128 to 0.502', () => {
    expect(normalizeChannel(128, 'uint8')).toBeCloseTo(0.502, 3);
  });

  it('correctly normalizes uint16 32768 to 0.5', () => {
    expect(normalizeChannel(32768, 'uint16')).toBeCloseTo(0.5, 4);
  });

  it('passes through float32 values unchanged', () => {
    expect(normalizeChannel(0.5, 'float32')).toBe(0.5);
  });

  it('clamps float32 values above 1', () => {
    expect(normalizeChannel(1.5, 'float32')).toBe(1);
  });
});

describe('denormalizeChannel', () => {
  it('converts 0.5 to uint8 128', () => {
    expect(denormalizeChannel(0.5, 'uint8')).toBe(128);
  });

  it('converts 0.5 to uint16 32768', () => {
    expect(denormalizeChannel(0.5, 'uint16')).toBe(32768);
  });

  it('passes through float32 values unchanged', () => {
    expect(denormalizeChannel(0.5, 'float32')).toBe(0.5);
  });
});

describe('managedColorToRgba — transparent with hidden channels', () => {
  it('preserves non-zero RGB channels when alpha is 0', () => {
    const color: RgbColorShim = { space: 'rgb', r: 255, g: 128, b: 64, a: 0 };
    const rgba = managedColorToRgba(color as never as import('@varve/shared').ManagedColorShim);
    // The function's contract is to return the channels as-is (straight alpha)
    expect(rgba[0]).toBeGreaterThan(0);
  });

  it('handles spot color with full transparency', () => {
    const color = {
      space: 'spot' as const,
      name: 'PANTONE 185 C',
      tint: 100,
      a: 0,
      processFallback: { c: 0, m: 91, y: 76, k: 0 },
    };
    const rgba = managedColorToRgba(color as never);
    expect(rgba).toHaveLength(4);
  });
});

describe('managedColorToRgba — HDR extended range', () => {
  it('handles float32 color with r=1.5, g=2.0 (HDR extended)', () => {
    // WARNING: managedColorToRgba clamps to uint8, so values > 1 get clamped
    const color: RgbColorShim = { space: 'rgb', bitDepth: 'float32', r: 1.5, g: 2.0, b: 0.5, a: 1 };
    const rgba = managedColorToRgba(color as never as import('@varve/shared').ManagedColorShim);
    // The function clamps to 0-255, so 1.5 * 255 = 382.5 → 255
    expect(rgba[0]).toBe(255);
    expect(rgba[1]).toBe(255);
    expect(rgba[2]).toBe(128);
  });
});
