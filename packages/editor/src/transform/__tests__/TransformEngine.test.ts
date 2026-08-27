// @ts-nocheck
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { TransformEngine } from '../TransformEngine';

function makeDoc(nodes: Record<string, any>) {
  return { nodes, rootChildren: Object.keys(nodes), pages: [], activePageId: 'page1' } as any;
}

function makeRasterShape(id: string, src: string, w: number, h: number) {
  return {
    id,
    kind: 'shape' as const,
    name: `Image ${id}`,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    fill: [0, 0, 0, 255] as [number, number, number, number],
    strokes: [] as [],
    effects: [] as [],
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
    fills: [{ type: 'image' as const, src, fit: 'fill' as const, x: 0, y: 0, scale: 1 }],
  };
}

function makeBackgroundRemovedRaster(id: string, w: number, h: number) {
  return {
    ...makeRasterShape(id, `${id}.png`, w, h),
    backgroundRemoval: {
      method: 'quick' as const,
      maskDataUrl: 'data:image/png;base64,MASK',
      confidence: 1,
      appliedAt: 1,
    },
    mask: {
      type: 'alpha' as const,
      rasterMask: {
        assetId: `${id}-mask`,
        width: w,
        height: h,
      },
    },
  };
}

function makeVectorShape(id: string, w: number, h: number) {
  return {
    id,
    kind: 'shape' as const,
    name: `Rect ${id}`,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    fill: [255, 0, 0, 255] as [number, number, number, number],
    strokes: [] as [],
    effects: [] as [],
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
  };
}

function makeFrame(id: string, w: number, h: number) {
  return {
    id,
    kind: 'frame' as const,
    name: `Frame ${id}`,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    children: [] as string[],
    w,
    h,
    transform: [1, 0, 0, 1, 0, 0] as Affine,
  };
}

describe('TransformEngine.isAllRaster', () => {
  it('returns true when all selected nodes are raster', () => {
    const doc = makeDoc({
      img1: makeRasterShape('img1', 'a.png', 100, 80),
    });
    const engine = new TransformEngine(doc, ['img1']);
    expect(engine.isAllRaster()).toBe(true);
  });

  it('returns true for multiple raster nodes', () => {
    const doc = makeDoc({
      img1: makeRasterShape('img1', 'a.png', 100, 80),
      img2: makeRasterShape('img2', 'b.png', 200, 150),
    });
    const engine = new TransformEngine(doc, ['img1', 'img2']);
    expect(engine.isAllRaster()).toBe(true);
  });

  it('returns false when selection includes a vector shape', () => {
    const doc = makeDoc({
      img1: makeRasterShape('img1', 'a.png', 100, 80),
      rect1: makeVectorShape('rect1', 50, 50),
    });
    const engine = new TransformEngine(doc, ['img1', 'rect1']);
    expect(engine.isAllRaster()).toBe(false);
  });

  it('returns false when selection includes a frame', () => {
    const doc = makeDoc({
      img1: makeRasterShape('img1', 'a.png', 100, 80),
      frame1: makeFrame('frame1', 200, 200),
    });
    const engine = new TransformEngine(doc, ['img1', 'frame1']);
    expect(engine.isAllRaster()).toBe(false);
  });

  it('returns false when all selected nodes are vector', () => {
    const doc = makeDoc({
      rect1: makeVectorShape('rect1', 100, 80),
      rect2: makeVectorShape('rect2', 50, 50),
    });
    const engine = new TransformEngine(doc, ['rect1', 'rect2']);
    expect(engine.isAllRaster()).toBe(false);
  });

  it('returns false for empty selection', () => {
    const doc = makeDoc({});
    const engine = new TransformEngine(doc, []);
    expect(engine.isAllRaster()).toBe(false);
  });
});

