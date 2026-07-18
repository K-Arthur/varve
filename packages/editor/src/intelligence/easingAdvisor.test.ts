import { describe, expect, it } from 'vitest';
import { suggestEasing } from './easingAdvisor';

describe('suggestEasing', () => {
  it('returns ease for opacity', () => {
    const result = suggestEasing('opacity');
    expect(result.easing).toBe('ease');
    expect(result.confidence).toBe('high');
  });

  it('returns easeOut for transform with short distance', () => {
    const result = suggestEasing('transform', 30);
    expect(result.easing).toBe('easeOut');
    expect(result.confidence).toBe('high');
  });

  it('returns spring for transform with long distance (>= 50)', () => {
    const result = suggestEasing('transform', 200);
    expect(result.easing).toBe('spring');
    expect(result.confidence).toBe('medium');
  });

  it('returns easeOut for scale', () => {
    const result = suggestEasing('scale');
    expect(result.easing).toBe('easeOut');
    expect(result.confidence).toBe('high');
  });

  it('returns easeInOut for rotation', () => {
    const result = suggestEasing('rotation');
    expect(result.easing).toBe('easeInOut');
    expect(result.confidence).toBe('medium');
  });

  it('returns default ease with low confidence for unknown property', () => {
    const result = suggestEasing('blur');
    expect(result.easing).toBe('ease');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Default');
  });

  it('handles distance exactly at 50 as long', () => {
    const result = suggestEasing('position', 50);
    expect(result.easing).toBe('spring');
    expect(result.confidence).toBe('medium');
  });

  it('handles distance exactly at 49 as short', () => {
    const result = suggestEasing('position', 49);
    expect(result.easing).toBe('easeOut');
    expect(result.confidence).toBe('high');
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = suggestEasing('transform', 100);
    const b = suggestEasing('transform', 100);
    expect(a).toEqual(b);
  });
});
