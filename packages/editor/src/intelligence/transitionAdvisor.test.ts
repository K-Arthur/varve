import { describe, expect, it } from 'vitest';
import { suggestDuration } from './transitionAdvisor';

describe('suggestDuration', () => {
  it('returns 0 for instant transitions', () => {
    const result = suggestDuration('instant');
    expect(result.duration).toBe(0);
    expect(result.reason).toContain('no duration');
  });

  it('returns a value in 250-350 range for dissolve', () => {
    const result = suggestDuration('dissolve');
    expect(result.duration).toBeGreaterThanOrEqual(250);
    expect(result.duration).toBeLessThanOrEqual(350);
  });

  it('returns a value in 300-500 range for slide', () => {
    const result = suggestDuration('slide');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
  });

  it('returns a value in 300-500 range for push', () => {
    const result = suggestDuration('push');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
  });

  it('returns a value in 300-500 range for moveIn', () => {
    const result = suggestDuration('moveIn');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
  });

  it('returns a value in 300-500 range for moveOut', () => {
    const result = suggestDuration('moveOut');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
  });

  it('returns a value in 300-500 range for smartAnimate', () => {
    const result = suggestDuration('smartAnimate');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
  });

  it('returns larger duration for larger elements', () => {
    const small = suggestDuration('dissolve', 100);
    const large = suggestDuration('dissolve', 900);
    expect(large.duration).toBeGreaterThan(small.duration);
  });

  it('clamps mobile durations to 200-300', () => {
    const result = suggestDuration('slide', 500, 'mobile');
    expect(result.duration).toBeGreaterThanOrEqual(200);
    expect(result.duration).toBeLessThanOrEqual(300);
  });

  it('clamps desktop durations to 150-250', () => {
    const result = suggestDuration('slide', 500, 'desktop');
    expect(result.duration).toBeGreaterThanOrEqual(150);
    expect(result.duration).toBeLessThanOrEqual(250);
  });

  it('returns a default range for unknown transition kinds', () => {
    const result = suggestDuration('customFlip');
    expect(result.duration).toBeGreaterThanOrEqual(300);
    expect(result.duration).toBeLessThanOrEqual(500);
    expect(result.reason).toContain('customFlip');
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = suggestDuration('slide', 400, 'mobile');
    const b = suggestDuration('slide', 400, 'mobile');
    expect(a).toEqual(b);
  });
});
