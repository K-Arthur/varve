import { describe, expect, it } from 'vitest';
import { verticalOrientationForCluster, verticalShapingDirection } from './verticalText';

describe('vertical text semantics', () => {
  it('uses cluster-level Unicode properties for mixed orientation', () => {
    expect(verticalOrientationForCluster('A')).toBe('sideways');
    expect(verticalOrientationForCluster('あ')).toBe('upright');
    expect(verticalOrientationForCluster('\u{1f642}')).toBe('upright');
    expect(verticalOrientationForCluster('e\u0301')).toBe('sideways');
    expect(verticalOrientationForCluster('e\u0301', 'upright')).toBe('upright');
  });

  it('maps both CSS vertical writing modes to top-to-bottom shaping', () => {
    expect(verticalShapingDirection('vertical-rl')).toBe('ttb');
    expect(verticalShapingDirection('vertical-lr')).toBe('ttb');
    expect(verticalShapingDirection('horizontal-tb')).toBe('ltr');
  });
});
