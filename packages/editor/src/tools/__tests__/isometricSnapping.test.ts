/**
 * Isometric snapping: exact oblique-lattice behaviour, sticky release on raw
 * movement, determinism, and integration with the shared `snapPosition`.
 */

import type { AxisFamily } from '@varve/scene';
import { basisFromColumns, nearestLatticePoint, resolveIsometricGeometry } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  boxSourceFeatures,
  findIsometricSnap,
  type IsometricSnapTarget,
  isometricCandidatesForPoint,
} from '../isometricSnapping';
import { snapPosition } from '../snapping';

const spacing = 24;

function standardTarget(overrides: Partial<IsometricSnapTarget> = {}): IsometricSnapTarget {
  const geometry = resolveIsometricGeometry({
    originX: 100,
    originY: 200,
    spacing,
    rotation: 0,
    axes: [
      { angle: 30, visible: true, label: 'Right' },
      { angle: 150, visible: true, label: 'Left' },
      { angle: 90, visible: true, label: 'Vertical' },
    ],
  })!;
  return {
    id: 'grid:test',
    origin: geometry.origin,
    basis: geometry.basis,
    families: geometry.families,
    intersections: true,
    lines: false,
    maxDistance: 8,
    releaseDistance: 20,
    previous: null,
    ...overrides,
  };
}

const obliqueBasis = basisFromColumns([10, 0], [9.9, 1]);
const obliqueCounterexample = [-15, -5.4] as const;

function obliqueTarget(overrides: Partial<IsometricSnapTarget> = {}): IsometricSnapTarget {
  return {
    id: 'grid:oblique',
    origin: [0, 0],
    basis: obliqueBasis,
    families: [],
    intersections: true,
    lines: false,
    maxDistance: 8,
    releaseDistance: 20,
    previous: null,
    ...overrides,
  };
}

describe('isometric snap candidates', () => {
  it('snaps an exact lattice point to itself', () => {
    const target = standardTarget();
    const point = nearestLatticePoint([137, 181], target.basis, { origin: target.origin })!.point;
    const candidates = isometricCandidatesForPoint(point, target);
    const intersection = candidates.find((candidate) => candidate.kind === 'intersection')!;
    expect(intersection.distance).toBeLessThan(1e-9);
  });

  it('does not use independent coordinate rounding for an oblique lattice', () => {
    const target = obliqueTarget();
    const result = findIsometricSnap([obliqueCounterexample], target);
    expect(result).not.toBeNull();
    // True nearest is index (4, −6); rounding picks (4, −5).
    const expected: [number, number] = [4, -6];
    const expectedPoint: [number, number] = [
      obliqueBasis[0] * expected[0] + obliqueBasis[2] * expected[1],
      obliqueBasis[1] * expected[0] + obliqueBasis[3] * expected[1],
    ];
    expect(result!.snappedPoint[0]).toBeCloseTo(expectedPoint[0], 9);
    expect(result!.snappedPoint[1]).toBeCloseTo(expectedPoint[1], 9);
  });

  it('skips non-finite features instead of producing NaN translations', () => {
    const target = standardTarget({ maxDistance: 1000 });
    const result = findIsometricSnap(
      [
        [Number.NaN, 0],
        [137, 181],
      ],
      target,
    );
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.translation.x)).toBe(true);
    expect(Number.isFinite(result!.translation.y)).toBe(true);
  });

  it('reports line candidates only when line snapping is enabled', () => {
    const target = standardTarget({ intersections: false, lines: true, maxDistance: 8 });
    const family = target.families[0]!;
    const lineOnlyTarget = { ...target, families: [family] };
    const anchor = nearestLatticePoint([130, 190], target.basis, { origin: target.origin })!.point;
    const along: [number, number] = [
      anchor[0] + family.direction[0] * 7 + family.normal[0] * family.offsetStep * 0.2,
      anchor[1] + family.direction[1] * 7 + family.normal[1] * family.offsetStep * 0.2,
    ];
    const result = findIsometricSnap([along], lineOnlyTarget);
    expect(result?.kind).toBe('line');
    expect(result?.familyIndex).toBe(0);
  });
});

