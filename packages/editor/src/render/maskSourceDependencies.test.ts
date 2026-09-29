import {
  addChild,
  addMask,
  addNode,
  createDocument,
  makeGroupNode,
  makeRasterLayerNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { collectMaskSourceDependencies } from './sceneToEngine';

describe('collectMaskSourceDependencies', () => {
  it('includes an external scene-node matte and its own mask dependencies', () => {
    let document = createDocument('mask dependencies');
    const group = makeGroupNode('group');
    const paint = makeRasterLayerNode('paint', { width: 32, height: 32 });
    const matte = makeGroupNode('matte');
    const secondaryMatte = makeShapeNode('secondary-matte', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 16,
      h: 16,
    });
    document = addNode(addNode(addNode(document, group), matte), secondaryMatte);
    document = addChild(document, group.id, paint);
    document = addChild(document, matte.id, secondaryMatte);
    document = addMask(document, group.id, undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: matte.id },
    });
    document = addMask(document, matte.id, undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: secondaryMatte.id },
    });

    expect(collectMaskSourceDependencies(document, [group.id])).toEqual([
      matte.id,
      secondaryMatte.id,
    ]);
  });

  it('does not duplicate a matte already inside the selected subtree', () => {
    let document = createDocument('internal matte');
    const group = makeGroupNode('group');
    const paint = makeRasterLayerNode('paint', { width: 32, height: 32 });
    const matte = makeRasterLayerNode('matte', { width: 32, height: 32 });
    document = addNode(document, group);
    document = addChild(document, group.id, paint);
    document = addChild(document, group.id, matte);
    document = addMask(document, group.id, undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: matte.id },
    });

    expect(collectMaskSourceDependencies(document, [group.id])).toEqual([]);
  });
});
