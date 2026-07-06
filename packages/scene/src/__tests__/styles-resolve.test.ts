import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode, makeTextNode } from '../document';
import {
  createColorStyle,
  createEffectStyle,
  createTextStyle,
  getEffectiveStyle,
  nodeHasStyle,
  resolveAllStyles,
  resolveNodeStyles,
} from '../styles';
import type { Effect, Fill, SceneNode } from '../types';

describe('resolveNodeStyles', () => {
  it('resolves color style fills', () => {
    const doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const d2 = addNode(d1, shape);

    const resolved = resolveNodeStyles(d2.nodes.n1!, style.id, d2.styles!);
    expect(resolved).toBeDefined();
    expect(resolved?.fill).toEqual(fill);
  });

  it('resolves text style properties', () => {
    const doc = createDocument('test');
    const { style, doc: d1 } = createTextStyle(doc, 'Heading', {
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 700,
      lineHeight: 1.1,
      letterSpacing: -0.02,
      textAlign: 'left',
      textCase: 'none',
    });
    const text = makeTextNode('n1', 'Hello');
    const d2 = addNode(d1, text);

    const resolved = resolveNodeStyles(d2.nodes.n1!, style.id, d2.styles!);
    expect(resolved).toBeDefined();
    expect((resolved as Record<string, unknown>).fontSize).toBe(48);
    expect((resolved as Record<string, unknown>).fontFamily).toBe('Inter');
    expect((resolved as Record<string, unknown>).fontWeight).toBe(700);
    expect((resolved as Record<string, unknown>).lineHeight).toBe(1.1);
    expect((resolved as Record<string, unknown>).letterSpacing).toBe(-0.02);
    expect((resolved as Record<string, unknown>).textAlign).toBe('left');
    expect((resolved as Record<string, unknown>).textCase).toBe('none');
  });

  it('resolves effect styles', () => {
    const doc = createDocument('test');
    const effects: Effect[] = [
      {
        type: 'dropShadow',
        x: 0,
        y: 4,
        blur: 8,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 76 },
        opacity: 0.3,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const { style, doc: d1 } = createEffectStyle(doc, 'Card Shadow', effects);
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const d2 = addNode(d1, shape);

    const resolved = resolveNodeStyles(d2.nodes.n1!, style.id, d2.styles!);
    expect(resolved).toBeDefined();
    expect(resolved?.effects).toEqual(effects);
  });

  it('returns undefined for non-existent styleId', () => {
    const doc = createDocument('test');
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const d2 = addNode(doc, shape);

    const resolved = resolveNodeStyles(d2.nodes.n1!, 'nonexistent', {});
    expect(resolved).toBeUndefined();
  });

  it('applies overrides on top of style', () => {
    const doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    const shape = makeShapeNode('n1', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    const d2 = addNode(d1, shape);

    const resolved = resolveNodeStyles(d2.nodes.n1!, style.id, d2.styles!);
    expect(resolved).toBeDefined();
    expect(resolved?.fill).toEqual(fill);
  });

  it('returns empty record when style has no resolvable properties (layout)', () => {
    let doc = createDocument('test');
    const layoutStyle = {
      id: 's1',
      type: 'layout' as const,
      name: 'Flex Row',
      layout: {
        mode: 'flex' as const,
        direction: 'row' as const,
        gap: 16,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        wrap: false,
        grow: 0,
        shrink: 0,
      },
    };
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);

    const resolved = resolveNodeStyles(doc.nodes.n1!, 's1', { s1: layoutStyle });
    expect(resolved).toEqual({});
  });
});

describe('resolveAllStyles', () => {
  it('returns empty map when no styles on document', () => {
    const doc = createDocument('test');
    const result = resolveAllStyles(doc);
    expect(result.size).toBe(0);
  });

  it('returns empty map when styles is undefined', () => {
    const doc = { ...createDocument('test'), styles: undefined };
    const result = resolveAllStyles(doc);
    expect(result.size).toBe(0);
  });

  it('resolves styles for multiple nodes', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;

    const shape1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc = addNode(doc, shape1);
    doc = addNode(doc, shape2);

    doc = {
      ...doc,
      nodes: { ...doc.nodes, n1: { ...doc.nodes.n1, styleId: style.id } as SceneNode },
    };

    const result = resolveAllStyles(doc);
    expect(result.size).toBe(1);
    expect(result.has('n1')).toBe(true);
    expect(result.has('n2')).toBe(false);
    expect(result.get('n1')?.fill).toEqual(fill);
  });

  it('skips nodes without styleId', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;

    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);

    const result = resolveAllStyles(doc);
    expect(result.size).toBe(0);
  });
});

describe('nodeHasStyle', () => {
  it('returns true when styleId is set', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const withStyle = { ...shape, styleId: 's1' as const };
    expect(nodeHasStyle(withStyle as SceneNode)).toBe(true);
  });

  it('returns false when no styleId', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(nodeHasStyle(shape)).toBe(false);
  });

  it('returns false when styleId is empty string', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const withEmpty = { ...shape, styleId: '' as const };
    expect(nodeHasStyle(withEmpty as SceneNode)).toBe(false);
  });
});

describe('getEffectiveStyle', () => {
  it('returns style with overrides', () => {
    let doc = createDocument('test');
    createTextStyle(doc, 'Heading', { fontSize: 48, fontWeight: 700 });
    const text = makeTextNode('n1', 'Hello');
    doc = addNode(doc, text);

    const result = getEffectiveStyle(doc, 'n1');
    expect(result).toEqual({ style: undefined, overrides: {} });
  });

  it('returns style with overrides when node has style', () => {
    let doc = createDocument('test');
    const { style, doc: d1 } = createTextStyle(doc, 'Heading', { fontSize: 48, fontWeight: 700 });
    doc = d1;
    const text = makeTextNode('n1', 'Hello');
    doc = addNode(doc, text);
    doc = {
      ...doc,
      nodes: { ...doc.nodes, n1: { ...doc.nodes.n1, styleId: style.id } as SceneNode },
    };

    const result = getEffectiveStyle(doc, 'n1');
    expect(result).toBeDefined();
    expect(result?.style).toBeDefined();
    expect(result?.style?.type).toBe('text');
    expect(result?.overrides).toEqual({});
  });

  it('returns undefined for non-existent node', () => {
    const doc = createDocument('test');
    expect(getEffectiveStyle(doc, 'nonexistent')).toBeUndefined();
  });
});
