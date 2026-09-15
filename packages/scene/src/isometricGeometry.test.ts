/**
 * Independent numerical verification of the canonical isometric geometry.
 *
 * Fixtures are computed from first principles in this file (trig identities,
 * brute-force nearest-point search, explicit affine algebra) rather than by
 * calling the implementation's own helpers, so a systematic mistake in the
 * module cannot make these tests pass.
 */

import { describe, expect, it } from 'vitest';
import {
  axisAngleToRatio,
  axisSeparationDegrees,
  basisConditioning,
  basisFromColumns,
  constructionPlaneFromGeometry,
  DIMETRIC_2_1_ANGLE_DEG,
  DIMETRIC_2_1_ANGLES,
  gridLinesForViewport,
  invertBasis,
  isometricPlaneInfo,
  nearestLatticeLine,
  nearestLatticePoint,
  planeToWorld,
  ratioToAxisAngleDegrees,
  resolveIsometricGeometry,
  selectDisplayStep,
  TRUE_ISOMETRIC_ANGLES,
  validateIsometricConfiguration,
  worldToPlane,
} from './isometricGeometry';

const S = 24;

function resolve(overrides: Partial<Parameters<typeof resolveIsometricGeometry>[0]> = {}) {
  const geometry = resolveIsometricGeometry({
    originX: 100,
    originY: 200,
    spacing: S,
    rotation: 0,
    axes: [
      { angle: 30, visible: true, label: 'Right' },
      { angle: 150, visible: true, label: 'Left' },
      { angle: 90, visible: true, label: 'Vertical' },
    ],
    ...overrides,
  });
  expect(geometry).not.toBeNull();
  return geometry!;
}

function dot(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}

