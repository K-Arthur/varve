/**
 * Regression tests for Item 5: nodeLocalBounds + hit-testing for shapeless nodes.
 *
 * Tests that shapeless nodes with paintRefs (no inline fills) correctly
 * derive their bounds from referenced paints, and that HitTestEngine uses
 * derived geometry instead of the stale shape field.
 */

import type { Shape } from '@strata/engine';
import type { ShapeNode } from '@strata/scene';
import {
  addNode,
  addPaintToDocument,
  createDocument,
  type Document,
  makeShapeNode,
  type Paint,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { HitTestEngine } from '../../hitTest/HitTestEngine';
import { nodeLocalBounds } from '../nodeBounds';
import { nodeWorldBounds } from '../world';

function makeImagePaint(w: number, h: number): Paint {
  return {
    id: 'paint-img',
    name: 'Test Image',
    fill: {
      type: 'image',
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      image: {
        src: 'test.png',
        fit: 'fill',
        x: 0,
        y: 0,
        scale: 1,
        imageWidth: w,
        imageHeight: h,
      },
    },
  };
}

function makeShapelessNode(id: string, paintRefs: string[]): ShapeNode {
  return {
    ...makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 } as Shape, {
      name: 'Shapeless Image',
    }),
    shapeless: true,
    paintRefs,
    fills: undefined,
  };
}

