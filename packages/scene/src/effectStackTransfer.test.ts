import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import { createDocument, makeAdjustmentNode, makeFrameNode, makeShapeNode } from './document';
import {
  applyEffectStackPayload,
  canReceiveEffectStack,
  createEffectStackPayload,
  transferEffectStackToNodes,
} from './effectStackTransfer';
import { makeSmartFilter } from './smartFilters';
import type { Effect, SceneNode } from './types';

function shadow(id: string, mask?: Effect['mask']): Effect {
  return {
    id,
    type: 'dropShadow',
    x: 2,
    y: 3,
    blur: 8,
    spread: 1,
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
    opacity: 0.5,
    blendMode: 'normal',
    visible: true,
    ...(mask ? { mask } : {}),
  };
}

function documentWith(...nodes: SceneNode[]): Document {
  return {
    ...createDocument('Effect stack transfer'),
    rootChildren: nodes.map((node) => node.id),
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

function layerEffects(node: SceneNode): Effect[] {
  if (!('effects' in node)) throw new Error('Expected an effect-capable node');
  return node.effects;
}

describe('effect stack transfer', () => {
  it('copies layer effects as an independently editable replacement stack', () => {
    const source = makeShapeNode(
      'source',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { effects: [shadow('source-shadow')] },
    );
    const target = makeShapeNode(
      'target',
      { kind: 'rect', x: 120, y: 0, w: 100, h: 100 },
      {
        effects: [
          {
            id: 'target-blur',
            type: 'layerBlur',
            radius: 12,
            visible: true,
          },
        ],
      },
    );
    const doc = documentWith(source, target);
    const payload = createEffectStackPayload(source, 'layer-effects');
    if (!payload) throw new Error('Expected a layer-effect payload');

    const result = applyEffectStackPayload(doc, target.id, payload);
    if (!result) throw new Error('Expected a compatible target');

    expect(layerEffects(source)).toEqual([shadow('source-shadow')]);
    expect(layerEffects(result.node)).toMatchObject([{ type: 'dropShadow', blur: 8 }]);
    expect(layerEffects(result.node)[0]?.id).not.toBe('source-shadow');
    expect(layerEffects(result.node).map((effect) => effect.type)).not.toContain('layerBlur');
  });

  it('preserves Object Filter order, metadata, and stack bypass without sharing ids', () => {
    const source = {
      ...makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      smartFilters: [
        makeSmartFilter('source-brightness', 'brightness', {
          value: 18,
          studioTreatment: {
            instanceId: 'treatment-1',
            treatmentId: 'halftone-pattern',
            effectIndex: 0,
            controls: { density: 40 },
          },
        }),
        makeSmartFilter('source-invert', 'invert', { visible: false }),
      ],
      smartFiltersEnabled: false,
    };
    const target = {
      ...makeShapeNode('target', { kind: 'rect', x: 120, y: 0, w: 100, h: 100 }),
      smartFilters: [makeSmartFilter('target-blur', 'blur', { radius: 10 })],
    };
    const doc = documentWith(source, target);
    const payload = createEffectStackPayload(source, 'object-filters');
    if (!payload) throw new Error('Expected an Object Filter payload');

    const result = applyEffectStackPayload(doc, target.id, payload);
    if (!result) throw new Error('Expected a compatible target');

    expect(source.smartFilters.map((filter) => filter.id)).toEqual([
      'source-brightness',
      'source-invert',
    ]);
    expect(result.node.smartFilters?.map((filter) => filter.kind)).toEqual([
      'brightness',
      'invert',
    ]);
    expect(result.node.smartFilters?.[0]).toMatchObject({
      value: 18,
      studioTreatment: {
        instanceId: 'treatment-1',
        treatmentId: 'halftone-pattern',
        effectIndex: 0,
        controls: { density: 40 },
      },
    });
    expect(result.node.smartFilters?.map((filter) => filter.id)).not.toEqual(
      source.smartFilters.map((filter) => filter.id),
    );
    expect(result.node.smartFiltersEnabled).toBe(false);
  });

  it('strips an invalid copied effect mask but retains the effect itself', () => {
    const source = makeShapeNode(
      'source',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      {
        effects: [
          shadow('masked-source', {
            source: { kind: 'scene-node', nodeId: 'target' },
            type: 'alpha',
            coordinateSpace: 'world',
          }),
        ],
      },
    );
    const target = makeShapeNode(
      'target',
      { kind: 'rect', x: 120, y: 0, w: 100, h: 100 },
      { effects: [] },
    );
    const doc = documentWith(source, target);
    const payload = createEffectStackPayload(source, 'layer-effects');
    if (!payload) throw new Error('Expected a layer-effect payload');

    const result = applyEffectStackPayload(doc, target.id, payload);
    if (!result) throw new Error('Expected a compatible target');

    expect(result.entryCount).toBe(1);
    expect(result.omittedMaskCount).toBe(1);
    expect(layerEffects(result.node)[0]?.mask).toBeUndefined();
    expect(layerEffects(source)[0]?.mask).toBeDefined();
  });

  it('creates independent entry identities for every multi-layer destination', () => {
    const source = makeShapeNode(
      'source',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { effects: [shadow('source-shadow')] },
    );
    const first = makeShapeNode(
      'first',
      { kind: 'rect', x: 120, y: 0, w: 100, h: 100 },
      { effects: [] },
    );
    const second = makeShapeNode(
      'second',
      { kind: 'rect', x: 240, y: 0, w: 100, h: 100 },
      { effects: [] },
    );
    const result = transferEffectStackToNodes(
      documentWith(source, first, second),
      source.id,
      [first.id, second.id],
      'layer-effects',
    );

    const firstId = layerEffects(result.document.nodes[first.id]!)[0]?.id;
    const secondId = layerEffects(result.document.nodes[second.id]!)[0]?.id;
    expect(result.copiedTargetIds).toEqual([first.id, second.id]);
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
    expect(firstId).not.toBe('source-shadow');
    expect(secondId).not.toBe('source-shadow');
  });

  it('appends Layer Effects after an existing destination stack', () => {
    const source = makeShapeNode(
      'source',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { effects: [shadow('source-shadow')] },
    );
    const target = makeShapeNode(
      'target',
      { kind: 'rect', x: 120, y: 0, w: 100, h: 100 },
      {
        effects: [
          {
            id: 'target-blur',
            type: 'layerBlur',
            radius: 12,
            visible: true,
          },
        ],
      },
    );
    const result = transferEffectStackToNodes(
      documentWith(source, target),
      source.id,
      [target.id],
      'layer-effects',
      'append',
    );

    expect(layerEffects(result.document.nodes[target.id]!).map((effect) => effect.type)).toEqual([
      'layerBlur',
      'dropShadow',
    ]);
    expect(layerEffects(result.document.nodes[target.id]!)[1]?.id).not.toBe('source-shadow');
  });

  it('keeps an appended bypassed Object Filter segment visually bypassed', () => {
    const source = {
      ...makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      smartFilters: [makeSmartFilter('source-invert', 'invert')],
      smartFiltersEnabled: false,
    };
    const target = {
      ...makeShapeNode('target', { kind: 'rect', x: 120, y: 0, w: 100, h: 100 }),
      smartFilters: [makeSmartFilter('target-brightness', 'brightness', { value: 12 })],
      smartFiltersEnabled: true,
    };
    const result = transferEffectStackToNodes(
      documentWith(source, target),
      source.id,
      [target.id],
      'object-filters',
      'append',
    );
    const filters = result.document.nodes[target.id]?.smartFilters;

    expect(filters?.map((filter) => filter.kind)).toEqual(['brightness', 'invert']);
    expect(filters?.[0]?.visible).toBe(true);
    expect(filters?.[1]?.visible).toBe(false);
    expect(result.document.nodes[target.id]?.smartFiltersEnabled).toBe(true);
    expect(result.convertedBypassedObjectFilterCount).toBe(1);
  });

  it('transfers Object Filters from a frame to both vector and raster paint layers', () => {
    const source = {
      ...makeFrameNode('source-frame'),
      smartFilters: [makeSmartFilter('frame-invert', 'invert')],
    };
    const vector = makeShapeNode('vector', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const {
      effects: _effects,
      strokes: _strokes,
      shape: _shape,
      ...rasterBase
    } = makeShapeNode('raster', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const raster = {
      ...rasterBase,
      kind: 'rasterLayer' as const,
      width: 100,
      height: 100,
      pixelMode: true,
      tiles: new Map(),
    } as SceneNode;
    const result = transferEffectStackToNodes(
      documentWith(source, vector, raster),
      source.id,
      [vector.id, raster.id],
      'object-filters',
    );

    expect(result.copiedTargetIds).toEqual([vector.id, raster.id]);
    expect(result.document.nodes[vector.id]?.smartFilters?.[0]?.kind).toBe('invert');
    expect(result.document.nodes[raster.id]?.smartFilters?.[0]?.kind).toBe('invert');
    expect(result.document.nodes[vector.id]?.smartFilters?.[0]?.id).not.toBe(
      result.document.nodes[raster.id]?.smartFilters?.[0]?.id,
    );
  });

  it('rejects incompatible destination stacks', () => {
    const {
      effects: _effects,
      strokes: _strokes,
      shape: _shape,
      ...rasterBase
    } = makeShapeNode('raster', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const raster = {
      ...rasterBase,
      kind: 'rasterLayer' as const,
      width: 10,
      height: 10,
      pixelMode: true,
      tiles: new Map(),
    } as SceneNode;
    const adjustment = makeAdjustmentNode(
      'adjustment',
      'levels',
      {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      },
      { effects: [] },
    );

    expect(canReceiveEffectStack(raster, 'layer-effects')).toBe(false);
    expect(canReceiveEffectStack(raster, 'object-filters')).toBe(true);
    expect(canReceiveEffectStack(adjustment, 'object-filters')).toBe(false);
  });
});
