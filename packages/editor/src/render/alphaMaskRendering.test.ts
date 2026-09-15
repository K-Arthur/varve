// @ts-nocheck
// @vitest-environment jsdom
//
// Deterministic regression test: an image shape with a backgroundRemoval maskDataUrl
// must propagate its alpha mask through the editor → engine IR pipeline so that the
// renderer can composite it. This exercises:
//   scene node → toEngineNode / flattenSceneToEngine → engine.buildIr → FillIR.alphaMask.
//
// Canvas-level pixel compositing is covered by packages/engine/src/replay-image-fill.test.ts.

import { createEngine } from '@varve/engine';
import { addNode, createDocument, type NodeId, type ShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { toEngineNode } from '../canvas/renderPipeline';
import { flattenSceneToEngine } from './sceneToEngine';

const SRC_URL = 'data:image/png;base64,TEST_SRC';
const MASK_URL = 'data:image/png;base64,TEST_MASK';

function makeImageShapeNode(id: NodeId): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: 'Masked Image',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        image: { src: SRC_URL, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
    backgroundRemoval: {
      maskDataUrl: MASK_URL,
      method: 'quick',
      confidence: 0.95,
      appliedAt: Date.now(),
      feather: 0,
      decontaminate: false,
    },
  } as unknown as ShapeNode;
}

describe('alpha mask engine IR pipeline', () => {
  it('propagates alphaMask from scene node to the engine node', () => {
    const node = makeImageShapeNode('img' as NodeId);
    const engineNode = toEngineNode(node);
    expect(engineNode.alphaMask).toBe(MASK_URL);
  });

  it('propagates alphaMask from scene document to engine IR fill', async () => {
    let doc = createDocument({ name: 'test' });
    const node = makeImageShapeNode('img' as NodeId);
    doc = addNode(doc, node);
    doc = { ...doc, rootChildren: [node.id] };

    const flattened = flattenSceneToEngine(doc, [node.id]);
    const engine = await createEngine('stub');
    const ir = await engine.buildIr({ nodes: flattened.nodes });

    expect(ir).toHaveLength(1);
    const imageFill = ir[0].fills?.find((f) => f.type === 'image');
    expect(imageFill).toBeDefined();
    expect((imageFill as { alphaMask?: string }).alphaMask).toBe(MASK_URL);
  });
});
