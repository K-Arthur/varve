import { describe, expect, it } from 'vitest';
import { buildCurveLUT, compileCurve } from './curves';

describe('canonical curve transfer', () => {
  it('preserves arbitrary floating identity, including uneven extra points', () => {
    const evaluate = compileCurve(
      [
        { x: 0, y: 0 },
        { x: 0.13, y: 0.13 },
        { x: 0.91, y: 0.91 },
        { x: 1, y: 1 },
      ],
      'pchip',
    );
    for (const x of [0.00003, 0.1297, 0.3333333, 0.79876, 0.99999]) expect(evaluate(x)).toBe(x);
  });
  it('matches analytical PCHIP with equal endpoint secants', () => {
    const evaluate = compileCurve(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ],
      'pchip',
    );
    expect(evaluate(0.25)).toBe(0.25);
  });
  it('does not overshoot plateaus or remove intentional inversion', () => {
    const points = [
      { x: 0, y: 0.8 },
      { x: 0.1, y: 0.8 },
      { x: 0.7, y: 0.2 },
      { x: 1, y: 0.2 },
    ];
    const evaluate = compileCurve(points, 'pchip');
    expect(evaluate(0.05)).toBeCloseTo(0.8, 12);
    expect(evaluate(0.85)).toBeCloseTo(0.2, 12);
    for (let i = 0; i <= 100; i++) expect(evaluate(i / 100)).toBeGreaterThanOrEqual(0.2 - 1e-12);
    expect(evaluate(0.4)).toBeCloseTo(0.5, 12);
  });
  it.each(['legacy', 'pchip'] as const)(
    'graph evaluator agrees with every byte LUT entry in %s',
    (algorithm) => {
      const points = [
        { x: 0, y: 0.1 },
        { x: 0.08, y: 0.6 },
        { x: 0.8, y: 0.7 },
        { x: 1, y: 0.9 },
      ];
      const evaluate = compileCurve(points, algorithm),
        lut = buildCurveLUT(points, algorithm);
      expect(Array.from(lut)).toEqual(
        Array.from({ length: 256 }, (_, i) => Math.round(evaluate(i / 255) * 255)),
      );
    },
  );
  it('uses the last duplicate X and rejects nonfinite points', () => {
    const evaluate = compileCurve(
      [
        { x: NaN, y: 0.2 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.9 },
      ],
      'pchip',
    );
    expect(evaluate(0.5)).toBeCloseTo(0.9, 12);
    expect(evaluate(NaN)).toBe(0);
  });
});
