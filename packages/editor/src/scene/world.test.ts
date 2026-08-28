import type { Affine } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeImageShapeNode,
  makeShapeNode,
} from '@varve/scene';
import { computeFloatingOrigin, multiplyAffine, rotateDeg, worldToScreen } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateAll,
  invalidateNodes,
  invalidateSubtree,
} from './transformCache';
import {
  nodeLocalBounds,
  nodeWorldBounds,
  nodeWorldTransform,
  worldRectToScreenAabb,
} from './world';

function buildDoc() {
  let doc = createDocument();

  // Frame A at world (100, 100)
  const frameA = makeFrameNode('f1', {
    name: 'FrameA',
    transform: [1, 0, 0, 1, 100, 100] as Affine,
  });
  doc = addNode(doc, frameA);

  // Frame B inside Frame A at local (50, 0)
  const frameB = makeFrameNode('f2', {
    name: 'FrameB',
    transform: [1, 0, 0, 1, 50, 0] as Affine,
  });
  doc = addChild(doc, 'f1', frameB);

  // Shape C inside Frame B at local (20, 30)
  const rect = makeShapeNode(
    's1',
    { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
    { name: 'RectC', transform: [1, 0, 0, 1, 20, 30] as Affine },
  );
  doc = addChild(doc, 'f2', rect);

  // Root-level shape D at (200, 50)
  const rootShape = makeShapeNode(
    's2',
    { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    { name: 'RootD', transform: [1, 0, 0, 1, 200, 50] as Affine },
  );
  doc = addNode(doc, rootShape);

  return doc;
}

const EPS = 1e-9;

describe('worldRectToScreenAabb', () => {
  it('projects every corner through the rotated camera', () => {
    const camera = { zoom: 1.5, pan: { x: 12, y: -8 }, rotation: Math.PI / 4 };
    const viewport = { width: 800, height: 600 };
    const rect = { x: 100, y: 40, w: 120, h: 60 };
    const origin = computeFloatingOrigin(camera, viewport);
    const points = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ].map(([x, y]) => worldToScreen(camera, x, y, viewport, origin));
    const expected = {
      x: Math.min(...points.map(([x]) => x)),
      y: Math.min(...points.map(([, y]) => y)),
      w: Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
      h: Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)),
    };

    expect(worldRectToScreenAabb(rect, camera, viewport)).toEqual(expected);
  });
});

