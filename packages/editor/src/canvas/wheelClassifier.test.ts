import { describe, expect, it } from 'vitest';
import { classifyWheelEvent, normalizeWheelDelta, resolveWheelAction } from './wheelClassifier';

function makeWheel(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  } as WheelEvent;
}

describe('classifyWheelEvent', () => {
  it('classifies line-mode as mouse', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 1, deltaY: 3 }))).toBe('mouse');
  });

  it('classifies page-mode as mouse', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 2, deltaY: 1 }))).toBe('mouse');
  });

  it('classifies small pixel-mode deltas as trackpad', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 10 }))).toBe('trackpad');
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: -5 }))).toBe('trackpad');
  });

  it('classifies large pixel-mode deltas as mouse', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 120 }))).toBe('mouse');
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: -150 }))).toBe('mouse');
  });

  it('classifies horizontal trackpad deltas', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaX: 20, deltaY: 0 }))).toBe('trackpad');
  });

  it('classifies horizontal mouse deltas', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaX: 120, deltaY: 0 }))).toBe('mouse');
  });

  it('returns unknown for borderline pixel deltas (50-119)', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 60 }))).toBe('unknown');
  });

  it('returns unknown for zero deltas', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 0, deltaX: 0 }))).toBe('unknown');
  });
});

describe('normalizeWheelDelta', () => {
  it('passes through pixel-mode deltas', () => {
    expect(normalizeWheelDelta(40, 0, 800)).toBe(40);
  });

  it('multiplies line-mode deltas by 16', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
  });

  it('multiplies page-mode deltas by client height', () => {
    expect(normalizeWheelDelta(1, 2, 800)).toBe(800);
  });

  it('handles negative deltas', () => {
    expect(normalizeWheelDelta(-3, 1, 800)).toBe(-48);
  });
});

describe('resolveWheelAction', () => {
  function wheel(
    overrides: {
      deltaX?: number;
      deltaY?: number;
      deltaMode?: number;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
      clientHeight?: number;
    } = {},
  ) {
    return {
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      clientHeight: 800,
      ...overrides,
    };
  }

  it('classifies ctrl+wheel as zoom with a scale around 1', () => {
    const action = resolveWheelAction(wheel({ ctrlKey: true, deltaY: -10 }));
    expect(action.kind).toBe('zoom');
    expect(action.scale).toBeGreaterThan(1);
    expect(action.scale).toBeLessThan(1.2);
    expect(action.applyInertia).toBe(false);
  });

  it('zooms out for positive (downward) ctrl+wheel', () => {
    const action = resolveWheelAction(wheel({ ctrlKey: true, deltaY: 10 }));
    expect(action.kind).toBe('zoom');
    expect(action.scale).toBeLessThan(1);
  });

  it('recognizes metaKey as zoom too (macOS)', () => {
    const action = resolveWheelAction(wheel({ metaKey: true, deltaY: -10 }));
    expect(action.kind).toBe('zoom');
  });

  it('clamps pathological zoom deltas', () => {
    const clamped = resolveWheelAction(wheel({ ctrlKey: true, deltaY: 5000 }));
    expect(clamped.kind).toBe('zoom');
    // Clamped to ±24 → scale ~ e^-0.24, not e^-50.
    expect(clamped.scale).toBeGreaterThan(0.5);
    const unclamped = resolveWheelAction(wheel({ ctrlKey: true, deltaY: -5000 }));
    expect(unclamped.scale).toBeLessThan(2);
  });

  it('pans 2D for plain mouse wheel pixel deltas', () => {
    // A detented mouse wheel in pixel mode emits ≥120px per notch.
    const action = resolveWheelAction(wheel({ deltaX: 10, deltaY: 130 }));
    expect(action.kind).toBe('pan');
    expect(action.deltaX).toBe(-10);
    expect(action.deltaY).toBe(-130);
    expect(action.applyInertia).toBe(true);
  });

  it('does not apply app inertia for trackpad pixel deltas', () => {
    // A small pixel delta is a precision-trackpad two-finger scroll.
    const action = resolveWheelAction(wheel({ deltaY: 10 }));
    expect(action.kind).toBe('pan');
    expect(action.deltaY).toBe(-10);
    expect(action.applyInertia).toBe(false);
  });

  it('applies inertia for mouse-wheel line-mode input', () => {
    const action = resolveWheelAction(wheel({ deltaY: 3, deltaMode: 1 }));
    expect(action.kind).toBe('pan');
    expect(action.deltaY).toBe(-48); // 3 lines * 16
    expect(action.applyInertia).toBe(true);
  });

  it('treats borderline (unknown) deltas like mouse for inertia', () => {
    const action = resolveWheelAction(wheel({ deltaY: 60 }));
    expect(action.kind).toBe('pan');
    expect(action.applyInertia).toBe(true);
  });

  it('routes shift+vertical-wheel to horizontal pan', () => {
    const action = resolveWheelAction(wheel({ shiftKey: true, deltaY: -20 }));
    expect(action.kind).toBe('pan');
    expect(action.deltaX).toBe(20);
    expect(action.deltaY).toBe(0);
    expect(action.shiftHeld).toBe(true);
    expect(action.applyInertia).toBe(false);
  });

  it('pans diagonally when both axes are present', () => {
    const action = resolveWheelAction(wheel({ deltaX: -15, deltaY: 8 }));
    expect(action.deltaX).toBe(15);
    expect(action.deltaY).toBe(-8);
  });

  it('normalizes page-mode panning by client height', () => {
    const action = resolveWheelAction(wheel({ deltaY: 1, deltaMode: 2, clientHeight: 600 }));
    expect(action.deltaY).toBe(-600);
  });
});
