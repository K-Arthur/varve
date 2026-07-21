// @ts-nocheck
/**
 * Tests for path quick ops.
 */
import { createDocument, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { setPathClosed, simplifyPathNode } from './pathQuickOps';

function makePathDoc(
  closed: boolean,
  points = [
    { x: 0, y: 0, handleIn: null, handleOut: null },
    { x: 10, y: 0, handleIn: null, handleOut: null },
    { x: 20, y: 1, handleIn: null, handleOut: null },
    { x: 30, y: 0, handleIn: null, handleOut: null },
    { x: 40, y: 0, handleIn: null, handleOut: null },
  ],
) {
  let doc = createDocument('t', true);
  const path = makeShapeNode('p1', {
    kind: 'path',
    points,
    closed,
  });
  doc = { ...doc, nodes: { ...doc.nodes, p1: path }, rootChildren: ['p1'] };
  return doc;
}

describe('setPathClosed', () => {
  it('closes an open path', () => {
    const doc = makePathDoc(false);
    const next = setPathClosed(doc, 'p1', true);
    const n = next.nodes.p1!;
    expect(n.kind).toBe('shape');
    if (n.kind !== 'shape' || n.shape.kind !== 'path') throw new Error('path');
    expect(n.shape.closed).toBe(true);
  });

  it('opens a closed path', () => {
    const doc = makePathDoc(true);
    const next = setPathClosed(doc, 'p1', false);
    const n = next.nodes.p1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'path') throw new Error('path');
    expect(n.shape.closed).toBe(false);
  });

  it('no-ops when already closed', () => {
    const doc = makePathDoc(true);
    expect(setPathClosed(doc, 'p1', true)).toBe(doc);
  });
});

describe('simplifyPathNode', () => {
  it('reduces near-collinear midpoints', () => {
    const doc = makePathDoc(false);
    const next = simplifyPathNode(doc, 'p1', 2);
    const n = next.nodes.p1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'path') throw new Error('path');
    expect(n.shape.points.length).toBeLessThan(5);
    expect(n.shape.points.length).toBeGreaterThanOrEqual(2);
  });

  it('no-ops for non-path nodes', () => {
    let doc = createDocument('t', true);
    const rect = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    doc = { ...doc, nodes: { ...doc.nodes, r: rect }, rootChildren: ['r'] };
    expect(simplifyPathNode(doc, 'r')).toBe(doc);
  });
});
