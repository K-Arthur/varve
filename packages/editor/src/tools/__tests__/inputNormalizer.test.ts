import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizeInputEvents,
  collectSourceEvents,
  detectPlatformCapabilities,
  hasGenuineStylusData,
  inputToStrokePoint,
  normalizeInputEvent,
  worldDistanceForCssPixels,
} from '../inputNormalizer';

function makePointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: 100,
    clientY: 200,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 'mouse',
    pointerId: 1,
    isPrimary: true,
    button: 0,
    timeStamp: performance.now(),
    getCoalescedEvents: undefined as unknown as () => PointerEvent[],
    getPredictedEvents: undefined as unknown as () => PointerEvent[],
    ...overrides,
  } as unknown as PointerEvent;
}

describe('normalizeInputEvent', () => {
  it('normalizes mouse events with 0.5 pressure default', () => {
    const ev = makePointerEvent({ pointerType: 'mouse' });
    const n = normalizeInputEvent(ev);
    expect(n.pressure).toBe(0.5);
    expect(n.pointerType).toBe('mouse');
    expect(n.clientX).toBe(100);
    expect(n.isEraser).toBe(false);
  });

  it('passes through genuine pen pressure', () => {
    const ev = makePointerEvent({ pointerType: 'pen', pressure: 0.75 });
    const n = normalizeInputEvent(ev);
    expect(n.pressure).toBe(0.75);
    expect(n.pointerType).toBe('pen');
  });

  it('preserves a zero-pressure pen sample instead of substituting mouse pressure', () => {
    const n = normalizeInputEvent(makePointerEvent({ pointerType: 'pen', pressure: 0 }));
    expect(n.pressure).toBe(0);
  });

  it('clamps pressure to [0, 1]', () => {
    const lo = normalizeInputEvent(makePointerEvent({ pointerType: 'pen', pressure: -0.1 }));
    expect(lo.pressure).toBe(0);
    const hi = normalizeInputEvent(makePointerEvent({ pointerType: 'pen', pressure: 1.5 }));
    expect(hi.pressure).toBe(1);
  });

  it('passes through touch pressure', () => {
    const ev = makePointerEvent({ pointerType: 'touch', pressure: 0.3 });
    const n = normalizeInputEvent(ev);
    expect(n.pressure).toBe(0.3);
  });

  it('passes through tilt and twist', () => {
    const ev = makePointerEvent({ pointerType: 'pen', tiltX: 30, tiltY: -15, twist: 90 });
    const n = normalizeInputEvent(ev);
    expect(n.tiltX).toBe(30);
    expect(n.tiltY).toBe(-15);
    expect(n.twist).toBe(90);
  });

  it('defaults twist to -1 when unavailable', () => {
    const ev = makePointerEvent({ pointerType: 'pen', twist: undefined as unknown as number });
    const n = normalizeInputEvent(ev);
    expect(n.twist).toBe(-1);
  });

  it('clamps tilt to [-90, 90]', () => {
    const ev = makePointerEvent({ tiltX: 100, tiltY: -100 });
    const n = normalizeInputEvent(ev);
    expect(n.tiltX).toBe(90);
    expect(n.tiltY).toBe(-90);
  });

  it('wraps twist to [0, 360)', () => {
    const ev = makePointerEvent({ twist: 450 });
    const n = normalizeInputEvent(ev);
    expect(n.twist).toBe(90);
  });

  it('detects eraser end from button=5 on pen', () => {
    const ev = makePointerEvent({ pointerType: 'pen', button: 5 });
    const n = normalizeInputEvent(ev);
    expect(n.isEraser).toBe(true);
  });

  it('computes altitudeAngle from tilt when absent', () => {
    const ev = makePointerEvent({ tiltY: 45, altitudeAngle: undefined as unknown as number });
    const n = normalizeInputEvent(ev);
    expect(n.altitudeAngle).toBeCloseTo(Math.PI / 4, 3);
  });

  it('preserves explicit altitudeAngle', () => {
    const ev = makePointerEvent({ altitudeAngle: 1.2 });
    const n = normalizeInputEvent(ev);
    expect(n.altitudeAngle).toBe(1.2);
  });

  it('preserves isPrimary and pointerId', () => {
    const ev = makePointerEvent({ pointerId: 7, isPrimary: false });
    const n = normalizeInputEvent(ev);
    expect(n.pointerId).toBe(7);
    expect(n.isPrimary).toBe(false);
  });

  it('preserves trusted per-sample timestamps for velocity and filtering', () => {
    const now = performance.now();
    const n = normalizeInputEvent(makePointerEvent({ timeStamp: now - 8 }));
    expect(n.time).toBeCloseTo(now - 8, 3);
  });

  it('rejects legacy epoch-domain timestamps before mixing with RAF time', () => {
    const n = normalizeInputEvent(makePointerEvent({ timeStamp: Date.now() }));
    expect(Math.abs(n.time - performance.now())).toBeLessThan(20);
  });

  it('uses safe defaults for malformed optional stylus values', () => {
    const n = normalizeInputEvent(
      makePointerEvent({
        tiltX: Number.NaN,
        tiltY: Number.NaN,
        altitudeAngle: Number.NaN,
        azimuthAngle: Number.NaN,
        tangentialPressure: Number.NaN,
        width: Number.NaN,
        height: Number.NaN,
      } as Partial<PointerEvent>),
    );
    expect(n.tiltX).toBe(0);
    expect(n.tiltY).toBe(0);
    expect(n.altitudeAngle).toBe(Math.PI / 2);
    expect(n.azimuthAngle).toBe(0);
    expect(n.tangentialPressure).toBe(0);
    expect(n.width).toBe(1);
    expect(n.height).toBe(1);
  });
});