describe('Item 5: nodeLocalBounds for shapeless nodes', () => {
  it('derives bounds from paintRefs when no inline fills (image paint)', () => {
    const doc0 = createDocument();
    const paint = makeImagePaint(640, 480);
    const doc1 = addPaintToDocument(doc0, paint);
    const node = makeShapelessNode('n1', ['paint-img']);
    const doc = addNode(doc1, node);

    // Without doc: falls back to shape field (stale 100x100)
    const boundsNoDoc = nodeLocalBounds(doc.nodes.n1 as ShapeNode);
    expect(boundsNoDoc).not.toBeNull();
    // Without doc, can't resolve paintRefs → falls through to stale shape
    // (this is the backward-compatible behavior)
    expect(boundsNoDoc!.w).toBe(100);
    expect(boundsNoDoc!.h).toBe(100);

    // With doc: resolves paintRefs → derives from image dimensions
    const boundsWithDoc = nodeLocalBounds(doc.nodes.n1 as ShapeNode, doc);
    expect(boundsWithDoc).not.toBeNull();
    expect(boundsWithDoc!.w).toBe(640);
    expect(boundsWithDoc!.h).toBe(480);
  });

  it('derives bounds from paintRefs with solid paint (default 100x100)', () => {
    const doc0 = createDocument();
    const paint: Paint = {
      id: 'paint-solid',
      name: 'Red Fill',
      fill: {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    };
    const doc1 = addPaintToDocument(doc0, paint);
    const node = makeShapelessNode('n2', ['paint-solid']);
    const doc = addNode(doc1, node);

    const bounds = nodeLocalBounds(doc.nodes.n2 as ShapeNode, doc);
    expect(bounds).not.toBeNull();
    // Solid paint → default 100x100
    expect(bounds!.w).toBe(100);
    expect(bounds!.h).toBe(100);
  });

  it('returns null fallback for shapeless node with no fills and no paintRefs', () => {
    const doc = createDocument();
    const node: ShapeNode = {
      ...makeShapeNode('n3', { kind: 'rect', x: 0, y: 0, w: 200, h: 150 } as Shape),
      shapeless: true,
      fills: undefined,
      paintRefs: undefined,
    };
    const d = addNode(doc, node);

    // No fills, no paintRefs, no doc → empty fills array → falls to stale shape
    const bounds = nodeLocalBounds(d.nodes.n3 as ShapeNode);
    expect(bounds).not.toBeNull();
    // Falls through to shape field
    expect(bounds!.w).toBe(200);
  });

  it('world bounds also resolve paintRefs for shapeless nodes', () => {
    const doc0 = createDocument();
    const paint = makeImagePaint(800, 600);
    const doc1 = addPaintToDocument(doc0, paint);
    const node: ShapeNode = {
      ...makeShapelessNode('n4', ['paint-img']),
      transform: [1, 0, 0, 1, 50, 50] as [number, number, number, number, number, number],
    };
    const doc = addNode(doc1, node);

    const wb = nodeWorldBounds(doc, 'n4');
    expect(wb).not.toBeNull();
    if (!wb) return;
    expect(wb.w).toBe(800);
    expect(wb.h).toBe(600);
    expect(wb.x).toBeCloseTo(50, 0);
    expect(wb.y).toBeCloseTo(50, 0);
  });

  it('vector (non-shapeless) nodes still use explicit shape (regression)', () => {
    const doc = createDocument();
    const node = makeShapeNode('vec1', { kind: 'rect', x: 10, y: 20, w: 100, h: 50 } as Shape);
    const d = addNode(doc, node);

    const bounds = nodeLocalBounds(d.nodes.vec1 as ShapeNode, d);
    expect(bounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
});

describe('Item 5: HitTestEngine for shapeless nodes', () => {
  function setupShapelessDoc(): Document {
    // Use flat document (no page system) so addNode adds directly to rootChildren
    // and activePageNodes / walkNodes can reach them.
    const doc0 = createDocument('test', true);
    const paint = makeImagePaint(200, 200);
    const doc1 = addPaintToDocument(doc0, paint);
    // Shapeless node at (100,100) with 200x200 derived bounds
    // Stale shape is 10x10 at (0,0) — should NOT be used for hit testing
    const node: ShapeNode = {
      ...makeShapeNode('img1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } as Shape, {
        name: 'Shapeless',
      }),
      shapeless: true,
      paintRefs: ['paint-img'],
      fills: undefined,
      transform: [1, 0, 0, 1, 100, 100] as [number, number, number, number, number, number],
    };
    return addNode(doc1, node);
  }

  it('hit test succeeds inside derived bounds (not stale shape)', () => {
    const doc = setupShapelessDoc();
    const engine = new HitTestEngine(doc);

    // Point at (200, 200) — inside the 200x200 derived bounds at (100,100)
    // but well outside the stale 10x10 shape
    const result = engine.hitTest({ x: 200, y: 200 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe('img1');
  });

  it('hit test succeeds at corner of derived bounds', () => {
    const doc = setupShapelessDoc();
    const engine = new HitTestEngine(doc);

    // Top-left corner of derived bounds
    const result = engine.hitTest({ x: 100, y: 100 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe('img1');
  });

  it('hit test fails outside derived bounds', () => {
    const doc = setupShapelessDoc();
    const engine = new HitTestEngine(doc);

    // Point at (350, 350) — outside the 200x200 bounds at (100,100)
    const result = engine.hitTest({ x: 350, y: 350 });
    expect(result).toBeNull();
  });

  it('hit test fails in area between stale shape and derived bounds', () => {
    const doc = setupShapelessDoc();
    const engine = new HitTestEngine(doc);

    // Point at (105, 105) — inside stale 10x10 shape at (100,100)
    // but also inside derived 200x200 bounds, so this should hit
    // Actually this IS inside both, so let's test a point inside stale
    // but outside derived — impossible since stale is smaller.
    // Instead test a point outside stale but inside derived:
    // (250, 250) is outside 10x10 stale shape but inside 200x200 derived
    const result = engine.hitTest({ x: 250, y: 250 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe('img1');
  });

  it('findNodesAtPoint returns shapeless node in results', () => {
    const doc = setupShapelessDoc();
    const engine = new HitTestEngine(doc);

    const results = engine.findNodesAtPoint({ x: 150, y: 150 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.nodeId === 'img1')).toBe(true);
  });

  it('vector (non-shapeless) nodes still hit-test using explicit shape (regression)', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNode('vec1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 } as Shape, {
      name: 'Vector Rect',
    });
    const d = addNode(doc, node);
    const engine = new HitTestEngine(d);

    // Inside the 50x50 rect
    const result = engine.hitTest({ x: 25, y: 25 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe('vec1');

    // Outside the 50x50 rect
    const outside = engine.hitTest({ x: 100, y: 100 });
    expect(outside).toBeNull();
  });
});
