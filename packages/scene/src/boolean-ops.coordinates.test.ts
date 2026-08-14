/**
 * Coordinate-space regression tests for boolean operations.
 *
 * Boolean operands may live in different parents (artboards, groups,
 * pasteboard). The op clips polygons in WORLD space and the result is
 * re-anchored at the first operand's home in that parent's LOCAL space —
 * otherwise results teleport or are mis-scaled inside transformed parents.
 */

import { describe, expect, it } from 'vitest';
import {
  booleanAnchorForNode,
  booleanOp,
  placeBooleanResult,
  shapeNodesInWorldSpace,
} from './boolean';
import { nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from './document';
import type { ShapeNode } from './types';

function makeRect(id: string, x: number, y: number, w = 50, h = 50): ShapeNode {
  return makeShapeNode(id, { kind: 'rect', x, y, w, h });
}

function worldOriginOf(doc: Document, id: string): [number, number] {
  const t = nodeWorldTransform(doc, id);
  return [t[4], t[5]];
}

/** World-space AABB of a path-shape's polygon. */
function worldPolygonBounds(
  doc: Document,
  id: string,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const node = doc.nodes[id] as ShapeNode;
  if (node.shape.kind !== 'path') throw new Error('expected path');
  const t = nodeWorldTransform(doc, id);
  const pts = node.shape.points.map((p) => {
    const [x, y] = [t[0] * p.x + t[2] * p.y + t[4], t[1] * p.x + t[3] * p.y + t[5]];
    return { x, y };
  });
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

describe('boolean ops — coordinate spaces', () => {
  it('same-parent boolean inside a translated artboard keeps the result inside it', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('art', { transform: [1, 0, 0, 1, 1000, 500] }));
    const a = makeRect('a', 0, 0, 50, 50);
    const b = makeRect('b', 30, 30, 50, 50);
    doc = addChild(doc, 'art', a);
    doc = addChild(doc, 'art', b);

    // Operands clipped in world space.
    const worldNodes = shapeNodesInWorldSpace(doc, [
      doc.nodes.a as ShapeNode,
      doc.nodes.b as ShapeNode,
    ]);
    const result = booleanOp('union', worldNodes);
    // Result polygon is world-space; anchor at 'a' inside the artboard.
    const anchor = booleanAnchorForNode(doc, 'a');
    expect(anchor).toEqual({ parentId: 'art', index: 0 });
    const placed = placeBooleanResult(doc, result, anchor);
    expect(placed.doc.nodes[placed.nodeId]!.kind).toBe('shape');
    // Result is a child of the artboard (not the root).
    expect((placed.doc.nodes.art as import('./types').FrameNode).children).toContain(placed.nodeId);
    // Its world origin equals the union of the world-space operands' origins
    // — i.e. the visual position inside the artboard is preserved.
    const resultWorld = worldOriginOf(placed.doc, placed.nodeId);
    const aWorld = worldOriginOf(doc, 'a');
    expect(resultWorld[0]).toBeCloseTo(aWorld[0], 6);
    expect(resultWorld[1]).toBeCloseTo(aWorld[1], 6);
  });

  it('cross-artboard boolean clips in world space and anchors to the first operand', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('artA', { transform: [1, 0, 0, 1, 100, 100] }));
    doc = addNode(doc, makeFrameNode('artB', { transform: [1, 0, 0, 1, 1000, 800] }));
    const a = makeRect('a', 20, 20, 50, 50);
    // b overlaps a's WORLD extent (120..170) despite living in artB:
    // local (-850,-650) → world (150,150)-(200,200).
    const b = makeRect('b', -850, -650, 50, 50);
    doc = addChild(doc, 'artA', a);
    doc = addChild(doc, 'artB', b);

    const worldNodes = shapeNodesInWorldSpace(doc, [
      doc.nodes.a as ShapeNode,
      doc.nodes.b as ShapeNode,
    ]);
    const result = booleanOp('union', worldNodes);
    const anchor = booleanAnchorForNode(doc, 'a');
    const placed = placeBooleanResult(doc, result, anchor);
    expect((placed.doc.nodes.artA as import('./types').FrameNode).children).toContain(
      placed.nodeId,
    );
    // Union of world extents (120..200) — the operands were clipped in a
    // common world space, and the result polygon covers both.
    const bounds = worldPolygonBounds(placed.doc, placed.nodeId);
    expect(bounds.minX).toBeCloseTo(120, 6);
    expect(bounds.minY).toBeCloseTo(120, 6);
    expect(bounds.maxX).toBeCloseTo(200, 6);
    expect(bounds.maxY).toBeCloseTo(200, 6);
  });

  it('artboard operand + pasteboard operand: result anchors to the artboard operand', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('art', { transform: [1, 0, 0, 1, -800, -400] }));
    const inside = makeRect('in', 10, 10, 60, 60);
    doc = addChild(doc, 'art', inside);
    // Pasteboard shape overlapping the artboard's world position of 'in'.
    const outside = makeRect('out', -770, -370, 60, 60);
    doc = addNode(doc, outside);

    const worldNodes = shapeNodesInWorldSpace(doc, [
      doc.nodes.in as ShapeNode,
      doc.nodes.out as ShapeNode,
    ]);
    const result = booleanOp('union', worldNodes);
    const anchor = booleanAnchorForNode(doc, 'in');
    const placed = placeBooleanResult(doc, result, anchor);
    expect((placed.doc.nodes.art as import('./types').FrameNode).children).toContain(placed.nodeId);
    // Union of world extents: 'in' (-790..-730, -390..-330) ∪ 'out'
    // (-770..-710, -370..-310) → (-790..-710, -390..-310).
    const bounds = worldPolygonBounds(placed.doc, placed.nodeId);
    expect(bounds.minX).toBeCloseTo(-790, 6);
    expect(bounds.minY).toBeCloseTo(-390, 6);
    expect(bounds.maxX).toBeCloseTo(-710, 6);
    expect(bounds.maxY).toBeCloseTo(-310, 6);
  });

  it('negative-world artboard preserves the union shape extent', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('art', { transform: [1, 0, 0, 1, -5000, -3000] }));
    const a = makeRect('a', 0, 0, 50, 50);
    const b = makeRect('b', 30, 30, 50, 50);
    doc = addChild(doc, 'art', a);
    doc = addChild(doc, 'art', b);

    const worldNodes = shapeNodesInWorldSpace(doc, [
      doc.nodes.a as ShapeNode,
      doc.nodes.b as ShapeNode,
    ]);
    const result = booleanOp('union', worldNodes);
    const anchor = booleanAnchorForNode(doc, 'a');
    const placed = placeBooleanResult(doc, result, anchor);
    const node = placed.doc.nodes[placed.nodeId] as ShapeNode;
    if (node.shape.kind !== 'path') throw new Error('expected path');
    const xs = node.shape.points.map((p) => p.x);
    const ys = node.shape.points.map((p) => p.y);
    // Local union extent: 0..80 in both axes (a 0-50, b 30-80).
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(80, 6);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(80, 6);
  });
});
