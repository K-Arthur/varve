import { describe, expect, it } from 'vitest';
import { snapPosition } from '../snapping';

const THRESHOLD = 5;

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('snapPosition', () => {
  it('snaps left edge to left edge of target', () => {
    const result = snapPosition(3, 50, 100, 100, [box(0, 50, 100, 100)]);
    expect(result.x).toBe(0);
    expect(result.guides.some((g) => g.axis === 'vertical')).toBe(true);
  });

  it('snaps right edge to right edge of target', () => {
    // subject: x=103, w=100 → right=203. target: x=100, w=100 → right=200. diff=3 < 5
    // Y: place far from target Y to avoid horizontal guides
    const result = snapPosition(103, 500, 100, 100, [box(100, 0, 100, 100)]);
    expect(result.x).toBe(100);
    expect(result.guides.some((g) => g.axis === 'vertical')).toBe(true);
  });

  it('snaps center-x to center-x of target', () => {
    // target: x=100, w=100 => centerX=150
    // subject: x=112, w=80 => centerX=152, diff=2. left diff=12, right diff=8 (no edge snap)
    // Y far away to avoid Y snap
    const result = snapPosition(112, 500, 80, 100, [box(100, 0, 100, 100)]);
    // snappedX = 112 - 2 = 110 (centerX = 110+40 = 150)
    expect(result.x).toBe(110);
    expect(result.guides.some((g) => g.axis === 'vertical')).toBe(true);
  });

  it('snaps top edge to top edge of target', () => {
    const result = snapPosition(500, 3, 100, 100, [box(0, 0, 100, 100)]);
    expect(result.y).toBe(0);
    expect(result.guides.some((g) => g.axis === 'horizontal')).toBe(true);
  });

  it('snaps bottom edge to bottom edge of target', () => {
    // subject: y=103, h=100 => bottom=203. target: y=100, h=100 => bottom=200. diff=3
    const result = snapPosition(500, 103, 100, 100, [box(0, 100, 100, 100)]);
    expect(result.y).toBe(100);
    expect(result.guides.some((g) => g.axis === 'horizontal')).toBe(true);
  });

  it('snaps center-y to center-y of target', () => {
    // target: y=100, h=100 => centerY=150
    // subject: y=112, h=80 => centerY=152, diff=2. top diff=12, bottom diff=8 (no edge snap)
    const result = snapPosition(500, 112, 100, 80, [box(0, 100, 100, 100)]);
    // snappedY = 112 - 2 = 110 (centerY = 110+40 = 150)
    expect(result.y).toBe(110);
    expect(result.guides.some((g) => g.axis === 'horizontal')).toBe(true);
  });

  it('does not snap when distance equals threshold (strict less-than boundary)', () => {
    // diff = THRESHOLD on X axis, no Y alignment
    const result = snapPosition(THRESHOLD, 500, 100, 100, [box(0, 0, 100, 100)]);
    // left diff = 5-0 = 5, right diff = 105-100 = 5, centerX diff = 55-50 = 5 — none snap
    expect(result.x).toBe(THRESHOLD);
    expect(result.guides.filter((g) => g.axis === 'vertical')).toHaveLength(0);
  });

  it('does not snap when distance exceeds threshold', () => {
    const result = snapPosition(100, 200, 100, 100, [box(0, 0, 100, 100)]);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.guides).toHaveLength(0);
  });

  it('returns no guides and unchanged position for empty targets', () => {
    const result = snapPosition(50, 50, 100, 100, []);
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.guides).toHaveLength(0);
  });
});
