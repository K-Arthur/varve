import { describe, expect, it } from 'vitest';
import {
  findNearestKeyframeIndex,
  projectPointOnPath,
  projectPointOnPathWithKeyframes,
  snapToFrame,
  snapToKeyframe,
} from './pathProjection';
import type { KeyframeEntry, PathSample } from './pathProjection';

function makeSample(x: number, y: number, timeMs: number): PathSample {
  return { x, y, timeMs };
}

describe('projectPointOnPath', () => {
  it('returns Infinity dist and zero progress for empty samples', () => {
    const r = projectPointOnPath([], { x: 10, y: 20 });
    expect(r.dist).toBe(Infinity);
    expect(r.progress).toBe(0);
    expect(r.timeMs).toBe(0);
  });

  it('projects onto a single sample', () => {
    const samples = [makeSample(0, 0, 0)];
    const r = projectPointOnPath(samples, { x: 3, y: 4 });
    expect(r.point).toEqual({ x: 0, y: 0 });
    expect(r.dist).toBe(25); // 3² + 4²
    expect(r.timeMs).toBe(0);
  });

  it('projects onto a straight horizontal line at midpoint', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 1000)];
    const r = projectPointOnPath(samples, { x: 50, y: 30 });
    expect(r.point.x).toBe(50);
    expect(r.point.y).toBe(0);
    expect(r.dist).toBe(900); // 30²
    expect(r.timeMs).toBe(500);
    expect(r.progress).toBeCloseTo(0.5);
    expect(r.segmentIndex).toBe(0);
  });

  it('projects onto a straight vertical line', () => {
    const samples = [makeSample(0, 0, 0), makeSample(0, 200, 2000)];
    const r = projectPointOnPath(samples, { x: 50, y: 100 });
    expect(r.point.x).toBe(0);
    expect(r.point.y).toBe(100);
    expect(r.dist).toBe(2500);
    expect(r.timeMs).toBe(1000);
    expect(r.progress).toBeCloseTo(0.5);
  });

  it('clamps projection beyond segment start (t<0)', () => {
    const samples = [makeSample(10, 10, 0), makeSample(100, 10, 1000)];
    const r = projectPointOnPath(samples, { x: 0, y: 50 });
    // Projection falls before p1 → clamped to p1
    expect(r.point.x).toBe(10);
    expect(r.point.y).toBe(10);
    expect(r.timeMs).toBe(0);
    expect(r.progress).toBeCloseTo(0);
  });

  it('clamps projection beyond segment end (t>1)', () => {
    const samples = [makeSample(10, 10, 0), makeSample(100, 10, 1000)];
    const r = projectPointOnPath(samples, { x: 200, y: 50 });
    expect(r.point.x).toBe(100);
    expect(r.point.y).toBe(10);
    expect(r.timeMs).toBe(1000);
    expect(r.progress).toBeCloseTo(1);
  });

  it('handles zero-length segment (degenerate)', () => {
    const samples = [makeSample(50, 50, 0), makeSample(50, 50, 500), makeSample(100, 50, 1000)];
    const r = projectPointOnPath(samples, { x: 50, y: 50 });
    // Should snap to the zero-length segment's point
    expect(r.point.x).toBe(50);
    expect(r.point.y).toBe(50);
    expect(r.dist).toBe(0);
  });

  it('picks the closer segment on a multi-segment path', () => {
    // L-shaped path: (0,0)→(100,0)→(100,100)
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 1000), makeSample(100, 100, 2000)];
    const r = projectPointOnPath(samples, { x: 110, y: 50 });
    // Closer to the vertical segment (100,0)→(100,100)
    expect(r.segmentIndex).toBe(1);
    expect(r.point.x).toBe(100);
    expect(r.point.y).toBe(50);
    expect(r.dist).toBe(100); // 10²
  });

  it('handles point exactly at the junction of two segments', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 1000), makeSample(200, 0, 2000)];
    const r = projectPointOnPath(samples, { x: 100, y: 0 });
    expect(r.point.x).toBe(100);
    expect(r.point.y).toBe(0);
    expect(r.dist).toBe(0);
    // Could be segment 0 (end) or segment 1 (start) — both are valid
    expect(r.timeMs).toBe(1000);
  });

  it('computes correct progress on a two-segment path', () => {
    // Two equal-length segments: total length = 200
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 500), makeSample(200, 0, 1000)];
    const r = projectPointOnPath(samples, { x: 150, y: 0 });
    expect(r.progress).toBeCloseTo(0.75);
    expect(r.timeMs).toBe(750);
  });

  it('handles very close points without NaN', () => {
    const samples = [makeSample(0, 0, 0), makeSample(1e-10, 1e-10, 100)];
    const r = projectPointOnPath(samples, { x: 1e-11, y: 1e-11 });
    expect(Number.isFinite(r.dist)).toBe(true);
    expect(Number.isFinite(r.timeMs)).toBe(true);
    expect(Number.isFinite(r.progress)).toBe(true);
  });
});

