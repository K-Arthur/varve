import type { StrokePoint } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIST_CONFIG,
  MirrorAssist,
  Stabilizer,
  StraightLineAssist,
} from '../drawingAssists';

function makeSP(x: number, y: number, opts: Partial<StrokePoint> = {}): StrokePoint {
  return {
    x,
    y,
    pressure: opts.pressure ?? 0.5,
    tilt: opts.tilt ?? 0,
    direction: opts.direction ?? 0,
    speed: opts.speed ?? 0,
    time: opts.time ?? performance.now(),
  };
}

describe('Stabilizer', () => {
  it('passes through when disabled', () => {
    const s = new Stabilizer({ enabled: false });
    const sp = makeSP(10, 20);
    expect(s.stabilize(sp)).toBe(sp);
  });

  it('returns null with only 1 point', () => {
    const s = new Stabilizer({ enabled: true, strength: 0.5 });
    expect(s.stabilize(makeSP(10, 20))).toBeNull();
  });

  it('returns smoothed point with 2+ points', () => {
    const s = new Stabilizer({ enabled: true, strength: 0.5, adaptive: false });
    s.stabilize(makeSP(0, 0));
    const result = s.stabilize(makeSP(100, 100));
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThan(0);
    expect(result!.x).toBeLessThan(100);
    expect(result!.y).toBeGreaterThan(0);
    expect(result!.y).toBeLessThan(100);
  });

  it('returns identity at strength=0', () => {
    const s = new Stabilizer({ enabled: true, strength: 0 });
    s.stabilize(makeSP(0, 0));
    const result = s.stabilize(makeSP(100, 200));
    expect(result!.x).toBe(100);
    expect(result!.y).toBe(200);
  });

  it('drains remaining history on drain()', () => {
    const s = new Stabilizer({ enabled: true, finishMode: true });
    for (let i = 0; i < 10; i++) {
      s.stabilize(makeSP(i * 10, i * 5));
    }
    const drained = s.drain();
    expect(drained.length).toBeGreaterThan(0);
    expect(drained[0]!.pressure).toBeLessThanOrEqual(0.5);
  });

  it('reset clears history', () => {
    const s = new Stabilizer({ enabled: true });
    s.stabilize(makeSP(0, 0));
    s.stabilize(makeSP(10, 10));
    expect(s.getHistoryLength()).toBe(2);
    s.reset();
    expect(s.getHistoryLength()).toBe(0);
  });

  it('updateConfig changes behavior', () => {
    const s = new Stabilizer({ enabled: false });
    const sp = makeSP(10, 20);
    expect(s.stabilize(sp)).toBe(sp);
    s.updateConfig({ enabled: true, strength: 1 });
    s.stabilize(makeSP(0, 0));
    const result = s.stabilize(makeSP(100, 100));
    expect(result).not.toBeNull();
    expect(result!.x).not.toBe(100); // Fully smoothed toward prev
  });
});

describe('StraightLineAssist', () => {
  it('passes through when disabled', () => {
    const a = new StraightLineAssist({ enabled: false });
    const sp = makeSP(50, 60);
    const r = a.process(sp, 0, 0, 1);
    expect(r.point).toBe(sp);
    expect(r.isActive).toBe(false);
  });

  it('does not activate below threshold', () => {
    const a = new StraightLineAssist({ enabled: true, activationDistancePx: 50 });
    const sp = makeSP(20, 20);
    const r = a.process(sp, 0, 0, 1);
    expect(r.isActive).toBe(false);
    expect(r.point.x).toBe(20);
    expect(r.point.y).toBe(20);
  });

  it('activates and snaps to horizontal', () => {
    const a = new StraightLineAssist({
      enabled: true,
      activationDistancePx: 10,
      angleSnapIncrement: Math.PI / 4,
      lockAfterActivation: true,
    });
    // Move mostly horizontally
    const sp = makeSP(100, 3);
    const r = a.process(sp, 0, 0, 1);
    expect(r.isActive).toBe(true);
    expect(r.point.y).toBeCloseTo(0, 1); // Snapped to horizontal
  });

  it('activates and snaps to vertical', () => {
    const a = new StraightLineAssist({
      enabled: true,
      activationDistancePx: 10,
      angleSnapIncrement: Math.PI / 4,
      lockAfterActivation: true,
    });
    const sp = makeSP(3, 100);
    const r = a.process(sp, 0, 0, 1);
    expect(r.isActive).toBe(true);
    expect(r.point.x).toBeCloseTo(0, 1); // Snapped to vertical
  });

  it('activates and snaps to 45 degrees', () => {
    const a = new StraightLineAssist({
      enabled: true,
      activationDistancePx: 10,
      angleSnapIncrement: Math.PI / 4,
      lockAfterActivation: true,
    });
    const sp = makeSP(100, 100);
    const r = a.process(sp, 0, 0, 1);
    expect(r.isActive).toBe(true);
    expect(r.point.x).toBeCloseTo(r.point.y, 1);
  });

  it('reset clears activation', () => {
    const a = new StraightLineAssist({ enabled: true, activationDistancePx: 10 });
    a.process(makeSP(100, 0), 0, 0, 1);
    expect(a.isActive()).toBe(true);
    a.reset();
    expect(a.isActive()).toBe(false);
  });
});

