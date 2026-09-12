import { createDocument, type Document, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  commitPreparedFragmentDocument,
  type PreparedFragmentClone,
  type PreparedFragmentItem,
  preparedFragmentFromNodes,
  preparedFragmentFromRootSets,
} from './preparedFragment';

describe('prepared fragments', () => {
  it('keeps ordered roots and commits every item through one loop', () => {
    const source = createDocument('source', true);
    const first = makeShapeNode('first', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const second = makeShapeNode('second', { kind: 'rect', x: 20, y: 0, w: 10, h: 10 });
    const fragment = preparedFragmentFromNodes(
      'drop',
      [
        { node: first, sourceDoc: { ...source, nodes: { [first.id]: first } } },
        { node: second, sourceDoc: { ...source, nodes: { [second.id]: second } } },
      ],
      { targetParentId: null, center: { x: 50, y: 60 } },
    );
    const clone = vi.fn(
      (doc: Document, item: PreparedFragmentItem): PreparedFragmentClone => ({
        doc,
        rootIds: item.rootIds,
        idMap: new Map<string, string>(item.rootIds.map((id): [string, string] => [id, id])),
      }),
    );
    const place = vi.fn((doc) => doc);

    const result = commitPreparedFragmentDocument(fragment.items[0]!.sourceDoc, fragment, {
      clone,
      place,
    });

    expect(clone).toHaveBeenCalledTimes(2);
    expect(place).toHaveBeenCalledTimes(2);
    expect(result.rootIds).toEqual(['first', 'second']);
    expect(result.resourceImports).toHaveLength(2);
    expect(fragment.center).toEqual({ x: 50, y: 60 });
  });

  it('does not append an item when cloning rejects it', () => {
    const source = createDocument('source', true);
    const node = makeShapeNode('rejected', { kind: 'rect', x: 0, y: 0, w: 1, h: 1 });
    const fragment = preparedFragmentFromNodes('import', [{ node, sourceDoc: source }], {
      targetParentId: null,
    });
    const result = commitPreparedFragmentDocument(source, fragment, {
      clone: () => null,
      place: (doc) => doc,
    });

    expect(result.rootIds).toEqual([]);
    expect(result.resourceImports).toEqual([]);
  });

  it('preserves an artifact root set as one ordered item', () => {
    const source = createDocument('source', true);
    const first = makeShapeNode('first', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const second = makeShapeNode('second', { kind: 'ellipse', x: 20, y: 0, w: 10, h: 10 });
    const fragment = preparedFragmentFromRootSets(
      'import',
      [
        {
          sourceDoc: { ...source, nodes: { [first.id]: first, [second.id]: second } },
          rootIds: [first.id, second.id],
        },
      ],
      { targetParentId: null },
    );

    expect(fragment.items).toHaveLength(1);
    expect(fragment.items[0]?.rootIds).toEqual([first.id, second.id]);
  });
});