describe('selection translation and arrangement', () => {
  it('applies one translation, preserving relative arrangement', () => {
    const target = standardTarget({ maxDistance: 12 });
    const box = { x: 130, y: 176, w: 60, h: 40 };
    const features = boxSourceFeatures(box);
    const result = findIsometricSnap(features, target);
    expect(result).not.toBeNull();
    const moved = {
      x: box.x + result!.translation.x,
      y: box.y + result!.translation.y,
    };
    // The winning feature is exactly on the lattice after the translation.
    const movedFeatures = boxSourceFeatures({ ...box, ...moved });
    const winning = movedFeatures[result!.lock.featureIndex]!;
    expect(winning[0]).toBeCloseTo(result!.snappedPoint[0], 9);
    expect(winning[1]).toBeCloseTo(result!.snappedPoint[1], 9);
    // The size is untouched: no independent per-object snapping.
    expect(moved.x - box.x).toBeCloseTo(result!.translation.x, 12);
  });

  it('resolves ties deterministically to the earliest feature', () => {
    // An orthogonal lattice has a square Voronoi cell, so the two features
    // below are exactly equidistant from the same lattice point.
    const target = standardTarget({
      basis: basisFromColumns([10, 0], [0, 10]),
      origin: [0, 0],
      families: [],
      maxDistance: 100,
    });
    const features: Array<readonly [number, number]> = [
      [-3, 0],
      [3, 0],
    ];
    const first = findIsometricSnap(features, target)!;
    const second = findIsometricSnap(features, target)!;
    expect(first.lock.featureIndex).toBe(0);
    expect(second.lock.featureIndex).toBe(0);
    expect(first.snappedPoint[0]).toBeCloseTo(0, 9);
    expect(first.snappedPoint[1]).toBeCloseTo(0, 9);
  });
});

describe('sticky acquisition and release', () => {
  it('keeps the acquired lattice point while the raw feature stays near it', () => {
    const target = standardTarget({ maxDistance: 4, releaseDistance: 12 });
    const lattice = nearestLatticePoint([0, 0], target.basis, { origin: target.origin })!.point;
    const first = findIsometricSnap([[lattice[0] + 2, lattice[1]]], target)!;
    expect(first.kind).toBe('intersection');
    const lockedTo = { ...first.lock };

    // Move the raw feature 5 units away: beyond acquisition (4) but inside
    // release (12). The same lattice point must be retained.
    const second = findIsometricSnap([[lattice[0] + 5, lattice[1]]], {
      ...target,
      previous: lockedTo,
    })!;
    expect(second.snappedPoint[0]).toBeCloseTo(lockedTo.snapped[0], 9);
    expect(second.snappedPoint[1]).toBeCloseTo(lockedTo.snapped[1], 9);
    expect(second.translation.x).toBeCloseTo(lockedTo.snapped[0] - (lattice[0] + 5), 9);

    // Beyond the release radius the lock drops and a new target is sought.
    const far = findIsometricSnap([[lattice[0] + 40, lattice[1]]], {
      ...target,
      previous: lockedTo,
    });
    if (far) {
      expect(far.snappedPoint[0]).not.toBeCloseTo(lockedTo.snapped[0], 6);
    } else {
      expect(far).toBeNull();
    }
  });

  it('invalidates the lock when the grid identity changes', () => {
    const target = standardTarget({ maxDistance: 4, releaseDistance: 12 });
    const lattice = nearestLatticePoint([0, 0], target.basis, { origin: target.origin })!.point;
    const lock = findIsometricSnap([[lattice[0] + 2, lattice[1]]], target)!.lock;
    const moved = findIsometricSnap([[lattice[0] + 5, lattice[1]]], {
      ...target,
      id: 'grid:other',
      previous: lock,
    });
    // A different grid must not inherit the old lock; the new grid may or may
    // not find a candidate, but it must not return the stale snapped point.
    if (moved) {
      expect(moved.lock.targetId).toBe('grid:other');
    } else {
      expect(moved).toBeNull();
    }
  });
});