describe('TransformEngine.resize — image aspect ratio', () => {
  it('bypasses selection-box snapping when the alternate transform modifier is active', () => {
    const img = makeRasterShape('img1', 'a.png', 100, 100);
    const doc = makeDoc({ img1: img });
    const snapBox = vi.fn((box: import('@varve/shared').SelectionBox) => ({
      ...box,
      w: 500,
      h: 500,
    }));
    const engine = new TransformEngine(doc, ['img1'], { snapBox });

    const resized = engine.resize([150, 50], 'e', { proportional: false, bypassSnap: true }, doc);

    expect(snapBox).not.toHaveBeenCalled();
    const node = resized.nodes.img1 as unknown as typeof img;
    expect(node.transform[0]).toBeCloseTo(1.5);
    expect(node.transform[3]).toBeCloseTo(1);
  });

  it('applies proportional resize to a raster node', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // Resize with proportional=true (corner handle, Shift held)
    const newDoc = engine.resize(
      [200, 120], // pointer in world space (SE direction)
      'se',
      { proportional: true },
      doc,
    );

    const resized = newDoc.nodes.img1 as unknown as typeof img;
    expect(resized).toBeDefined();
    // The transform should have uniform scale (aspect preserved)
    const [a, b, c, d] = resized.transform;
    const scaleX = Math.hypot(a, b);
    const scaleY = Math.hypot(c, d);
    // For proportional resize, scaleX ≈ scaleY
    expect(scaleX).toBeCloseTo(scaleY, 4);
  });

  it('allows non-uniform resize when proportional is false', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // Resize with proportional=false (free resize)
    const newDoc = engine.resize(
      [200, 0], // pointer moves right only
      'e',
      { proportional: false },
      doc,
    );

    const resized = newDoc.nodes.img1 as unknown as typeof img;
    expect(resized).toBeDefined();
    const [a, b, c, d] = resized.transform;
    const scaleX = Math.hypot(a, b);
    const scaleY = Math.hypot(c, d);
    // For free resize, scaleX ≠ scaleY
    expect(scaleX).not.toBeCloseTo(scaleY, 2);
  });
});

function makeTextNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'text' as const,
    name: `Text ${id}`,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    fill: [0, 0, 0, 255] as [number, number, number, number],
    strokes: [] as [],
    effects: [] as [],
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    text: 'Area text that wraps across more than one line',
    fontSize: 16,
    fontFamily: 'Test Sans',
    lineHeight: 1.4,
    ...overrides,
  };
}

describe('TransformEngine.bakeNode — text resizing contract', () => {
  it('widens a fixed area box instead of scaling its type', () => {
    const node = makeTextNode('t1', { w: 200, h: 100, textMode: 'area', textResizing: 'fixed' });
    const doc = makeDoc({ t1: node });
    const engine = new TransformEngine(doc, ['t1'], { bakeOnCommit: true });

    const resized = engine.resize([400, 100], 'e', { proportional: false }, doc);
    const baked = engine.commit(resized).nodes.t1 as unknown as typeof node;

    expect(baked.fontSize).toBe(16);
    expect(baked.w).toBeGreaterThan(300);
    expect(baked.h).toBeCloseTo(100, 0);
  });

  it('leaves auto-height without a stored height so the wrap keeps owning it', () => {
    const node = makeTextNode('t1', { w: 200, textMode: 'area', textResizing: 'autoHeight' });
    const doc = makeDoc({ t1: node });
    const engine = new TransformEngine(doc, ['t1'], { bakeOnCommit: true });

    const resized = engine.resize([400, 300], 'se', { proportional: false }, doc);
    const baked = engine.commit(resized).nodes.t1 as unknown as typeof node;

    expect(baked.fontSize).toBe(16);
    expect(baked.w).toBeGreaterThan(300);
    expect(baked.h).toBeUndefined();
  });

  it('scales the type for auto-width text, which owns no container', () => {
    const node = makeTextNode('t1', { text: 'Point text', textResizing: 'autoWidth' });
    const doc = makeDoc({ t1: node });
    const engine = new TransformEngine(doc, ['t1'], { bakeOnCommit: true });

    const resized = engine.resize([400, 200], 'se', { proportional: true }, doc);
    const baked = engine.commit(resized).nodes.t1 as unknown as typeof node;

    expect(baked.fontSize).toBeGreaterThan(16);
    expect(baked.w).toBeUndefined();
  });
});

