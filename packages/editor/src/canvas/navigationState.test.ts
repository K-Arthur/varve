import { describe, expect, it } from 'vitest';
import { transitionNavigationState } from './navigationState';

describe('navigationState', () => {
  it('idle -> wheel-pan on plain wheel', () => {
    const t = transitionNavigationState('idle', { type: 'wheel', zoom: false });
    expect(t.next).toBe('wheel-pan');
  });

  it('idle -> wheel-zoom on ctrl+wheel', () => {
    const t = transitionNavigationState('idle', { type: 'wheel', zoom: true });
    expect(t.next).toBe('wheel-zoom');
  });

  it('touch pointer count drives pan vs pinch', () => {
    expect(
      transitionNavigationState('idle', {
        type: 'pointer-down',
        pointerType: 'touch',
        pointerCount: 1,
      }).next,
    ).toBe('touch-pan');
    expect(
      transitionNavigationState('idle', {
        type: 'pointer-down',
        pointerType: 'touch',
        pointerCount: 2,
      }).next,
    ).toBe('touch-pinch');
    expect(
      transitionNavigationState('idle', {
        type: 'pointer-down',
        pointerType: 'touch',
        pointerCount: 3,
      }).next,
    ).toBe('touch-pinch');
  });

  it('mouse pointer events leave the state machine alone', () => {
    const t = transitionNavigationState('idle', {
      type: 'pointer-down',
      pointerType: 'mouse',
      pointerCount: 1,
    });
    expect(t.next).toBe('idle');
  });

  it('a second touch finger promotes pan to pinch', () => {
    const t = transitionNavigationState('touch-pan', {
      type: 'pointer-move',
      pointerType: 'touch',
      pointerCount: 2,
    });
    expect(t.next).toBe('touch-pinch');
  });

  it('losing a finger demotes pinch to pan and finishes the pinch', () => {
    const t = transitionNavigationState('touch-pinch', {
      type: 'pointer-move',
      pointerType: 'touch',
      pointerCount: 1,
    });
    expect(t.next).toBe('touch-pan');
    expect(t.finished).toBe(true);
  });

  it('releasing the last finger returns to idle and finishes', () => {
    const t = transitionNavigationState('touch-pan', {
      type: 'pointer-up',
      pointerType: 'touch',
      pointerCount: 0,
    });
    expect(t.next).toBe('idle');
    expect(t.finished).toBe(true);
  });

  it('releasing one of two fingers keeps a single-finger pan but finishes pinch', () => {
    const t = transitionNavigationState('touch-pinch', {
      type: 'pointer-up',
      pointerType: 'touch',
      pointerCount: 1,
    });
    expect(t.next).toBe('touch-pan');
    expect(t.finished).toBe(true);
  });

  it('pointer-cancel always collapses to idle', () => {
    for (const state of [
      'wheel-pan',
      'wheel-zoom',
      'touch-pan',
      'touch-pinch',
      'space-hand',
    ] as const) {
      const t = transitionNavigationState(state, { type: 'pointer-cancel' });
      expect(t.next).toBe('idle');
      expect(t.finished).toBe(true);
    }
  });

  it('blur and reset collapse any active gesture to idle', () => {
    for (const event of [{ type: 'blur' }, { type: 'reset' }] as const) {
      const t = transitionNavigationState('touch-pinch', event);
      expect(t.next).toBe('idle');
      expect(t.finished).toBe(true);
    }
  });

  it('space-down enters space-hand; space-up returns to idle', () => {
    expect(transitionNavigationState('idle', { type: 'space-down' }).next).toBe('space-hand');
    const t = transitionNavigationState('space-hand', { type: 'space-up' });
    expect(t.next).toBe('idle');
    expect(t.finished).toBe(true);
  });
});
