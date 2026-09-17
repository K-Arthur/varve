import { describe, expect, it } from 'vitest';
import { resolvePinchBridgeAction } from './pinchBridge';

describe('resolvePinchBridgeAction — GtkGestureZoom stream', () => {
  it('resolves a begin gesture with cumulative scale 1 and centre', () => {
    expect(resolvePinchBridgeAction({ phase: 'begin', scale: 1, x: 120.5, y: 64 })).toEqual({
      kind: 'gesture',
      phase: 'begin',
      scale: 1,
      x: 120.5,
      y: 64,
    });
  });

  it('resolves an update gesture with its cumulative scale', () => {
    expect(resolvePinchBridgeAction({ phase: 'update', scale: 1.37, x: 121, y: 65 })).toEqual({
      kind: 'gesture',
      phase: 'update',
      scale: 1.37,
      x: 121,
      y: 65,
    });
  });

  it('resolves an end gesture', () => {
    expect(resolvePinchBridgeAction({ phase: 'end', scale: 0.82, x: 10, y: 20 })?.kind).toBe(
      'gesture',
    );
  });

  it('falls back to scale 1 for a non-finite or non-positive scale', () => {
    expect(resolvePinchBridgeAction({ phase: 'update', scale: Number.NaN })).toMatchObject({
      scale: 1,
    });
    expect(resolvePinchBridgeAction({ phase: 'update', scale: 0 })).toMatchObject({ scale: 1 });
    expect(resolvePinchBridgeAction({ phase: 'update', scale: -2 })).toMatchObject({ scale: 1 });
    expect(resolvePinchBridgeAction({ phase: 'update' })).toMatchObject({ scale: 1 });
  });

  it('normalizes missing/non-finite centre coordinates to null (the canvas resolves a fallback anchor)', () => {
    expect(resolvePinchBridgeAction({ phase: 'begin' })).toMatchObject({ x: null, y: null });
    expect(
      resolvePinchBridgeAction({ phase: 'update', scale: 1.1, x: Number.NaN, y: null }),
    ).toMatchObject({ x: null, y: null });
  });
});

describe('resolvePinchBridgeAction — WebKit page-zoom fallback factor', () => {
  it('resolves a positive finite factor', () => {
    expect(resolvePinchBridgeAction({ factor: 1.05 })).toEqual({ kind: 'factor', factor: 1.05 });
    expect(resolvePinchBridgeAction({ factor: 0.5 })).toEqual({ kind: 'factor', factor: 0.5 });
  });

  it('ignores zero, negative, and non-finite factors', () => {
    expect(resolvePinchBridgeAction({ factor: 0 })).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction({ factor: -1.2 })).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction({ factor: Number.NaN })).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction({ factor: Number.POSITIVE_INFINITY })).toEqual({
      kind: 'ignore',
    });
  });
});

describe('resolvePinchBridgeAction — malformed payloads', () => {
  it('ignores null/undefined and unknown shapes', () => {
    expect(resolvePinchBridgeAction(null)).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction(undefined)).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction({})).toEqual({ kind: 'ignore' });
    expect(resolvePinchBridgeAction({ phase: 'sideways' })).toEqual({ kind: 'ignore' });
  });
});
