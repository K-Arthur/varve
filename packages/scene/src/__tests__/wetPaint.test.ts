import { describe, expect, it } from 'vitest';
import { WetBuffer, wetEdgeDarkening } from '../wetPaint';

describe('WetBuffer', () => {
  it('creates a buffer with the given dimensions', () => {
    const buf = new WetBuffer(100, 100);
    expect(buf.width).toBe(100);
    expect(buf.height).toBe(100);
    expect(buf.pixels.length).toBe(100 * 100 * 4);
    expect(buf.wetness.length).toBe(100 * 100);
  });

  it('returns null for out-of-bounds access', () => {
    const buf = new WetBuffer(10, 10);
    expect(buf.get(-1, 0)).toBeNull();
    expect(buf.get(0, -1)).toBeNull();
    expect(buf.get(10, 0)).toBeNull();
    expect(buf.get(0, 10)).toBeNull();
  });

  it('get/set round-trips correctly', () => {
    const buf = new WetBuffer(10, 10);
    buf.set(3, 4, { wetness: 0.5, r: 0.2, g: 0.4, b: 0.6, a: 0.8 });
    const result = buf.get(3, 4);
    expect(result).not.toBeNull();
    expect(result!.wetness).toBeCloseTo(0.5);
    expect(result!.r).toBeCloseTo(0.2);
    expect(result!.g).toBeCloseTo(0.4);
    expect(result!.b).toBeCloseTo(0.6);
    expect(result!.a).toBeCloseTo(0.8);
  });

  it('addPaint increases wetness', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 0, 0, 255], 0.5, 0);
    const result = buf.get(5, 5);
    expect(result).not.toBeNull();
    expect(result!.wetness).toBeGreaterThan(0);
  });

  it('addPaint caps wetness at 1', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 0, 0, 255], 2.0, 0);
    const result = buf.get(5, 5);
    expect(result!.wetness).toBe(1);
  });

  it('addPaint mixes with existing wet paint', () => {
    const buf = new WetBuffer(10, 10);
    // Add red wet paint
    buf.addPaint(5, 5, [255, 0, 0, 255], 0.8, 0);
    // Add blue paint with mixing
    buf.addPaint(5, 5, [0, 0, 255, 255], 0.3, 0.5);
    const result = buf.get(5, 5);
    // Should be a mix of red and blue
    expect(result!.r).toBeGreaterThan(0);
    expect(result!.b).toBeGreaterThan(0);
  });

  it('dry reduces wetness over time', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 255, 255, 255], 1.0, 0);
    expect(buf.get(5, 5)!.wetness).toBe(1.0);

    buf.dry(1.0, 0.5); // 1 second at 0.5/s drying rate
    expect(buf.get(5, 5)!.wetness).toBeCloseTo(0.5, 5);

    buf.dry(2.0, 0.5); // Another 2 seconds
    expect(buf.get(5, 5)!.wetness).toBe(0); // Fully dry
  });

  it('dry with zero rate does nothing', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 255, 255, 255], 1.0, 0);
    buf.dry(100, 0);
    expect(buf.get(5, 5)!.wetness).toBe(1.0);
  });

  it('dry clears pixels when fully dry', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 100, 50, 200], 1.0, 0);
    expect(buf.get(5, 5)!.r).toBeGreaterThan(0);
    buf.dry(10, 1.0);
    const result = buf.get(5, 5);
    expect(result!.wetness).toBe(0);
  });

  it('clear resets all pixels', () => {
    const buf = new WetBuffer(10, 10);
    buf.addPaint(5, 5, [255, 255, 255, 255], 1.0, 0);
    buf.addPaint(0, 0, [128, 128, 128, 255], 0.5, 0);
    buf.clear();
    for (let i = 0; i < buf.wetness.length; i++) {
      expect(buf.wetness[i]).toBe(0);
    }
  });

  it('handles multiple pixels independently', () => {
    const buf = new WetBuffer(20, 20);
    buf.addPaint(5, 5, [255, 0, 0, 255], 0.8, 0);
    buf.addPaint(15, 15, [0, 0, 255, 255], 0.6, 0);

    expect(buf.get(5, 5)!.r).toBeGreaterThan(0);
    expect(buf.get(5, 5)!.b).toBe(0);
    expect(buf.get(15, 15)!.b).toBeGreaterThan(0);
    expect(buf.get(15, 15)!.r).toBe(0);
  });
});

describe('wetEdgeDarkening', () => {
  it('returns 0 inside the brush body', () => {
    expect(wetEdgeDarkening(0.5, 0.2, 0.3)).toBe(0);
    expect(wetEdgeDarkening(0.79, 0.2, 0.3)).toBe(0);
  });

  it('returns 0 at or beyond the brush edge', () => {
    expect(wetEdgeDarkening(1.0, 0.2, 0.3)).toBe(0);
    expect(wetEdgeDarkening(1.5, 0.2, 0.3)).toBe(0);
  });

  it('returns positive value in the edge region', () => {
    const edge = wetEdgeDarkening(0.9, 0.2, 0.5);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThanOrEqual(0.5);
  });

  it('returns maximum darkening at the outermost edge', () => {
    const edge = wetEdgeDarkening(0.99, 0.2, 0.5);
    expect(edge).toBeCloseTo(0.475, 2); // Approximately max
  });

  it('scales with darkenAmount', () => {
    const low = wetEdgeDarkening(0.9, 0.2, 0.2);
    const high = wetEdgeDarkening(0.9, 0.2, 0.8);
    expect(high).toBeGreaterThan(low);
  });
});
