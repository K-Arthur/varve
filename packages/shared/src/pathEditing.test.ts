import { describe, expect, it } from 'vitest';
import { cubicBezierPoint } from './bezier';
import { segmentToCubic } from './bezierPathOps';
import type { EditablePathShape } from './pathEditing';
import {
  deleteSelectedAnchorsFromPath,
  insertPointOnPath,
  nearestEditableSegment,
  nodeModeForPoint,
  pathRings,
  remapSelectionAfterDeletion,
  remapSelectionAfterInsertion,
  remapSelectionAfterRingReverse,
  reversePathShape,
  setNodeMode,
  translateSelectedAnchors,
  withPathRings,
} from './pathEditing';

function point(
  x: number,
  y: number,
  handleIn: [number, number] | null = null,
  handleOut: [number, number] | null = null,
): EditablePathShape['points'][number] {
  return { x, y, handleIn, handleOut };
}

describe('canonical path editing', () => {
  it('moves anchors in contours and keeps legacy aliases synchronized', () => {
    const shape: EditablePathShape = {
      points: [point(0, 0), point(100, 0)],
      contours: [
        [point(0, 0), point(100, 0)],
        [point(20, 20), point(80, 20), point(80, 80)],
      ],
      holes: [[point(20, 20), point(80, 20), point(80, 80)]],
      closed: true,
    };
    const moved = translateSelectedAnchors(shape, new Set([1, 3]), [5, -7]);
    expect(moved.points[1]).toMatchObject({ x: 105, y: -7 });
    expect(moved.contours?.[0]?.[1]).toMatchObject({ x: 105, y: -7 });
    expect(moved.contours?.[1]?.[1]).toMatchObject({ x: 85, y: 13 });
    expect(moved.holes?.[0]?.[1]).toMatchObject({ x: 85, y: 13 });
  });

  it('distinguishes corner, smooth, symmetric, and automatic handles', () => {
    const ring = [point(0, 0), point(100, 0, [-20, 0], [40, 0]), point(100, 100)];
    expect(nodeModeForPoint(ring[1]!)).toBe('smooth');
    const symmetric = setNodeMode(ring, 1, 'symmetric', false);
    expect(symmetric[1]?.mode).toBe('symmetric');
    expect(Math.hypot(...symmetric[1]!.handleIn!)).toBeCloseTo(
      Math.hypot(...symmetric[1]!.handleOut!),
    );
    const smooth = setNodeMode(ring, 1, 'smooth', false);
    expect(smooth[1]?.mode).toBe('smooth');
    expect(Math.hypot(...smooth[1]!.handleIn!)).not.toBeCloseTo(
      Math.hypot(...smooth[1]!.handleOut!),
    );
    const automatic = setNodeMode(ring, 1, 'automatic', false);
    expect(automatic[1]?.mode).toBe('automatic');
    expect(automatic[1]?.handleIn?.[0]).toBeLessThan(0);
    expect(automatic[1]?.handleOut?.[0]).toBeGreaterThan(0);
    const corner = setNodeMode(automatic, 1, 'corner', false);
    expect(corner[1]?.handleIn).toEqual(automatic[1]?.handleIn);
    expect(corner[1]?.handleOut).toEqual(automatic[1]?.handleOut);
  });

  it('recomputes automatic tangents when neighbouring anchors move', () => {
    const shape: EditablePathShape = {
      points: [
        point(0, 0),
        { ...point(50, 0, [-16, 0], [16, 0]), mode: 'automatic' },
        point(100, 0),
      ],
      closed: false,
    };
    const moved = translateSelectedAnchors(shape, new Set([2]), [0, 50]);
    expect(moved.points[1]?.mode).toBe('automatic');
    expect(moved.points[1]?.handleOut?.[1]).toBeGreaterThan(0);
    expect(moved.points[1]?.handleIn?.[1]).toBeLessThan(0);
  });

  it('subdivides a closing segment without changing its curve', () => {
    const shape: EditablePathShape = {
      points: [point(0, 0), point(100, 0, null, [0, 80]), point(100, 100, [-80, 0], null)],
      closed: true,
    };
    const original = segmentToCubic(shape.points[2]!, shape.points[0]!);
    const result = insertPointOnPath(shape, 0, 2, 0.35);
    expect(result).not.toBeNull();
    expect(result?.insertedIndex).toBe(3);
    const ring = result!.shape.points;
    const left = segmentToCubic(ring[2]!, ring[3]!);
    const right = segmentToCubic(ring[3]!, ring[0]!);
    for (const u of [0, 0.1, 0.35, 0.6, 1]) {
      const expected = cubicBezierPoint(original, u);
      const actual =
        u <= 0.35 ? cubicBezierPoint(left, u / 0.35) : cubicBezierPoint(right, (u - 0.35) / 0.65);
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
  });

  it('remaps selection explicitly across topology edits', () => {
    expect(remapSelectionAfterInsertion(new Set([0, 2, 4]), 2)).toEqual(new Set([0, 3, 5]));
    expect(remapSelectionAfterDeletion(new Set([0, 2, 4]), new Set([1, 3]))).toEqual(
      new Set([0, 1, 2]),
    );
    const rings = [
      [point(0, 0), point(1, 0), point(2, 0)],
      [point(0, 1), point(1, 1)],
    ];
    expect(remapSelectionAfterRingReverse(new Set([0, 3]), rings)).toEqual(new Set([2, 4]));
  });

  it('deletes anchors without losing compound-ring ownership', () => {
    const shape: EditablePathShape = {
      points: [point(0, 0), point(100, 0), point(100, 100), point(0, 100)],
      contours: [
        [point(0, 0), point(100, 0), point(100, 100), point(0, 100)],
        [point(20, 20), point(80, 20), point(80, 80)],
      ],
      holes: [[point(20, 20), point(80, 20), point(80, 80)]],
      closed: true,
    };
    const result = deleteSelectedAnchorsFromPath(shape, new Set([1, 4, 5, 6]));
    expect(result).not.toBeNull();
    expect(result!.shape.contours).toHaveLength(1);
    expect(result!.shape.points).toHaveLength(3);
    expect(result!.shape.holes).toEqual([]);
    expect(result!.selection).toEqual(new Set());
  });

  it('safely rejects non-finite nearest-point input', () => {
    expect(
      nearestEditableSegment([point(0, 0), point(10, 0)], false, { x: Number.NaN, y: 0 }),
    ).toBeNull();
    expect(
      nearestEditableSegment([point(Number.POSITIVE_INFINITY, 0), point(10, 0)], false, {
        x: 0,
        y: 0,
      }),
    ).toBeNull();
  });

  it('round-trips reversed rings and handles', () => {
    const shape: EditablePathShape = {
      points: [
        point(0, 0, null, [10, 4]),
        point(50, 30, [-8, 2], [3, 9]),
        point(100, 0, [-6, -4], null),
      ],
      closed: false,
    };
    const reversed = reversePathShape(shape);
    expect(reversePathShape(reversed)).toEqual(shape);
    expect(remapSelectionAfterRingReverse(new Set([0, 2]), pathRings(shape))).toEqual(
      new Set([2, 0]),
    );
    expect(withPathRings(shape, pathRings(shape))).toEqual(shape);
  });
});
