/**
 * Periodicity tests for the procedural pattern fields.
 *
 * These are *not* data-URL smoke tests. They exercise the pure field each
 * generator is defined by and assert the property that makes a repeat a
 * repeat: `f(x + W, y) = f(x, y)` and `f(x, y + H) = f(x, y)`, plus continuity
 * across the tile seam. A field that merely draws an attractive square fails
 * these; the previous dot/crosshatch/hex implementations did.
 */
import { describe, expect, it } from 'vitest';
import {
  PATTERN_TYPES,
  type PatternField,
  type PatternOptions,
  type PatternType,
  patternField,
  resolveStripeAngle,
  resolveTileSize,
  seededRandom,
} from './patternGenerators';

const BASE: PatternOptions = { tileSize: 96, color1: '#ffffff', color2: '#101828' };

function fieldFor(
  overrides: Partial<PatternOptions> = {},
  type: PatternType = 'polka-dots',
): PatternField {
  const field = patternField(type, { ...BASE, ...overrides });
  if (!field) throw new Error(`no field for ${type}`);
  return field;
}

function channelDelta(a: readonly number[], b: readonly number[]): number {
  return Math.max(
    Math.abs(a[0]! - b[0]!),
    Math.abs(a[1]! - b[1]!),
    Math.abs(a[2]! - b[2]!),
    Math.abs(a[3]! - b[3]!),
  );
}

/**
 * Assert the field repeats over its own tile. Samples are taken at fractional
 * positions (including negatives) so a tile that only works at integer offsets
 * is not accidentally accepted.
 */
function expectPeriodic(field: PatternField, tolerance = 2): void {
  const { width, height } = field;
  const xs = [0.37, 1.5, width / 3, width / 2 + 0.25, width - 0.5];
  const ys = [0.11, 2.5, height / 4, height / 2 + 0.75, height - 0.5];
  for (const x of xs) {
    for (const y of ys) {
      const base = field.sample(x, y);
      const shiftedX = field.sample(x + width, y);
      const shiftedY = field.sample(x, y + height);
      const shiftedBoth = field.sample(x - 2 * width, y + 3 * height);
      expect(channelDelta(base, shiftedX), `x-shift at (${x},${y})`).toBeLessThanOrEqual(tolerance);
      expect(channelDelta(base, shiftedY), `y-shift at (${x},${y})`).toBeLessThanOrEqual(tolerance);
      expect(channelDelta(base, shiftedBoth), `both-shift at (${x},${y})`).toBeLessThanOrEqual(
        tolerance,
      );
    }
  }
}

/**
 * Integrate the field over one tile and compare the ink actually present to the
 * geometry the generator declares in `expectedInkFraction`.
 *
 * This is the test a clipped motif fails: dots placed inside the square and cut
 * off at the edge lose ink, so the integral falls short of `count · πr²`,
 * whereas the wrapped field hits it. `expectPeriodic` alone cannot catch this —
 * a field built by wrapping a clipped square is still periodic.
 */
function expectInkMatchesGeometry(field: PatternField, relativeTolerance = 0.12): void {
  const { width, height } = field;
  // BASE colors: color1 = #ffffff, color2 = #101828. For opaque colors,
  // `sample = color1 + cov · (color2 − color1)`, so coverage is recovered from
  // the red channel exactly.
  const c1R = 255;
  const c2R = 16;
  let ink = 0;
  let count = 0;
  const steps = 120;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const sample = field.sample(((i + 0.5) * width) / steps, ((j + 0.5) * height) / steps);
      ink += Math.max(0, Math.min(1, (c1R - (sample[0] ?? c1R)) / (c1R - c2R)));
      count++;
    }
  }
  const measured = ink / count;
  const expected = field.expectedInkFraction;
  expect(
    Math.abs(measured - expected),
    `ink ${measured.toFixed(4)} vs geometry ${expected.toFixed(4)}`,
  ).toBeLessThanOrEqual(Math.max(0.02, relativeTolerance * expected));
}

/**
 * A stripe field depends only on the coordinate along its normal, so it must be
 * invariant under translation along the stripe direction.
 */
