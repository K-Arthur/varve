import { describe, expect, it } from 'vitest';
import {
  applyLiquifyDab,
  clampLiquifyField,
  createFreezeSampler,
  createLiquifyField,
  decodeFreezeMask,
  encodeFreezeMask,
  isIdentityLiquifyField,
  liquifyFieldRevision,
  MAX_LIQUIFY_DISPLACEMENT_FRACTION,
  stampFreezeMask,
  validateLiquifyField,
} from '../field';
import { sampleImageDataBilinear, warpImageDataByField } from '../warp';

function makeImage(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

function pixelAt(image: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
}

const dab = (overrides: Partial<Parameters<typeof applyLiquifyDab>[2]> = {}) => ({
  x: 50,
  y: 50,
  radius: 30,
  strength: 1,
  pressure: 1,
  deltaX: 0,
  deltaY: 0,
  ...overrides,
});

describe('liquify field', () => {
  it('creates an identity field with the expected control count', () => {
    const field = createLiquifyField(200, 100, 4, 6);
    expect(field.displacement).toHaveLength((4 + 1) * (6 + 1) * 2);
    expect(isIdentityLiquifyField(field)).toBe(true);
  });

  it('clamps grid dimensions and displacement magnitude', () => {
    const field = createLiquifyField(100, 100, 500, 0);
    expect(field.rows).toBe(64);
    expect(field.columns).toBe(1);
    const pushed = applyLiquifyDab(field, 'push', dab({ deltaX: 1000, deltaY: 1000 }));
    const clamped = clampLiquifyField(pushed);
    const max = 100 * MAX_LIQUIFY_DISPLACEMENT_FRACTION;
    for (let i = 0; i < clamped.displacement.length; i += 2) {
      expect(Math.abs(clamped.displacement[i]!)).toBeLessThanOrEqual(max);
      expect(Math.abs(clamped.displacement[i + 1]!)).toBeLessThanOrEqual(max);
    }
  });

  it('pushes content in the pointer direction', () => {
    // 1×1-cell field so the whole layer sees the centre displacement.
    const field = createLiquifyField(100, 100, 1, 1);
    const next = applyLiquifyDab(field, 'push', dab({ deltaX: 8, deltaY: 0, radius: 200 }), null);
    // D(center) = -8: output samples 8 px to the left, so content moves right.
    const center = next.displacement[(0 * 2 + 1) * 2]!;
    expect(center).toBeLessThan(0);
    expect(Math.abs(center)).toBeGreaterThan(1);
  });

  it('does not drift when a push brush is held still', () => {
    const field = createLiquifyField(100, 100, 4, 4);
    const moved = applyLiquifyDab(field, 'push', dab({ deltaX: 5 }), null);
    const still = applyLiquifyDab(moved, 'push', dab({ deltaX: 0, deltaY: 0 }), null);
    expect(still.displacement).toEqual(moved.displacement);
  });

  it('bloat pulls source samples toward the centre and pucker pushes them out', () => {
    const field = createLiquifyField(100, 100, 1, 1);
    const bloat = applyLiquifyDab(field, 'bloat', dab({ x: 50, y: 50, radius: 200 }), null);
    // Control point at (0,0) is up-left of centre: source offset gains a
    // component toward the centre (positive x, positive y).
    expect(bloat.displacement[0]!).toBeGreaterThan(0);
    expect(bloat.displacement[1]!).toBeGreaterThan(0);
    const pucker = applyLiquifyDab(field, 'pucker', dab({ x: 50, y: 50, radius: 200 }), null);
    expect(pucker.displacement[0]!).toBeLessThan(0);
    expect(pucker.displacement[1]!).toBeLessThan(0);
  });

  it('twirl rotates source offsets in opposite directions', () => {
    const field = createLiquifyField(100, 100, 1, 1);
    // Control point directly right of centre: (100, 50).
    const cw = applyLiquifyDab(field, 'twirl-cw', dab({ x: 50, y: 50, radius: 100 }), null);
    const ccw = applyLiquifyDab(field, 'twirl-ccw', dab({ x: 50, y: 50, radius: 100 }), null);
    const rightIndex = 1 * 2; // (row 0, col 1)
    // Clockwise content rotation samples from above the point (negative dy).
    expect(cw.displacement[rightIndex + 1]!).toBeLessThan(0);
    expect(ccw.displacement[rightIndex + 1]!).toBeGreaterThan(0);
  });

  it('restore moves deformation toward identity', () => {
    const field = createLiquifyField(100, 100, 1, 1);
    const moved = applyLiquifyDab(field, 'push', dab({ deltaX: 20, radius: 200 }), null);
    const magnitude = Math.abs(moved.displacement[1 * 2]!);
    expect(magnitude).toBeGreaterThan(0);
    let restored = moved;
    for (let i = 0; i < 20; i++) {
      restored = applyLiquifyDab(restored, 'restore', dab({ radius: 100 }), null);
    }
    expect(Math.abs(restored.displacement[1 * 2]!)).toBeLessThan(magnitude);
  });

  it('freeze fully protects a region', () => {
    const field = createLiquifyField(100, 100, 4, 4);
    const frozen = new Uint8Array(100 * 100).fill(255);
    const sampler = createFreezeSampler(100, 100, frozen)!;
    const next = applyLiquifyDab(field, 'push', dab({ deltaX: 20 }), sampler);
    expect(isIdentityLiquifyField(next)).toBe(true);
  });

  it('freeze is sampled bilinearly so boundaries fade', () => {
    const data = new Uint8Array(4 * 4);
    stampFreezeMask(data, 4, 4, 1.5, 1.5, 1.2, true);
    const sampler = createFreezeSampler(4, 4, data)!;
    expect(sampler.sampleNormalized(1.5 / 4, 1.5 / 4)).toBeGreaterThan(0.9);
    expect(sampler.sampleNormalized(3.5 / 4, 3.5 / 4)).toBeLessThan(0.1);
  });
  it('freeze mask RLE round-trips exactly', () => {
    const data = new Uint8Array(64);
    for (let i = 0; i < data.length; i++) data[i] = i < 20 ? 255 : i < 30 ? 7 : 0;
    const encoded = encodeFreezeMask(data);
    const decoded = decodeFreezeMask(encoded, data.length);
    expect(decoded).toEqual(data);
    expect(decodeFreezeMask(encoded, data.length + 1)).toBeNull();
  });

  it('validates persisted fields and repairs malformed numbers', () => {
    const field = createLiquifyField(50, 40, 2, 2);
    expect(validateLiquifyField(field)).not.toBeNull();
    expect(validateLiquifyField({ ...field, version: 99 })).toBeNull();
    expect(validateLiquifyField({ ...field, displacement: [1, 2] })).toBeNull();
    const repaired = validateLiquifyField({
      ...field,
      displacement: field.displacement.map((value, index) => (index === 3 ? Number.NaN : value)),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.displacement[3]).toBe(0);
  });

  it('revision changes when the field changes and is stable otherwise', () => {
    const field = createLiquifyField(100, 100, 2, 2);
    const moved = applyLiquifyDab(field, 'push', dab({ radius: 50, deltaX: 3 }), null);
    expect(liquifyFieldRevision(field)).not.toBe(liquifyFieldRevision(moved));
    expect(liquifyFieldRevision(moved)).toBe(liquifyFieldRevision(moved));
  });
});

describe('liquify warp', () => {
  it('identity field is a bit-exact copy', () => {
    const source = makeImage(16, 16, (x, y) => [x * 7, y * 7, 128, x === 3 && y === 3 ? 0 : 255]);
    const field = createLiquifyField(16, 16, 4, 4);
    const out = warpImageDataByField(source, field);
    expect(Array.from(out.data)).toEqual(Array.from(source.data));
  });

  it('uniform push translates content and leaves vacated regions transparent', () => {
    const source = makeImage(32, 8, (x) => (x === 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const field = createLiquifyField(32, 8, 1, 1);
    // Move content 6 px right: D = -6 everywhere.
    field.displacement[0] = -6;
    field.displacement[1] = 0;
    field.displacement[2] = -6;
    field.displacement[3] = 0;
    field.displacement[4] = -6;
    field.displacement[5] = 0;
    field.displacement[6] = -6;
    field.displacement[7] = 0;
    const out = warpImageDataByField(source, field);
    expect(pixelAt(out, 10, 4)[0]).toBe(255);
    expect(pixelAt(out, 4, 4)[3]).toBe(0);
  });

  it('transparent border policy never reveals an undeformed copy', () => {
    const source = makeImage(16, 4, () => [255, 255, 255, 255]);
    const field = createLiquifyField(16, 4, 1, 1);
    // Shift the left edge content to the right by 10 px.
    field.displacement[0] = -10;
    field.displacement[1] = 0;
    const out = warpImageDataByField(source, field, { border: 'transparent' });
    expect(pixelAt(out, 0, 1)[3]).toBe(0);
  });

  it('clamp border policy repeats edge pixels only when requested', () => {
    const source = makeImage(16, 4, () => [255, 0, 0, 255]);
    const field = createLiquifyField(16, 4, 1, 1);
    field.displacement[0] = 6;
    field.displacement[1] = 0;
    const out = warpImageDataByField(source, field, { border: 'clamp' });
    expect(pixelAt(out, 15, 1)[3]).toBe(255);
  });

  it('resamples premultiplied so transparent neighbours do not darken edges', () => {
    // Half the image is opaque white, half fully transparent with black RGB.
    const source = makeImage(16, 1, (x) => (x < 8 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const field = createLiquifyField(16, 1, 1, 1);
    field.displacement[0] = 0.5;
    field.displacement[1] = 0;
    const out = warpImageDataByField(source, field);
    const [r, g, b] = pixelAt(out, 7, 0);
    // Straight-alpha interpolation would drag the edge toward black.
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  });

  it('bilinear sampler clamps fractional coordinates safely', () => {
    const source = makeImage(4, 4, () => [10, 20, 30, 255]);
    const sample = sampleImageDataBilinear(source.data, 4, 4, 1.5, 1.5, 'clamp');
    expect(sample.r).toBe(10);
    expect(sample.a).toBe(255);
  });
});
