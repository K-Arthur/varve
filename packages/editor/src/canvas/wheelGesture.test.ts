import { describe, expect, it } from 'vitest';
import { createWheelGestureClassifier, WHEEL_GESTURE_HYSTERESIS } from './wheelGesture';

describe('createWheelGestureClassifier', () => {
  it('classifies line-mode detents as mouse', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(1, 0, 100, 0)).toBe('mouse');
  });

  it('classifies small pixel-mode deltas as trackpad', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 10, 0)).toBe('trackpad');
    expect(c.isTrackpad()).toBe(true);
  });

  it('classifies large pixel-mode detents as mouse', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 120, 0)).toBe('mouse');
  });

  it('resolves an ambiguous first event as unknown (safe default)', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 80, 0)).toBe('unknown');
  });

  it('treats a dense decaying burst of ambiguous deltas as trackpad', () => {
    const c = createWheelGestureClassifier();
    // Fast trackpad flick: dense burst with a decaying envelope. The burst
    // resolves as soon as 3 dense decaying events are visible.
    expect(c.classify(0, 0, 100, 0)).toBe('unknown');
    expect(c.classify(0, 0, 90, 8)).toBe('unknown');
    expect(c.classify(0, 0, 70, 16)).toBe('trackpad');
    expect(c.classify(0, 0, 45, 24)).toBe('trackpad');
    expect(c.isTrackpad()).toBe(true);
  });

  it('does not classify a sparse run of equal ambiguous deltas as trackpad', () => {
    const c = createWheelGestureClassifier();
    // Detented wheel in pixel mode: sparse, flat magnitudes.
    expect(c.classify(0, 0, 100, 0)).toBe('unknown');
    expect(c.classify(0, 0, 100, 100)).toBe('unknown');
    expect(c.classify(0, 0, 100, 200)).toBe('unknown');
    expect(c.classify(0, 0, 100, 300)).toBe('unknown');
    expect(c.classify(0, 0, 100, 400)).toBe('unknown');
    expect(c.isTrackpad()).toBe(false);
  });

  it('sticks to trackpad across a loud mouse detent until hysteresis flips', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 10, 0)).toBe('trackpad');
    // A single 120px detent mid-gesture must not flip the classification.
    expect(c.classify(0, 0, 120, 16)).toBe('trackpad');
    expect(c.classify(0, 0, 10, 32)).toBe('trackpad');
    // Sustained contrary evidence eventually flips it.
    for (let i = 0; i < WHEEL_GESTURE_HYSTERESIS + 1; i++) {
      c.classify(0, 0, 120, 50 + i * 16);
    }
    expect(c.classify(0, 0, 120, 200)).toBe('mouse');
  });

  it('sticks to mouse across trackpad-like signals until hysteresis flips', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(1, 0, 100, 0)).toBe('mouse');
    expect(c.classify(0, 0, 12, 16)).toBe('mouse');
    for (let i = 0; i < WHEEL_GESTURE_HYSTERESIS; i++) {
      c.classify(0, 0, 12, 40 + i * 16);
    }
    expect(c.classify(0, 0, 12, 200)).toBe('trackpad');
  });

  it('resets when a gap longer than the gesture window elapses', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 10, 0)).toBe('trackpad');
    // Gap of 300ms ends the gesture; the next signal is classified fresh.
    expect(c.classify(1, 0, 100, 400)).toBe('mouse');
    expect(c.isTrackpad()).toBe(false);
  });

  it('rejects invalid timestamps', () => {
    const c = createWheelGestureClassifier();
    expect(c.classify(0, 0, 10, Number.NaN)).toBe('trackpad');
  });
});
