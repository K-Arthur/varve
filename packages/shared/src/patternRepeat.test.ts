import { describe, expect, it } from 'vitest';
import { applyAffine } from './affine';
import type { PatternRect } from './patternRepeat';
import {
  forEachPatternInstance,
  PATTERN_ARRANGEMENTS,
  patternCellAt,
  patternIndexRange,
  patternInstanceBounds,
  patternInstanceMatrix,
  patternRepeatSignature,
  resolveColumnShift,
  resolvePatternLattice,
  resolveRowShift,
} from './patternRepeat';

const base = { tileWidth: 40, tileHeight: 24 };

describe('resolvePatternLattice', () => {
  it('rejects non-finite and non-positive tile dimensions', () => {
    expect(resolvePatternLattice({ tileWidth: 0, tileHeight: 10 })).toBeNull();
    expect(resolvePatternLattice({ tileWidth: 10, tileHeight: -1 })).toBeNull();
    expect(resolvePatternLattice({ tileWidth: Number.NaN, tileHeight: 10 })).toBeNull();
    expect(
      resolvePatternLattice({ tileWidth: 10, tileHeight: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });

  it('rejects a non-positive repeat period (gap cancels the tile)', () => {
    expect(resolvePatternLattice({ tileWidth: 10, tileHeight: 10, gapX: -10 })).toBeNull();
    expect(resolvePatternLattice({ tileWidth: 10, tileHeight: 10, gapX: -20 })).toBeNull();
    // A shrinking-but-still-positive period is legal overlap, not an error.
    expect(resolvePatternLattice({ tileWidth: 10, tileHeight: 10, gapX: -5 })).not.toBeNull();
  });

  it('keeps fractional origins and a fractional negative gap exactly', () => {
    const lattice = resolvePatternLattice({
      tileWidth: 10.5,
      tileHeight: 7.25,
      gapX: -0.25,
      gapY: 0.125,
      offsetX: -3.75,
      offsetY: 11.5,
    });
    expect(lattice).not.toBeNull();
    expect(lattice?.ux).toBeCloseTo(10.25, 10);
    expect(lattice?.vy).toBeCloseTo(7.375, 10);
    expect(lattice?.phaseX).toBeCloseTo(-3.75, 10);
    expect(lattice?.phaseY).toBeCloseTo(11.5, 10);
  });

  it('defaults row shift per arrangement and honours an explicit override', () => {
    expect(resolveRowShift({ ...base, arrangement: 'grid' })).toBe(0);
    expect(resolveRowShift({ ...base, arrangement: 'half-drop' })).toBe(0);
    expect(resolveRowShift({ ...base, arrangement: 'brick' })).toBe(0.5);
    expect(resolveRowShift({ ...base, arrangement: 'brick', rowShift: 0.25 })).toBe(0.25);
    expect(resolveColumnShift({ ...base, arrangement: 'half-drop' })).toBe(0.5);
    expect(resolveColumnShift({ ...base, arrangement: 'brick' })).toBe(0);
    expect(resolveColumnShift({ ...base, arrangement: 'half-drop', columnShift: 0.25 })).toBe(0.25);
  });

  it('uses column-offset half-drop and row-offset brick as distinct lattices', () => {
    const halfDrop = resolvePatternLattice({ ...base, arrangement: 'half-drop' });
    const brick = resolvePatternLattice({ ...base, arrangement: 'brick' });
    if (!halfDrop || !brick) throw new Error('expected valid lattices');

    // Half-drop advances columns by half a row vertically. Brick advances
    // rows by half a column horizontally. They must not share one shear.
    expect([halfDrop.ux, halfDrop.uy, halfDrop.vx, halfDrop.vy]).toEqual([40, 12, 0, 24]);
    expect([brick.ux, brick.uy, brick.vx, brick.vy]).toEqual([40, 0, 20, 24]);
    expect(patternInstanceBounds(halfDrop, 1, 0)).toMatchObject({ x: 40, y: 12 });
    expect(patternInstanceBounds(brick, 0, 1)).toMatchObject({ x: 20, y: 24 });
  });

  it('defines every arrangement in PATTERN_ARRANGEMENTS', () => {
    for (const arrangement of PATTERN_ARRANGEMENTS) {
      const lattice = resolvePatternLattice({ ...base, arrangement });
      expect(lattice, arrangement).not.toBeNull();
    }
  });
});

describe('patternInstanceMatrix — translational invariance', () => {
  it('shifting a lattice index reproduces the tile one period over', () => {
    const lattice = resolvePatternLattice({ ...base, arrangement: 'half-drop' });
    if (!lattice) throw new Error('expected lattice');

    const m00 = patternInstanceMatrix(lattice, 0, 0);
    const m10 = patternInstanceMatrix(lattice, 1, 0);
    const m01 = patternInstanceMatrix(lattice, 0, 1);
    // [u, v, origin] as translation components.
    expect(m10[4]).toBeCloseTo(m00[4] + lattice.ux, 10);
    expect(m01[4]).toBeCloseTo(m00[4] + lattice.vx, 10);
    expect(m01[5]).toBeCloseTo(m00[5] + lattice.vy, 10);

    // Every index maps tile-local (0,0) to its cell origin, offset by phase.
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const bounds = patternInstanceBounds(lattice, i, j);
        expect(bounds.x).toBeCloseTo(lattice.phaseX + i * lattice.ux + j * lattice.vx, 10);
        expect(bounds.y).toBeCloseTo(lattice.phaseY + i * lattice.uy + j * lattice.vy, 10);
      }
    }
  });

  it('never drifts when the phase is fractional and the tile is odd-sized', () => {
    const lattice = resolvePatternLattice({
      tileWidth: 33.333,
      tileHeight: 17.777,
      gapX: 2.5,
      gapY: 1.25,
      offsetX: 0.1,
      offsetY: -0.3,
    });
    if (!lattice) throw new Error('expected lattice');
    for (let i = 0; i < 997; i++) {
      const a = patternInstanceMatrix(lattice, i, 0);
      const expected = lattice.phaseX + i * lattice.ux;
      // Accumulation is analytic, not incremental: exact to floating error.
      expect(Math.abs((a[4] ?? 0) - expected)).toBeLessThan(1e-9);
    }
  });

  it('uses non-negative parity for negative indices when mirroring', () => {
    const lattice = resolvePatternLattice({ ...base, mirrorX: true, mirrorY: true });
    if (!lattice) throw new Error('expected lattice');
    const even = patternInstanceMatrix(lattice, -2, 0);
    const odd = patternInstanceMatrix(lattice, -1, 0);
    expect(even[0]).toBe(1); // even column: not flipped
    expect(odd[0]).toBe(-1); // odd column: flipped
    expect(odd[4]).toBeCloseTo(odd[4] ?? 0, 10);
    // A flipped copy still occupies [p, p + tileWidth].
    const flipped = patternInstanceBounds(lattice, -1, 0);
    expect(flipped.w).toBe(lattice.tileWidth);
    const corner = applyAffine(odd, [0, 0]);
    expect(corner[0]).toBeCloseTo(flipped.x + lattice.tileWidth, 10);
  });
});

describe('patternIndexRange / forEachPatternInstance', () => {
  const rect: PatternRect = { x: 0, y: 0, w: 100, h: 60 };

  it('covers every copy that intersects the destination', () => {
    const lattice = resolvePatternLattice({ ...base, arrangement: 'brick' });
    if (!lattice) throw new Error('expected lattice');
    const seen: Array<[number, number]> = [];
    const walk = forEachPatternInstance(lattice, rect, (i, j) => seen.push([i, j]));
    expect(walk.truncated).toBe(false);
    expect(walk.count).toBe(seen.length);

    // The walk is a superset of every intersecting copy: enumerate a wide
    // index window and require every true intersection to be present.
    const seenKeys = new Set(seen.map(([i, j]) => `${i},${j}`));
    let intersections = 0;
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const b = patternInstanceBounds(lattice, i, j);
        const overlaps =
          b.x + b.w > rect.x + 1e-9 &&
          b.x < rect.x + rect.w - 1e-9 &&
          b.y + b.h > rect.y + 1e-9 &&
          b.y < rect.y + rect.h - 1e-9;
        if (!overlaps) continue;
        intersections++;
        expect(seenKeys.has(`${i},${j}`), `missing instance ${i},${j}`).toBe(true);
      }
    }
    expect(intersections).toBeGreaterThan(0);
    // Overscan is bounded (one padded period per axis), not unbounded.
    expect(seen.length).toBeLessThan(intersections * 4);

    // A grid larger than the rect by a period must still be fully covered.
    const range = patternIndexRange(lattice, rect);
    expect(range).not.toBeNull();
    if (range) {
      expect(range.iMax - range.iMin).toBeGreaterThanOrEqual(1);
      expect(range.jMax - range.jMin).toBeGreaterThanOrEqual(1);
    }
  });

  it('grows the walk by the requested bleed for oversized motifs', () => {
    const lattice = resolvePatternLattice(base);
    if (!lattice) throw new Error('expected lattice');
    const plain = forEachPatternInstance(lattice, rect, () => undefined).count;
    const bled = forEachPatternInstance(lattice, rect, () => undefined, {
      bleed: lattice.tileWidth,
    }).count;
    expect(bled).toBeGreaterThan(plain);
  });

  it('bounds the walk for a tiny period over a large destination', () => {
    const lattice = resolvePatternLattice({ tileWidth: 0.5, tileHeight: 0.5 });
    if (!lattice) throw new Error('expected lattice');
    const walk = forEachPatternInstance(
      lattice,
      { x: 0, y: 0, w: 100000, h: 100000 },
      () => undefined,
      {
        maxInstances: 64,
      },
    );
    expect(walk.count).toBe(64);
    expect(walk.truncated).toBe(true);
  });
});