describe('nodeWorldTransform', () => {
  it('returns identity for a non-existent node', () => {
    const doc = createDocument();
    const t = nodeWorldTransform(doc, 'nonexistent');
    expect(t).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('returns the node transform for a root-level node', () => {
    const doc = buildDoc();
    const t = nodeWorldTransform(doc, 's2');
    expect(t).toEqual([1, 0, 0, 1, 200, 50]);
  });

  it('composes parent transforms for a nested node', () => {
    const doc = buildDoc();
    // Shape C: local transform (20,30) inside FrameB (50,0) inside FrameA (100,100)
    // World = parentA · parentB · child = translate(100,100) · translate(50,0) · translate(20,30)
    // = translate(170, 130)
    const t = nodeWorldTransform(doc, 's1');
    expect(t[4]).toBeCloseTo(170, EPS);
    expect(t[5]).toBeCloseTo(130, EPS);
    expect(t[0]).toBeCloseTo(1, EPS);
    expect(t[1]).toBeCloseTo(0, EPS);
    expect(t[2]).toBeCloseTo(0, EPS);
    expect(t[3]).toBeCloseTo(1, EPS);
  });

  it('composes through a frame-only chain (no child transform)', () => {
    const doc = buildDoc();
    const t = nodeWorldTransform(doc, 'f2');
    expect(t[4]).toBeCloseTo(150, EPS);
    expect(t[5]).toBeCloseTo(100, EPS);
  });
});

describe('nodeLocalBounds', () => {
  it('returns the shape bounds for a rect', () => {
    const doc = buildDoc();
    const node = doc.nodes.s1;
    if (!node) return;
    const b = nodeLocalBounds(node);
    expect(b).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('returns null for groups', () => {
    const doc = createDocument();
    const g = makeGroupNode('g1', { name: 'Group' });
    const d = addNode(doc, g);
    const node = d.nodes.g1;
    if (!node) throw new Error('g1 not found');
    const b = nodeLocalBounds(node);
    expect(b).toBeNull();
  });

  it('path shape localBounds returns bounds from points', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p1',
      {
        kind: 'path',
        points: [
          { x: 10, y: 20, handleIn: null, handleOut: null },
          { x: 50, y: 80, handleIn: null, handleOut: null },
          { x: 100, y: 30, handleIn: null, handleOut: null },
        ],
        closed: true,
        tolerance: 2,
      },
      { name: 'Path' },
    );
    const d = addNode(doc, pathNode);
    const n1 = d.nodes.p1;
    if (!n1) throw new Error('node not found');
    const b = nodeLocalBounds(n1);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(10, 4);
    expect(b.y).toBeCloseTo(20, 4);
    expect(b.w).toBeCloseTo(90, 4);
    expect(b.h).toBeCloseTo(60, 4);
  });

  it('arrow shape localBounds returns bounds from from/to', () => {
    const doc = createDocument();
    const arrNode = makeShapeNode(
      'a1',
      {
        kind: 'arrow',
        from: [15, 25],
        to: [80, 120],
        tolerance: 2,
        arrowheadSize: 10,
      },
      { name: 'Arrow' },
    );
    const d = addNode(doc, arrNode);
    const a1 = d.nodes.a1;
    if (!a1) throw new Error('node not found');
    const b = nodeLocalBounds(a1);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(15, 4);
    expect(b.y).toBeCloseTo(25, 4);
    expect(b.w).toBeCloseTo(65, 4);
    expect(b.h).toBeCloseTo(95, 4);
  });

  it('path bounds are correct for multi-point path', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p2',
      {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: [10, -20] },
          { x: 100, y: 100, handleIn: [-10, 10], handleOut: null },
          { x: 200, y: 50, handleIn: null, handleOut: null },
        ],
        closed: false,
        tolerance: 2,
      },
      { name: 'Path2' },
    );
    const d = addNode(doc, pathNode);
    const p2 = d.nodes.p2;
    if (!p2) throw new Error('node not found');
    const b = nodeLocalBounds(p2);
    expect(b).not.toBeNull();
    if (!b) return;
    // Include handle control points in bounds: handleOut[1] = -20 gives y = 0 + (-20) = -20
    expect(b.x).toBeCloseTo(0, 4);
    expect(b.y).toBeCloseTo(-20, 4);
    expect(b.w).toBeCloseTo(200, 4);
    // P1 handleIn y offset (+10) gives 110, min y is -20 → h = 110 - (-20) = 130
    expect(b.h).toBeCloseTo(130, 4);
  });

  it('null path (empty points) returns null', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p3',
      {
        kind: 'path',
        points: [],
        closed: false,
        tolerance: 2,
      },
      { name: 'EmptyPath' },
    );
    const d = addNode(doc, pathNode);
    const p3 = d.nodes.p3;
    if (!p3) throw new Error('node not found');
    const b = nodeLocalBounds(p3);
    expect(b).toBeNull();
  });

  it('returns bounds from image fills for shapeless nodes (not stale shape)', () => {
    const doc = createDocument();
    const img = makeImageShapeNode('i1', {
      src: 'test.png',
      imageWidth: 800,
      imageHeight: 600,
      shapeless: true,
    });
    const d = addNode(doc, img);
    const n = d.nodes.i1;
    if (!n) throw new Error('node not found');
    const b = nodeLocalBounds(n);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.w).toBe(800);
    expect(b.h).toBe(600);
  });

  it('returns bounds from updated image fill (not stale shape field)', () => {
    // Simulate a shapeless node whose paint dimensions were updated
    // after creation (shape field is stale, fills have correct dimensions)
    const node = makeImageShapeNode('i1', {
      src: 'small.png',
      imageWidth: 100,
      imageHeight: 80,
      shapeless: true,
    });
    // Now update the fills to different dimensions (simulating paint change)
    // without touching the shape field
    const updatedNode = {
      ...node,
      fills: [
        {
          type: 'image' as const,
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
          image: {
            src: 'large.png',
            fit: 'fill' as const,
            x: 0,
            y: 0,
            scale: 1,
            imageWidth: 1920,
            imageHeight: 1080,
          },
        },
      ],
    };
    const b = nodeLocalBounds(updatedNode as import('@varve/scene').SceneNode);
    expect(b).not.toBeNull();
    if (!b) return;
    // Should derive from updated fills, not the stale shape
    expect(b.w).toBe(1920);
    expect(b.h).toBe(1080);
  });
});

