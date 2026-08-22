// @vitest-environment jsdom

/**
 * The whole path a variation setting takes, in one test.
 *
 * Four separate fixes to the painter had no visible effect in the running
 * application, because each was checked with a primitive built by hand and
 * the real chain drops the value earlier. This walks the actual sequence —
 * scene node, engine node, IR, primitive — so whichever link loses it says
 * so, instead of the failure surfacing as "the glyphs didn't change" at the
 * end of a five-minute video capture.
 */
import { createEngine } from '@varve/engine';
import { createDocument, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

function specimen(variableAxes?: Record<string, number>): TextNode {
  return {
    id: 't1',
    kind: 'text',
    name: 'Specimen',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text: 'Aa',
    transform: [1, 0, 0, 1, 0, 0] as const,
    w: 400,
    h: 120,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fontSize: 96,
    fontFamily: 'IBM Plex Sans Variable',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.1,
    letterSpacing: 0,
    textAlign: 'left',
    direction: 'auto',
    strokes: [],
    effects: [],
    ...(variableAxes ? { variableAxes } : {}),
  } as TextNode;
}

function chain(node: TextNode) {
  const doc = createDocument('specimen', true);
  doc.nodes[node.id] = node;
  doc.rootChildren.push(node.id);
  const engineNode = sceneNodeToEngineNode(node, undefined, doc);
  return {
    engineNode: engineNode as unknown as Record<string, unknown>,
    shape: engineNode.shape as unknown as Record<string, unknown>,
  };
}

describe('variation settings survive the render chain', () => {
  it('reaches the engine node', () => {
    expect(chain(specimen({ wght: 750 })).engineNode.variableAxes).toEqual({ wght: 750 });
  });

  it('reaches the shape the pipeline paints from', () => {
    expect(chain(specimen({ wght: 750 })).shape.variableAxes).toEqual({ wght: 750 });
  });

  it('reaches the primitive the painter reads', async () => {
    // The browser build resolves to the stub engine, which is what the
    // capture harness and the dev server both run.
    const engine = await createEngine('stub');
    const { engineNode } = chain(specimen({ wght: 750 }));
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = ir[0]?.primitive as unknown as Record<string, unknown>;
    expect(primitive.kind).toBe('text');
    expect(primitive.variableAxes).toEqual({ wght: 750 });
  });

  it('carries nothing when the node sets no axes', async () => {
    const engine = await createEngine('stub');
    const { engineNode } = chain(specimen());
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = ir[0]?.primitive as unknown as Record<string, unknown>;
    expect(primitive.variableAxes).toBeUndefined();
  });
});
