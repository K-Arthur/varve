import { describe, expect, it } from 'vitest';
import {
  type BrushPreset,
  createStrokeDabSession,
  defaultBrushPreset,
  generateDabs,
  strokePoint,
} from '../brush';

function preset(overrides: Partial<BrushPreset> = {}): BrushPreset {
  return { ...defaultBrushPreset('p', 'P'), radius: 10, spacing: 0.25, ...overrides };
}

function line(from: number, to: number, step: number) {
  const pts = [];
  for (let x = from; x <= to; x += step) pts.push(strokePoint(x, 0));
  return pts;
}

describe('incremental dab generation', () => {
  it('produces the same dab stream whether a stroke arrives in one batch or many', () => {
    const p = preset();
    const points = line(0, 200, 7);

    const whole = generateDabs(points, p, { session: createStrokeDabSession(1234) });

    const incremental = [];
    const session = createStrokeDabSession(1234);
    for (let i = 0; i < points.length; i += 3) {
      incremental.push(...generateDabs(points.slice(i, i + 3), p, { session }));
    }

    expect(incremental.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      expect(incremental[i]!.x).toBeCloseTo(whole[i]!.x, 9);
      expect(incremental[i]!.y).toBeCloseTo(whole[i]!.y, 9);
      expect(incremental[i]!.strokeDistance).toBeCloseTo(whole[i]!.strokeDistance, 9);
    }
  });

  it('keeps dab spacing uniform across batch boundaries', () => {
    const p = preset({ radius: 10, spacing: 0.5 }); // 10px spacing
    const points = line(0, 100, 3);
    const session = createStrokeDabSession(7);
    const dabs = [];
    for (let i = 0; i < points.length; i += 2) {
      dabs.push(...generateDabs(points.slice(i, i + 2), p, { session }));
    }
    expect(dabs.length).toBeGreaterThan(5);
    for (let i = 2; i < dabs.length; i++) {
      expect(dabs[i]!.x - dabs[i - 1]!.x).toBeCloseTo(10, 6);
    }
  });

  it('never emits a dab twice at a batch boundary', () => {
    const p = preset();
    const session = createStrokeDabSession(99);
    const first = generateDabs(line(0, 50, 5), p, { session });
    const second = generateDabs(line(55, 100, 5), p, { session });
    const xs = [...first, ...second].map((d) => d.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('gives each stroke an independent jitter sequence', () => {
    const p = preset({ positionJitter: 0.5, sizeJitter: 0.5 });
    const pts = line(0, 100, 5);

    const a1 = generateDabs(pts, p, { session: createStrokeDabSession(42) });
    // Interleave a second stroke's generation; it must not perturb the first.
    const sA = createStrokeDabSession(42);
    const sB = createStrokeDabSession(4242);
    const interleavedA = [];
    for (let i = 0; i < pts.length; i += 2) {
      interleavedA.push(...generateDabs(pts.slice(i, i + 2), p, { session: sA }));
      generateDabs(pts.slice(i, i + 2), p, { session: sB });
    }

    expect(interleavedA.map((d) => d.x)).toEqual(a1.map((d) => d.x));
    expect(interleavedA.map((d) => d.radius)).toEqual(a1.map((d) => d.radius));
  });

  it('stamps a single dab for a tap', () => {
    const dabs = generateDabs([strokePoint(5, 5)], preset(), {
      session: createStrokeDabSession(1),
    });
    expect(dabs).toHaveLength(1);
    expect(dabs[0]!.x).toBeCloseTo(5);
  });

  it('does not restamp the origin on a follow-up batch', () => {
    const session = createStrokeDabSession(1);
    const p = preset();
    const first = generateDabs([strokePoint(0, 0)], p, { session });
    const second = generateDabs([strokePoint(1, 0)], p, { session });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // 1px < 5px spacing
  });

  it('tracks absolute arc length independently of batch size', () => {
    const p = preset({ spacing: 0.25 }); // 5px spacing
    const session = createStrokeDabSession(3);
    const dabs = [];
    for (let i = 0; i < 100; i += 10) {
      dabs.push(...generateDabs(line(i, i + 10, 2), p, { session }));
    }
    const last = dabs[dabs.length - 1]!;
    expect(last.strokeDistance).toBeCloseTo(last.x, 6);
  });
});
