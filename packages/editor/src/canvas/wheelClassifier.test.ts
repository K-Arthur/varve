import { describe, expect, it } from 'vitest';
import { classifyWheelEvent, normalizeWheelDelta } from './wheelClassifier';

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
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaX: 20, deltaY: 0 }))).toBe(
      'trackpad',
    );
  });

  it('classifies horizontal mouse deltas', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaX: 120, deltaY: 0 }))).toBe(
      'mouse',
    );
  });

  it('returns unknown for borderline pixel deltas (50-119)', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 60 }))).toBe('unknown');
  });

  it('returns unknown for zero deltas', () => {
    expect(classifyWheelEvent(makeWheel({ deltaMode: 0, deltaY: 0, deltaX: 0 }))).toBe(
      'unknown',
    );
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
