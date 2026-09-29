// @ts-nocheck

import type { Document, NodeId } from '@varve/scene';
import {
  addChild,
  addPage,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  nextNodeId,
  resolveEditorSceneScope,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  buildMinimapScene,
  clipFootprintToStage,
  computeMinimapSize,
  computeMinimapTransform,
  computeViewportMinimapFootprint,
  computeViewportMinimapRect,
  computeViewportWorldCenter,
  computeViewportWorldRect,
  expandFootprintForHitTest,
  inflateFootprintToMinimum,
  isOrientationLabelWorthy,
  minimapToWorld,
  panForViewportCenter,
  pointInMinimapFootprint,
  worldRectToMinimap,
  worldToMinimap,
} from './minimapLayout';

/* -------------------------------------------------------------------------- */
/*  Test helpers                                                              */
/* -------------------------------------------------------------------------- */

function makeDoc(nodes: Record<string, unknown> = {}, rootChildren: NodeId[] = []): Document {
  return {
    id: 'doc-1',
    name: 'Test',
    formatVersion: '2.0',
    rootChildren,
    nodes: nodes as Document['nodes'],
    components: {},
    nextId: 100,
    pages: undefined,
    activePageId: undefined,
  } as Document;
}

function makeRectShape(id: string, x: number, y: number, w: number, h: number) {
  return {
    id,
    kind: 'shape' as const,
    name: `Rect ${id}`,
    transform: [1, 0, 0, 1, x, y] as const,
    fill: { r: 200, g: 100, b: 50 },
    shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
  };
}

function makeFrame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  children: NodeId[] = [],
) {
  return {
    id,
    kind: 'frame' as const,
    name: `Frame ${id}`,
    transform: [1, 0, 0, 1, x, y] as const,
    fill: { r: 255, g: 255, b: 255 },
    w,
    h,
    children,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    clipContent: true,
  };
}

function makeGroup(id: string, children: NodeId[] = []) {
  return {
    id,
    kind: 'group' as const,
    name: `Group ${id}`,
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { r: 200, g: 200, b: 200 },
    children,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
  };
}

