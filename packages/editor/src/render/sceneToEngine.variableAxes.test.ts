// @vitest-environment jsdom

/**
 * Variation settings have to survive the trip onto the text *shape*.
 *
 * The render pipeline turns a node's shape into the text primitive the
 * painter reads. `variableAxes` was set on the engine node but not on the
 * shape, so the axis was present everywhere except the one object that
 * reaches the canvas — and every fix applied further down the painter was
 * dead code against a field that was always undefined.
 *
 * The painter-level tests could not catch this: they construct the primitive
 * by hand, with the field already populated.
 */
import { createDocument, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

function textNode(extra: Partial<TextNode> = {}): TextNode {
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
    ...extra,
  } as TextNode;
}

const shapeOf = (node: TextNode) => {
  const doc = createDocument('t', true);
  doc.nodes[node.id] = node;
  doc.rootChildren.push(node.id);
  const engineNode = sceneNodeToEngineNode(node, undefined, doc);
  return engineNode.shape as unknown as Record<string, unknown>;
};

describe('text shape carries what the painter reads', () => {
  it('puts variableAxes on the shape, not only on the engine node', () => {
    const shape = shapeOf(textNode({ variableAxes: { wght: 750 } } as Partial<TextNode>));
    expect(shape.variableAxes).toEqual({ wght: 750 });
  });

  it('puts openTypeFeatures on the shape too', () => {
    const shape = shapeOf(textNode({ openTypeFeatures: { liga: true } } as Partial<TextNode>));
    expect(shape.openTypeFeatures).toEqual({ liga: true });
  });

  it('leaves both undefined when the node sets neither', () => {
    const shape = shapeOf(textNode());
    expect(shape.variableAxes).toBeUndefined();
    expect(shape.openTypeFeatures).toBeUndefined();
  });

  it('still carries the plain typography the painter needs', () => {
    const shape = shapeOf(textNode({ variableAxes: { wght: 200 } } as Partial<TextNode>));
    expect(shape.fontFamily).toBe('IBM Plex Sans Variable');
    expect(shape.fontSize).toBe(96);
    // fontWeight stays the authored value; the axis is applied by the painter.
    expect(shape.fontWeight).toBe(400);
  });
});
