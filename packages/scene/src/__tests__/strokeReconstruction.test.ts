import { describe, expect, it } from 'vitest';
import { catmullRomPoint, defaultBrushPreset, strokePoint } from '../brush';
import {
  appendStrokePoints,
  beginStroke,
  cloneStrokeEngineState,
  runWholeStroke,
} from '../strokeEngine';
import { reconstructCentripetalSegment } from '../strokeReconstruction';

function point(x: number, y: number, time: number, pressure: number = 0.5) {
  return strokePoint(x, y, {
    pressure,
    tilt: 30,
    tiltAzimuth: x > 0 ? -Math.PI + 0.1 : Math.PI - 0.1,
    time,
  });
}

function preset() {
  return {
    ...defaultBrushPreset('reconstruction', 'Reconstruction'),
    radius: 4,
    spacing: 0.25,
    smoothing: 0,
  };
}

function parabola(samples: number): ReturnType<typeof point>[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / Math.max(1, samples - 1);
    return point(160 * t, 96 * t * t, t * 1_000, 0.1 + 0.8 * t);
  });
}

function maxDistanceToPath(
  source: ReadonlyArray<{ x: number; y: number }>,
  reference: ReadonlyArray<{ x: number; y: number }>,
): number {
  return Math.max(
    ...source.map((sample) =>
      Math.min(
        ...reference.map((candidate) => Math.hypot(sample.x - candidate.x, sample.y - candidate.y)),
      ),
    ),
  );
}

describe('centripetal stroke reconstruction', () => {
  it('keeps a collinear trajectory exact', () => {
    const p0 = point(-10, 0, 0);
    const p1 = point(0, 0, 10);
    const p2 = point(10, 0, 20);
    const p3 = point(20, 0, 30);
    const midpoint = catmullRomPoint(p0, p1, p2, p3, 0.5);
    expect(midpoint.x).toBeCloseTo(5, 12);
    expect(midpoint.y).toBe(0);
  });

  it('reconstructs a smooth curve instead of the event chord without overshooting its bounds', () => {
    const p0 = point(-20, 0, 0);
    const p1 = point(0, 0, 10, 0.1);
    const p2 = point(20, 20, 20, 0.9);
    const p3 = point(20, 40, 30);
    const curve = reconstructCentripetalSegment(p0, p1, p2, p3, { maxChordLength: 0.5 });
    const midpoint = curve[Math.floor(curve.length / 2)]!;

    expect(Math.hypot(midpoint.x - 10, midpoint.y - 10)).toBeGreaterThan(0.2);
    expect(curve.every((sample) => sample.x >= -0.01 && sample.x <= 20.01)).toBe(true);
    expect(curve.every((sample) => sample.y >= -0.01 && sample.y <= 20.01)).toBe(true);
    expect(midpoint.pressure).toBeGreaterThan(0.1);
    expect(midpoint.pressure).toBeLessThan(0.9);
  });

  it('is invariant to worker batch partitioning and flushes the final tail', () => {
    const points = [
      point(0, 0, 0, 0.1),
      point(20, 0, 8, 0.25),
      point(35, 12, 16, 0.5),
      point(38, 34, 24, 0.8),
      point(55, 45, 32, 0.95),
    ];
    const whole = runWholeStroke(preset(), points, 1234).dabs;
    const state = beginStroke('partitioned', 0, preset(), 1234);
    const partitioned = [
      ...appendStrokePoints(state, points.slice(0, 2)).dabs,
      ...appendStrokePoints(state, points.slice(2, 4)).dabs,
      ...appendStrokePoints(state, points.slice(4)).dabs,
      ...appendStrokePoints(state, [], { final: true }).dabs,
    ];

    expect(partitioned).toHaveLength(whole.length);
    for (let index = 0; index < whole.length; index++) {
      expect(partitioned[index]!.x).toBeCloseTo(whole[index]!.x, 9);
      expect(partitioned[index]!.y).toBeCloseTo(whole[index]!.y, 9);
      expect(partitioned[index]!.strokeDistance).toBeCloseTo(whole[index]!.strokeDistance, 9);
    }
    expect(partitioned[partitioned.length - 1]!.x).toBeGreaterThan(50);
  });

  it('keeps authoritative state unchanged while a predicted tail is evaluated', () => {
    const points = [
      point(0, 0, 0, 0.1),
      point(12, 2, 8, 0.3),
      point(24, 12, 16, 0.6),
      point(30, 30, 24, 0.9),
    ];
    const authoritative = beginStroke('authoritative', 1, preset(), 77);
    const prefix = appendStrokePoints(authoritative, points.slice(0, 2));

    const prediction = cloneStrokeEngineState(authoritative);
    appendStrokePoints(prediction, points.slice(2), { final: true });

    const committed = appendStrokePoints(authoritative, points.slice(2), { final: true });
    const direct = runWholeStroke(preset(), points, 77);
    const authoritativeDabs = [...prefix.dabs, ...committed.dabs];

    expect(authoritativeDabs).toHaveLength(direct.dabs.length);
    for (let index = 0; index < direct.dabs.length; index++) {
      expect(authoritativeDabs[index]!.x).toBeCloseTo(direct.dabs[index]!.x, 9);
      expect(authoritativeDabs[index]!.y).toBeCloseTo(direct.dabs[index]!.y, 9);
    }
  });

  it('keeps sparse and dense event-rate traces on the same reconstructed curve', () => {
    const dense = runWholeStroke(preset(), parabola(241), 18).dabs;
    const sparse = runWholeStroke(preset(), parabola(31), 18).dabs;

    // The input rate changes the spline's local estimate a little, but it must
    // never turn a continuous curve into visible, event-sized chords. A 2px
    // bound is tighter than one normal dab spacing for this 8px-diameter tip.
    expect(maxDistanceToPath(sparse, dense)).toBeLessThan(2);
    expect(maxDistanceToPath(dense, sparse)).toBeLessThan(2);
  });

  it('contains a sharp corner without spline overshoot', () => {
    const corner = reconstructCentripetalSegment(
      point(0, 0, 0),
      point(12, 0, 10),
      point(12, 12, 20),
      point(12, 30, 30),
      { maxChordLength: 0.25 },
    );

    expect(corner.every((sample) => sample.x >= -0.001 && sample.x <= 12.001)).toBe(true);
    expect(corner.every((sample) => sample.y >= -0.001 && sample.y <= 12.001)).toBe(true);
  });
});
