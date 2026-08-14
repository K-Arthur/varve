import { describe, expect, it } from 'vitest';
import {
  computeMaskConfidence,
  decontaminateMask,
  featherMaskArray,
  normalizeSegmentationOutput,
  packChwFloat32,
  packSegmentationChwFloat32,
  resizeMaskBilinear,
  resizeMaskNearestNeighbor,
  thresholdMask,
} from '../maskOps';

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

describe('thresholdMask', () => {
  it('binarizes at 0.5 threshold', () => {
    const data = new Float32Array([0.1, 0.6, 0.5, 0.9]);
    const mask = thresholdMask(data);
    expect(Array.from(mask)).toEqual([0, 255, 0, 255]);
  });
});

describe('resizeMaskNearestNeighbor', () => {
  it('upscales a 2x2 mask to 4x4', () => {
    const mask = new Uint8Array([255, 0, 0, 255]);
    const result = resizeMaskNearestNeighbor(mask, 2, 2, 4, 4);
    expect(result.length).toBe(16);
    expect(result[0]).toBe(255);
    expect(result[3]).toBe(0);
  });

  it('returns the same array when dimensions match', () => {
    const mask = new Uint8Array([255, 0]);
    expect(resizeMaskNearestNeighbor(mask, 2, 1, 2, 1)).toBe(mask);
  });
});

describe('packChwFloat32', () => {
  it('packs RGBA into CHW layout normalized to 0-1', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const packed = packChwFloat32({ data, width: 2, height: 1 });
    expect(packed.length).toBe(6);
    expect(packed[0]).toBeCloseTo(1);
    expect(packed[1]).toBeCloseTo(0);
    expect(packed[2]).toBeCloseTo(0);
    expect(packed[3]).toBeCloseTo(1);
    expect(packed[4]).toBeCloseTo(0);
    expect(packed[5]).toBeCloseTo(0);
  });
});

describe('packSegmentationChwFloat32', () => {
  it('matches rembg max-value and ImageNet normalization', () => {
    const data = new Uint8ClampedArray([128, 64, 0, 255]);
    const packed = packSegmentationChwFloat32({ data, width: 1, height: 1 });
    expect(packed[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(packed[1]).toBeCloseTo((0.5 - 0.456) / 0.224, 5);
    expect(packed[2]).toBeCloseTo((0 - 0.406) / 0.225, 5);
  });
});

describe('normalizeSegmentationOutput', () => {
  it('scales U2-Net probabilities to a soft byte mask (rembg-faithful, no min-max)', () => {
    const mask = normalizeSegmentationOutput(new Float32Array([0.2, 0.4, 0.6]), false);
    expect(Array.from(mask)).toEqual([51, 102, 153]);
  });

  it('applies sigmoid before scaling BiRefNet logits', () => {
    const mask = normalizeSegmentationOutput(new Float32Array([-2, 0, 2]), true);
    expect(Array.from(mask)).toEqual([30, 128, 225]);
  });

  it('clamps out-of-range values instead of stretching the map', () => {
    const mask = normalizeSegmentationOutput(new Float32Array([-5, 0.5, 5]), false);
    expect(Array.from(mask)).toEqual([0, 128, 255]);
  });

  it('does not stretch a near-flat probability map to full contrast', () => {
    // The old min-max path turned a soft 0.50-0.52 band into 0-255 hard
    // edges; rembg clamps probabilities, preserving soft alpha.
    const mask = normalizeSegmentationOutput(new Float32Array([0.5, 0.51, 0.52]), false);
    expect(Array.from(mask)).toEqual([128, 130, 133]);
  });
});

describe('resizeMaskBilinear', () => {
  it('preserves soft edges while enlarging a mask', () => {
    const result = resizeMaskBilinear(new Uint8Array([0, 255]), 2, 1, 4, 1);
    expect(Array.from(result)).toEqual([0, 64, 191, 255]);
  });
});

describe('computeMaskConfidence', () => {
  it('returns a value in [0, 1]', () => {
    const data = new Float32Array([0.9, 0.1, 0.95, 0.05]);
    const conf = computeMaskConfidence(data);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it('differs for high-vs-low separation mask data', () => {
    const highSep = new Float32Array([0.95, 0.05, 0.9, 0.1]);
    const lowSep = new Float32Array([0.48, 0.52, 0.49, 0.51]);
    expect(computeMaskConfidence(highSep)).toBeGreaterThan(computeMaskConfidence(lowSep));
  });

  it('is not a constant 0.85', () => {
    const data = new Float32Array([0.9, 0.1]);
    expect(computeMaskConfidence(data)).not.toBe(0.85);
  });
});
