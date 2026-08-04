import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
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

  it('invalidates every ancestor up the chain, not just the direct parent', () => {
    let doc = createDocument('Invalidation', true);
    doc = addNode(doc, makeFrameNode('frame', { w: 300, h: 300, children: [] }));
    // A mid-level group nested in the frame, so the leaf sits two
    // ancestor levels deep — the direct-parent pass would miss the frame.
    doc = addNode(doc, makeGroupNode('mid', { name: 'Mid' }));
    doc = addChild(doc, 'frame', doc.nodes.mid!);
    doc = addChild(
      doc,
      'mid',
      makeShapeNode(
        'inner',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { transform: [1, 0, 0, 1, 10, 15] as const, name: 'Inner' },
      ),
    );

    const inner = doc.nodes.inner!;
    const after = {
      ...doc,
      nodes: { ...doc.nodes, inner: { ...inner, transform: [1, 0, 0, 1, 40, 40] as const } },
    };

    const plan = computeInvalidationPlan(doc, after);
    expect(plan.isStructural).toBe(false);
    expect(plan.changedIds.sort()).toEqual(['frame', 'inner', 'mid']);
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