describe('nodeWorldBounds', () => {
  it('returns correct world bounds for a nested rect', () => {
    const doc = buildDoc();
    // Shape C: local rect (0,0,40,30), world at (170, 130)
    const b = nodeWorldBounds(doc, 's1');
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(170, 4);
    expect(b.y).toBeCloseTo(130, 4);
    expect(b.w).toBeCloseTo(40, 4);
    expect(b.h).toBeCloseTo(30, 4);
  });

  it('returns correct world bounds for a root-level node', () => {
    const doc = buildDoc();
    const b = nodeWorldBounds(doc, 's2');
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(200, 4);
    expect(b.y).toBeCloseTo(50, 4);
    expect(b.w).toBeCloseTo(10, 4);
    expect(b.h).toBeCloseTo(10, 4);
  });

  it('follows the referenced path for text-on-path bounds', () => {
    let doc = createDocument();
    const path = makeShapeNode(
      'path-1',
      { kind: 'circle', cx: 100, cy: 80, r: 40 },
      { name: 'Ring' },
    );
    const text = {
      id: 'text-1',
      kind: 'text' as const,
      name: 'Label',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'b0',
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      text: 'AROUND',
      w: 80,
      h: 20,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      fontSize: 20,
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal' as const,
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left' as const,
      direction: 'auto' as const,
      strokes: [],
      effects: [],
      textMode: 'path' as const,
      pathTextSettings: { pathNodeId: 'path-1', startOffset: 0, side: 'top' as const },
    };
    doc = addNode(doc, path);
    doc = addNode(doc, text as never);

    const bounds = nodeWorldBounds(doc, 'text-1');
    expect(bounds).toEqual({ x: 35, y: 15, w: 130, h: 130 });
  });

  it('returns null for non-existent nodes', () => {
    const doc = createDocument();
    expect(nodeWorldBounds(doc, 'nope')).toBeNull();
  });
});

