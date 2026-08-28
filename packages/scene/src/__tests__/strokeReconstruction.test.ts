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
});
