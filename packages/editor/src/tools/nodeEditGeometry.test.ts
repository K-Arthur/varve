import type { PathPoint } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { findNodeEditHit } from './nodeEditGeometry';

const point = (x: number, y: number, handleOut: [number, number] | null = null): PathPoint => ({
  x,
  y,
  handleIn: null,
  handleOut,
});

describe('node edit screen-space hit testing', () => {
  it('uses the complete affine projection for rotated and non-uniform paths', () => {
    const transform = [0, 2, -1, 0, 300, 40] as const;
    const rings = [[point(10, 20), point(80, 20)]];
    const hit = findNodeEditHit(rings, false, transform, { x: 280, y: 60 }, (world) => world);
    expect(hit).toEqual({ kind: 'anchor', anchorIdx: 0 });
  });

  it('gives anchors priority over collapsed or nearby handles', () => {
    const rings = [[point(0, 0, [12, 0]), point(100, 0)]];
    expect(
      findNodeEditHit(rings, false, [1, 0, 0, 1, 0, 0], { x: 0, y: 0 }, (world) => world),
    ).toEqual({ kind: 'anchor', anchorIdx: 0 });
    expect(
      findNodeEditHit(rings, false, [1, 0, 0, 1, 0, 0], { x: 12, y: 0 }, (world) => world),
    ).toEqual({ kind: 'handle', anchorIdx: 0, which: 'out' });
  });

  it('includes the closing segment and returns its local parameter', () => {
    const rings = [[point(0, 0), point(100, 0), point(100, 100)]];
    const hit = findNodeEditHit(
      rings,
      true,
      [1, 0, 0, 1, 0, 0],
      { x: 20, y: 30 },
      (world) => world,
    );
    expect(hit?.kind).toBe('segment');
    expect(hit && hit.kind === 'segment' ? hit.segmentIndex : -1).toBe(2);
    expect(hit && hit.kind === 'segment' ? hit.t : -1).toBeGreaterThan(0);
    expect(hit && hit.kind === 'segment' ? hit.t : 2).toBeLessThan(1);
  });
});
