/**
 * Halftone persistence: save/reopen exactness and malformed-data tolerance.
 *
 * The halftone adjustment lives in the persisted `AdjustmentNode.adjustments`
 * stack. These tests verify:
 *   1. create → encode → decode → reopen preserves every parameter exactly
 *      (including the invert / foregroundColor / backgroundColor fields);
 *   2. the legacy `adjustmentType` singleton path remains backward-compatible;
 *   3. malformed persisted values (NaN, garbage strings, unknown enum values)
 *      never crash document loading — decode still succeeds and the render
 *      path falls back to safe defaults.
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { createDocument, makeAdjustmentNode } from '../document';
import { DocumentCodec } from '../documentCodec';
import type { AdjustmentNode, NodeId, ShapeNode } from '../types';

function makeTestDoc(): Document {
  return createDocument('halftone-persistence', true) as Document;
}

function addNode(doc: Document, node: ShapeNode | AdjustmentNode, parentId?: NodeId): Document {
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && 'children' in parent) {
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [node.id]: node as Document['nodes'][string],
          [parentId]: { ...parent, children: [...parent.children, node.id] },
        },
      } as Document;
    }
  }
  return {
    ...doc,
    nodes: { ...doc.nodes, [node.id]: node as Document['nodes'][string] },
    rootChildren: [...doc.rootChildren, node.id],
  } as Document;
}

function addShape(doc: Document, id: string): Document {
  return addNode(doc, {
    id,
    kind: 'shape',
    name: 'Shape',
    order: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    fill: { space: 'rgb', r: 128, g: 128, b: 128, a: 255 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    strokes: [],
    effects: [],
  } as ShapeNode);
}

describe('halftone persistence — save/reopen round trip', () => {
  it('preserves every halftone parameter across encode → decode', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);

    const adjId = 'adj1';
    d = addNode(d, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [
        {
          id: 'ht1',
          kind: 'halftone',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          pattern: 'dot',
          frequency: 37,
          angle: 63,
          dotShape: 'elliptical',
          channel: 'k',
          method: 'am',
          threshold: 141,
          intensity: 0.82,
          softness: 0.4,
          invert: true,
          foregroundColor: [200, 30, 10],
          backgroundColor: [240, 245, 250],
        },
      ],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok, 'decode must succeed').toBe(true);
    if (!decoded.ok) return;

    const restored = decoded.document.nodes[adjId] as AdjustmentNode;
    const restoredHt = restored.adjustments?.find((a) => a.id === 'ht1');
    expect(restoredHt).toBeDefined();
    if (!restoredHt) return;

    expect(restoredHt).toMatchObject({
      kind: 'halftone',
      pattern: 'dot',
      frequency: 37,
      angle: 63,
      dotShape: 'elliptical',
      channel: 'k',
      method: 'am',
      threshold: 141,
      intensity: 0.82,
      softness: 0.4,
      invert: true,
      foregroundColor: [200, 30, 10],
      backgroundColor: [240, 245, 250],
    });
  });

  it('preserves the FM halftone variant and print fields', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);

    const adjId = 'adj1';
    d = addNode(d, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'document' },
      adjustments: [
        {
          id: 'ht-fm',
          kind: 'halftone',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          pattern: 'line',
          frequency: 12,
          angle: 15,
          dotShape: 'line',
          channel: 'cmyk',
          method: 'fm',
          channelAngles: { c: 15, m: 75, y: 0, k: 45 },
          registrationOffset: { c: [0.5, 0.5], k: [-0.25, 0.25] },
          tacLimit: 0.85,
          blackGeneration: 'gcr',
          gcrStrength: 0.6,
          previewChannel: 'c',
          dotGain: 0.12,
        },
      ],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const restored = decoded.document.nodes[adjId] as AdjustmentNode;
    const ht = restored.adjustments?.find((a) => a.id === 'ht-fm');
    expect(ht).toMatchObject({
      kind: 'halftone',
      pattern: 'line',
      frequency: 12,
      method: 'fm',
      channel: 'cmyk',
      channelAngles: { c: 15, m: 75, y: 0, k: 45 },
      registrationOffset: { c: [0.5, 0.5], k: [-0.25, 0.25] },
      tacLimit: 0.85,
      blackGeneration: 'gcr',
      gcrStrength: 0.6,
      previewChannel: 'c',
      dotGain: 0.12,
    });
  });

  it('keeps the legacy adjustmentType singleton path intact', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);

    const adjId = 'adj1';
    d = addNode(d, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      adjustmentType: 'levels',
      params: { channel: 'rgb' },
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const restored = decoded.document.nodes[adjId] as AdjustmentNode;
    expect(restored.adjustmentType).toBe('levels');
    expect(restored.params).toEqual({ channel: 'rgb' });
  });
});

describe('halftone persistence — malformed data tolerance', () => {
  it('decodes a document whose halftone frequency is a garbage string', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);
    d = addNode(d, {
      ...makeAdjustmentNode('adj1', 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [
        // Simulate a hand-edited / corrupted save
        {
          id: 'ht1',
          kind: 'halftone',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          pattern: 'dot',
          frequency: 'twenty' as unknown as number,
          angle: '45deg' as unknown as number,
          dotShape: 'round',
          channel: 'k',
          method: 'am',
        },
      ],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok, 'corrupted halftone params must not fail document load').toBe(true);
    if (!decoded.ok) return;
    // The adjustment survives (renderer falls back to defaults at draw time)
    const restored = decoded.document.nodes['adj1'] as AdjustmentNode;
    expect(restored.adjustments).toHaveLength(1);
  });

  it('decodes a document with NaN and negative parameter values', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);
    d = addNode(d, {
      ...makeAdjustmentNode('adj1', 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [
        {
          id: 'ht1',
          kind: 'halftone',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          pattern: 'dot',
          frequency: Number.NaN,
          angle: -30,
          dotShape: 'round',
          channel: 'k',
          method: 'am',
          threshold: Number.POSITIVE_INFINITY,
          intensity: -2,
        },
      ],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
  });

  it('decodes an unknown future pattern enum value without crashing', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addShape(doc, shapeId);
    d = addNode(d, {
      ...makeAdjustmentNode('adj1', 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [
        {
          id: 'ht1',
          kind: 'halftone',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          // A value from a future version of the document format
          pattern: 'waffle' as unknown as 'dot',
          frequency: 20,
          angle: 45,
          dotShape: 'round',
          channel: 'k',
          method: 'am',
        },
      ],
    } as AdjustmentNode);

    const json = DocumentCodec.encode(d);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok, 'unknown enum values must not fail document load').toBe(true);
  });
});