describe('MirrorAssist', () => {
  it('returns single point when disabled', () => {
    const m = new MirrorAssist({ enabled: false });
    const sp = makeSP(10, 20);
    const result = m.mirror(sp);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(sp);
  });

  it('mirrors across vertical axis (radialSymmetry=2)', () => {
    const m = new MirrorAssist({
      enabled: true,
      axisX: 0,
      axisY: 0,
      angle: 0,
      radialSymmetry: 2,
    });
    const sp = makeSP(100, 50);
    const result = m.mirror(sp);
    expect(result.length).toBe(2);
    expect(result[0]!.x).toBe(100);
    expect(result[0]!.y).toBe(50);
    expect(result[1]!.x).toBeCloseTo(100, 5); // Radial 180 = mirror across angle 0
    expect(result[1]!.y).toBeCloseTo(-50, 5);
  });

  it('mirrors across horizontal axis', () => {
    const m = new MirrorAssist({
      enabled: true,
      axisX: 0,
      axisY: 0,
      angle: Math.PI / 2,
      radialSymmetry: 2,
    });
    const sp = makeSP(100, 50);
    const result = m.mirror(sp);
    expect(result.length).toBe(2);
    expect(result[1]!.x).toBeCloseTo(-100, 5);
    expect(result[1]!.y).toBeCloseTo(50, 5);
  });

  it('creates 4-way symmetry (radialSymmetry=4)', () => {
    const m = new MirrorAssist({
      enabled: true,
      axisX: 0,
      axisY: 0,
      angle: 0,
      radialSymmetry: 4,
    });
    const sp = makeSP(100, 0);
    const result = m.mirror(sp);
    expect(result.length).toBe(4);
  });

  it('mirrorDab generates mirrored copies', () => {
    const m = new MirrorAssist({
      enabled: true,
      axisX: 0,
      axisY: 0,
      angle: 0,
      radialSymmetry: 2,
    });
    const dab = {
      x: 100,
      y: 50,
      radius: 10,
      opacity: 1,
      flow: 1,
      hardness: 0.8,
      angle: 0,
      roundness: 1,
      strokeT: 0.5,
      strokeDistance: 0,
    };
    const result = m.mirrorDab(dab);
    expect(result.length).toBe(2);
    expect(result[1]!.x).toBeCloseTo(100, 5);
  });
});

describe('DEFAULT_ASSIST_CONFIG', () => {
  it('has all sections', () => {
    expect(DEFAULT_ASSIST_CONFIG.stabilizer).toBeDefined();
    expect(DEFAULT_ASSIST_CONFIG.straightLine).toBeDefined();
    expect(DEFAULT_ASSIST_CONFIG.mirror).toBeDefined();
  });

  it('stabilizer defaults are sensible', () => {
    const s = DEFAULT_ASSIST_CONFIG.stabilizer;
    expect(s.enabled).toBe(false);
    expect(s.strength).toBe(0.5);
    expect(s.maxWindowSize).toBe(16);
  });
});
