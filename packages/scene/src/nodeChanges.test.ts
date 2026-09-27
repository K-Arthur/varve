import { describe, expect, it } from 'vitest';
import { makeShapeNode } from './document';
import { nodesDifferOnlyInTransforms } from './nodeChanges';

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
});
