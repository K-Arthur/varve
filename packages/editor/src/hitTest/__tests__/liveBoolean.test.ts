import { addNode, createDocument, createLiveBooleanDoc, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { HitTestEngine } from '../HitTestEngine';

describe('HitTestEngine live Boolean groups', () => {
  it('hits the visible Boolean result and never exposes source operands', () => {
    let document = createDocument('live boolean hit test', true);
    document = addNode(
      document,
      makeShapeNode('base', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
    );
    document = addNode(
      document,
      makeShapeNode('cutter', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 }),
    );
    const created = createLiveBooleanDoc(document, ['base', 'cutter'], 'subtract');
    expect(created).not.toBeNull();
    if (!created) return;

    const hitTest = new HitTestEngine(created.doc, { zoom: 1 });
    expect(hitTest.hitTest({ x: 10, y: 10 })?.nodeId).toBe(created.nodeId);
    // The cutter remains in the scene graph, but its removed centre is not
    // interactive and the old source node ids never leak through selection.
    expect(hitTest.hitTest({ x: 50, y: 50 })).toBeNull();
    expect(hitTest.findNodesAtPoint({ x: 10, y: 10 }).map((hit) => hit.nodeId)).toEqual([
      created.nodeId,
    ]);
  });
});