describe('projectPointOnPathWithKeyframes', () => {
  it('returns snapTarget none when no keyframes provided', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 100, 1000)];
    const r = projectPointOnPathWithKeyframes(samples, { x: 50, y: 50 }, []);
    expect(r.snapTarget).toBe('none');
    expect(r.snapTimeMs).toBeUndefined();
  });

  it('snaps to nearest keyframe when within threshold', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 1000), makeSample(100, 100, 2000)];
    const keyframes: KeyframeEntry[] = [
      { timeMs: 0, progress: 0 },
      { timeMs: 1000, progress: 0.5 },
      { timeMs: 2000, progress: 1 },
    ];
    // Point at (90, 0) on segment 0: t=0.9, total length 200, progress = 0.9*100/200 = 0.45
    // Nearest keyframe by progress: 0.5 (dist 0.0025 < threshold 0.5²)
    const r = projectPointOnPathWithKeyframes(
      samples,
      { x: 90, y: 0 },
      keyframes,
      0.25, // threshold in progress-space (squared): 0.5²
    );
    expect(r.snapTarget).toBe('keyframe');
    expect(r.snapTimeMs).toBe(1000);
  });

  it('does not snap when outside threshold', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 1000)];
    const keyframes: KeyframeEntry[] = [
      { timeMs: 0, progress: 0 },
      { timeMs: 1000, progress: 1 },
    ];
    const r = projectPointOnPathWithKeyframes(
      samples,
      { x: 50, y: 0 },
      keyframes,
      0.01, // very tight threshold
    );
    // progress ~0.5, nearest keyframe progress 0 or 1 → distance 0.25 > 0.01
    expect(r.snapTarget).toBe('none');
  });
});

describe('snapToFrame', () => {
  it('snaps to nearest frame at 60fps', () => {
    // 12ms is closer to frame 1 (16.67ms) than frame 0 (0ms)
    expect(snapToFrame(12)).toBeCloseTo(1000 / 60);
    expect(snapToFrame(0)).toBe(0);
    expect(snapToFrame(25)).toBeCloseTo(2 * (1000 / 60));
  });

  it('snaps at 30fps', () => {
    // 20ms is closer to frame 1 (33.33ms) than frame 0 (0ms)
    expect(snapToFrame(20, 30)).toBeCloseTo(1000 / 30);
    expect(snapToFrame(50, 30)).toBeCloseTo(2 * (1000 / 30));
  });

  it('snaps at 24fps', () => {
    const frameDuration = 1000 / 24;
    expect(snapToFrame(0, 24)).toBe(0);
    expect(snapToFrame(frameDuration * 0.4, 24)).toBeCloseTo(0);
    expect(snapToFrame(frameDuration * 0.6, 24)).toBeCloseTo(frameDuration);
  });

  it('snaps exact frame boundaries unchanged', () => {
    const frameDuration = 1000 / 60;
    expect(snapToFrame(frameDuration, 60)).toBeCloseTo(frameDuration);
    expect(snapToFrame(frameDuration * 3, 60)).toBeCloseTo(frameDuration * 3);
  });
});

describe('snapToKeyframe', () => {
  it('returns false for empty keyframes', () => {
    const r = snapToKeyframe(100, []);
    expect(r.snapped).toBe(false);
    expect(r.timeMs).toBe(100);
  });

  it('snaps to nearest keyframe within threshold', () => {
    const r = snapToKeyframe(105, [0, 100, 200, 300], 10);
    expect(r.snapped).toBe(true);
    expect(r.timeMs).toBe(100);
  });

  it('does not snap when outside threshold', () => {
    const r = snapToKeyframe(150, [0, 100, 200, 300], 10);
    expect(r.snapped).toBe(false);
    expect(r.timeMs).toBe(150);
  });

  it('snaps to exact keyframe time', () => {
    const r = snapToKeyframe(200, [0, 100, 200], 5);
    expect(r.snapped).toBe(true);
    expect(r.timeMs).toBe(200);
  });
});

describe('findNearestKeyframeIndex', () => {
  it('returns 0 for empty array', () => {
    expect(findNearestKeyframeIndex([], 100)).toBe(0);
  });

  it('finds nearest keyframe', () => {
    const samples = [makeSample(0, 0, 0), makeSample(50, 0, 500), makeSample(100, 0, 1000)];
    expect(findNearestKeyframeIndex(samples, 480)).toBe(1);
    expect(findNearestKeyframeIndex(samples, 0)).toBe(0);
    expect(findNearestKeyframeIndex(samples, 1000)).toBe(2);
  });

  it('returns first when equidistant', () => {
    const samples = [makeSample(0, 0, 0), makeSample(100, 0, 100)];
    // timeMs=50 is equidistant to index 0 (0) and index 1 (100)
    // Implementation returns first found with < comparison, so index 0
    expect(findNearestKeyframeIndex(samples, 50)).toBe(0);
  });
});
