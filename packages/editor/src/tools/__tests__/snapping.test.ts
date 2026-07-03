import { describe, expect, it } from 'vitest';
import { snapPosition, snapSize } from '../snapping';

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

describe('snapPosition — distance indicators', () => {
  it('includes distance value when snapping edges', () => {
    const result = snapPosition(3, 50, 100, 100, [box(0, 50, 100, 100)]);
    expect(result.x).toBe(0);
    const guide = result.guides.find((g) => g.axis === 'vertical');
    expect(guide?.distance).toBe(3);
    expect(guide?.type).toBe('edge');
  });

  it('distance is the difference between aligned edges', () => {
    // right-to-right snap: subject.right=203, target.right=200, diff=3
    const result = snapPosition(103, 50, 100, 100, [box(100, 50, 100, 100)]);
    expect(result.x).toBe(100);
    const guide = result.guides.find((g) => g.axis === 'vertical');
    expect(guide?.distance).toBe(3);
  });

  it('includes type center for center snaps', () => {
    const result = snapPosition(112, 500, 80, 100, [box(100, 0, 100, 100)]);
    expect(result.x).toBe(110);
    const guide = result.guides.find((g) => g.axis === 'vertical');
    expect(guide?.type).toBe('center');
  });
});

describe('snapPosition — mid-point snapping', () => {
  it('snaps to mid-point between two aligned objects', () => {
    // Two targets at x=0,w=100 (center=50) and x=200,w=100 (center=250)
    // Mid-point of centers = (50+250)/2 = 150
    // Subject: x=96, w=100 => centerX=146, diff=4 < 5
    const result = snapPosition(96, 50, 100, 100, [
      box(0, 50, 100, 100),
      box(200, 50, 100, 100),
    ]);
    // Should snap so centerX = 150, meaning x = 150 - 50 = 100
    expect(result.x).toBe(100);
    expect(result.guides.some((g) => g.type === 'midpoint')).toBe(true);
  });

  it('mid-point is exactly between the two objects edges', () => {
    // Objects at x=0 (center=50) and x=300 (center=350)
    // Mid-point of centers = (50+350)/2 = 200
    // Subject offset 4px: x=146, w=100 => centerX=196, diff=4 < 5
    const result = snapPosition(146, 50, 100, 100, [
      box(0, 50, 100, 100),
      box(300, 50, 100, 100),
    ]);
    // snapped to centerX=200, so x=150
    expect(result.x).toBe(150);
    const guide = result.guides.find((g) => g.type === 'midpoint');
    expect(guide).toBeDefined();
    expect(guide?.position).toBe(200);
  });

  it('does not mid-point snap when not near mid-point', () => {
    // centerX of subject (100+50=150) vs mid-point of centers (50+350)/2=200, diff=50 > 5
    // Y positions staggered so Y mid-point doesn't trigger either
    const result = snapPosition(100, 200, 100, 100, [
      box(0, 0, 100, 100),
      box(300, 500, 100, 100),
    ]);
    expect(result.x).toBe(100);
    expect(result.guides.filter((g) => g.type === 'midpoint')).toHaveLength(0);
  });
});

describe('snapSize', () => {
  it('snaps width to match a target object width when within threshold', () => {
    const result = snapSize(202, 100, [box(0, 0, 200, 100)]);
    expect(result.w).toBe(200);
    expect(result.matched).toBe(true);
  });

  it('snaps height to match a target object height when within threshold', () => {
    const result = snapSize(100, 103, [box(0, 0, 200, 100)]);
    expect(result.h).toBe(100);
    expect(result.matched).toBe(true);
  });

  it('does not snap size when difference exceeds threshold', () => {
    // w diff=10 >=5, h diff=50 >=5 — neither matches
    const result = snapSize(210, 150, [box(0, 0, 200, 100)]);
    expect(result.w).toBe(210);
    expect(result.h).toBe(150);
    expect(result.matched).toBe(false);
  });

  it('returns a size-match guide when snapped', () => {
    const result = snapSize(202, 100, [box(0, 0, 200, 100)]);
    expect(result.guide).toBeDefined();
    expect(result.guide?.type).toBe('size-match');
    expect(result.guide?.label).toBe('200px');
  });
});