describe('collectSourceEvents', () => {
  it('returns single event when getCoalescedEvents is absent', () => {
    const ev = makePointerEvent({ pointerType: 'pen', pressure: 0.8 });
    const events = collectSourceEvents(ev);
    expect(events.length).toBe(1);
    expect(events[0]!.pressure).toBe(0.8);
  });

  it('uses coalesced events when available', () => {
    const now = performance.now();
    const ev = makePointerEvent({
      pressure: 0.9,
      getCoalescedEvents: () =>
        [
          makePointerEvent({ clientX: 101, pressure: 0.5, timeStamp: now - 4 }),
          makePointerEvent({ clientX: 102, pressure: 0.6, timeStamp: now - 2 }),
        ] as unknown as PointerEvent[],
    });
    const events = collectSourceEvents(ev);
    expect(events.length).toBe(3);
    expect(events[0]!.clientX).toBe(101);
    expect(events[1]!.clientX).toBe(102);
    expect(events[2]!.clientX).toBe(100);
    expect(events.map((event) => event.time)).toEqual([now - 4, now - 2, expect.any(Number)]);
  });

  it('marks predicted events when requested', () => {
    const ev = makePointerEvent({
      getCoalescedEvents: () => [makePointerEvent({ clientX: 100 })] as unknown as PointerEvent[],
      getPredictedEvents: () => [makePointerEvent({ clientX: 105 })] as unknown as PointerEvent[],
    });
    const events = collectSourceEvents(ev, true);
    expect(events.length).toBe(3);
    expect(events[0]!.isPredicted).toBe(false);
    expect(events[1]!.isPredicted).toBe(false);
    expect(events[2]!.isPredicted).toBe(true);
    expect(events[2]!.clientX).toBe(105);
  });

  it('excludes predicted events when not requested', () => {
    const ev = makePointerEvent({
      getCoalescedEvents: () => [makePointerEvent({ clientX: 100 })] as unknown as PointerEvent[],
      getPredictedEvents: () => [makePointerEvent({ clientX: 105 })] as unknown as PointerEvent[],
    });
    const events = collectSourceEvents(ev, false);
    expect(events.length).toBe(2);
  });

  it('orders samples, removes duplicates, and gives confirmed input priority', () => {
    const now = performance.now();
    const early = normalizeInputEvent(makePointerEvent({ clientX: 10, timeStamp: now - 8 }));
    const late = normalizeInputEvent(makePointerEvent({ clientX: 30, timeStamp: now - 2 }));
    const duplicate = { ...late };
    const predictedDuplicate = { ...late, isPredicted: true };
    const predicted = {
      ...normalizeInputEvent(makePointerEvent({ clientX: 40, timeStamp: now + 2 })),
      isPredicted: true,
    };

    expect(
      canonicalizeInputEvents([late, predicted, duplicate, early, predictedDuplicate]),
    ).toEqual([early, late, predicted]);
  });
});

