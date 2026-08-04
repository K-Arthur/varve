// @ts-nocheck
import type { Document, NodeId } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  buildMinimapScene,
  computeMinimapSize,
  computeMinimapTransform,
  computeViewportMinimapRect,
  computeViewportWorldRect,
  minimapToWorld,
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

    // The outlier should be in outliers, not contentBounds
    expect(scene.outliers.length).toBeGreaterThanOrEqual(1);
    expect(scene.outliers.some((e) => e.id === 'outlier')).toBe(true);
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

/* -------------------------------------------------------------------------- */
/*  Tests: computeMinimapSize                                                 */
/* -------------------------------------------------------------------------- */

describe('computeMinimapSize', () => {
  it('returns max dimensions for empty content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 0, h: 0 });
    expect(size.width).toBe(160);
    expect(size.height).toBe(120);
  });

  it('returns max dimensions for zero-area content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 0, h: 50 });
    expect(size.width).toBe(160);
    expect(size.height).toBe(120);
  });

  it('preserves aspect ratio for wide content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 400, h: 100 });
    expect(size.width).toBe(160);
    expect(size.height).toBeLessThan(120);
  });

  it('preserves aspect ratio for tall content', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 100, h: 400 });
    expect(size.height).toBe(120);
    expect(size.width).toBeLessThan(160);
  });

  it('respects custom max dimensions', () => {
    const size = computeMinimapSize({ x: 0, y: 0, w: 200, h: 200 }, 100, 80);
    expect(size.width).toBeLessThanOrEqual(100);
    expect(size.height).toBeLessThanOrEqual(80);
  });
});
