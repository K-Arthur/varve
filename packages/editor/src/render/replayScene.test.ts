// @vitest-environment jsdom

import { createEngine } from '@strata/engine';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { replayStructuredScene } from './replayScene';
import { flattenSceneToEngine } from './sceneToEngine';

describe('replayStructuredScene', () => {
  it('clips frame descendants in world space while painting the frame first', async () => {
    let sceneDocument = createDocument('Frame export', true);
    const frame = makeFrameNode('frame', {
      transform: [1, 0, 0, 1, 100, 50],
      w: 200,
      h: 120,
      children: [],
      clipContent: true,
    });
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 60, h: 40 },
      { transform: [1, 0, 0, 1, 180, 90] },
    );
    sceneDocument = addNode(sceneDocument, frame);
    sceneDocument = addChild(sceneDocument, frame.id, child);
    const flattened = flattenSceneToEngine(sceneDocument, [frame.id]);
    const engine = await createEngine('stub');
    const items = await engine.buildIr({ nodes: flattened.nodes });
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('test canvas unavailable');
    const clip = vi.spyOn(context, 'clip');
    const lineTo = vi.spyOn(context, 'lineTo');

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [frame.id],
      flattenedIds: flattened.ids,
      items,
    });

    expect(clip).toHaveBeenCalledOnce();
    expect(lineTo).toHaveBeenCalledWith(300, 50);
    expect(lineTo).toHaveBeenCalledWith(300, 170);
  });

  it('applies container opacity and blend mode after alpha-mask compositing', async () => {
    let sceneDocument = createDocument('Masked group export', true);
    const group = {
      ...makeGroupNode('group', { opacity: 0.4, blendMode: 'multiply' }),
      mask: { type: 'alpha' as const, sourceNodeId: 'mask', visible: true },
    };
    const mask = makeShapeNode('mask', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 });
    sceneDocument = addNode(sceneDocument, group);
    sceneDocument = addChild(sceneDocument, group.id, mask);
    sceneDocument = addChild(sceneDocument, group.id, content);
    const flattened = flattenSceneToEngine(sceneDocument, [group.id]);
    const engine = await createEngine('stub');
    const items = await engine.buildIr({ nodes: flattened.nodes });
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('test canvas unavailable');
    if (typeof context.getTransform !== 'function') {
      context.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;
    }
    const observed: Array<{ alpha: number; blend: string }> = [];
    vi.spyOn(context, 'drawImage').mockImplementation(() => {
      observed.push({ alpha: context.globalAlpha, blend: context.globalCompositeOperation });
    });

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [group.id],
      flattenedIds: flattened.ids,
      items,
    });

    expect(observed).toContainEqual({ alpha: 0.4, blend: 'multiply' });
  });
});
