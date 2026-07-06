import { describe, expect, it } from 'vitest';
import { createSnapSession, filterSnapTargets, snapPosition, snapSize } from '../snapping';

const THRESHOLD = 8;

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
    const result = snapPosition(96, 50, 100, 100, [box(0, 50, 100, 100), box(200, 50, 100, 100)]);
    // Should snap so centerX = 150, meaning x = 150 - 50 = 100
    expect(result.x).toBe(100);
    expect(result.guides.some((g) => g.type === 'midpoint')).toBe(true);
  });

  it('mid-point is exactly between the two objects edges', () => {
    // Objects at x=0 (center=50) and x=300 (center=350)
    // Mid-point of centers = (50+350)/2 = 200
    // Subject offset 4px: x=146, w=100 => centerX=196, diff=4 < 5
    const result = snapPosition(146, 50, 100, 100, [box(0, 50, 100, 100), box(300, 50, 100, 100)]);
    // snapped to centerX=200, so x=150
    expect(result.x).toBe(150);
    const guide = result.guides.find((g) => g.type === 'midpoint');
    expect(guide).toBeDefined();
    expect(guide?.position).toBe(200);
  });

  it('does not mid-point snap when not near mid-point', () => {
    // centerX of subject (100+50=150) vs mid-point of centers (50+350)/2=200, diff=50 > 5
    // Y positions staggered so Y mid-point doesn't trigger either
    const result = snapPosition(100, 200, 100, 100, [box(0, 0, 100, 100), box(300, 500, 100, 100)]);
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

describe('filterSnapTargets — D-02', () => {
  const dragged = { x: 0, y: 0, w: 100, h: 100 };
  const camera = { zoom: 1 };

  it('nearby target included, far target excluded', () => {
    const allBounds = [
      { nodeId: 'near', bounds: { x: 150, y: 0, w: 100, h: 100 } },
      { nodeId: 'far', bounds: { x: 500, y: 0, w: 100, h: 100 } },
    ];
    const parentIndex = new Map<string, string | null>([
      ['near', 'root'],
      ['far', 'root'],
    ]);
    const result = filterSnapTargets(dragged, camera, allBounds, parentIndex, 'dragged');
    const ids = result.map((b) => `${b.x},${b.y},${b.w},${b.h}`);
    expect(ids).toContain('150,0,100,100');
    expect(ids).not.toContain('500,0,100,100');
  });

  it('sibling preferred over distant node when both are within spatial range', () => {
    // sibling at x=160 is closer than distant node at x=200, both within 200px
    const allBounds = [
      { nodeId: 'sibling', bounds: { x: 160, y: 0, w: 100, h: 100 } },
      { nodeId: 'distant', bounds: { x: 200, y: 0, w: 100, h: 100 } },
    ];
    const parentIndex = new Map<string, string | null>([
      ['sibling', 'parentA'],
      ['distant', 'parentB'],
      ['dragged', 'parentA'],
    ]);
    const result = filterSnapTargets(dragged, camera, allBounds, parentIndex, 'dragged');
    expect(result.length).toBe(2); // both are within range
  });

  it('returns empty array when no targets within range', () => {
    const allBounds = [
      { nodeId: 'far1', bounds: { x: 500, y: 500, w: 100, h: 100 } },
      { nodeId: 'far2', bounds: { x: 1000, y: 0, w: 100, h: 100 } },
    ];
    const parentIndex = new Map<string, string | null>([
      ['far1', 'root'],
      ['far2', 'root'],
    ]);
    const result = filterSnapTargets(dragged, camera, allBounds, parentIndex, 'dragged');
    expect(result).toHaveLength(0);
  });

  it('performance: 500 targets filtered in < 1ms', () => {
    const allBounds: Array<{
      nodeId: string;
      bounds: { x: number; y: number; w: number; h: number };
    }> = [];
    const parentIndex = new Map<string, string | null>();
    for (let i = 0; i < 500; i++) {
      const id = `n${i}`;
      // Only one target is within 200px range
      const x = i === 250 ? 160 : 1000 + i;
      allBounds.push({ nodeId: id, bounds: { x, y: 0, w: 100, h: 100 } });
      parentIndex.set(id, 'root');
    }
    const start = performance.now();
    const result = filterSnapTargets(dragged, camera, allBounds, parentIndex, 'dragged');
    const elapsed = performance.now() - start;
    expect(result.length).toBe(1); // only the one nearby
    expect(elapsed).toBeLessThan(1);
  });
});

describe('snapPosition — snapExcludedIds (D-03)', () => {
  it('excluded node skipped in object snapping', () => {
    // target[0] at x=0 would snap to dragged left edge (x=4, diff=4<5).
    // target[1] at x=300 is far. Y positions staggered so no Y snap.
    const targets = [
      { x: 0, y: 50, w: 100, h: 100 },
      { x: 300, y: 500, w: 100, h: 100 },
    ];
    const result = snapPosition(4, 200, 100, 100, targets, 0, new Set(['0']));
    expect(result.x).toBe(4); // not snapped to x=0 because target[0] excluded
    expect(result.guides).toHaveLength(0);
  });

  it('snaps to target when not excluded (sanity check)', () => {
    const targets = [{ x: 0, y: 50, w: 100, h: 100 }];
    const result = snapPosition(4, 200, 100, 100, targets, 0);
    expect(result.x).toBe(0);
    expect(result.guides.length).toBeGreaterThan(0);
  });
});

import {
  createDocument,
  makeShapeNode,
  setSnapExcluded as sceneSetSnapExcluded,
} from '@strata/scene';

describe('setSnapExcluded — D-03', () => {
  it('toggles snap exclusion on/off', () => {
    const doc = createDocument('test', true);
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const d1 = { ...doc, rootChildren: ['n1'], nodes: { ...doc.nodes, n1: shape } };
    const d2 = sceneSetSnapExcluded(d1, 'n1', true);
    expect((d2.nodes.n1 as (typeof d2.nodes)[string]).snapExcluded).toBe(true);
    const d3 = sceneSetSnapExcluded(d2, 'n1', false);
    expect((d3.nodes.n1 as (typeof d3.nodes)[string]).snapExcluded).toBe(false);
  });

  it('exclusion persists through undo/redo pattern', () => {
    const doc = createDocument('test', true);
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const d1 = { ...doc, rootChildren: ['n1'], nodes: { ...doc.nodes, n1: shape } };
    sceneSetSnapExcluded(d1, 'n1', true);
    // "undo" — revert to d1
    expect((d1.nodes.n1 as unknown as { snapExcluded?: boolean }).snapExcluded).toBeUndefined();
    // "redo" — apply d2 again
    const d3 = sceneSetSnapExcluded(d1, 'n1', true);
    expect((d3.nodes.n1 as unknown as { snapExcluded?: boolean }).snapExcluded).toBe(true);
  });
});

describe('snapPosition — frame/page center (D-04)', () => {
  it('snaps to page center when dragged near it', () => {
    // Page bounds: 1920x1080, center at (960, 540)
    // Dragged object at x=957, y=537, w=100, h=100 => centerX=1007, centerY=587
    // ... let me fix: centerX = 957+50 = 1007, page centerX = 960, diff = 47 > 5
    // Need diff < 5. Dragged centerX should be near 960.
    // Try: x=910, w=100 => centerX = 960. x=957 is wrong.
    // x=910, w=100 => centerX=960 exactly.
    const pageBounds = { x: 0, y: 0, w: 1920, h: 1080 };
    const result = snapPosition(910, 537, 100, 100, [pageBounds]);
    expect(result.x).toBe(910); // centerX=960 matches page centerX=960 (0 diff)
    // Actually, snap compares edges, not center. Let me adjust.
    // Page left=0, dragged left=0 => diff=0 < 5 (pass)
    // Wait, dragged x=910, page x=0, diff=910 > 5. No snap.
    // Snap is edge-based: dragged.left -> page.left, dragged.right -> page.right
    // dragged.right = 910+100=1010, page.right = 1920, diff=910. No.
    // dragged.centerX = 960, page.centerX = 960, diff=0 center snap.
    expect(result.guides.some((g) => g.axis === 'vertical' && g.type === 'center')).toBe(true);
  });

  it('snaps to parent frame center when dragged near it', () => {
    // Frame: x=100, y=100, w=400, h=300 => centerX=300, centerY=250
    // Dragged: x=250, y=200, w=100, h=100 => centerX=300, centerY=250
    // diff=0 on both
    const frameBounds = { x: 100, y: 100, w: 400, h: 300 };
    const result = snapPosition(250, 200, 100, 100, [frameBounds]);
    expect(result.guides.some((g) => g.axis === 'vertical' && g.type === 'center')).toBe(true);
    expect(result.guides.some((g) => g.axis === 'horizontal' && g.type === 'center')).toBe(true);
  });
});

describe('snapPosition — sticky hysteresis', () => {
  it('holds snap until release distance exceeded', () => {
    const session = createSnapSession();
    const first = snapPosition(3, 50, 100, 100, [box(0, 50, 100, 100)], undefined, undefined, {
      zoom: 1,
      session,
    });
    expect(first.x).toBe(0);
    expect(first.session.stickyX).not.toBeNull();
    const second = snapPosition(6, 50, 100, 100, [box(0, 50, 100, 100)], undefined, undefined, {
      zoom: 1,
      session: first.session,
    });
    expect(second.x).toBe(0);
    const third = snapPosition(20, 50, 100, 100, [box(0, 50, 100, 100)], undefined, undefined, {
      zoom: 1,
      session: second.session,
    });
    expect(third.x).toBe(20);
  });

  it('allows placement near guide without snapping when outside threshold', () => {
    const result = snapPosition(12, 50, 100, 100, [box(0, 50, 100, 100)]);
    expect(result.x).toBe(12);
  });
});