describe('TransformEngine.bakeNode — image-node commit', () => {
  it('shrinks a background-removed image from its centre without dropping mask metadata', () => {
    const img = makeBackgroundRemovedRaster('cutout', 200, 120);
    const doc = makeDoc({ cutout: img });
    const engine = new TransformEngine(doc, ['cutout'], { bakeOnCommit: true });

    const resized = engine.resize(
      [150, 60],
      'e',
      { centered: true, proportional: false, bypassSnap: true },
      doc,
    );
    const committed = engine.commit(resized);
    const node = committed.nodes.cutout as unknown as typeof img;

    expect(node.shape.w).toBeCloseTo(100);
    expect(node.shape.h).toBeCloseTo(120);
    expect(node.transform[4]).toBeCloseTo(50);
    expect(node.transform[5]).toBeCloseTo(0);
    expect(node.backgroundRemoval).toEqual(img.backgroundRemoval);
    expect(node.mask).toEqual(img.mask);
  });

  it('bakes scale into shape dimensions, not transform, for an image-filled rect', () => {
    // Image node: 1920x1080 rect, identity transform, image fill
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // Simulate SE corner drag from center of right-bottom quadrant
    // initialBox: cx=960, cy=540, w=1920, h=1080
    // Drag SE handle to (2920, 1580) → box widens by 1000, heightens by 500
    const newDoc = engine.resize([2920, 1580], 'se', {}, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    expect(node).toBeDefined();
    // Shape dimensions should reflect the resize (roughly 2920×1580)
    expect(node.shape.w).toBeGreaterThan(1920);
    expect(node.shape.h).toBeGreaterThan(1080);
    // The transform matrix should have scale 1 on both axes (no distortion baked in)
    const [a, b, c, d] = node.transform;
    expect(Math.hypot(a, b)).toBeCloseTo(1, 2);
    expect(Math.hypot(c, d)).toBeCloseTo(1, 2);
  });

  it('preserves aspect ratio on commit for proportional image resize', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // Proportional resize (Shift held for images → proportional=false, so we pass true explicitly)
    const newDoc = engine.resize([2920, 1642], 'se', { proportional: true }, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    // Original aspect: 1920/1080 = 16/9 ≈ 1.777...
    const aspect = node.shape.w / node.shape.h;
    expect(aspect).toBeCloseTo(1920 / 1080, 2);
  });

  it('allows non-uniform shape dimensions when proportional is false', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // Free resize: width changes more than height
    const newDoc = engine.resize([2920, 1580], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    const aspect = node.shape.w / node.shape.h;
    // Original aspect: 16/9 ≈ 1.777
    // New: 2920/1580 ≈ 1.848 — different from original
    expect(aspect).not.toBeCloseTo(1920 / 1080, 3);
  });

  it('keeps transform scale at 1 after commit for an east-edge resize', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // East handle: only width changes
    const newDoc = engine.resize([2920, 540], 'e', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    // Shape width increased, height unchanged
    expect(node.shape.w).toBeGreaterThan(1920);
    expect(node.shape.h).toBe(1080);
    // Transform should be position-only
    const [a, b, c, d] = node.transform;
    expect(Math.hypot(a, b)).toBeCloseTo(1, 4);
    expect(Math.hypot(c, d)).toBeCloseTo(1, 4);
  });

  it('keeps transform scale at 1 after commit for a south-edge resize', () => {
    const img = makeRasterShape('img1', 'a.png', 1920, 1080);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // South handle: only height changes
    const newDoc = engine.resize([960, 1580], 's', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    expect(node.shape.h).toBeGreaterThan(1080);
    expect(node.shape.w).toBe(1920);
    const [a, b, c, d] = node.transform;
    expect(Math.hypot(a, b)).toBeCloseTo(1, 4);
    expect(Math.hypot(c, d)).toBeCloseTo(1, 4);
  });

  it('commits a centred resize correctly (Alt held)', () => {
    const img = makeRasterShape('img1', 'a.png', 200, 200);
    const doc = makeDoc({ img1: img });
    const engine = new TransformEngine(doc, ['img1'], { bakeOnCommit: true });

    // SE corner, centred: each edge moves equally from center
    const newDoc = engine.resize([300, 300], 'se', { centered: true, proportional: true }, doc);
    const committed = engine.commit(newDoc);

    const node = committed.nodes.img1 as unknown as typeof img;
    // With centred + proportional: both dimensions scale uniformly
    expect(node.shape.w).toBeGreaterThan(200);
    expect(node.shape.h).toBeGreaterThan(200);
    expect(node.shape.w / node.shape.h).toBeCloseTo(1, 4);

    const [a, b, c, d] = node.transform;
    expect(Math.hypot(a, b)).toBeCloseTo(1, 2);
    expect(Math.hypot(c, d)).toBeCloseTo(1, 2);
  });

  it('handles multi-selection with two image nodes', () => {
    const img1 = makeRasterShape('img1', 'a.png', 1920, 1080);
    const img2 = makeRasterShape('img2', 'b.png', 640, 480);
    const doc = makeDoc({ img1, img2 });
    const engine = new TransformEngine(doc, ['img1', 'img2'], { bakeOnCommit: true });

    // Proportional resize on multi-selection
    const newDoc = engine.resize([2000, 1000], 'se', { proportional: true }, doc);
    const committed = engine.commit(newDoc);

    const n1 = committed.nodes.img1 as unknown as typeof img1;
    const n2 = committed.nodes.img2 as unknown as typeof img2;
    // Both should have baked dimensions, not transform scales
    expect(Math.hypot(n1.transform[0], n1.transform[1])).toBeCloseTo(1, 2);
    expect(Math.hypot(n2.transform[0], n2.transform[1])).toBeCloseTo(1, 2);
  });
});

describe('TransformEngine.bakeNode — frame child constraints', () => {
  function makeChild(id: string, x: number, y: number, w: number, h: number) {
    return {
      id,
      kind: 'shape' as const,
      name: `Child ${id}`,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      fill: [255, 0, 0, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: [1, 0, 0, 1, x, y] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
      constraints: { horizontal: 'min', vertical: 'min' } as const,
    };
  }

  it('applies min constraints (pinned to left/top)', () => {
    const child = makeChild('child1', 20, 30, 100, 80);
    const frame = makeFrame('frame1', 400, 300);
    frame.children = ['child1'];
    frame.w = 400;
    frame.h = 300;
    const doc = makeDoc({ frame1: frame, child1: child });

    const engine = new TransformEngine(doc, ['frame1'], { bakeOnCommit: true });

    // Resize frame to 800x600
    const newDoc = engine.resize([800, 600], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const movedChild = committed.nodes.child1 as unknown as typeof child;
    // Min constraints: position stays the same (pinned to left/top)
    expect(movedChild.transform[4]).toBe(20);
    expect(movedChild.transform[5]).toBe(30);
  });

  it('applies max constraints (pinned to right/bottom)', () => {
    const child = makeChild('child1', 300, 220, 100, 80);
    child.constraints = { horizontal: 'max', vertical: 'max' };
    const frame = makeFrame('frame1', 400, 300);
    frame.children = ['child1'];
    frame.w = 400;
    frame.h = 300;
    const doc = makeDoc({ frame1: frame, child1: child });

    const engine = new TransformEngine(doc, ['frame1'], { bakeOnCommit: true });

    // Resize frame to 800x600
    const newDoc = engine.resize([800, 600], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const movedChild = committed.nodes.child1 as unknown as typeof child;
    // Max constraints: distance from right edge stays the same
    const oldRight = 400 - (300 + 100);
    const newX = 800 - 100 - oldRight; // = 800 - 100 - 0 = 700
    const oldBottom = 300 - (220 + 80);
    const newY = 600 - 80 - oldBottom; // = 600 - 80 - 0 = 520
    expect(movedChild.transform[4]).toBe(newX);
    expect(movedChild.transform[5]).toBe(newY);
  });

  it('applies stretch constraints', () => {
    const child = makeChild('child1', 20, 30, 100, 80);
    child.constraints = { horizontal: 'stretch', vertical: 'stretch' };
    // Stretch child: marginLeft=20, marginRight=400-(20+100)=280
    // marginTop=30, marginBottom=300-(30+80)=190
    const frame = makeFrame('frame1', 400, 300);
    frame.children = ['child1'];
    frame.w = 400;
    frame.h = 300;
    const doc = makeDoc({ frame1: frame, child1: child });

    const engine = new TransformEngine(doc, ['frame1'], { bakeOnCommit: true });

    // Resize frame to 800x600
    const newDoc = engine.resize([800, 600], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const movedChild = committed.nodes.child1 as unknown as typeof child;
    // Stretch: child resizes to fill margins
    // newW = 800 - 20 - 280 = 500, newH = 600 - 30 - 190 = 380
    expect(movedChild.transform[4]).toBe(20); // x stays at margin
    expect(movedChild.transform[5]).toBe(30); // y stays at margin
    const mcShape = movedChild.shape;
    expect(mcShape.w).toBe(500); // width stretches
    expect(mcShape.h).toBe(380); // height stretches
  });

  it('applies scale constraints', () => {
    const child = makeChild('child1', 20, 30, 100, 80);
    child.constraints = { horizontal: 'scale', vertical: 'scale' };
    const frame = makeFrame('frame1', 400, 300);
    frame.children = ['child1'];
    frame.w = 400;
    frame.h = 300;
    const doc = makeDoc({ frame1: frame, child1: child });

    const engine = new TransformEngine(doc, ['frame1'], { bakeOnCommit: true });

    // Resize frame to 800x600
    const newDoc = engine.resize([800, 600], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const movedChild = committed.nodes.child1 as unknown as typeof child;
    // Scale: position and size scale proportionally
    // newX = 20 * (800/400) = 40, newY = 30 * (600/300) = 60
    // newW = 100 * (800/400) = 200, newH = 80 * (600/300) = 160
    expect(movedChild.transform[4]).toBe(40);
    expect(movedChild.transform[5]).toBe(60);
    const mcShape2 = movedChild.shape;
    expect(mcShape2.w).toBe(200);
    expect(mcShape2.h).toBe(160);
  });

  it('does not move children without constraints', () => {
    const child = makeChild('child1', 20, 30, 100, 80);
    delete (child as { constraints?: unknown }).constraints;
    const frame = makeFrame('frame1', 400, 300);
    frame.children = ['child1'];
    frame.w = 400;
    frame.h = 300;
    const doc = makeDoc({ frame1: frame, child1: child });

    const engine = new TransformEngine(doc, ['frame1'], { bakeOnCommit: true });

    const newDoc = engine.resize([800, 600], 'se', { proportional: false }, doc);
    const committed = engine.commit(newDoc);

    const movedChild = committed.nodes.child1 as unknown as typeof child;
    // No constraints → child stays at original position
    expect(movedChild.transform[4]).toBe(20);
    expect(movedChild.transform[5]).toBe(30);
  });
});

describe('TransformEngine — authoritative vector geometry baking', () => {
  it('converts a non-uniformly resized circle to an exact editable cubic path', () => {
    const circle = {
      ...makeVectorShape('circle1', 20, 20),
      shape: { kind: 'circle' as const, cx: 0, cy: 0, r: 10 },
    };
    const doc = makeDoc({ circle1: circle });
    const engine = new TransformEngine(doc, ['circle1'], { bakeOnCommit: true });

    // The east handle changes only the horizontal dimension (20 → 30).
    const preview = engine.resize([20, 0], 'e', { proportional: false }, doc);
    const committed = engine.commit(preview);
    const shape = (committed.nodes.circle1 as typeof circle).shape;

    // A one-radius primitive cannot represent an ellipse. The committed path
    // retains the curve handles that the node editor and SVG exporter use.
    expect(shape.kind).toBe('path');
    if (shape.kind !== 'path') return;
    expect(shape.closed).toBe(true);
    expect(shape.points).toHaveLength(4);
    expect(shape.points[0]).toMatchObject({ x: 15, y: 0 });
    expect(shape.points[0]?.handleIn).toEqual([0, -5.522847498307936]);
    expect(shape.points[0]?.handleOut).toEqual([0, 5.522847498307936]);

    // No visual-only scale matrix is left behind after commit.
    const node = committed.nodes.circle1 as typeof circle;
    expect(node.transform[0]).toBeCloseTo(1);
    expect(node.transform[3]).toBeCloseTo(1);
  });

  it('keeps fractional path anchors and Bézier handles in persisted geometry', () => {
    const path = {
      ...makeVectorShape('path1', 1, 1),
      shape: {
        kind: 'path' as const,
        closed: false,
        tolerance: 0,
        points: [
          { x: 10.125, y: -4.375, handleIn: null, handleOut: [4.25, -2.5] as [number, number] },
          { x: 60.125, y: -4.375, handleIn: [-3.5, 1.75] as [number, number], handleOut: null },
        ],
      },
    };
    const doc = makeDoc({ path1: path });
    const engine = new TransformEngine(doc, ['path1'], { bakeOnCommit: true });

    // East-edge resize: 50 world units → 62.5 (a 1.25× horizontal scale).
    const preview = engine.resize([72.625, -4.375], 'e', { proportional: false }, doc);
    const committed = engine.commit(preview);
    const shape = (committed.nodes.path1 as typeof path).shape;

    expect(shape.kind).toBe('path');
    if (shape.kind !== 'path') return;
    expect(shape.points[0]?.x).toBeCloseTo(12.65625, 12);
    expect(shape.points[0]?.y).toBeCloseTo(-4.375, 12);
    expect(shape.points[0]?.handleOut?.[0]).toBeCloseTo(5.3125, 12);
    expect(shape.points[0]?.handleOut?.[1]).toBeCloseTo(-2.5, 12);
    expect(shape.points[1]?.x).toBeCloseTo(75.15625, 12);
    expect(shape.points[1]?.y).toBeCloseTo(-4.375, 12);
    expect(shape.points[1]?.handleIn?.[0]).toBeCloseTo(-4.375, 12);
    expect(shape.points[1]?.handleIn?.[1]).toBeCloseTo(1.75, 12);
  });
});
