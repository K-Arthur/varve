// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { type ActivePrototypeTransition, computeTransitionVisuals } from './usePrototypeTransition';

describe('computeTransitionVisuals', () => {
  it('interpolates dissolve opacity at midpoint', () => {
    const active: ActivePrototypeTransition = {
      fromScreenId: 'a',
      toScreenId: 'b',
      transition: { kind: 'dissolve', duration: 300, easing: { kind: 'linear' } },
      startedAt: 0,
    };
    const mid = computeTransitionVisuals(active, 0.5);
    expect(mid.from.opacity).toBeLessThan(1);
    expect(mid.to.opacity).toBeGreaterThan(0);
  });

  it('uses smart animate values when provided', () => {
    const active: ActivePrototypeTransition = {
      fromScreenId: 'a',
      toScreenId: 'b',
      transition: { kind: 'smartAnimate', duration: 400, easing: { kind: 'linear' } },
      smartAnimateValues: { n1: { opacity: 0.5 } },
      startedAt: 0,
    };
    const end = computeTransitionVisuals(active, 1);
    expect(end.to.opacity).toBeGreaterThan(0);
  });
});