function sub(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

describe('true isometric basis (independently derived)', () => {
  it('has equal projected axis lengths and pairwise 120° separation', () => {
    const geometry = resolve();
    const b1: [number, number] = [geometry.basis[0], geometry.basis[1]];
    const b2: [number, number] = [geometry.basis[2], geometry.basis[3]];

    expect(Math.hypot(...b1)).toBeCloseTo(S, 12);
    expect(Math.hypot(...b2)).toBeCloseTo(S, 12);

    const angle = (Math.acos(dot(b1, b2) / (S * S)) * 180) / Math.PI;
    expect(angle).toBeCloseTo(120, 10);
    expect(dot(b1, b2)).toBeCloseTo(-(S * S) / 2, 10);

    // eX + eY + eZ = 0 with eZ = (0, −s); eZ is the third family direction.
    const eZ: [number, number] = [0, -S];
    const sum: [number, number] = [b1[0] + b2[0] + eZ[0], b1[1] + b2[1] + eZ[1]];
    expect(Math.hypot(...sum)).toBeLessThan(1e-12);
  });

  it('derives the third family step from the basis (s·√3/2), not from spacing', () => {
    const geometry = resolve();
    const vertical = geometry.families.find((family) => family.index === 2)!;
    expect(vertical.role).toBe('lattice');
    // Independent derivation: the perpendicular distance between vertical
    // lines through lattice points equals |b1 · n| with n = (−1, 0).
    expect(Math.abs(vertical.offsetStep)).toBeCloseTo((S * Math.sqrt(3)) / 2, 10);
  });

  it('reports all three families as a valid lattice with conditioning √3/2', () => {
    const geometry = resolve();
    expect(geometry.latticeValid).toBe(true);
    expect(geometry.conditioning).toBeCloseTo(Math.sqrt(3) / 2, 10);
  });
});

describe('exact 2:1 dimetric preset', () => {
  it('uses atan2(1, 2), not a truncated degree constant', () => {
    expect(DIMETRIC_2_1_ANGLE_DEG).toBe((Math.atan2(1, 2) * 180) / Math.PI);
    expect(DIMETRIC_2_1_ANGLE_DEG).toBeCloseTo(26.56505117707799, 12);
    expect(DIMETRIC_2_1_ANGLES[1]).toBeCloseTo(180 - DIMETRIC_2_1_ANGLE_DEG, 12);
  });

  it('has an exact 1:2 tangent and round-trips through the ratio helpers', () => {
    const radians = (DIMETRIC_2_1_ANGLE_DEG * Math.PI) / 180;
    expect(Math.tan(radians)).toBeCloseTo(0.5, 14);
    expect(ratioToAxisAngleDegrees(1, 2)).toBe(DIMETRIC_2_1_ANGLE_DEG);
    expect(axisAngleToRatio(DIMETRIC_2_1_ANGLE_DEG)).toEqual({ height: 1, width: 2 });
  });

  it('produces a distinct basis from true isometric', () => {
    const iso = resolve();
    const dimetric = resolve({
      axes: [
        { angle: DIMETRIC_2_1_ANGLES[0], visible: true },
        { angle: DIMETRIC_2_1_ANGLES[1], visible: true },
        { angle: DIMETRIC_2_1_ANGLES[2], visible: true },
      ],
    });
    const isoB1: [number, number] = [iso.basis[0], iso.basis[1]];
    const diB1: [number, number] = [dimetric.basis[0], dimetric.basis[1]];
    expect(Math.hypot(...sub(isoB1, diB1))).toBeGreaterThan(0.1);
    expect(dimetric.families[2]!.offsetStep).toBeCloseTo(Math.abs(dimetric.basis[0]), 6);
  });
});

describe('plane mapping', () => {
  it('round-trips world to plane through the inverse basis', () => {
    const geometry = resolve();
    for (const planeId of ['top', 'front', 'side'] as const) {
      const plane = constructionPlaneFromGeometry(geometry, planeId);
      expect(plane).not.toBeNull();
      for (const uv of [
        [0, 0],
        [1, 0],
        [0, 1],
        [3.25, -7.5],
      ] as const) {
        const world = planeToWorld(plane!, uv);
        const back = worldToPlane(plane!, world);
        expect(back![0]).toBeCloseTo(uv[0], 10);
        expect(back![1]).toBeCloseTo(uv[1], 10);
      }
    }
  });

  it('assigns documented basis pairs to each plane', () => {
    const geometry = resolve();
    const top = constructionPlaneFromGeometry(geometry, 'top')!;
    const front = constructionPlaneFromGeometry(geometry, 'front')!;
    const side = constructionPlaneFromGeometry(geometry, 'side')!;
    // Top spans Right(30°) then Left(150°): u points down-right.
    expect(top.uAxisLabel).toBe('Right');
    expect(top.vAxisLabel).toBe('Left');
    expect(front.uAxisLabel).toBe('Right');
    expect(front.vAxisLabel).toBe('Vertical');
    expect(side.uAxisLabel).toBe('Left');
    expect(side.vAxisLabel).toBe('Vertical');
    // Front's v column is vertical (no x component).
    expect(Math.abs(front.basis[2])).toBeLessThan(1e-9);
    expect(Math.abs(side.basis[2])).toBeLessThan(1e-9);
  });

  it('returns null for a singular basis instead of inventing coordinates', () => {
    const singular = basisFromColumns([1, 0], [2, 0]);
    expect(invertBasis(singular)).toBeNull();
    expect(basisConditioning(singular)).toBe(0);
  });
});

describe('nearest lattice point (oblique lattice correctness)', () => {
  /**
   * The classic failure of independent rounding: basis b1=(10,0),
   * b2=(9.9,1), query (−15, −5.4). Rounding basis coordinates picks (4, −5)
   * at distance ≈5.5145; the true nearest is (4, −6) at ≈4.4407.
   */
  const oblique = basisFromColumns([10, 0], [9.9, 1]);
  const counterexample: readonly [number, number] = [-15, -5.4];

  function bruteForceNearest(
    point: readonly [number, number],
    basis: readonly [number, number, number, number],
    radius: number,
  ): { index: [number, number]; distance: number } {
    let best: { index: [number, number]; distance: number } | null = null;
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        const x = basis[0] * i + basis[2] * j;
        const y = basis[1] * i + basis[3] * j;
        const dist = Math.hypot(x - point[0], y - point[1]);
        if (!best || dist < best.distance - 1e-12) best = { index: [i, j], distance: dist };
      }
    }
    return best!;
  }

  it('finds the true nearest intersection where rounding does not', () => {
    const roundedIndex: [number, number] = [4, -5];
    const roundedX = oblique[0] * roundedIndex[0] + oblique[2] * roundedIndex[1];
    const roundedY = oblique[1] * roundedIndex[0] + oblique[3] * roundedIndex[1];
    const roundedDistance = Math.hypot(roundedX - counterexample[0], roundedY - counterexample[1]);

    const hit = nearestLatticePoint(counterexample, oblique)!;
    const reference = bruteForceNearest(counterexample, oblique, 10);

    expect(hit.index).toEqual(reference.index);
    expect(hit.distance).toBeCloseTo(reference.distance, 12);
    expect(hit.distance).toBeLessThan(roundedDistance - 1);
  });

  it('agrees with brute force over a deterministic sweep of an oblique lattice', () => {
    const basis = basisFromColumns([7, 0], [6.3, 1.6]);
    let checked = 0;
    for (let x = -20; x <= 20; x += 1.3) {
      for (let y = -12; y <= 12; y += 1.7) {
        const hit = nearestLatticePoint([x, y], basis)!;
        const reference = bruteForceNearest([x, y], basis, 12);
        expect(hit.distance).toBeCloseTo(reference.distance, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('is idempotent: snapping an already-snapped point returns it', () => {
    const basis = basisFromColumns([10, 0], [9.9, 1]);
    const first = nearestLatticePoint(counterexample, basis)!;
    const second = nearestLatticePoint(first.point, basis)!;
    expect(second.point[0]).toBeCloseTo(first.point[0], 10);
    expect(second.point[1]).toBeCloseTo(first.point[1], 10);
    expect(second.distance).toBeLessThan(1e-9);
  });

  it('keeps the grid origin as an exact lattice point, including negative indices', () => {
    const basis = basisFromColumns([10, 0], [9.9, 1]);
    const geometry = resolve({ originX: -5000, originY: 3200 });
    for (const k of [
      [-3, 4],
      [7, -11],
    ] as const) {
      const world: [number, number] = [
        geometry.origin[0] + geometry.basis[0] * k[0] + geometry.basis[2] * k[1],
        geometry.origin[1] + geometry.basis[1] * k[0] + geometry.basis[3] * k[1],
      ];
      const hit = nearestLatticePoint(world, geometry.basis, { origin: geometry.origin })!;
      expect(hit.distance).toBeLessThan(1e-9);
      expect(hit.point[0]).toBeCloseTo(world[0], 9);
      expect(hit.point[1]).toBeCloseTo(world[1], 9);
    }
    // Far-negative phase must not wrap to zero.
    const farNegative: [number, number] = [-987.6, 321.4];
    const hit = nearestLatticePoint(farNegative, basis)!;
    expect(Math.abs(hit.point[0] - farNegative[0])).toBeLessThan(6);
  });

  it('is deterministic for equidistant candidates', () => {
    const basis = basisFromColumns([10, 0], [0, 10]);
    const query: [number, number] = [5, 5];
    const results = Array.from({ length: 8 }, () => nearestLatticePoint(query, basis)!);
    for (const result of results) {
      expect(result.point).toEqual(results[0]!.point);
      expect(result.index).toEqual(results[0]!.index);
    }
    expect(Math.hypot(results[0]!.point[0] - 5, results[0]!.point[1] - 5)).toBeCloseTo(
      Math.sqrt(50) / 2 + Math.sqrt(50) / 2,
      6,
    );
  });

  it('minimises screen distance when a metric is supplied', () => {
    const basis = basisFromColumns([10, 0], [9.9, 1]);
    // Screen transform: 4× zoom, 90° camera rotation. Screen distance is the
    // declared policy, so the chosen candidate may differ from the world
    // nearest; verify against brute force in screen space.
    const zoom = 4;
    const metric = basisFromColumns([0, zoom], [-zoom, 0]);
    const query: [number, number] = [-15, -5.4];
    const hit = nearestLatticePoint(query, basis, { metric })!;
    const screen = (p: readonly [number, number]): [number, number] => [
      metric[0] * p[0] + metric[2] * p[1],
      metric[1] * p[0] + metric[3] * p[1],
    ];
    const target = screen(query);
    let bestDistance = Infinity;
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const world: [number, number] = [basis[0] * i + basis[2] * j, basis[1] * i + basis[3] * j];
        const [sx, sy] = screen(world);
        bestDistance = Math.min(bestDistance, Math.hypot(sx - target[0], sy - target[1]));
      }
    }
    const hitScreen = screen(hit.point);
    expect(Math.hypot(hitScreen[0] - target[0], hitScreen[1] - target[1])).toBeCloseTo(
      bestDistance,
      9,
    );
  });

  it('rejects degenerate and non-finite inputs', () => {
    expect(nearestLatticePoint([1, 1], basisFromColumns([1, 0], [2, 0]))).toBeNull();
    expect(nearestLatticePoint([Number.NaN, 1], oblique)).toBeNull();
  });
});

describe('line snapping', () => {
  it('projects onto the nearest family line rather than an intersection', () => {
    const geometry = resolve();
    const family = geometry.families[0]!;
    // A point midway along a line: line snapping must keep the along-line
    // component and only correct the perpendicular offset.
    const anchor: [number, number] = [
      geometry.origin[0] + family.direction[0] * 37,
      geometry.origin[1] + family.direction[1] * 37,
    ];
    const offLine: [number, number] = [
      anchor[0] + family.normal[0] * (family.offsetStep * 0.2),
      anchor[1] + family.normal[1] * (family.offsetStep * 0.2),
    ];
    const hit = nearestLatticeLine(offLine, geometry.origin, family)!;
    expect(hit.distance).toBeCloseTo(family.offsetStep * 0.2, 9);
    // The corrected point lies on the same lattice line as the anchor.
    const offset =
      (hit.point[0] - geometry.origin[0]) * family.normal[0] +
      (hit.point[1] - geometry.origin[1]) * family.normal[1];
    expect(Math.abs(offset % family.offsetStep)).toBeLessThan(1e-8);
    const along =
      (hit.point[0] - anchor[0]) * family.direction[0] +
      (hit.point[1] - anchor[1]) * family.direction[1];
    expect(Math.abs(along)).toBeLessThan(1e-8);
  });
});

describe('viewport line generation', () => {
  const viewport = {
    corners: [
      [-50, -50],
      [400, -50],
      [400, 350],
      [-50, 350],
    ] as const,
  };

  it('anchors every line to origin + k·step at integer k', () => {
    const geometry = resolve();
    const lines = gridLinesForViewport(geometry, viewport);
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      // Reconstruct the offset from the midpoint and check integer phase.
      const midX = (line.x1 + line.x2) / 2;
      const midY = (line.y1 + line.y2) / 2;
      const offset =
        (midX - geometry.origin[0]) * family.normal[0] +
        (midY - geometry.origin[1]) * family.normal[1];
      const index = offset / family.offsetStep;
      expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-6);
      expect(Math.round(index) + 0).toBe(line.offsetIndex + 0);
    }
  });

  it('keeps phase stable when display density changes and preserves major identity', () => {
    const geometry = resolve();
    const dense = gridLinesForViewport(geometry, { ...viewport, displayStep: 1, majorEvery: 4 });
    const sparse = gridLinesForViewport(geometry, { ...viewport, displayStep: 2, majorEvery: 4 });
    const denseKeys = new Set(dense.map((line) => `${line.familyIndex}:${line.offsetIndex}`));
    for (const line of sparse) {
      // Every sparse line already exists in the dense set at the same offset.
      expect(denseKeys.has(`${line.familyIndex}:${line.offsetIndex}`)).toBe(true);
    }
    const denseMajors = new Set(
      dense.filter((line) => line.major).map((line) => `${line.familyIndex}:${line.offsetIndex}`),
    );
    for (const line of sparse.filter((candidate) => candidate.major)) {
      expect(denseMajors.has(`${line.familyIndex}:${line.offsetIndex}`)).toBe(true);
    }
    // A major line is an authored multiple of majorEvery, not a display artefact.
    for (const line of dense.filter((candidate) => candidate.major)) {
      expect(line.offsetIndex % 4 === 0).toBe(true);
    }
  });

  it('covers the viewport at any pan/zoom and never emits a fixed extent', () => {
    const geometry = resolve();
    const farViewport = {
      corners: [
        [100000, -50000],
        [100640, -50000],
        [100640, -49520],
        [100000, -49520],
      ] as const,
    };
    const lines = gridLinesForViewport(geometry, farViewport);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Number.isFinite(line.x1)).toBe(true);
      expect(Number.isFinite(line.y1)).toBe(true);
    }
  });

  it('bounds work for extremely small spacing instead of hanging', () => {
    const geometry = resolve({ spacing: 0.001 });
    const lines = gridLinesForViewport(geometry, { ...viewport, maxLinesPerFamily: 64 });
    // Too dense to draw: the policy is to omit the family, not to emit millions.
    expect(lines.length).toBe(0);
  });

  it('never shifts the lattice when the origin moves off the visible area', () => {
    const geometry = resolve({ originX: 123456.5, originY: -98765.25 });
    const lines = gridLinesForViewport(geometry, {
      corners: [
        [123000, -99200],
        [123800, -99200],
        [123800, -98800],
        [123000, -98800],
      ] as const,
    });
    for (const line of lines) {
      const family = geometry.families.find((candidate) => candidate.index === line.familyIndex)!;
      const offset =
        ((line.x1 + line.x2) / 2 - geometry.origin[0]) * family.normal[0] +
        ((line.y1 + line.y2) / 2 - geometry.origin[1]) * family.normal[1];
      const index = offset / family.offsetStep;
      expect(Math.abs(index - Math.round(index))).toBeLessThan(1e-6);
    }
  });
});