describe('nodeWorldTransform — rotation composition', () => {
  const EPS = 1e-6;

  it('returns identity when rotation is 0 (no-op compose)', () => {
    let doc = createDocument();
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { name: 'NoRot', rotation: 0, transform: [1, 0, 0, 1, 100, 100] as Affine },
    );
    doc = addNode(doc, rect);
    const t = nodeWorldTransform(doc, 'r1');
    expect(t[0]).toBeCloseTo(1, EPS);
    expect(t[1]).toBeCloseTo(0, EPS);
    expect(t[2]).toBeCloseTo(0, EPS);
    expect(t[3]).toBeCloseTo(1, EPS);
    expect(t[4]).toBeCloseTo(100, EPS);
    expect(t[5]).toBeCloseTo(100, EPS);
  });

  it('composes rotation into world transform', () => {
    let doc = createDocument();
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { name: 'Rot', rotation: 45, transform: [1, 0, 0, 1, 100, 100] as Affine },
    );
    doc = addNode(doc, rect);
    const t = nodeWorldTransform(doc, 'r1');
    const expected = multiplyAffine([1, 0, 0, 1, 100, 100] as Affine, rotateDeg(45));
    expect(t[0]).toBeCloseTo(expected[0], EPS);
    expect(t[1]).toBeCloseTo(expected[1], EPS);
    expect(t[2]).toBeCloseTo(expected[2], EPS);
    expect(t[3]).toBeCloseTo(expected[3], EPS);
    expect(t[4]).toBeCloseTo(100, EPS);
    expect(t[5]).toBeCloseTo(100, EPS);
  });

  it('composes rotation through transformCache', () => {
    let doc = createDocument();
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { name: 'RotCached', rotation: 30, transform: [1, 0, 0, 1, 50, 50] as Affine },
    );
    doc = addNode(doc, rect);
    const cache = createTransformCache();
    const t = getCachedWorldTransform(cache, doc, 'r1');
    const expected = multiplyAffine([1, 0, 0, 1, 50, 50] as Affine, rotateDeg(30));
    expect(t[0]).toBeCloseTo(expected[0], EPS);
    expect(t[1]).toBeCloseTo(expected[1], EPS);
    expect(t[4]).toBeCloseTo(50, EPS);
    expect(t[5]).toBeCloseTo(50, EPS);
  });

  it('worldBounds reflects rotation (AABB is larger than local rect)', () => {
    let doc = createDocument();
    // A 100x80 rect rotated 45° has a larger AABB than (0,0,100,80)
    const rect = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { name: 'RotBounds', rotation: 45, transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    doc = addNode(doc, rect);
    const b = nodeWorldBounds(doc, 'r1');
    expect(b).not.toBeNull();
    if (!b) return;
    // A 100x80 rect rotated 45° — the diagonal = sqrt(100²+80²) ≈ 128.06
    // AABB should be larger than 100x80
    expect(b.w).toBeGreaterThan(100);
    expect(b.h).toBeGreaterThan(80);
    // It should be symmetric (centered at origin, width ≈ height)
    expect(b.w).toBeCloseTo(b.h, 0);
  });

  it('rotation composes through nested parent chain', () => {
    let doc = createDocument();
    const frame = makeFrameNode('f1', {
      name: 'ParentFrame',
      transform: [1, 0, 0, 1, 100, 100] as Affine,
    });
    doc = addNode(doc, frame);
    const child = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child', rotation: 90, transform: [1, 0, 0, 1, 20, 20] as Affine },
    );
    doc = addChild(doc, 'f1', child);
    const t = nodeWorldTransform(doc, 'r1');
    // World = parent(100,100) * child(20,20) * rotate(90°)
    expect(t[4]).toBeCloseTo(120, 4);
    expect(t[5]).toBeCloseTo(120, 4);
    expect(t[0]).toBeCloseTo(0, 4);
    expect(t[1]).toBeCloseTo(1, 4);
    expect(t[2]).toBeCloseTo(-1, 4);
    expect(t[3]).toBeCloseTo(0, 4);
  });

  it('parent rotation field composes into child world transform', () => {
    let doc = createDocument();
    const frame = makeFrameNode('f1', {
      name: 'RotatedFrame',
      rotation: 45,
      transform: [1, 0, 0, 1, 0, 0] as Affine,
    });
    doc = addNode(doc, frame);
    const child = makeShapeNode(
      'r1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { name: 'Child', transform: [1, 0, 0, 1, 100, 0] as Affine },
    );
    doc = addChild(doc, 'f1', child);
    const t = nodeWorldTransform(doc, 'r1');
    // Child at (100,0) in frame space, frame rotated 45°:
    // world x = 100*cos(45) ≈ 70.71, world y = 100*sin(45) ≈ 70.71
    expect(t[4]).toBeCloseTo(70.71, 1);
    expect(t[5]).toBeCloseTo(70.71, 1);
    expect(t[0]).toBeCloseTo(Math.cos(Math.PI / 4), 3);
    expect(t[1]).toBeCloseTo(Math.sin(Math.PI / 4), 3);
  });
});

