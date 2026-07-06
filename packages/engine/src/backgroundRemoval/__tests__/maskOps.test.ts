import { describe, expect, it } from 'vitest';
import { decontaminateMask, featherMaskArray } from '../maskOps';

describe('decontaminateMask', () => {
  it('leaves a fully binary mask unchanged', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = x < 5 ? 255 : 0;
      }
    }
    const result = decontaminateMask(mask, w, h);
    expect(Array.from(result)).toEqual(Array.from(mask));
  });

  it('chokes (shrinks) the semi-transparent halo band toward transparent', () => {
    const w = 10;
    const h = 1;
    // A soft edge: opaque, halo, halo, transparent
    const mask = new Uint8Array([255, 255, 200, 128, 60, 0, 0, 0, 0, 0]);
    const result = decontaminateMask(mask, w, h);
    // Halo pixels (values strictly between 10 and 245) should move toward
    // the darkest (most transparent) neighbor, i.e. never increase.
    for (let i = 0; i < w; i++) {
      const original = mask[i] ?? 0;
      if (original > 10 && original < 245) {
        expect(result[i]!).toBeLessThanOrEqual(original);
      }
    }
    // The choke should measurably reduce the halo, not act as a no-op.
    expect(Array.from(result)).not.toEqual(Array.from(mask));
  });

  it('leaves fully opaque and fully transparent pixels untouched', () => {
    const mask = new Uint8Array([0, 5, 10, 250, 255]);
    const result = decontaminateMask(mask, 5, 1);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(5);
    expect(result[2]).toBe(10);
    expect(result[3]).toBe(250);
    expect(result[4]).toBe(255);
  });

  it('is a no-op for degenerate (zero-size) input', () => {
    const mask = new Uint8Array(0);
    expect(decontaminateMask(mask, 0, 0)).toBe(mask);
  });
});

describe('featherMaskArray', () => {
  it('returns the input unchanged for radius <= 0', () => {
    const mask = new Uint8Array([0, 255, 0, 255]);
    expect(featherMaskArray(mask, 2, 2, 0)).toBe(mask);
  });

  it('smooths a hard edge into a gradient', () => {
    const w = 10;
    const h = 1;
    const mask = new Uint8Array(w);
    for (let x = 0; x < w; x++) mask[x] = x < 5 ? 255 : 0;

    const result = featherMaskArray(mask, w, h, 2);
    // The step edge at x=4/5 should now have intermediate values nearby.
    const hasIntermediate = Array.from(result).some((v) => v > 10 && v < 245);
    expect(hasIntermediate).toBe(true);
    // Far from the edge, values should remain close to the original.
    expect(result[0]!).toBeGreaterThan(200);
    expect(result[9]!).toBeLessThan(55);
  });
});