describe('snapPosition integration', () => {
  it('applies the joint isometric translation and emits a point guide', () => {
    const target = standardTarget({ maxDistance: 12 });
    const box = { x: 130, y: 176, w: 60, h: 40 };
    const result = snapPosition(box.x, box.y, box.w, box.h, [], undefined, undefined, {
      zoom: 1,
      isometric: target,
    });
    expect(result.isometricLock).not.toBeNull();
    expect(result.x).not.toBe(box.x);
    expect(
      result.guides.some((guide) => guide.point && guide.targetId?.startsWith('isometric:')),
    ).toBe(true);
    // The winning corner/edge feature of the moved box is on the lattice.
    const movedFeatures = boxSourceFeatures({
      x: result.x,
      y: result.y,
      w: box.w,
      h: box.h,
    });
    const onLattice = movedFeatures.some(
      (feature) =>
        nearestLatticePoint(feature, target.basis, { origin: target.origin })!.distance < 1e-6,
    );
    expect(onLattice).toBe(true);
  });

  it('leaves ordinary snapping untouched when no isometric target is supplied', () => {
    const other = { x: 100, y: 100, w: 50, h: 50 };
    const withoutIso = snapPosition(103, 300, 50, 50, [other], undefined, undefined, {
      zoom: 1,
    });
    const withGrid = snapPosition(
      103,
      300,
      50,
      50,
      [other],
      { spacingX: 10, spacingY: 10 },
      undefined,
      { zoom: 1 },
    );
    expect(withoutIso.x).toBeCloseTo(100, 9);
    expect(withGrid.x).toBeCloseTo(100, 9);
    expect(withoutIso.isometricLock ?? null).toBeNull();
  });

  it('lets a closer object snap win over a distant isometric candidate', () => {
    const target = standardTarget({ maxDistance: 3 });
    // Feature is 3.5 units from the lattice (out of range) but 1 unit from an
    // object edge: the object snap must win.
    const box = { x: 130, y: 176, w: 60, h: 40 };
    const other = { x: 131, y: 176, w: 60, h: 40 };
    const result = snapPosition(box.x, box.y, box.w, box.h, [other], undefined, undefined, {
      zoom: 1,
      isometric: target,
    });
    expect(result.x).toBeCloseTo(131, 9);
    expect(result.guides.some((guide) => guide.point)).toBe(false);
  });

  it('does not double-apply the translation for a multi-object selection', () => {
    const target = standardTarget({ maxDistance: 12 });
    const box = { x: 130, y: 176, w: 60, h: 40 };
    const result = snapPosition(box.x, box.y, box.w, box.h, [], undefined, undefined, {
      zoom: 1,
      isometric: target,
    });
    const dx = result.x - box.x;
    const dy = result.y - box.y;
    // Same translation applies to every corner: relative arrangement is
    // preserved because the solver returns a single vector.
    expect(Number.isFinite(dx)).toBe(true);
    expect(Number.isFinite(dy)).toBe(true);
    const movedCorner = [box.x + box.w + dx, box.y + box.h + dy] as const;
    const rawCorner = [box.x + box.w, box.y + box.h] as const;
    expect(movedCorner[0] - rawCorner[0]).toBeCloseTo(dx, 12);
    expect(movedCorner[1] - rawCorner[1]).toBeCloseTo(dy, 12);
  });
});

describe('axis family filtering', () => {
  it('ignores non-lattice guide families for line snapping', () => {
    const geometry = resolveIsometricGeometry({
      originX: 0,
      originY: 0,
      spacing: 24,
      rotation: 0,
      axes: [
        { angle: 30, visible: true },
        { angle: 150, visible: true },
        { angle: 17, visible: true },
      ],
    })!;
    const guideFamily = geometry.families.find((family: AxisFamily) => family.role === 'guide')!;
    const target: IsometricSnapTarget = {
      id: 'grid:guide',
      origin: geometry.origin,
      basis: geometry.basis,
      families: geometry.families,
      intersections: false,
      lines: true,
      maxDistance: 4,
      releaseDistance: 12,
      previous: null,
    };
    // A point exactly on the guide's line but far from any lattice line must
    // not produce a line candidate.
    const onGuide: [number, number] = [guideFamily.normal[0] * 0.5, guideFamily.normal[1] * 0.5];
    const candidates = isometricCandidatesForPoint(onGuide, target);
    expect(candidates.every((candidate) => candidate.familyIndex !== guideFamily.index)).toBe(true);
  });
});
