import type { Affine } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyPaintProperties,
  extractPaintProperties,
  hasPaintProperties,
} from './propertyClipboard';

function shapeNode(over: Record<string, unknown> = {}): SceneNode {
  return {
    kind: 'shape',
    id: 's1',
    name: 'shape',
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    order: 'a0',
    visible: true,
    locked: false,
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    ...over,
  } as unknown as SceneNode;
}

function textNode(over: Partial<SceneNode> = {}): SceneNode {
  return {
    kind: 'text',
    id: 't1',
    name: 'text',
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    text: 'Hello',
    fontSize: 16,
    ...over,
  } as unknown as SceneNode;
}

describe('extractPaintProperties', () => {
  it('captures fills, strokes, effects, opacity, blend mode and radius', () => {
    const node = shapeNode({
      fills: [{ type: 'solid', space: 'rgb', r: 1, g: 0, b: 0, a: 1 }],
      strokes: [{ width: 2, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 } }],
      effects: [
        {
          type: 'shadow',
          x: 0,
          y: 2,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 0.5 },
        },
      ],
      opacity: 0.7,
      blendMode: 'multiply',
      cornerRadius: 8,
    });
    const props = extractPaintProperties(node);
    expect(props.fills).toHaveLength(1);
    expect(props.strokes).toHaveLength(1);
    expect(props.effects).toHaveLength(1);
    expect(props.opacity).toBe(0.7);
    expect(props.blendMode).toBe('multiply');
    expect(props.cornerRadius).toBe(8);
    expect(hasPaintProperties(props)).toBe(true);
  });

  it('captures typography from text nodes', () => {
    const node = textNode({
      fontFamily: 'Geist',
      fontSize: 24,
      fontWeight: 600,
      textAlign: 'center',
    });
    const props = extractPaintProperties(node);
    expect(props.fontFamily).toBe('Geist');
    expect(props.fontSize).toBe(24);
    expect(props.fontWeight).toBe(600);
    expect(props.textAlign).toBe('center');
  });

  it('reports an empty clipboard for nodes with no copyable properties', () => {
    // A bare node without optional property keys has nothing to copy.
    const props = extractPaintProperties(shapeNode());
    expect(hasPaintProperties(props)).toBe(false);
  });
});

describe('applyPaintProperties', () => {
  it('applies appearance properties to a shape target', () => {
    const target = shapeNode();
    const source = shapeNode({
      fills: [{ type: 'solid', space: 'rgb', r: 1, g: 0, b: 0, a: 1 }],
      opacity: 0.5,
      cornerRadius: 12,
    });
    const updated = applyPaintProperties(target, extractPaintProperties(source));
    expect(updated.fills).toHaveLength(1);
    expect(updated.opacity).toBe(0.5);
    expect((updated as { cornerRadius?: number }).cornerRadius).toBe(12);
  });

  it('applies typography only to text targets', () => {
    const source = textNode({ fontSize: 32, fontFamily: 'Serif' });
    const textTarget = textNode();
    const shapeTarget = shapeNode();

    const updatedText = applyPaintProperties(textTarget, extractPaintProperties(source));
    expect((updatedText as { fontSize?: number }).fontSize).toBe(32);
    expect((updatedText as { fontFamily?: string }).fontFamily).toBe('Serif');

    const updatedShape = applyPaintProperties(shapeTarget, extractPaintProperties(source));
    expect((updatedShape as { fontSize?: number }).fontSize).toBeUndefined();
  });

  it('leaves the target node untouched when nothing applies', () => {
    const target = shapeNode();
    const updated = applyPaintProperties(target, {});
    expect(updated).toBe(target);
  });

  it('does not alias the source node arrays after application', () => {
    const source = shapeNode({ fills: [{ type: 'solid', space: 'rgb', r: 1, g: 0, b: 0, a: 1 }] });
    const target = shapeNode();
    const updated = applyPaintProperties(target, extractPaintProperties(source));
    expect(updated.fills).not.toBe(source.fills);
  });
});
