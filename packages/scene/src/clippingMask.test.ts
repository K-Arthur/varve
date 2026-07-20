import type { Affine } from '@strata/shared';
import { multiplyAffine, rotateDeg } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import {
  canBeClipMaskSource,
  createClippingMask,
  releaseClippingMask,
  replaceClippingMaskContent,
} from './clippingMask';
import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from './document';
import type { NodeId, SceneNode } from './types';

function composedTransform(node: SceneNode): Affine {
  return node.rotation ? multiplyAffine(node.transform, rotateDeg(node.rotation)) : node.transform;
}

function worldTransform(doc: Document, id: NodeId): Affine {
  const node = doc.nodes[id];
  if (!node) throw new Error(`Missing node ${id}`);
  let result = composedTransform(node);
  let childId = id;
  while (true) {
    const parent = Object.values(doc.nodes).find(
      (candidate) => 'children' in candidate && candidate.children.includes(childId),
    );
    if (!parent) return result;
    result = multiplyAffine(composedTransform(parent), result);
    childId = parent.id;
  }
}

function expectAffine(actual: Affine, expected: Affine): void {
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? 0, 8);
  });
}

function nestedFixture(): Document {
  let doc = createDocument();
  doc = addNode(
    doc,
    makeGroupNode('parent', {
      transform: [1.25, 0.1, -0.2, 0.8, 120, -45],
      rotation: 17,
    }),
  );
  doc = addChild(
    doc,
    'parent',
    makeShapeNode(
      'mask',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      { transform: [1, 0, 0, 1, 30, 40], rotation: 23 },
    ),
  );
  doc = addChild(
    doc,
    'parent',
    makeShapeNode(
      'content',
      { kind: 'ellipse', cx: 60, cy: 50, rx: 60, ry: 50 },
      { transform: [0.75, 0, 0, 1.4, -25, 15], rotation: -31 },
    ),
  );
  doc = addChild(
    doc,
    'parent',
    makeShapeNode(
      'replacement',
      {
        kind: 'star',
        cx: 0,
        cy: 0,
        points: 5,
        innerRadius: 20,
        outerRadius: 50,
        rotation: 0,
      },
      { transform: [1.1, 0.2, -0.15, 0.9, 200, 75], rotation: 9 },
    ),
  );
  return doc;
}

describe('clipping-mask transform preservation', () => {
  it('creates a clipping group from root-level sibling nodes', () => {
    const mask = makeShapeNode('mask', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    const doc = {
      ...createDocument('root siblings', true),
      nodes: { mask, content },
      rootChildren: ['mask', 'content'],
    };

    const result = createClippingMask(doc, 'mask', ['content']);

    expect(result.doc.rootChildren).toEqual([result.groupId]);
    expect(result.doc.nodes[result.groupId]?.mask?.sourceNodeId).toBe('mask');
  });

  it('preserves mask and content world transforms when creating inside a transformed parent', () => {
    const doc = nestedFixture();
    const maskWorld = worldTransform(doc, 'mask');
    const contentWorld = worldTransform(doc, 'content');

    const result = createClippingMask(doc, 'mask', ['content']);

    expectAffine(worldTransform(result.doc, 'mask'), maskWorld);
    expectAffine(worldTransform(result.doc, 'content'), contentWorld);
    expect(result.doc.nodes[result.groupId]?.rotation).toBe(0);
    expect(result.doc.nodes.mask?.rotation).toBe(0);
    expect(result.doc.nodes.content?.rotation).toBe(0);
  });

  it('preserves every child world transform when releasing inside a transformed parent', () => {
    const created = createClippingMask(nestedFixture(), 'mask', ['content']);
    const maskWorld = worldTransform(created.doc, 'mask');
    const contentWorld = worldTransform(created.doc, 'content');

    const released = releaseClippingMask(created.doc, created.groupId);

    expectAffine(worldTransform(released, 'mask'), maskWorld);
    expectAffine(worldTransform(released, 'content'), contentWorld);
    expect(released.nodes.mask?.rotation).toBe(0);
    expect(released.nodes.content?.rotation).toBe(0);
  });

  it('releases a temporarily disabled clipping mask without losing its children', () => {
    const created = createClippingMask(nestedFixture(), 'mask', ['content']);
    const group = created.doc.nodes[created.groupId];
    if (group?.kind !== 'group' || !group.mask) throw new Error('Expected clipping group');
    const disabled = {
      ...created.doc,
      nodes: {
        ...created.doc.nodes,
        [created.groupId]: { ...group, mask: { ...group.mask, visible: false } },
      },
    };

    const released = releaseClippingMask(disabled, created.groupId);

    expect(released.nodes[created.groupId]).toBeUndefined();
    expect(released.nodes.mask).toBeDefined();
    expect(released.nodes.content).toBeDefined();
  });

  it('preserves old and replacement content world transforms when replacing content', () => {
    const created = createClippingMask(nestedFixture(), 'mask', ['content']);
    const oldContentWorld = worldTransform(created.doc, 'content');
    const replacementWorld = worldTransform(created.doc, 'replacement');

    const replaced = replaceClippingMaskContent(created.doc, created.groupId, ['replacement']);

    expectAffine(worldTransform(replaced, 'content'), oldContentWorld);
    expectAffine(worldTransform(replaced, 'replacement'), replacementWorld);
    expect(replaced.nodes.content?.rotation).toBe(0);
    expect(replaced.nodes.replacement?.rotation).toBe(0);
  });
});

describe('clipping-mask source validation', () => {
  it('rejects open paths, live text, and groups that cannot produce a vector clip outline', () => {
    const openPath = makeShapeNode('open', {
      kind: 'path',
      points: [],
      closed: false,
      tolerance: 1,
    });
    expect(canBeClipMaskSource(openPath)).toBe(false);
    expect(canBeClipMaskSource(makeGroupNode('group'))).toBe(false);
    expect(canBeClipMaskSource(makeTextNode('text', 'Live text'))).toBe(false);
  });
});