function _makeTextNode(id: string, x: number, y: number, text: string, fontSize = 16) {
  return {
    id,
    kind: 'text' as const,
    name: `Text ${id}`,
    transform: [1, 0, 0, 1, x, y] as const,
    fill: { r: 0, g: 0, b: 0 },
    text,
    fontSize,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Tests: buildMinimapScene                                                  */
/* -------------------------------------------------------------------------- */

describe('buildMinimapScene', () => {
  it('returns empty document fallback bounds', () => {
    const doc = makeDoc({}, []);
    const scene = buildMinimapScene(doc, new Set());
    expect(scene.entries).toHaveLength(0);
    expect(scene.contentBounds).toEqual({ x: -200, y: -200, w: 400, h: 400 });
  });

  it('includes root-level shapes', () => {
    const r1 = makeRectShape('r1', 0, 0, 100, 80);
    const r2 = makeRectShape('r2', 200, 100, 150, 120);
    const doc = makeDoc({ r1, r2 }, ['r1', 'r2']);
    const scene = buildMinimapScene(doc, new Set());

    expect(scene.entries).toHaveLength(2);
    expect(scene.contentBounds.x).toBe(0);
    expect(scene.contentBounds.y).toBe(0);
    expect(scene.contentBounds.w).toBe(350);
    expect(scene.contentBounds.h).toBe(220);
  });

  it('recurses into frames', () => {
    const inner = makeRectShape('inner', 10, 10, 50, 40);
    const frame1 = makeFrame('frame1', 100, 100, 300, 200, ['inner']);
    const doc = makeDoc({ inner, frame1 }, ['frame1']);
    const scene = buildMinimapScene(doc, new Set());

    // Should have frame + inner shape = 2 entries
    expect(scene.entries).toHaveLength(2);
    expect(scene.entries[0].id).toBe('frame1');
    expect(scene.entries[0].isFrame).toBe(true);
    expect(scene.entries[0].isContainer).toBe(true);
    expect(scene.entries[1].id).toBe('inner');
    expect(scene.entries[1].depth).toBe(1);
  });

  it('recurses into groups', () => {
    const inner = makeRectShape('inner', 5, 5, 30, 20);
    const grp1 = makeGroup('grp1', ['inner']);
    const doc = makeDoc({ inner, grp1 }, ['grp1']);
    const scene = buildMinimapScene(doc, new Set());

    expect(scene.entries).toHaveLength(2);
    expect(scene.entries[0].isContainer).toBe(true);
    expect(scene.entries[1].id).toBe('inner');
  });

  it('excludes hidden nodes by default', () => {
    const vis = makeRectShape('vis', 0, 0, 100, 100);
    const hid = { ...makeRectShape('hid', 200, 0, 100, 100), visible: false };
    const doc = makeDoc({ vis, hid }, ['vis', 'hid']);
    const scene = buildMinimapScene(doc, new Set());

    expect(scene.entries).toHaveLength(1);
    expect(scene.entries[0].id).toBe('vis');
  });

  it('includes hidden nodes when opt-in', () => {
    const vis = makeRectShape('vis', 0, 0, 100, 100);
    const hid = { ...makeRectShape('hid', 200, 0, 100, 100), visible: false };
    const doc = makeDoc({ vis, hid }, ['vis', 'hid']);
    const scene = buildMinimapScene(doc, new Set(), { includeHidden: true });

    expect(scene.entries).toHaveLength(2);
    expect(scene.entries.find((e) => e.id === 'hid')?.visible).toBe(false);
  });

  it('marks selected entries', () => {
    const r1 = makeRectShape('r1', 0, 0, 100, 100);
    const r2 = makeRectShape('r2', 200, 0, 100, 100);
    const doc = makeDoc({ r1, r2 }, ['r1', 'r2']);
    const scene = buildMinimapScene(doc, new Set(['r1']));

    expect(scene.entries[0].selected).toBe(true);
    expect(scene.entries[1].selected).toBe(false);
  });

  it('respects maxDepth', () => {
    const leaf = makeRectShape('leaf', 5, 5, 10, 10);
    const mid = makeFrame('mid', 0, 0, 100, 100, ['leaf']);
    const root = makeFrame('root', 0, 0, 200, 200, ['mid']);
    const doc = makeDoc({ leaf, mid, root }, ['root']);
    const scene = buildMinimapScene(doc, new Set(), { maxDepth: 1 });

    // root (depth 0) + mid (depth 1) but not leaf (depth 2)
    expect(scene.entries).toHaveLength(2);
    expect(scene.entries.find((e) => e.id === 'leaf')).toBeUndefined();
  });

  it('detects outliers when one object is much larger than median', () => {
    // Several small objects and one massive outlier
    const r1 = makeRectShape('r1', 0, 0, 50, 50);
    const r2 = makeRectShape('r2', 100, 0, 50, 50);
    const r3 = makeRectShape('r3', 200, 0, 50, 50);
    const outlier = makeRectShape('outlier', 0, 0, 50000, 50000);
    const doc = makeDoc({ r1, r2, r3, outlier }, ['r1', 'r2', 'r3', 'outlier']);
    const scene = buildMinimapScene(doc, new Set(), { outlierFactor: 2 });

    // The outlier is flagged for discovery but remains in contentBounds.
    expect(scene.outliers.length).toBeGreaterThanOrEqual(1);
    expect(scene.outliers.some((e) => e.id === 'outlier')).toBe(true);
    expect(scene.contentBounds.w).toBe(50000);
  });

  it('handles negative coordinates', () => {
    const r1 = makeRectShape('r1', -500, -300, 100, 80);
    const r2 = makeRectShape('r2', 200, 150, 100, 80);
    const doc = makeDoc({ r1, r2 }, ['r1', 'r2']);
    const scene = buildMinimapScene(doc, new Set());

    expect(scene.contentBounds.x).toBe(-500);
    expect(scene.contentBounds.y).toBe(-300);
    expect(scene.contentBounds.w).toBe(800);
    expect(scene.contentBounds.h).toBe(530);
  });

  it('counts totalNodes', () => {
    const r1 = makeRectShape('r1', 0, 0, 50, 50);
    const r2 = makeRectShape('r2', 100, 0, 50, 50);
    const doc = makeDoc({ r1, r2 }, ['r1', 'r2']);
    const scene = buildMinimapScene(doc, new Set());
    expect(scene.totalNodes).toBe(2);
  });

  it('handles deeply nested hierarchy', () => {
    const leaf = makeRectShape('leaf', 5, 5, 10, 10);
    const inner = makeGroup('inner', ['leaf']);
    const mid = makeFrame('mid', 50, 50, 200, 200, ['inner']);
    const outer = makeFrame('outer', 0, 0, 400, 400, ['mid']);
    const doc = makeDoc({ leaf, inner, mid, outer }, ['outer']);
    const scene = buildMinimapScene(doc, new Set());

    // outer, mid, inner, leaf = 4
    expect(scene.entries).toHaveLength(4);
    expect(scene.entries.map((e) => e.depth)).toEqual([0, 1, 2, 3]);
  });

  it('includes every placed page in the pasteboard overview', () => {
    let doc = createDocument('pages', false);
    doc = addPage(doc, { width: 320, height: 240 });
    doc = {
      ...doc,
      pages: doc.pages!.map((page, index) => ({
        ...page,
        placement: { x: index * 420, y: index * 60 },
      })),
      activePageId: doc.pages![0]!.id,
    };

    const scene = buildMinimapScene(doc, new Set(), { scope: 'pasteboard' });

    expect(scene.pages).toHaveLength(2);
    expect(scene.pages[0]!.active).toBe(true);
    expect(scene.pages[1]!.bounds.x).toBe(420);
    expect(scene.contentBounds.x).toBe(0);
    expect(scene.contentBounds.w).toBeGreaterThanOrEqual(740);
  });

  it('uses the resolved Design Canvas occurrence set', () => {
    let doc = createDesignCanvas(createDocument('canvases', false), { name: 'A' });
    const firstCanvasId = doc.activeDesignCanvasId!;
    const firstRoot = designCanvasContentRoot(doc, firstCanvasId)!;
    const first = nextNodeId(doc);
    doc = addChild(first.doc, firstRoot, makeFrame(first.id, 0, 0, 120, 80, []));

    doc = createDesignCanvas(doc, { name: 'B' });
    const secondCanvasId = doc.activeDesignCanvasId!;
    const secondRoot = designCanvasContentRoot(doc, secondCanvasId)!;
    const second = nextNodeId(doc);
    doc = addChild(second.doc, secondRoot, makeFrame(second.id, 0, 0, 120, 80, []));

    const scope = resolveEditorSceneScope(doc, {
      workspaceMode: 'design',
      activeDesignCanvasId: firstCanvasId,
    });
    const scene = buildMinimapScene(doc, new Set(), { sceneScope: scope });

    expect(scene.surfaceKey).toBe(`designCanvas:${firstCanvasId}`);
    expect(scene.entries.map((entry) => entry.nodeId)).toEqual([first.id]);
    expect(scene.entries.some((entry) => entry.nodeId === second.id)).toBe(false);
  });

  it('keeps a degenerate line discoverable without producing invalid bounds', () => {
    const line = makeRectShape('line', 42, -8, 0, 0);
    const scene = buildMinimapScene(makeDoc({ line }, ['line']), new Set());

    expect(scene.entries[0]!.bounds).toEqual({ x: 42, y: -8, w: 1, h: 1 });
    expect(Object.values(scene.contentBounds).every(Number.isFinite)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: computeMinimapTransform                                            */
/* -------------------------------------------------------------------------- */

describe('computeMinimapTransform', () => {
  it('centers content in the minimap', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    expect(tf.mmWidth).toBe(160);
    expect(tf.mmHeight).toBe(120);
    expect(tf.scale).toBeGreaterThan(0);
    expect(tf.offsetX).toBeGreaterThanOrEqual(0);
    expect(tf.offsetY).toBeGreaterThanOrEqual(0);
  });

  it('handles zero-size content', () => {
    const bounds = { x: 0, y: 0, w: 0, h: 0 };
    const tf = computeMinimapTransform(bounds, 160, 120);
    expect(tf.scale).toBe(1);
    expect(tf.offsetX).toBe(80);
    expect(tf.offsetY).toBe(60);
  });

  it('preserves aspect ratio', () => {
    const bounds = { x: 0, y: 0, w: 400, h: 200 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    // The scale should ensure content fits within the canvas
    const contentW = bounds.w * tf.scale;
    const contentH = bounds.h * tf.scale;
    expect(contentW).toBeLessThanOrEqual(160);
    expect(contentH).toBeLessThanOrEqual(120);
  });

  it('applies padding', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const tf = computeMinimapTransform(bounds, 160, 120, 20);
    // With padding, the effective content area is larger, so scale should be smaller
    const tfNoPad = computeMinimapTransform(bounds, 160, 120, 0);
    expect(tf.scale).toBeLessThanOrEqual(tfNoPad.scale);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: coordinate transforms                                              */
/* -------------------------------------------------------------------------- */

describe('worldToMinimap / minimapToWorld', () => {
  it('round-trips correctly', () => {
    const bounds = { x: -100, y: -50, w: 400, h: 200 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    const worldPoint = { x: 50, y: 25 };
    const mm = worldToMinimap(worldPoint.x, worldPoint.y, tf);
    const back = minimapToWorld(mm.x, mm.y, tf);

    expect(back.x).toBeCloseTo(worldPoint.x, 6);
    expect(back.y).toBeCloseTo(worldPoint.y, 6);
  });

  it('handles negative coordinates', () => {
    const bounds = { x: -500, y: -300, w: 1000, h: 600 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    const mm = worldToMinimap(-500, -300, tf);
    expect(mm.x).toBeGreaterThanOrEqual(0);
    expect(mm.y).toBeGreaterThanOrEqual(0);
  });
});

describe('worldRectToMinimap', () => {
  it('converts a rect correctly', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    const worldRect = { x: 50, y: 25, w: 30, h: 20 };
    const mm = worldRectToMinimap(worldRect, tf);

    expect(mm.w).toBeGreaterThan(0);
    expect(mm.h).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: viewport indicator                                                 */
/* -------------------------------------------------------------------------- */

describe('computeViewportWorldRect', () => {
  it('computes viewport in world space', () => {
    const rect = computeViewportWorldRect({ x: 0, y: 0 }, 1, 800, 600);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.w).toBe(800);
    expect(rect.h).toBe(600);
  });

  it('accounts for zoom', () => {
    const rect = computeViewportWorldRect({ x: 0, y: 0 }, 2, 800, 600);
    expect(rect.w).toBe(400);
    expect(rect.h).toBe(300);
  });

  it('accounts for pan', () => {
    const rect = computeViewportWorldRect({ x: -200, y: -100 }, 1, 800, 600);
    expect(rect.x).toBe(200);
    expect(rect.y).toBe(100);
  });
});

describe('computeViewportMinimapRect', () => {
  it('converts viewport to minimap coordinates', () => {
    const bounds = { x: 0, y: 0, w: 400, h: 300 };
    const tf = computeMinimapTransform(bounds, 160, 120);

    const mmRect = computeViewportMinimapRect({ x: 0, y: 0 }, 1, 800, 600, tf);
    expect(mmRect.w).toBeGreaterThan(0);
    expect(mmRect.h).toBeGreaterThan(0);
  });
});

describe('computeViewportMinimapFootprint', () => {
  it('projects the rotated canvas corners and round-trips its center', () => {
    const tf = computeMinimapTransform({ x: -500, y: -400, w: 1200, h: 1000 }, 160, 120);
    const camera = { pan: { x: -100, y: 40 }, zoom: 1.5, rotation: Math.PI / 4 };
    const viewport = { width: 800, height: 600 };
    const footprint = computeViewportMinimapFootprint(camera, viewport, tf);
    const center = computeViewportWorldCenter(camera, viewport);
    const centerMm = worldToMinimap(center[0], center[1], tf);

    expect(footprint.points).toHaveLength(4);
    expect(pointInMinimapFootprint([centerMm.x, centerMm.y], footprint)).toBe(true);
    expect(footprint.bounds.w).toBeGreaterThan(0);
    expect(footprint.bounds.h).toBeGreaterThan(0);
  });

  it('computes a pan that puts the requested world point at viewport center', () => {
    const camera = { pan: { x: 20, y: -30 }, zoom: 2, rotation: Math.PI / 6 };
    const viewport = { width: 900, height: 700 };
    const target: [number, number] = [125, -80];
    const nextPan = panForViewportCenter(camera, viewport, target);
    const nextCenter = computeViewportWorldCenter({ ...camera, pan: nextPan }, viewport);

    expect(nextCenter[0]).toBeCloseTo(target[0], 6);
    expect(nextCenter[1]).toBeCloseTo(target[1], 6);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: computeMinimapSize                                                 */
/* -------------------------------------------------------------------------- */

describe('computeMinimapSize', () => {
  it('returns a full stage for empty content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 0, h: 0 });
    expect(size.width).toBe(160);
    expect(size.height).toBeLessThanOrEqual(120);
    expect(size.height).toBeGreaterThanOrEqual(48);
  });

  it('returns a full stage for zero-area content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 0, h: 50 });
    expect(size.width).toBe(160);
    expect(size.height).toBeLessThanOrEqual(120);
    expect(size.height).toBeGreaterThanOrEqual(48);
  });

  it('fills the available width and derives the height from wide content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 400, h: 100 });
    expect(size.width).toBe(160);
    expect(size.height).toBeLessThan(120);
    expect(size.height).toBeGreaterThan(48);
  });

  it('fills the width and caps the height for tall content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 100, h: 400 });
    expect(size.width).toBe(160);
    expect(size.height).toBe(120);
  });

  it('never returns a stage narrower than the width it was given', () => {
    // Regression guard: the canvas used to hug the content aspect instead,
    // which left roughly half of the panel card empty on a normal sidebar.
    for (const bounds of [
      { x: 0, y: 0, w: 400, h: 100 },
      { x: 0, y: 0, w: 100, h: 400 },
      { x: 0, y: 0, w: 1200, h: 90 },
    ]) {
      expect(computeMinimapSize(bounds, 300, 168).width).toBe(300);
    }
  });

  it('respects custom max dimensions', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 200, h: 200 }, 100, 80);
    expect(size.width).toBe(100);
    expect(size.height).toBeLessThanOrEqual(80);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: viewfinder minimum size and hit tolerance                           */
/* -------------------------------------------------------------------------- */

function footprintOf(x: number, y: number, w: number, h: number) {
  return {
    points: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ] as Array<[number, number]>,
    bounds: { x, y, w, h },
  };
}

describe('inflateFootprintToMinimum', () => {
  it('leaves a large enough footprint untouched', () => {
    const original = footprintOf(10, 10, 40, 40);
    expect(inflateFootprintToMinimum(original, 14)).toBe(original);
  });

  it('grows a sub-pixel footprint to the minimum drawn size', () => {
    const inflated = inflateFootprintToMinimum(footprintOf(10, 10, 0.4, 0.2), 14);
    expect(inflated.bounds.w).toBeGreaterThanOrEqual(14);
    expect(inflated.bounds.h).toBeGreaterThanOrEqual(14);
  });
  it('keeps the footprint centred on the same point', () => {
    const inflated = inflateFootprintToMinimum(footprintOf(10, 20, 1, 1), 14);
    expect(inflated.bounds.x + inflated.bounds.w / 2).toBeCloseTo(10.5, 5);
    expect(inflated.bounds.y + inflated.bounds.h / 2).toBeCloseTo(20.5, 5);
  });

  it('preserves a rotated quad instead of growing an axis-aligned box', () => {
    const rotated = {
      points: [
        [20, 10],
        [30, 20],
        [20, 30],
        [10, 20],
      ] as Array<[number, number]>,
      bounds: { x: 10, y: 10, w: 20, h: 20 },
    };
    const inflated = inflateFootprintToMinimum(rotated, 40);
    const diagonal = inflated.points[0]![0] - inflated.points[1]![0];
    expect(diagonal).toBeLessThan(0);
  });
});

describe('expandFootprintForHitTest', () => {
  it('clears the WCAG 2.5.8 24x24 target minimum from the minimum drawn size', () => {
    const expanded = expandFootprintForHitTest(footprintOf(10, 10, 0.2, 0.2));
    expect(expanded.bounds.w).toBeGreaterThanOrEqual(24);
    expect(expanded.bounds.h).toBeGreaterThanOrEqual(24);
  });

  it('contains the drawn rectangle, so what looks grabbable is grabbable', () => {
    const drawn = inflateFootprintToMinimum(footprintOf(30, 30, 2, 2), 14);
    const hit = expandFootprintForHitTest(footprintOf(30, 30, 2, 2));
    for (const point of drawn.points) {
      expect(pointInMinimapFootprint(point, hit)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: orientation label worthiness                                        */
/* -------------------------------------------------------------------------- */

describe('isOrientationLabelWorthy', () => {
  it('accepts authored names', () => {
    expect(isOrientationLabelWorthy('Checkout flow')).toBe(true);
    expect(isOrientationLabelWorthy('Hero')).toBe(true);
  });

  it('rejects auto-generated names', () => {
    for (const name of ['Rectangle 3', 'Frame 12', 'Ellipse 1', 'Group 4', 'Text 2', 'Frame']) {
      expect(isOrientationLabelWorthy(name), name).toBe(false);
    }
  });

  it('rejects empty and single-character names', () => {
    expect(isOrientationLabelWorthy('')).toBe(false);
    expect(isOrientationLabelWorthy('   ')).toBe(false);
    expect(isOrientationLabelWorthy('x')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests: clipping the viewfinder to the map stage                            */
/* -------------------------------------------------------------------------- */

describe('clipFootprintToStage', () => {
  it('returns the footprint unchanged when it is already inside', () => {
    const clipped = clipFootprintToStage(footprintOf(20, 20, 40, 40), 160, 120);
    expect(clipped).not.toBeNull();
    expect(clipped!.bounds).toEqual({ x: 20, y: 20, w: 40, h: 40 });
  });

  it('clamps an overhanging footprint to the stage rectangle', () => {
    const clipped = clipFootprintToStage(footprintOf(-40, -30, 240, 120), 160, 120);
    expect(clipped).not.toBeNull();
    expect(clipped!.bounds.x).toBe(0);
    expect(clipped!.bounds.y).toBe(0);
    expect(clipped!.bounds.x + clipped!.bounds.w).toBeLessThanOrEqual(160);
    expect(clipped!.bounds.y + clipped!.bounds.h).toBeLessThanOrEqual(120);
  });

  it('returns null when the footprint misses the stage entirely', () => {
    // Panning past your own document: the outline must be replaced by a
    // pointer rather than left in limbo outside the visible map.
    expect(clipFootprintToStage(footprintOf(400, 400, 60, 40), 160, 120)).toBeNull();
  });

  it('keeps every produced vertex inside the stage', () => {
    const clipped = clipFootprintToStage(footprintOf(-10, 30, 400, 40), 160, 120);
    for (const [x, y] of clipped!.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(160);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(120);
    }
  });
});