describe('display density ladder', () => {
  it('selects nested powers of two and never mutates authored spacing', () => {
    expect(selectDisplayStep({ minStep: 10, zoom: 1, minScreenPx: 6 })).toBe(1);
    expect(selectDisplayStep({ minStep: 1, zoom: 1, minScreenPx: 6 })).toBe(8);
    expect(selectDisplayStep({ minStep: 1, zoom: 0.5, minScreenPx: 6 })).toBe(16);
  });

  it('retains the level inside the hysteresis dead band', () => {
    // screen step = 10 * 0.55 = 5.5 px; ideal = 2 but previous=1 is within
    // 0.8×threshold → stay at 1 (no flicker).
    expect(selectDisplayStep({ minStep: 10, zoom: 0.55, minScreenPx: 6, previous: 1 })).toBe(1);
    // screen step = 10 * 0.45 = 4.5 px; below 0.8×6 → coarsen to 2.
    expect(selectDisplayStep({ minStep: 10, zoom: 0.45, minScreenPx: 6, previous: 1 })).toBe(2);
    // Densify only when the finer level is comfortable (≥1.25×6 = 7.5 px).
    // At 0.8 zoom the finer level is 8 px → comfortable, accept it.
    expect(selectDisplayStep({ minStep: 10, zoom: 0.8, minScreenPx: 6, previous: 2 })).toBe(1);
    // At 0.7 zoom the finer level is 7 px → not comfortable, keep 2.
    expect(selectDisplayStep({ minStep: 10, zoom: 0.7, minScreenPx: 6, previous: 2 })).toBe(2);
    expect(selectDisplayStep({ minStep: 10, zoom: 0.9, minScreenPx: 6, previous: 2 })).toBe(1);
  });
});