describe('patternCellAt — inverse mapping for cross-boundary editing', () => {
  it('round-trips a point through its instance matrix', () => {
    const lattice = resolvePatternLattice({ ...base, arrangement: 'half-drop', offsetX: -7.5 });
    if (!lattice) throw new Error('expected lattice');
    for (const [px, py] of [
      [5, 5],
      [73, 41],
      [-12.5, 3.25],
      [203.5, -88.75],
    ] as const) {
      const hit = patternCellAt(lattice, px, py);
      expect(hit).not.toBeNull();
      if (!hit) continue;
      const matrix = patternInstanceMatrix(lattice, hit.i, hit.j);
      const back = applyAffine(matrix, [hit.localX, hit.localY]);
      expect(back[0]).toBeCloseTo(px, 8);
      expect(back[1]).toBeCloseTo(py, 8);
      expect(hit.localX).toBeGreaterThanOrEqual(-1e-9);
      expect(hit.localX).toBeLessThanOrEqual(lattice.tileWidth + 1e-9);
      expect(hit.localY).toBeGreaterThanOrEqual(-1e-9);
      expect(hit.localY).toBeLessThanOrEqual(lattice.tileHeight + 1e-9);
    }
  });

  it('maps a point in a mirrored copy back to the canonical source pixel', () => {
    const lattice = resolvePatternLattice({ tileWidth: 10, tileHeight: 10, mirrorX: true });
    if (!lattice) throw new Error('expected lattice');
    // Column 1 is flipped: pattern x just right of its left edge is source x
    // just left of the tile's right edge.
    const hit = patternCellAt(lattice, 10.5, 5);
    expect(hit?.i).toBe(1);
    expect(hit?.localX).toBeCloseTo(9.5, 8);
    expect(hit?.localY).toBeCloseTo(5, 8);
  });

  it('finds half-drop and brick cells through the inverse lattice', () => {
    const halfDrop = resolvePatternLattice({ ...base, arrangement: 'half-drop' });
    const brick = resolvePatternLattice({ ...base, arrangement: 'brick' });
    if (!halfDrop || !brick) throw new Error('expected valid lattices');

    const halfDropHit = patternCellAt(halfDrop, 45, 17);
    expect(halfDropHit).toMatchObject({ i: 1, j: 0, localX: 5, localY: 5 });
    const brickHit = patternCellAt(brick, 25, 29);
    expect(brickHit).toMatchObject({ i: 0, j: 1, localX: 5, localY: 5 });
  });

  it('rejects non-finite input', () => {
    const lattice = resolvePatternLattice(base);
    if (!lattice) throw new Error('expected lattice');
    expect(patternCellAt(lattice, Number.NaN, 0)).toBeNull();
  });
});

describe('patternRepeatSignature', () => {
  it('distinguishes every input the lattice depends on', () => {
    const a = patternRepeatSignature({ ...base, arrangement: 'grid' });
    const b = patternRepeatSignature({ ...base, arrangement: 'half-drop' });
    const c = patternRepeatSignature({ ...base, arrangement: 'grid', mirrorX: true });
    const d = patternRepeatSignature({ ...base, arrangement: 'grid', offsetX: 1 });
    expect(new Set([a, b, c, d]).size).toBe(4);
    // Same parameters produce the same signature.
    expect(patternRepeatSignature({ ...base, arrangement: 'grid' })).toBe(a);
  });

  it('reports degenerate parameters as a single stable token', () => {
    expect(patternRepeatSignature({ tileWidth: 0, tileHeight: 0 })).toBe('degenerate');
  });
});
