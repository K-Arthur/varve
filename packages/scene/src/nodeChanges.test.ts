import { describe, expect, it } from 'vitest';
import { makeShapeNode } from './document';
import { classifyNodeChanges, nodesDifferOnlyInTransforms } from './nodeChanges';

const rect = (id: string) => makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });

describe('nodesDifferOnlyInTransforms', () => {
  const a = rect('a');
  const b = rect('b');
  const nodes = { a, b };

  it('accepts identical records and pure moves', () => {
    expect(nodesDifferOnlyInTransforms(nodes, nodes)).toBe(true);
    expect(nodesDifferOnlyInTransforms(nodes, { ...nodes })).toBe(true);
    const moved = { ...nodes, a: { ...a, transform: [1, 0, 0, 1, 5, 5] as const } };
    expect(nodesDifferOnlyInTransforms(nodes, moved)).toBe(true);
  });

  it('rejects any other property change, added, or removed node', () => {
    expect(nodesDifferOnlyInTransforms(nodes, { ...nodes, a: { ...a, visible: false } })).toBe(
      false,
    );
    expect(nodesDifferOnlyInTransforms(nodes, { ...nodes, a: { ...a, name: 'Renamed' } })).toBe(
      false,
    );
    expect(nodesDifferOnlyInTransforms(nodes, { ...nodes, c: rect('c') })).toBe(false);
    expect(nodesDifferOnlyInTransforms(nodes, { a })).toBe(false);
    expect(nodesDifferOnlyInTransforms(nodes, { a, c: rect('c') })).toBe(false);
  });

  it('shares one transform classification and exposes every changed node id', () => {
    const moved = { ...nodes, a: { ...a, transform: [1, 0, 0, 1, 5, 5] as const } };
    const first = classifyNodeChanges(nodes, moved);

    expect(first).toBe(classifyNodeChanges(nodes, moved));
    expect(first.transformsOnly).toBe(true);
    expect(first.topologyChanged).toBe(false);
    expect(first.changedNodeIds).toEqual(['a']);
    expect(Object.isFrozen(first.changedNodeIds)).toBe(true);
  });

  it('reports additions and removals as topology changes', () => {
    const added = classifyNodeChanges(nodes, { ...nodes, c: rect('c') });
    const removed = classifyNodeChanges(nodes, { a });

    expect(added).toMatchObject({ transformsOnly: false, topologyChanged: true });
    expect(added.changedNodeIds).toEqual(['c']);
    expect(removed).toMatchObject({ transformsOnly: false, topologyChanged: true });
    expect(removed.changedNodeIds).toEqual(['b']);
  });
});
