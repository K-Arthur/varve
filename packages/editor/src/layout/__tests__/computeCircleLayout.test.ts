// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { computeCircleLayout } from '../computeCircleLayout';

describe('computeCircleLayout', () => {
  it('places 4 items evenly around a circle', () => {
    const items = [
      { id: 'a', width: 20, height: 20 },
      { id: 'b', width: 20, height: 20 },
      { id: 'c', width: 20, height: 20 },
      { id: 'd', width: 20, height: 20 },
    ];
    const result = computeCircleLayout(items, { centerX: 100, centerY: 100, radius: 80 });

    expect(result).toHaveLength(4);
    // Items should be at 0°, 90°, 180°, 270° from center
    expect(result[0]).toMatchObject({ id: 'a' });
    expect(result[1]).toMatchObject({ id: 'b' });
    expect(result[2]).toMatchObject({ id: 'c' });
    expect(result[3]).toMatchObject({ id: 'd' });

    // Check spacing: item A (at -90° default) should be above center
    expect(result[0].x).toBeCloseTo(100 - 10, 0); // centerX - halfWidth
    expect(result[0].y).toBeCloseTo(100 - 80 - 10, 0); // centerY - radius - halfHeight
  });

  it('respects custom radius', () => {
    const items = [
      { id: 'a', width: 10, height: 10 },
      { id: 'b', width: 10, height: 10 },
    ];
    const result = computeCircleLayout(items, { centerX: 0, centerY: 0, radius: 50 });
    expect(result).toHaveLength(2);
    // Item center is at (x + w/2, y + h/2). Distance from (0,0) center should be ~ radius
    const cx = result[0].x + 5;
    const cy = result[0].y + 5;
    const distA = Math.sqrt(cx * cx + cy * cy);
    expect(distA).toBeCloseTo(50, 0);
  });

  it('rotates items when rotateItems is true', () => {
    const items = [
      { id: 'a', width: 30, height: 30 },
      { id: 'b', width: 30, height: 30 },
    ];
    const result = computeCircleLayout(items, {
      centerX: 0,
      centerY: 0,
      radius: 100,
      startAngle: 0,
      rotateItems: true,
    });
    expect(result[0].rotation).toBeDefined();
    expect(result[1].rotation).toBeDefined();
    // At startAngle=0, first item is at 0°, rotation = 0+90 = 90° (default outward)
    expect(result[0].rotation).toBeCloseTo(90, 0);
  });

  it('returns empty array for no items', () => {
    const result = computeCircleLayout([], {});
    expect(result).toEqual([]);
  });
});
