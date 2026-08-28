import {
  addChild,
  addNode,
  addPage,
  createDocument,
  createLiveBooleanDoc,
  makeShapeNode,
  type ShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { flattenSceneToEngine } from './sceneToEngine';

describe('flattenSceneToEngine live Boolean groups', () => {
  it('emits the resolved Boolean under the group id and omits editable operand items', () => {
    let document = createDocument();
    document = addNode(document, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    document = addNode(document, makeShapeNode('b', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 }));
    const created = createLiveBooleanDoc(document, ['a', 'b'], 'subtract');
    expect(created).not.toBeNull();
    if (!created) return;
    document = created.doc;

    const flattened = flattenSceneToEngine(document, document.rootChildren);
    expect(flattened.ids).toEqual([created.nodeId]);
    const shape = flattened.nodes[0]?.shape;
    expect(shape?.kind).toBe('path');
    if (shape?.kind === 'path') expect(shape.holes).toHaveLength(1);

    // Changing an operand has no cached result to invalidate: flattening
    // resolves fresh geometry on the next render.
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        b: {
          ...(document.nodes.b as ShapeNode),
          shape: { kind: 'rect', x: 125, y: 25, w: 50, h: 50 },
        },
      },
    };
    const updated = flattenSceneToEngine(document, document.rootChildren);
    expect(updated.ids).toEqual([created.nodeId]);
    expect(updated.nodes[0]?.shape.kind).toBe('path');
    if (updated.nodes[0]?.shape.kind === 'path')
      expect(updated.nodes[0].shape.holes).toBeUndefined();
  });

  it('retains page placement exactly once for the resolved result', () => {
    let document = createDocument('page Boolean');
    document = addPage(document, {});
    document = {
      ...document,
      pages: document.pages!.map((page, index) => ({
        ...page,
        placement: { x: index * 500, y: index * 300 },
      })),
    };
    const page = document.pages![1]!;
    document = addChild(
      document,
      page.contentRoot,
      makeShapeNode('a', { kind: 'rect', x: 10, y: 10, w: 50, h: 50 }),
    );
    document = addChild(
      document,
      page.contentRoot,
      makeShapeNode('b', { kind: 'rect', x: 20, y: 20, w: 30, h: 30 }),
    );
    const created = createLiveBooleanDoc(document, ['a', 'b'], 'intersect');
    expect(created).not.toBeNull();
    if (!created) return;

    const flattened = flattenSceneToEngine(created.doc, created.doc.rootChildren);
    const index = flattened.ids.indexOf(created.nodeId);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(flattened.nodes[index]?.transform).toEqual([1, 0, 0, 1, 500, 300]);
  });
});
