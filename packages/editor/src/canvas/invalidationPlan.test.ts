import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeInvalidationPlan } from './invalidationPlan';

describe('computeInvalidationPlan', () => {
  it('is selective for a property-only leaf change made via the real update pattern', () => {
    let before = createDocument('Invalidation', true);
    before = addNode(
      before,
      makeShapeNode(
        'shape',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { transform: [1, 0, 0, 1, 10, 15] as const },
      ),
    );
    // Mirrors context.tsx's updateNodeProp: `{ ...doc, nodes: { ...doc.nodes, [id]: updated } }`.
    // rootChildren keeps its reference — this is what every fill/stroke/opacity/position
    // edit in the app actually looks like, and is the case the selective path exists for.
    const shape = before.nodes.shape!;
    const after = {
      ...before,
      nodes: { ...before.nodes, shape: { ...shape, transform: [1, 0, 0, 1, 50, 45] as const } },
    };

    expect(before.rootChildren).toBe(after.rootChildren);
    expect(before.nodes).not.toBe(after.nodes);

    const plan = computeInvalidationPlan(before, after);
    expect(plan.isStructural).toBe(false);
    expect(plan.changedIds).toEqual(['shape']);
  });

  it("also invalidates the changed node's parent", () => {
    let doc = createDocument('Invalidation', true);
    doc = addNode(doc, makeFrameNode('frame', { w: 200, h: 200, children: [] }));
    doc = addChild(
      doc,
      'frame',
      makeShapeNode(
        'leaf',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { transform: [1, 0, 0, 1, 10, 15] as const },
      ),
    );
    const leaf = doc.nodes.leaf!;
    const after = {
      ...doc,
      nodes: { ...doc.nodes, leaf: { ...leaf, transform: [1, 0, 0, 1, 30, 30] as const } },
    };

    const plan = computeInvalidationPlan(doc, after);
    expect(plan.isStructural).toBe(false);
    expect(plan.changedIds.sort()).toEqual(['frame', 'leaf']);
  });

  it('is structural when rootChildren changes (node added)', () => {
    const before = createDocument('Invalidation', true);
    const after = addNode(
      before,
      makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }),
    );

    const plan = computeInvalidationPlan(before, after);
    expect(plan.isStructural).toBe(true);
    expect(plan.changedIds).toEqual([]);
  });

  it('is structural when a container node itself changes', () => {
    let before = createDocument('Invalidation', true);
    before = addNode(before, makeFrameNode('frame', { w: 100, h: 100, children: [] }));
    const frame = before.nodes.frame!;
    const after = {
      ...before,
      nodes: { ...before.nodes, frame: { ...frame, clipContent: false } },
    };

    const plan = computeInvalidationPlan(before, after);
    expect(plan.isStructural).toBe(true);
  });

  it('reports no changed ids for an identical document', () => {
    const doc = createDocument('Invalidation', true);
    const plan = computeInvalidationPlan(doc, doc);
    expect(plan.isStructural).toBe(false);
    expect(plan.changedIds).toEqual([]);
  });
});