function expectInvariantAlong(field: PatternField, dx: number, dy: number): void {
  const { width, height } = field;
  const len = Math.hypot(dx, dy);
  const ux = (dx / len) * (len / 3);
  const uy = (dy / len) * (len / 3);
  for (let i = 0; i < 60; i++) {
    const x = (((i * 37) % 90) + 1) * (width / 96);
    const y = (((i * 53) % 90) + 1) * (height / 96);
    expect(channelDelta(field.sample(x, y), field.sample(x + ux, y + uy))).toBeLessThanOrEqual(1);
  }
}

describe('field periodicity', () => {
  for (const type of PATTERN_TYPES) {
    it(`${type} repeats exactly over its tile`, () => {
      expectPeriodic(fieldFor({ seed: 7 }, type));
    });

    it(`${type} carries the ink its motif geometry declares`, () => {
      expectInkMatchesGeometry(fieldFor({ seed: 7 }, type));
    });
  }

  it('repeats for negative and fractional parameters too', () => {
    for (const type of PATTERN_TYPES) {
      expectPeriodic(
        fieldFor(
          { seed: 3, tileWidth: 80.5, tileHeight: 61.25, gap: 1.5, density: 0.4, angle: 30 },
          type,
        ),
        4,
      );
    }
  });
});

describe('deterministic seeding', () => {
  it('honours seed 0 (it must not fall back to random)', () => {
    const a = seededRandom(0);
    const b = seededRandom(0);
    const sequenceA = [a(), a(), a(), a(), a()];
    const sequenceB = [b(), b(), b(), b(), b()];
    expect(sequenceA).toEqual(sequenceB);
    expect(sequenceA.some((v) => v !== sequenceA[0])).toBe(true);
  });

  it('produces different streams for different seeds', () => {
    const zero = seededRandom(0)();
    const one = seededRandom(1)();
    const big = seededRandom(0xffffffff)();
    expect(zero).not.toBe(one);
    expect(zero).not.toBe(big);
    expect(one).not.toBe(big);
  });

  it('is reproducible through the dot field for seed 0', () => {
    const a = fieldFor({ seed: 0 });
    const b = fieldFor({ seed: 0 });
    for (let i = 0; i < 40; i++) {
      const x = (i * 3.1) % 96;
      const y = (i * 7.7) % 96;
      expect(a.sample(x, y)).toEqual(b.sample(x, y));
    }
  });

  it('changes the dot field for a different seed', () => {
    const a = fieldFor({ seed: 1 });
    const b = fieldFor({ seed: 2 });
    let differences = 0;
    for (let i = 0; i < 200; i++) {
      const x = (i * 1.7) % 96;
      const y = (i * 4.3) % 96;
      if (channelDelta(a.sample(x, y), b.sample(x, y)) > 0) differences++;
    }
    expect(differences).toBeGreaterThan(20);
  });
});

describe('stripe angle constraint', () => {
  it('reproduces 0°, 45° and 90° exactly', () => {
    expect(resolveStripeAngle(0, 96, 96)).toEqual({ angle: 0, exact: true });
    expect(resolveStripeAngle(45, 96, 96)).toEqual({ angle: 45, exact: true });
    expect(resolveStripeAngle(90, 96, 96).exact).toBe(true);
  });

  it('constrains a non-closing angle and says so', () => {
    const resolved = resolveStripeAngle(30, 96, 96);
    expect(resolved.exact).toBe(false);
    expect(resolved.angle).toBeGreaterThan(29);
    expect(resolved.angle).toBeLessThan(32);

    const field = fieldFor({ angle: 30, density: 0.5 }, 'stripes');
    expect(field.effectiveAngle).toBeCloseTo(resolved.angle, 6);
    expect(field.warnings.some((w) => w.includes('does not close'))).toBe(true);
  });

  it('still repeats after constraining', () => {
    expectPeriodic(fieldFor({ angle: 30 }, 'stripes'));
    expectPeriodic(fieldFor({ angle: 12.3 }, 'stripes'));
  });
});