describe('TransformCache', () => {
  it('returns cached value on second call', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    // First call — computes and caches
    const t1 = getCachedWorldTransform(cache, doc, 's1');
    expect(t1[4]).toBeCloseTo(170, EPS);
    expect(t1[5]).toBeCloseTo(130, EPS);

    // Second call — should return same reference from cache
    const t2 = getCachedWorldTransform(cache, doc, 's1');
    expect(t2).toBe(t1);
    expect(t2[4]).toBeCloseTo(170, EPS);
    expect(t2[5]).toBeCloseTo(130, EPS);

    // Cache map has the entry
    expect(cache.worldTransform.has('s1')).toBe(true);
    // Dirty set has no entry for s1
    expect(cache.dirty.has('s1')).toBe(false);
  });

  it('returns cached worldBounds on second call', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    const b1 = getCachedWorldBounds(cache, doc, 's1');
    expect(b1).not.toBeNull();
    if (!b1) return;
    expect(b1.x).toBeCloseTo(170, 4);
    expect(b1.y).toBeCloseTo(130, 4);

    const b2 = getCachedWorldBounds(cache, doc, 's1');
    expect(b2).toBe(b1);
  });

  it('invalidates a node, causing recomputation', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    const t1 = getCachedWorldTransform(cache, doc, 's1');
    expect(t1[4]).toBeCloseTo(170, EPS);

    // Invalidate s1
    invalidateNodes(cache, ['s1']);
    expect(cache.dirty.has('s1')).toBe(true);
    expect(cache.generation).toBe(1);

    const t2 = getCachedWorldTransform(cache, doc, 's1');
    // Verify it was recomputed (new cached entry)
    expect(t2[4]).toBeCloseTo(170, EPS);
    expect(cache.dirty.has('s1')).toBe(false);
  });

  it('invalidates all via invalidateAll', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    getCachedWorldTransform(cache, doc, 's1');
    getCachedWorldTransform(cache, doc, 's2');
    getCachedWorldBounds(cache, doc, 's1');

    expect(cache.worldTransform.size).toBe(2);
    expect(cache.worldBounds.size).toBe(1);

    const gen = cache.generation;
    invalidateAll(cache);

    expect(cache.worldTransform.size).toBe(0);
    expect(cache.worldBounds.size).toBe(0);
    expect(cache.dirty.size).toBe(0);
    expect(cache.generation).toBe(gen + 1);
  });

  it('invalidates parent and all descendants on invalidateSubtree', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    // Warm the cache
    getCachedWorldTransform(cache, doc, 'f1');
    getCachedWorldTransform(cache, doc, 'f2');
    getCachedWorldTransform(cache, doc, 's1');
    getCachedWorldTransform(cache, doc, 's2');

    expect(cache.dirty.size).toBe(0);

    // Invalidate f1 — should mark f1, f2, s1 as dirty (but not s2, which is root-level)
    invalidateSubtree(cache, doc, 'f1');
    expect(cache.dirty.has('f1')).toBe(true);
    expect(cache.dirty.has('f2')).toBe(true);
    expect(cache.dirty.has('s1')).toBe(true);
    expect(cache.dirty.has('s2')).toBe(false);
  });

  it('works with nodeWorldTransform via cache parameter', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    const t1 = getCachedWorldTransform(cache, doc, 's1');
    expect(t1[4]).toBeCloseTo(170, EPS);

    // Calling the non-cached path gives same result
    const t2 = nodeWorldTransform(doc, 's1');
    expect(t2[4]).toBeCloseTo(170, EPS);

    // Cached returns same value (and from cache now)
    const t3 = getCachedWorldTransform(cache, doc, 's1');
    expect(t3).toBe(t1);
  });

  it('works with nodeWorldBounds via cache parameter', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    const b = getCachedWorldBounds(cache, doc, 's1');
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(170, 4);
    expect(b.y).toBeCloseTo(130, 4);
    expect(b.w).toBeCloseTo(40, 4);
    expect(b.h).toBeCloseTo(30, 4);
  });

  it('handles identity for non-existent node with cache', () => {
    const cache = createTransformCache();
    const doc = createDocument();
    const t = getCachedWorldTransform(cache, doc, 'nonexistent');
    expect(t).toEqual([1, 0, 0, 1, 0, 0]);
    expect(cache.dirty.has('nonexistent')).toBe(false);
  });

  it('handles null bounds for non-existent node with cache', () => {
    const cache = createTransformCache();
    const doc = createDocument();
    const b = getCachedWorldBounds(cache, doc, 'nonexistent');
    expect(b).toBeNull();
  });

  it('returns correct transform for root-level node from cache', () => {
    const doc = buildDoc();
    const cache = createTransformCache();
    const t = getCachedWorldTransform(cache, doc, 's2');
    expect(t[4]).toBeCloseTo(200, EPS);
    expect(t[5]).toBeCloseTo(50, EPS);
    expect(cache.dirty.has('s2')).toBe(false);
  });

  it('dirty set is cleared after successful cache read', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    // Load the cache for s1
    getCachedWorldTransform(cache, doc, 's1');
    expect(cache.dirty.has('s1')).toBe(false);

    // Invalidate
    invalidateNodes(cache, ['s1']);
    expect(cache.dirty.has('s1')).toBe(true);

    // Read — should recompute and clear dirty
    getCachedWorldTransform(cache, doc, 's1');
    expect(cache.dirty.has('s1')).toBe(false);
  });

  it('generation increments on each invalidation', () => {
    const cache = createTransformCache();
    expect(cache.generation).toBe(0);

    invalidateNodes(cache, ['x']);
    expect(cache.generation).toBe(1);

    invalidateAll(cache);
    expect(cache.generation).toBe(2);
  });

  it('reuses cached worldBounds when reading world transform after bounds', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    // Getting bounds caches both bounds and the transform
    getCachedWorldBounds(cache, doc, 's1');
    expect(cache.worldBounds.has('s1')).toBe(true);
    expect(cache.worldTransform.has('s1')).toBe(true);

    // Getting transform reuses cached transform
    const t = getCachedWorldTransform(cache, doc, 's1');
    expect(t).toBe(cache.worldTransform.get('s1'));
    expect(t[4]).toBeCloseTo(170, EPS);
  });

  it('invalidateSubtree generation increments per recursive call', () => {
    const doc = buildDoc();
    const cache = createTransformCache();

    const genBefore = cache.generation;
    // f1 → 3 nodes marked dirty (f1, f2, s1) = 3 recursive calls = generation +3
    invalidateSubtree(cache, doc, 'f1');
    expect(cache.generation).toBe(genBefore + 3);
  });
});

describe('transformCache getWorldBounds group handling', () => {
  it('returns child-union bounds for a group (matches nodeWorldBounds)', () => {
    const doc = createDocument('g', true);
    const gId = 'g1';
    let d = addNode(doc, makeGroupNode(gId, { name: 'Group', children: [] }));
    d = addNode(
      d,
      makeShapeNode(
        's1',
        { kind: 'rect', x: 0, y: 0, w: 10, h: 20 },
        { transform: [1, 0, 0, 1, 5, 7] as const },
      ),
    );
    d = addNode(
      d,
      makeShapeNode(
        's2',
        { kind: 'rect', x: 0, y: 0, w: 30, h: 5 },
        { transform: [1, 0, 0, 1, 100, 50] as const },
      ),
    );
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        [gId]: { ...d.nodes[gId], children: ['s1', 's2'] } as import('@varve/scene').SceneNode,
      },
    };
    const cache = createTransformCache();
    const groupBounds = getCachedWorldBounds(cache, d, gId);
    expect(groupBounds).toEqual({ x: 5, y: 7, w: 125, h: 48 });
  });
});
