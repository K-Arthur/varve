import { computeExpandPlan } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { expandCompositionLayout } from './expandComposition';

function planResult(margins: { top: number; right: number; bottom: number; left: number }) {
  const result = computeExpandPlan(1200, 900, margins);
  if (!result.ok) throw new Error(result.error.message);
  return result.plan;
}

describe('expandCompositionLayout', () => {
  it('places the full-resolution source at the plan offset and excludes it from generation', () => {
    const plan = planResult({ top: 40, right: 0, bottom: 0, left: 80 });
    const layout = expandCompositionLayout(plan, 640, 470);
    expect(layout).toEqual({
      outputWidth: 1280,
      outputHeight: 940,
      source: {
        sx: 0,
        sy: 0,
        sw: 1200,
        sh: 900,
        dx: 80,
        dy: 40,
        dw: 1200,
        dh: 900,
      },
      generated: { dx: 0, dy: 0, dw: 1280, dh: 940 },
      protectedExclusion: { x: 80, y: 40, width: 1200, height: 900 },
    });
  });

  it('keeps the generated frame mapped across the whole output frame', () => {
    const plan = planResult({ top: 10, right: 20, bottom: 30, left: 40 });
    const layout = expandCompositionLayout(plan, 100, 80);
    expect(layout.generated).toEqual({
      dx: 0,
      dy: 0,
      dw: plan.outputWidth,
      dh: plan.outputHeight,
    });
  });

  it('rejects invalid generated dimensions instead of guessing a scale', () => {
    const plan = planResult({ top: 5, right: 5, bottom: 5, left: 5 });
    expect(() => expandCompositionLayout(plan, 0, 10)).toThrow();
    expect(() => expandCompositionLayout(plan, 10.5, 10)).toThrow();
    expect(() => expandCompositionLayout(plan, Number.NaN, 10)).toThrow();
  });
});
