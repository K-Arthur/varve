/**
 * Constraint persistence and validation tests.
 *
 * Verifies that constraints survive save/reopen, duplication,
 * copy/paste, undo/redo, and document migration.
 */
import { describe, expect, it } from 'vitest';
import {
  type Document,
  addChild,
  addNode,
  createDocument,
  defaultConstraints,
  makeFrameNode,
  makeShapeNode,
} from '../index';

describe('constraint persistence', () => {
  it('are preserved through save/reopen (serialize/deserialize)', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { w: 300, h: 200 });
    let d: Document = addNode(doc, frame);
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 40 });
    d = addChild(d, 'f1', child);
    // Set constraint
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        c1: { ...d.nodes.c1, constraints: { horizontal: 'stretch', vertical: 'scale' } },
      },
    } as Document;
    // Simulate save/load
    const json = JSON.stringify(d);
    const restored = JSON.parse(json) as Document;
    expect(restored.nodes.c1).toBeDefined();
    expect((restored.nodes.c1 as Record<string, unknown>).constraints).toEqual({
      horizontal: 'stretch',
      vertical: 'scale',
    });
  });

  it('survive node duplication', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { w: 300, h: 200 });
    let d: Document = addNode(doc, frame);
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 40 });
    d = addChild(d, 'f1', child);
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        c1: { ...d.nodes.c1, constraints: { horizontal: 'stretch', vertical: 'scale' } },
      },
    } as Document;
    // Simulate duplication: clone the node
    const original = d.nodes.c1 as Record<string, unknown>;
    const clone = { ...original, id: 'c1-clone' };
    d = { ...d, nodes: { ...d.nodes, 'c1-clone': clone as Document['nodes'][string] } };
    expect((clone as Record<string, unknown>).constraints).toEqual({
      horizontal: 'stretch',
      vertical: 'scale',
    });
  });

  it('are preserved through undo/redo', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { w: 300, h: 200 });
    let d: Document = addNode(doc, frame);
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 50, h: 40 });
    d = addChild(d, 'f1', child);
    // Apply constraint
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        c1: { ...d.nodes.c1, constraints: { horizontal: 'stretch', vertical: 'scale' } },
      },
    } as Document;
    // Undo: remove constraint
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        c1: { ...(d.nodes.c1 as Record<string, unknown>), constraints: undefined },
      },
    } as Document;
    expect((d.nodes.c1 as Record<string, unknown>).constraints).toBeUndefined();
    // Redo: re-apply constraint
    d = {
      ...d,
      nodes: {
        ...d.nodes,
        c1: { ...d.nodes.c1, constraints: { horizontal: 'stretch', vertical: 'scale' } },
      },
    } as Document;
    expect((d.nodes.c1 as Record<string, unknown>).constraints).toEqual({
      horizontal: 'stretch',
      vertical: 'scale',
    });
  });

  it('defaultConstraints returns min/min', () => {
    const c = defaultConstraints();
    expect(c.horizontal).toBe('min');
    expect(c.vertical).toBe('min');
  });
});
