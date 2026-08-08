// @vitest-environment jsdom

import { createEngine } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
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

  it('composites a group-level drop shadow from the flattened subtree', async () => {
    let sceneDocument = createDocument('Group effect export', true);
    const group = makeGroupNode('group', {
      effects: [
        {
          type: 'dropShadow',
          x: 5,
          y: 5,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    const childA = makeShapeNode(
      'childA',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { transform: [1, 0, 0, 1, 10, 10] },
    );
    const childB = makeShapeNode(
      'childB',
      { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
      { transform: [1, 0, 0, 1, 20, 40] },
    );
    sceneDocument = addNode(sceneDocument, group);
    sceneDocument = addChild(sceneDocument, group.id, childA);
    sceneDocument = addChild(sceneDocument, group.id, childB);

    const flattened = flattenSceneToEngine(sceneDocument, [group.id]);
    const engine = await createEngine('stub');
    const items = await engine.buildIr({ nodes: flattened.nodes });
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('test canvas unavailable');
    if (typeof context.getTransform !== 'function') {
      context.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;
    }
    const drawImage = vi.spyOn(context, 'drawImage');

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [group.id],
      flattenedIds: flattened.ids,
      items,
    });

    // A group-level shadow must flatten the subtree and composite it (and its
    // shadow-only scratch canvas) via drawImage — not be silently dropped.
    expect(drawImage).toHaveBeenCalled();
    expect(context.globalCompositeOperation).toBe('source-over');
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

  it('renders adjustment layers by filtering the target-scope backdrop', async () => {
    let sceneDocument = createDocument('Adjustment export', true);
    const target = makeShapeNode(
      'target',
      { kind: 'rect', x: 0, y: 0, w: 60, h: 40 },
      { transform: [1, 0, 0, 1, 20, 20] },
    );
    const adj = {
      ...makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }),
      adjustments: [
        { kind: 'brightness', value: 50, opacity: 1, blendMode: 'normal', visible: true },
      ],
      scope: { mode: 'image-local' as const, targetNodeId: 'target' },
    };
    sceneDocument = addNode(sceneDocument, target);
    sceneDocument = addNode(sceneDocument, adj);
    const flattened = flattenSceneToEngine(sceneDocument, [adj.id, target.id]);
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
    const drawImage = vi.spyOn(context, 'drawImage');

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [adj.id, target.id],
      flattenedIds: flattened.ids,
      items,
    });

    // The adjustment must composite the filtered backdrop back onto the
    // export surface (9-arg drawImage). The backdrop capture itself happens
    // on an internal offscreen surface, so the observable signal is the
    // final composite — a plain zero-size filter item (the old behavior)
    // never draws anything back.
    const nineArg = drawImage.mock.calls.filter((call) => call.length === 9);
    expect(nineArg.length).toBeGreaterThanOrEqual(1);
  });

  it('masks the adjustment result to its spatial mask (destination-in)', async () => {
    let sceneDocument = createDocument('Masked adjustment export', true);
    const target = makeShapeNode('target', { kind: 'rect', x: 0, y: 0, w: 60, h: 40 });
    const matte = makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 30, h: 30 });
    const adj = {
      ...makeAdjustmentNode('adj', 'levels', { channel: 'rgb' }),
      adjustments: [
        { kind: 'brightness', value: 50, opacity: 1, blendMode: 'normal', visible: true },
      ],
      scope: { mode: 'image-local' as const, targetNodeId: 'target' },
      mask: { type: 'clip' as const, visible: true, sourceNodeId: 'matte' },
    };
    sceneDocument = addNode(sceneDocument, target);
    sceneDocument = addNode(sceneDocument, matte);
    sceneDocument = addNode(sceneDocument, adj);
    const flattened = flattenSceneToEngine(sceneDocument, [adj.id, target.id, matte.id]);
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
    const drawImage = vi.spyOn(context, 'drawImage');

    // Must not throw: the masked adjustment renders backdrop → filter →
    // mask → composite. The mask's destination-in runs on the backdrop's
    // own context (not observable on the target), so the structural signal
    // is that the final composite still occurs.
    expect(() =>
      replayStructuredScene(context, {
        document: sceneDocument,
        rootIds: [adj.id, target.id, matte.id],
        flattenedIds: flattened.ids,
        items,
      }),
    ).not.toThrow();
    const nineArg = drawImage.mock.calls.filter((call) => call.length === 9);
    expect(nineArg.length).toBeGreaterThanOrEqual(1);
  });

  it('routes feathered clip masks through the alpha-compositing path', async () => {
    let sceneDocument = createDocument('Feathered clip export', true);
    const group = {
      ...makeGroupNode('group'),
      mask: {
        type: 'clip' as const,
        sourceNodeId: 'matte',
        visible: true,
        feather: 6,
      },
    };
    const matte = makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 });
    sceneDocument = addNode(sceneDocument, group);
    sceneDocument = addChild(sceneDocument, group.id, matte);
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
    const clip = vi.spyOn(context, 'clip');
    const drawImage = vi.spyOn(context, 'drawImage');

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [group.id],
      flattenedIds: flattened.ids,
      items,
    });

    // Feather cannot be expressed by ctx.clip() — the feathered clip must
    // composite through the alpha path (masked surface drawn back) instead
    // of the hard clip path.
    expect(clip).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
  });

  it('composes a frame quad clip with a container mask (intersection)', async () => {
    let sceneDocument = createDocument('Frame + mask export', true);
    const frame = {
      ...makeFrameNode('frame', { w: 100, h: 80, children: [], clipContent: true }),
      mask: { type: 'clip' as const, sourceNodeId: 'matte', visible: true },
    };
    const matte = makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 200, h: 200 });
    sceneDocument = addNode(sceneDocument, frame);
    sceneDocument = addChild(sceneDocument, frame.id, matte);
    sceneDocument = addChild(sceneDocument, frame.id, content);
    const flattened = flattenSceneToEngine(sceneDocument, [frame.id]);
    const engine = await createEngine('stub');
    const items = await engine.buildIr({ nodes: flattened.nodes });
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('test canvas unavailable');
    if (typeof context.getTransform !== 'function') {
      context.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;
    }
    const clip = vi.spyOn(context, 'clip');
    const lineTo = vi.spyOn(context, 'lineTo');

    replayStructuredScene(context, {
      document: sceneDocument,
      rootIds: [frame.id],
      flattenedIds: flattened.ids,
      items,
    });

    // Both the mask clip and the frame quad clip must run — content beyond
    // either boundary is hidden (intersection semantics).
    expect(clip).toHaveBeenCalled();
    // The frame quad is traced in device space (0,0)-(100,80): its corners
    // appear as lineTo calls.
    expect(lineTo).toHaveBeenCalledWith(100, 0);
    expect(lineTo).toHaveBeenCalledWith(0, 80);
  });
});