describe('validation', () => {
  it('rejects non-finite and non-positive configuration with messages', () => {
    const result = validateIsometricConfiguration({
      originX: Number.NaN,
      originY: 0,
      spacing: 0,
      rotation: 0,
      axes: [{ angle: 30 }, { angle: 150 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects near-parallel axes by conditioning, not just duplicates', () => {
    const result = validateIsometricConfiguration({
      originX: 0,
      originY: 0,
      spacing: 24,
      rotation: 0,
      axes: [{ angle: 30 }, { angle: 30.5 }],
      basisAxisIndices: [0, 1],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('stable lattice');
  });

  it('warns for a usable but poorly conditioned basis', () => {
    const result = validateIsometricConfiguration({
      originX: 0,
      originY: 0,
      spacing: 24,
      rotation: 0,
      axes: [{ angle: 30 }, { angle: 37 }],
      basisAxisIndices: [0, 1],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(1);
  });

  it('treats 180°-equivalent directions as duplicates', () => {
    expect(axisSeparationDegrees(30, 210)).toBeCloseTo(0, 9);
    const result = validateIsometricConfiguration({
      originX: 0,
      originY: 0,
      spacing: 24,
      rotation: 0,
      axes: [{ angle: 30 }, { angle: 210 }],
      basisAxisIndices: [0, 1],
    });
    expect(result.valid).toBe(false);
  });

  it('marks an inconsistent custom third axis as a directional guide', () => {
    const geometry = resolve({
      axes: [
        { angle: 30, visible: true },
        { angle: 150, visible: true },
        { angle: 17, visible: true },
      ],
    });
    const third = geometry.families.find((family) => family.index === 2)!;
    expect(third.role).toBe('guide');
    expect(geometry.latticeValid).toBe(false);
  });

  it('still draws the two lattice families when the third is a guide', () => {
    const geometry = resolve({
      axes: [
        { angle: 30, visible: true },
        { angle: 150, visible: true },
        { angle: 17, visible: true },
      ],
    });
    const lines = gridLinesForViewport(geometry, {
      corners: [
        [-10, -10],
        [120, -10],
        [120, 120],
        [-10, 120],
      ] as const,
    });
    expect(lines.some((line) => line.role === 'lattice')).toBe(true);
    expect(lines.some((line) => line.role === 'guide')).toBe(true);
  });
});

describe('plane metadata', () => {
  it('publishes a stable label/description for every plane', () => {
    for (const id of ['top', 'front', 'side'] as const) {
      const info = isometricPlaneInfo(id);
      expect(info.id).toBe(id);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it('rotates the lattice with grid rotation but not the family geometry', () => {
    const unrotated = resolve();
    const rotated = resolve({ rotation: 90 });
    expect(rotated.basis[0]).toBeCloseTo(-unrotated.basis[1], 9);
    expect(rotated.basis[1]).toBeCloseTo(unrotated.basis[0], 9);
    const rotatedFamilyAngle = rotated.families[0]!.angleDeg;
    expect(rotatedFamilyAngle).toBeCloseTo(120, 6);
  });

  it('keeps lattice basis unchanged by visible-axis filtering', () => {
    const hidden = resolve({
      axes: [
        { angle: 30, visible: true },
        { angle: 150, visible: true },
        { angle: 90, visible: false },
      ],
    });
    expect(hidden.families.length).toBe(2);
    expect(hidden.latticeValid).toBe(true);
    expect(TRUE_ISOMETRIC_ANGLES[0]).toBe(30);
  });
});