describe('tile size budget', () => {
  it('bounds each axis and preserves aspect ratio under the area budget', () => {
    const big = resolveTileSize({ ...BASE, tileWidth: 4000, tileHeight: 2000 });
    expect(big.width).toBeLessThanOrEqual(1024);
    expect(big.height).toBeLessThanOrEqual(1024);
    expect(big.width * big.height).toBeLessThanOrEqual(1_048_576);
    expect(big.width / big.height).toBeCloseTo(2, 1);
    expect(big.warnings.length).toBeGreaterThan(0);
  });

  it('raises the floor rather than producing a 0px tile', () => {
    const tiny = resolveTileSize({ ...BASE, tileSize: 0 });
    expect(tiny.width).toBeGreaterThanOrEqual(8);
    expect(tiny.height).toBeGreaterThanOrEqual(8);
  });
});

describe('directionality', () => {
  it('stripes are invariant along their own direction (bands are parallel)', () => {
    const field = fieldFor({ angle: 45, density: 0.5 }, 'stripes');
    // 45° stripes: the normal is (1,1)/√2, so the stripe direction is (1,-1).
    expectInvariantAlong(field, 1, -1);
  });

  it('vertical stripes are invariant along y', () => {
    const field = fieldFor({ angle: 0 }, 'stripes');
    expectInvariantAlong(field, 0, 1);
  });

  it('crosshatch keeps both 45° families straight', () => {
    // f = max(family(x−y), family(x+y)); each family is invariant along its own
    // diagonal. A "fan" of non-parallel lines (the old implementation) fails
    // because a dark pixel has no dark neighbour along either diagonal.
    const field = fieldFor({ density: 0.5 }, 'crosshatch');
    for (let i = 0; i < 200; i++) {
      const x = (((i * 17) % 91) + 2) * (field.width / 96);
      const y = (((i * 29) % 91) + 2) * (field.height / 96);
      const here = field.sample(x, y);
      const dark = here[0] < 200;
      if (!dark) continue;
      const alongPlus = field.sample(x + 0.75, y + 0.75);
      const alongMinus = field.sample(x + 0.75, y - 0.75);
      const keepsPlus = channelDelta(here, alongPlus) <= 40;
      const keepsMinus = channelDelta(here, alongMinus) <= 40;
      expect(keepsPlus || keepsMinus, `dark pixel at (${x},${y}) lost its line`).toBe(true);
    }
  });
});

describe('the ink test rejects a clipped tile', () => {
  it('fails a field whose dots are cut off at the tile edge', () => {
    // A negative control: dots placed inside the square and clipped, with no
    // wrapped contributions. It is still "periodic" if the lookup wraps, which
    // is why periodicity alone is not enough — but it loses ink at the seam.
    const width = 96;
    const height = 96;
    const radius = 8;
    const clipped: PatternField = {
      width,
      height,
      effectiveAngle: 0,
      warnings: [],
      // The honest geometry: 9 dots of this radius, fully present.
      expectedInkFraction: (9 * Math.PI * radius * radius) / (width * height),
      sample(x, y) {
        const left = pmodLocal(x, width);
        const top = pmodLocal(y, height);
        // Dot centres at cell corners: the one at x = 0 is cut in half.
        const cx = Math.floor(left / 32) * 32;
        const cy = Math.floor(top / 32) * 32;
        const dist = Math.hypot(left - cx, top - cy);
        return dist <= radius ? [0, 0, 0, 255] : [255, 255, 255, 255];
      },
    };
    // Periodicity holds...
    expect(clipped.sample(5 + width, 5)).toEqual(clipped.sample(5, 5));
    // ...but the ink is short of the declared geometry, so the real test fails.
    expect(() => expectInkMatchesGeometry(clipped)).toThrow();
  });
});

function pmodLocal(value: number, m: number): number {
  return ((value % m) + m) % m;
}

describe('color validation', () => {
  it('falls back with a warning for a malformed color', () => {
    const field = patternField('checkerboard', { ...BASE, color2: 'not-a-color' });
    expect(field).not.toBeNull();
    expect(field!.warnings.some((w) => w.includes('Unrecognized color'))).toBe(true);
  });

  it('keeps alpha from a transparent background', () => {
    const field = patternField('checkerboard', {
      ...BASE,
      color1: 'transparent',
      color2: '#ff0000',
    });
    const corner = field!.sample(1, 1);
    expect(corner[3]).toBe(0);
  });
});
