import { describe, expect, it } from 'vitest';
import {
  cubicBezier,
  easeIn,
  easeInOut,
  easeOut,
  linear,
  sampleEasing,
  springPhysics,
  steps,
} from './easing';

describe('easing functions', () => {
  describe('linear', () => {
    it('returns t unchanged', () => {
      expect(linear(0)).toBe(0);
      expect(linear(0.5)).toBe(0.5);
      expect(linear(1)).toBe(1);
    });
  });

  describe('easeIn', () => {
    it('starts slowly and accelerates (quadratic)', () => {
      expect(easeIn(0)).toBe(0);
      expect(easeIn(0.5)).toBeCloseTo(0.25, 5);
      expect(easeIn(1)).toBe(1);
      expect(easeIn(0.25)).toBeCloseTo(0.0625, 5);
    });
  });

  describe('easeOut', () => {
    it('starts fast and decelerates', () => {
      expect(easeOut(0)).toBe(0);
      expect(easeOut(0.5)).toBeCloseTo(0.75, 5);
      expect(easeOut(1)).toBe(1);
    });
  });

  describe('easeInOut', () => {
    it('accelerates then decelerates', () => {
      expect(easeInOut(0)).toBe(0);
      expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
      expect(easeInOut(1)).toBe(1);
      expect(easeInOut(0.25)).toBeCloseTo(0.125, 5);
      expect(easeInOut(0.75)).toBeCloseTo(0.875, 5);
    });
  });

  describe('cubicBezier', () => {
    it('produces standard ease curve (0.25, 0.1, 0.25, 1)', () => {
      const ease = cubicBezier(0.25, 0.1, 0.25, 1);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(0.5)).toBeGreaterThan(0.5);
    });

    it('produces ease-in curve (0.42, 0, 1, 1)', () => {
      const easeIn = cubicBezier(0.42, 0, 1, 1);
      expect(easeIn(0)).toBe(0);
      expect(easeIn(1)).toBe(1);
      expect(easeIn(0.5)).toBeLessThan(0.5);
    });

    it('produces ease-out curve (0, 0, 0.58, 1)', () => {
      const easeOut = cubicBezier(0, 0, 0.58, 1);
      expect(easeOut(0)).toBe(0);
      expect(easeOut(1)).toBe(1);
      expect(easeOut(0.5)).toBeGreaterThan(0.5);
    });

    it('linear bezier is identity', () => {
      const linear_b = cubicBezier(0, 0, 1, 1);
      expect(linear_b(0)).toBe(0);
      expect(linear_b(1)).toBe(1);
      expect(linear_b(0.5)).toBeCloseTo(0.5, 2);
    });
  });

  describe('springPhysics', () => {
    it('returns a spring-based easing function', () => {
      const spring = springPhysics({ mass: 1, stiffness: 100, damping: 10 });
      expect(spring(0)).toBe(0);
      expect(spring(1)).toBeCloseTo(1, 1);
    });

    it('can overshoot with underdamped spring', () => {
      const spring = springPhysics({ mass: 1, stiffness: 300, damping: 5 });
      const result = spring(0.5);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('steps', () => {
    it('produces step-wise easing', () => {
      const stepFn = steps(4, 'end');
      expect(stepFn(0)).toBe(0);
      expect(stepFn(0.24)).toBe(0);
      expect(stepFn(0.25)).toBe(0.25);
      expect(stepFn(0.5)).toBe(0.5);
      expect(stepFn(1)).toBe(1);
    });

    it('steps start jumps immediately', () => {
      const stepFn = steps(4, 'start');
      expect(stepFn(0)).toBe(0.25);
      expect(stepFn(0.24)).toBe(0.25);
      expect(stepFn(0.25)).toBe(0.5);
    });
  });

  describe('sampleEasing', () => {
    it('samples linear easing', () => {
      const samples = sampleEasing({ kind: 'linear' }, 5);
      expect(samples).toHaveLength(5);
      expect(samples[0]).toBe(0);
      expect(samples[4]).toBe(1);
    });

    it('samples cubic bezier easing', () => {
      const samples = sampleEasing({ kind: 'cubicBezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }, 5);
      expect(samples).toHaveLength(5);
      expect(samples[0]).toBeCloseTo(0, 1);
      expect(samples[4]).toBeCloseTo(1, 1);
    });

    it('samples spring easing', () => {
      const samples = sampleEasing({ kind: 'spring', mass: 1, stiffness: 100, damping: 10 }, 10);
      expect(samples).toHaveLength(10);
      expect(samples[0]).toBe(0);
      expect(samples[samples.length - 1]).toBeCloseTo(1, 1);
    });
  });
});
