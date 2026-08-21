import { describe, expect, it } from 'vitest';
import { fitPathToBeziers, type Point2D, simplifyPoints } from '../fitting';

function pressureRamp(count: number): Point2D[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i * 6,
    y: Math.sin(i / 4) * 10,
    pressure: i / (count - 1),
  }));
}

describe('vector stroke pressure', () => {
  it('survives curve fitting', () => {
    // Regression: fitPathToBeziers dropped pressure, so every fitted anchor
    // read back as the 0.5 default and the variable-width renderer — which
    // only engages when some point differs from 0.5 — never ran.
    const fitted = fitPathToBeziers(pressureRamp(40));
    expect(fitted.length).toBeGreaterThan(1);
    expect(fitted.every((p) => p.pressure !== undefined)).toBe(true);
    expect(fitted.some((p) => (p.pressure ?? 0.5) !== 0.5)).toBe(true);
  });

  it('keeps the endpoints of the ramp', () => {
    const fitted = fitPathToBeziers(pressureRamp(40));
    expect(fitted[0]!.pressure).toBeCloseTo(0, 5);
    expect(fitted[fitted.length - 1]!.pressure).toBeCloseTo(1, 5);
  });

  it('survives simplification', () => {
    const simplified = simplifyPoints(pressureRamp(40), 1);
    expect(simplified.every((p) => p.pressure !== undefined)).toBe(true);
  });

  it('survives the simplify-then-fit pipeline the pencil uses', () => {
    const fitted = fitPathToBeziers(simplifyPoints(pressureRamp(60), 2));
    const pressures = fitted.map((p) => p.pressure ?? 0.5);
    expect(Math.min(...pressures)).toBeLessThan(0.2);
    expect(Math.max(...pressures)).toBeGreaterThan(0.8);
  });

  it('handles a single-point path', () => {
    const fitted = fitPathToBeziers([{ x: 1, y: 2, pressure: 0.42 }]);
    expect(fitted).toHaveLength(1);
    expect(fitted[0]!.pressure).toBe(0.42);
  });

  it('leaves pressure undefined when the caller supplied none', () => {
    const fitted = fitPathToBeziers([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(fitted.every((p) => p.pressure === undefined)).toBe(true);
  });

  it('records a monotonic ramp without inversions', () => {
    const fitted = fitPathToBeziers(pressureRamp(50));
    const pressures = fitted.map((p) => p.pressure ?? 0.5);
    for (let i = 1; i < pressures.length; i++) {
      expect(pressures[i]!).toBeGreaterThanOrEqual(pressures[i - 1]! - 1e-9);
    }
  });
});
