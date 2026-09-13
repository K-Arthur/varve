// @vitest-environment jsdom

import { CompositeCanvas, type RenderItem, type ReplayTarget } from '@varve/engine';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  applyGroupContentEffects,
  createEffectMaskResolver,
  createGroupEffectTargetItem,
} from './groupEffectStages';

type EffectMaskBindingIR = NonNullable<NonNullable<RenderItem['effects']>[number]['mask']>;

function effectItem(): RenderItem {
  return {
    primitive: { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    transform: [1, 0, 0, 1, 10, 15],
    fills: [],
    strokes: [],
  } as unknown as RenderItem;
}

function targetContext(): ReplayTarget {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('test canvas unavailable');
  return context as unknown as ReplayTarget;
}

describe('createEffectMaskResolver', () => {
  it('replays a scene-node matte in the effect surface coordinate system', () => {
    let documentModel = createDocument('effect mask');
    documentModel = addNode(
      documentModel,
      makeShapeNode('matte', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
    );
    const replayNode = vi.fn(
      (_nodeId: string, target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
        target.fillRect(0, 0, 40, 40);
      },
    );
    const resolver = createEffectMaskResolver({ document: documentModel, replayNode });
    const binding: EffectMaskBindingIR = {
      source: { kind: 'scene-node', nodeId: 'matte' },
      type: 'alpha',
      coordinateSpace: 'world',
    };

    const result = resolver(binding, effectItem(), targetContext(), 32, 32);

    expect(result).toBeDefined();
    expect(result?.width).toBe(32);
    expect(result?.height).toBe(32);
    expect(replayNode).toHaveBeenCalledWith('matte', expect.anything());
  });

  it('traces vector mattes without asking the scene replay callback', () => {
    const replayNode = vi.fn();
    const resolver = createEffectMaskResolver({
      document: createDocument('vector effect mask'),
      replayNode,
    });
    const binding: EffectMaskBindingIR = {
      source: {
        kind: 'vector',
        vectorMask: {
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 16, y: 0, handleIn: null, handleOut: null },
            { x: 16, y: 16, handleIn: null, handleOut: null },
          ],
          closed: true,
          fillRule: 'nonzero',
        },
      },
      type: 'luminance',
      coordinateSpace: 'target-local',
    };

    const result = resolver(binding, effectItem(), targetContext(), 32, 32);

    expect(result).toBeDefined();
    expect(replayNode).not.toHaveBeenCalled();
  });
});

describe('applyGroupContentEffects', () => {
  it('restores the pre-effect group surface where its effect mask is empty', () => {
    const canvas = document.createElement('canvas');
    const groupSurface = new CompositeCanvas({
      width: 4,
      height: 4,
      testCanvas: canvas,
    });
    groupSurface.ctx.fillStyle = 'rgb(255, 0, 0)';
    groupSurface.ctx.fillRect(0, 0, 2, 4);
    groupSurface.ctx.fillStyle = 'rgb(0, 0, 255)';
    groupSurface.ctx.fillRect(2, 0, 2, 4);
    const before = groupSurface.getImageData(0, 0, 4, 4).data;
    const resolveMask = vi.fn((_binding, _item, _target, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }));

    applyGroupContentEffects(
      createDocument('masked group effect'),
      groupSurface,
      [
        {
          id: 'blur',
          type: 'layerBlur',
          radius: 2,
          visible: true,
          mask: {
            source: {
              kind: 'vector',
              vectorMask: {
                points: [
                  { x: 0, y: 0, handleIn: null, handleOut: null },
                  { x: 4, y: 0, handleIn: null, handleOut: null },
                  { x: 4, y: 4, handleIn: null, handleOut: null },
                ],
                closed: true,
                fillRule: 'nonzero',
              },
            },
            type: 'alpha',
            coordinateSpace: 'target-local',
          },
        },
      ],
      {
        effectMaskResolver: resolveMask,
        effectTarget: createGroupEffectTargetItem(10, 20, 4, 4),
      },
    );

    expect(resolveMask).toHaveBeenCalledOnce();
    expect(Array.from(groupSurface.getImageData(0, 0, 4, 4).data)).toEqual(Array.from(before));
  });
});
