// @vitest-environment jsdom

/**
 * Path-text settings have to survive the trip to the painter.
 *
 * Same shape of question as the variable-axis chain: the inspector writes
 * `pathTextSettings` onto the node, but the painter reads a primitive built
 * from the node's *shape*. If the shape does not carry the settings — or the
 * path geometry they point at is never resolved — the controls move and the
 * canvas does not.
 */
import { createEngine } from '@varve/engine';
import { createDocument, type ShapeNode, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

const ring = (): ShapeNode =>
  ({
    id: 'ring-1',
    kind: 'shape',
    name: 'Ellipse 1',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    transform: [1, 0, 0, 1, 0, 0] as const,
    shape: { kind: 'circle', cx: 200, cy: 200, r: 140 },
    fills: [],
    strokes: [],
    effects: [],
  }) as unknown as ShapeNode;

const label = (
  startOffset: number,
  overrides?: { endOffset?: number; baselineShift?: number; side?: 'top' | 'bottom' },
): TextNode =>
  ({
    id: 'text-1',
    kind: 'text',
    name: 'Node',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a1',
    text: 'VELO CLUB',
    transform: [1, 0, 0, 1, 0, 0] as const,
    w: 300,
    h: 40,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fontSize: 32,
    fontFamily: 'IBM Plex Sans Variable',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    direction: 'auto',
    strokes: [],
    effects: [],
    textMode: 'path',
    pathTextSettings: {
      pathNodeId: 'ring-1',
      startOffset,
      side: overrides?.side ?? 'top',
      ...(overrides?.endOffset != null ? { endOffset: overrides.endOffset } : {}),
      ...(overrides?.baselineShift != null ? { baselineShift: overrides.baselineShift } : {}),
    },
  }) as unknown as TextNode;

function build(startOffset: number) {
  const doc = createDocument('badge', true);
  const r = ring();
  const t = label(startOffset);
  doc.nodes[r.id] = r;
  doc.nodes[t.id] = t;
  doc.rootChildren.push(r.id, t.id);
  const engineNode = sceneNodeToEngineNode(t, undefined, doc);
  return { doc, engineNode, shape: engineNode.shape as unknown as Record<string, unknown> };
}

describe('path-text settings reach the painter', () => {
  it('puts pathTextSettings on the shape the pipeline paints from', () => {
    expect(build(0.25).shape.pathTextSettings).toMatchObject({
      pathNodeId: 'ring-1',
      startOffset: 0.25,
    });
  });

  it('carries the offset through to the render primitive', async () => {
    const engine = await createEngine('stub');
    const { engineNode } = build(0.25);
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = ir[0]?.primitive as unknown as Record<string, unknown>;
    expect(primitive.textMode).toBe('path');
    expect(primitive.pathTextSettings).toMatchObject({ startOffset: 0.25 });
  });

  it('distinguishes two different offsets at the primitive', async () => {
    const engine = await createEngine('stub');
    const a = await engine.buildIr({ nodes: [build(0.05).engineNode] } as never);
    const b = await engine.buildIr({ nodes: [build(0.45).engineNode] } as never);
    const offsetOf = (ir: unknown) =>
      (
        (ir as Array<{ primitive: Record<string, { startOffset?: number }> }>)[0]
          ?.primitive as unknown as { pathTextSettings?: { startOffset?: number } }
      )?.pathTextSettings?.startOffset;
    expect(offsetOf(a)).not.toBe(offsetOf(b));
  });

  it('resolves the path geometry the glyphs are placed along', async () => {
    // Without pathShape the painter has nothing to walk and draws nothing,
    // which looks identical to the offset having no effect. The ring must be
    // in the same IR build for the text to resolve it by id.
    const engine = await createEngine('stub');
    const { doc, engineNode } = build(0.25);
    const ringEngineNode = sceneNodeToEngineNode(doc.nodes['ring-1']!, undefined, doc);
    const ir = await engine.buildIr({ nodes: [ringEngineNode, engineNode] } as never);
    const textItem = (ir as Array<{ primitive: { kind: string } }>).find(
      (i) => i.primitive.kind === 'text',
    );
    const primitive = textItem?.primitive as unknown as Record<string, unknown>;
    expect(primitive.pathShape).toBeDefined();
  });

  it('carries endOffset through to the render primitive', async () => {
    const engine = await createEngine('stub');
    const t = label(0.1, { endOffset: 0.6 });
    const doc = createDocument('badge', true);
    const r = ring();
    doc.nodes[r.id] = r;
    doc.nodes[t.id] = t;
    doc.rootChildren.push(r.id, t.id);
    const engineNode = sceneNodeToEngineNode(t, undefined, doc);
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = (ir as Array<{ primitive: Record<string, unknown> }>)[0]?.primitive as Record<
      string,
      unknown
    >;
    expect(primitive.pathTextSettings).toMatchObject({ endOffset: 0.6 });
  });

  it('carries baselineShift through to the render primitive', async () => {
    const engine = await createEngine('stub');
    const t = label(0, { baselineShift: 12 });
    const doc = createDocument('badge', true);
    const r = ring();
    doc.nodes[r.id] = r;
    doc.nodes[t.id] = t;
    doc.rootChildren.push(r.id, t.id);
    const engineNode = sceneNodeToEngineNode(t, undefined, doc);
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = (ir as Array<{ primitive: Record<string, unknown> }>)[0]?.primitive as Record<
      string,
      unknown
    >;
    expect(primitive.pathTextSettings).toMatchObject({ baselineShift: 12 });
  });

  it('carries side bottom through to the render primitive', async () => {
    const engine = await createEngine('stub');
    const t = label(0.2, { side: 'bottom' });
    const doc = createDocument('badge', true);
    const r = ring();
    doc.nodes[r.id] = r;
    doc.nodes[t.id] = t;
    doc.rootChildren.push(r.id, t.id);
    const engineNode = sceneNodeToEngineNode(t, undefined, doc);
    const ir = await engine.buildIr({ nodes: [engineNode] } as never);
    const primitive = (ir as Array<{ primitive: Record<string, unknown> }>)[0]?.primitive as Record<
      string,
      unknown
    >;
    expect(primitive.pathTextSettings).toMatchObject({ side: 'bottom', startOffset: 0.2 });
  });
});
