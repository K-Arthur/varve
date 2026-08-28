import { describe, expect, it } from 'vitest';
import { signedArea } from './boolean/region';
import { nodeWorldTransform } from './coordinateService';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from './document';
import {
  createLiveBooleanDoc,
  expandLiveBooleanDoc,
  reorderLiveBooleanOperands,
  resolveLiveBooleanShape,
  setLiveBooleanOperation,
} from './liveBoolean';
import type { GroupNode, ShapeNode } from './types';

function bounds(node: ShapeNode): { minX: number; minY: number; maxX: number; maxY: number } {
  if (node.shape.kind !== 'path') throw new Error('expected a resolved Boolean path');
  const points = [...node.shape.points, ...(node.shape.holes ?? []).flat()];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

describe('live Boolean groups', () => {
  it('rejects open paths instead of creating an unresolved live group', () => {
    let doc = createDocument();
    doc = addNode(doc, makeShapeNode('closed', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    doc = addNode(
      doc,
      makeShapeNode('open', {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 100, handleIn: null, handleOut: null },
        ],
        closed: false,
        tolerance: 3,
      }),
    );

    expect(createLiveBooleanDoc(doc, ['closed', 'open'], 'union')).toBeNull();
  });

  it('rejects centreline geometry instead of silently excluding it from a filled result', () => {
    let doc = createDocument();
    doc = addNode(doc, makeShapeNode('filled', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    doc = addNode(
      doc,
      makeShapeNode('line', { kind: 'line', from: [0, 0], to: [100, 100], tolerance: 3 }),
    );

    expect(createLiveBooleanDoc(doc, ['filled', 'line'], 'union')).toBeNull();
  });

  it('owns editable operands, preserves their placed-world transforms, and resolves on demand', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('left', { transform: [1, 0, 0, 1, 100, 50] }));
    doc = addNode(doc, makeFrameNode('right', { transform: [1, 0, 0, 1, 400, 100] }));
    doc = addChild(doc, 'left', makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 }));
    doc = addChild(
      doc,
      'right',
      makeShapeNode('b', { kind: 'rect', x: -280, y: -30, w: 80, h: 80 }),
    );
    const beforeA = nodeWorldTransform(doc, 'a');
    const beforeB = nodeWorldTransform(doc, 'b');

    const created = createLiveBooleanDoc(doc, ['a', 'b'], 'union');
    expect(created).not.toBeNull();
    if (!created) return;
    doc = created.doc;

    const live = doc.nodes[created.nodeId] as GroupNode;
    expect(live.boolean).toEqual({ schemaVersion: 1, operation: 'union' });
    expect(live.children).toEqual(['a', 'b']);
    expect((doc.nodes.left as GroupNode).children).toContain(created.nodeId);
    expect((doc.nodes.right as GroupNode).children).not.toContain('b');
    expect(nodeWorldTransform(doc, 'a')).toEqual(beforeA);
    expect(nodeWorldTransform(doc, 'b')).toEqual(beforeB);

    const initial = resolveLiveBooleanShape(doc, created.nodeId);
    expect(initial).not.toBeNull();
    if (!initial) return;
    expect(bounds(initial)).toEqual({ minX: 100, minY: 50, maxX: 200, maxY: 150 });
    expect(resolveLiveBooleanShape(doc, created.nodeId)).toBe(initial);

    // Editing a child changes the result; no copied resolved path is stored on
    // the Boolean group for this update to modify.
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        b: { ...(doc.nodes.b as ShapeNode), transform: [1, 0, 0, 1, 380, 70] },
      },
    };
    const edited = resolveLiveBooleanShape(doc, created.nodeId);
    expect(edited).not.toBeNull();
    if (!edited) return;
    expect(edited).not.toBe(initial);
    expect(nodeWorldTransform(doc, 'a')).toEqual([1, 0, 0, 1, 100, 50]);
    expect(nodeWorldTransform(doc, 'b')).toEqual([1, 0, 0, 1, 480, 120]);
    expect(bounds(edited)).toEqual({ minX: 100, minY: 50, maxX: 280, maxY: 170 });
  });

  it('supports operation changes, deterministic operand reordering, and atomic expansion', () => {
    let doc = createDocument();
    doc = addNode(doc, makeShapeNode('base', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    doc = addNode(doc, makeShapeNode('cut', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 }));
    const created = createLiveBooleanDoc(doc, ['base', 'cut'], 'union');
    expect(created).not.toBeNull();
    if (!created) return;
    doc = setLiveBooleanOperation(created.doc, created.nodeId, 'subtract');
    const subtract = resolveLiveBooleanShape(doc, created.nodeId);
    expect(subtract?.shape.kind).toBe('path');
    if (subtract?.shape.kind !== 'path') return;
    expect(subtract.shape.holes).toHaveLength(1);
    expect(Math.abs(signedArea(subtract.shape.points))).toBeCloseTo(10000, 8);

    doc = reorderLiveBooleanOperands(doc, created.nodeId, ['cut', 'base']);
    const reordered = resolveLiveBooleanShape(doc, created.nodeId);
    expect(reordered?.shape.kind).toBe('path');
    if (reordered?.shape.kind !== 'path') return;
    // cut - base is empty, proving Subtract's first operand is an explicit,
    // editable base rather than a selection-array accident.
    expect(reordered.shape.points).toHaveLength(0);

    doc = reorderLiveBooleanOperands(doc, created.nodeId, ['base', 'cut']);
    const expanded = expandLiveBooleanDoc(doc, created.nodeId);
    expect(expanded).not.toBeNull();
    if (!expanded) return;
    expect(expanded.doc.nodes[created.nodeId]).toBeUndefined();
    expect(expanded.doc.nodes.base).toBeUndefined();
    expect(expanded.doc.nodes.cut).toBeUndefined();
    const result = expanded.doc.nodes[expanded.nodeId] as ShapeNode;
    expect(result.shape.kind).toBe('path');
    if (result.shape.kind === 'path') expect(result.shape.holes).toHaveLength(1);
  });
});