describe('inputToStrokePoint', () => {
  it('creates a StrokePoint from normalized input', () => {
    const input: import('../inputNormalizer').NormalizedInputEvent = {
      clientX: 100,
      clientY: 200,
      pressure: 0.75,
      tiltX: 30,
      tiltY: 15,
      twist: 45,
      tangentialPressure: 0,
      width: 2,
      height: 2,
      pointerType: 'pen',
      altitudeAngle: Math.PI / 3,
      azimuthAngle: 0.5,
      isPredicted: false,
      time: 1000,
      isEraser: false,
      isPrimary: true,
      pointerId: 1,
    };
    const sp = inputToStrokePoint(input, { x: 50, y: 60 });
    expect(sp.x).toBe(50);
    expect(sp.y).toBe(60);
    expect(sp.pressure).toBe(0.75);
    expect(sp.tilt).toBeCloseTo(32.477, 3);
    expect(sp.tiltAzimuth).toBe(0.5);
    expect(sp.twist).toBe(45);
    expect(sp.tangentialPressure).toBe(0);
    expect(sp.time).toBe(1000);
  });

  it('computes speed and direction from previous point', () => {
    const input: import('../inputNormalizer').NormalizedInputEvent = {
      clientX: 100,
      clientY: 200,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: -1,
      tangentialPressure: 0,
      width: 1,
      height: 1,
      pointerType: 'mouse',
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      isPredicted: false,
      time: 2000,
      isEraser: false,
      isPrimary: true,
      pointerId: 1,
    };
    const sp = inputToStrokePoint(input, { x: 110, y: 200 }, { x: 100, y: 200, time: 1000 });
    expect(sp.speed).toBeCloseTo(10, 5);
    expect(sp.direction).toBeCloseTo(0, 3);
  });

  it('handles zero time delta gracefully', () => {
    const input: import('../inputNormalizer').NormalizedInputEvent = {
      clientX: 100,
      clientY: 200,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: -1,
      tangentialPressure: 0,
      width: 1,
      height: 1,
      pointerType: 'mouse',
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      isPredicted: false,
      time: 1000,
      isEraser: false,
      isPrimary: true,
      pointerId: 1,
    };
    const sp = inputToStrokePoint(input, { x: 100, y: 200 }, { x: 100, y: 200, time: 1000 });
    expect(sp.speed).toBe(0);
  });
});

describe('hasGenuineStylusData', () => {
  it('returns false for mouse', () => {
    expect(hasGenuineStylusData(makePointerEvent({ pointerType: 'mouse' }))).toBe(false);
  });

  it('returns false for pen with no data', () => {
    expect(
      hasGenuineStylusData(
        makePointerEvent({ pointerType: 'pen', pressure: 0, tiltX: 0, tiltY: 0, twist: 0 }),
      ),
    ).toBe(false);
  });

  it('returns true for pen with pressure', () => {
    expect(hasGenuineStylusData(makePointerEvent({ pointerType: 'pen', pressure: 0.5 }))).toBe(
      true,
    );
  });

  it('returns true for pen with tilt', () => {
    expect(hasGenuineStylusData(makePointerEvent({ pointerType: 'pen', tiltX: 30 }))).toBe(true);
  });
});

describe('worldDistanceForCssPixels', () => {
  it('returns cssPixels at zoom=1', () => {
    expect(worldDistanceForCssPixels(3, 1)).toBe(3);
  });

  it('returns fewer world units at higher zoom', () => {
    expect(worldDistanceForCssPixels(3, 2)).toBe(1.5);
  });

  it('returns more world units at lower zoom', () => {
    expect(worldDistanceForCssPixels(3, 0.5)).toBe(6);
  });

  it('handles invalid zoom gracefully', () => {
    expect(worldDistanceForCssPixels(3, 0)).toBe(3);
  });
});

describe('detectPlatformCapabilities', () => {
  beforeEach(() => {
    // Reset the cached detection
    vi.resetModules();
  });

  it('returns initial detection', () => {
    const caps = detectPlatformCapabilities();
    expect(caps).toHaveProperty('hasCoalescedEvents');
    expect(caps).toHaveProperty('hasPredictedEvents');
    expect(caps).toHaveProperty('hasOffscreenCanvas');
  });
});
