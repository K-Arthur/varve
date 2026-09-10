/**
 * TDD tests for the reusable style system.
 *
 * Tests cover: CRUD operations, apply/unlink, resolve, overrides,
 * style usage tracking, orphan detection, duplication.
 */
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode, makeTextNode } from './document';
import {
  applyStyleToNode,
  createColorStyle,
  createEffectStyle,
  createLayoutStyle,
  createTextStyle,
  deleteStyle,
  duplicateStyle,
  getNodesUsingStyle,
  getStylesByType,
  getUsedStyleIds,
  resolveStyle,
  resolveStyleWithOverrides,
  unlinkStyleFromNode,
  updateStyle,
} from './styles';
import type { Effect, Fill, LayoutStyle } from './types';

describe('Style System — Color Styles', () => {
  it('creates a color style with a solid fill', () => {
    const doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: newDoc } = createColorStyle(doc, 'Teal Primary', fill);

    expect(style.type).toBe('color');
    expect(style.name).toBe('Teal Primary');
    expect(style.fill.color).toEqual({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 });
    expect(newDoc.styles?.[style.id]).toBeDefined();
  });

  it('creates a color style with a gradient fill', () => {
    const doc = createDocument('test');
    const fill: Fill = {
      type: 'gradient',
      gradient: {
        type: 'linear',
        stops: [
          { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
          { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
        ],
      },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style } = createColorStyle(doc, 'Gradient Red-Blue', fill);
    expect(style.fill.type).toBe('gradient');
    expect(style.fill.gradient?.stops).toHaveLength(2);
  });

  it('creates a color style with description', () => {
    const doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style } = createColorStyle(doc, 'Black', fill, 'Primary text color');
    expect(style.description).toBe('Primary text color');
  });
});

describe('Style System — Text Styles', () => {
  it('creates a text style with all properties', () => {
    const doc = createDocument('test');
    const { style } = createTextStyle(doc, 'Heading 1', {
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 700,
      lineHeight: 1.1,
      letterSpacing: -0.02,
      textAlign: 'left',
      textCase: 'none',
    });

    expect(style.type).toBe('text');
    expect(style.name).toBe('Heading 1');
    expect(style.fontSize).toBe(48);
    expect(style.fontWeight).toBe(700);
    expect(style.fontFamily).toBe('Inter');
  });

  it('creates a text style with minimal defaults', () => {
    const doc = createDocument('test');
    const { style } = createTextStyle(doc, 'Body', { fontSize: 16 });
    expect(style.fontSize).toBe(16);
    expect(style.fontFamily).toBeUndefined();
  });
});

describe('Style System — Effect Styles', () => {
  it('creates an effect style with a drop shadow', () => {
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
    const { style } = createEffectStyle(doc, 'Card Shadow', effects);
    expect(style.type).toBe('effect');
    expect(style.effects).toHaveLength(1);
    expect(style.effects?.[0]?.type).toBe('dropShadow');
  });

  it('creates an effect style with multiple effects', () => {
    const doc = createDocument('test');
    const effects: Effect[] = [
      {
        type: 'dropShadow',
        x: 0,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 38 },
        opacity: 0.15,
        blendMode: 'normal',
        visible: true,
      },
      { type: 'layerBlur', radius: 2, visible: true },
    ];
    const { style } = createEffectStyle(doc, 'Soft Blur Shadow', effects);
    expect(style.effects).toHaveLength(2);
  });
});

describe('Style System — Layout Styles', () => {
  it('creates a layout style', () => {
    const doc = createDocument('test');
    const layout: LayoutStyle = {
      mode: 'flex',
      direction: 'column',
      gap: 16,
      padding: [0, 0, 0, 0],
      wrap: false,
      grow: 0,
      shrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    };
    const { style } = createLayoutStyle(doc, 'Centered Column', layout);
    expect(style.type).toBe('layout');
    expect(style.layout.direction).toBe('column');
    expect(style.layout.gap).toBe(16);
    expect(style.layout.alignItems).toBe('center');
  });
});

describe('Style System — Update & Delete', () => {
  it('updates a style name', () => {
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

    doc = updateStyle(doc, style.id, { name: 'Updated Teal' });
    expect(doc.styles?.[style.id]?.name).toBe('Updated Teal');
  });

  it('updates a style fill value', () => {
    let doc = createDocument('test');
    const fill1: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style, doc: d1 } = createColorStyle(doc, 'Teal', fill1);
    doc = d1;

    const fill2: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    doc = updateStyle(doc, style.id, { fill: fill2 } as Partial<typeof style>);
    const updatedStyle = doc.styles?.[style.id];
    if (!updatedStyle) throw new Error('Expected updated color style');
    expect((updatedStyle as unknown as import('./types').ColorStyle).fill.color).toEqual({
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it('clears styleId from nodes when style is deleted', () => {
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
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);
    expect(doc.nodes.n1?.styleId).toBe(style.id);

    doc = deleteStyle(doc, style.id);
    expect((doc.nodes.n1 as { styleId?: string }).styleId).toBeUndefined();
  });

  it('deletes a style', () => {
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
    expect(doc.styles?.[style.id]).toBeDefined();

    doc = deleteStyle(doc, style.id);
    expect(doc.styles?.[style.id]).toBeUndefined();
  });
});

describe('Style System — Apply & Unlink', () => {
  it('applies a color style to a shape node', () => {
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

    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);

    doc = applyStyleToNode(doc, 'n1', style.id);
    expect(doc.nodes.n1?.styleId).toBe(style.id);
  });

  it('applies a text style to a text node', () => {
    let doc = createDocument('test');
    const { style, doc: d1 } = createTextStyle(doc, 'Heading', { fontSize: 36, fontWeight: 700 });
    doc = d1;

    const text = makeTextNode('n1', 'Hello');
    doc = addNode(doc, text);

    doc = applyStyleToNode(doc, 'n1', style.id);
    expect(doc.nodes.n1?.styleId).toBe(style.id);
  });

  it('bakes resolved style values when unlinking', () => {
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
    const shape = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    );
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);

    doc = unlinkStyleFromNode(doc, 'n1');
    expect((doc.nodes.n1 as { styleId?: string }).styleId).toBeUndefined();
    expect(doc.nodes.n1?.fill).toEqual(fill.color);
  });

  it('unlinks a style from a node', () => {
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

    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = applyStyleToNode(doc, 'n1', style.id);
    expect(doc.nodes.n1?.styleId).toBe(style.id);

    doc = unlinkStyleFromNode(doc, 'n1');
    expect((doc.nodes.n1 as unknown as { styleId?: string }).styleId).toBeUndefined();
  });
});

describe('Style System — Query & Resolve', () => {
  it('resolves a style by ID', () => {
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

    const resolved = resolveStyle(doc, style.id);
    expect(resolved).toBeDefined();
    expect(resolved?.name).toBe('Teal');
  });

  it('returns undefined for non-existent style', () => {
    const doc = createDocument('test');
    expect(resolveStyle(doc, 'nonexistent')).toBeUndefined();
  });

  it('filters styles by type', () => {
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
    const { doc: d2 } = createColorStyle(doc, 'Red', {
      type: 'solid',
      color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    });
    doc = d2;
    const { doc: d3 } = createTextStyle(doc, 'Body', { fontSize: 16 });
    doc = d3;

    const colorStyles = getStylesByType(doc, 'color');
    expect(colorStyles).toHaveLength(2);

    const textStyles = getStylesByType(doc, 'text');
    expect(textStyles).toHaveLength(1);
  });
});

describe('Style System — Usage Tracking', () => {
  it('tracks which styles are used by nodes', () => {
    let doc = createDocument('test');
    const fill: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const { style: s1, doc: d1 } = createColorStyle(doc, 'Teal', fill);
    doc = d1;
    const { style: s2, doc: d2 } = createColorStyle(doc, 'Red', {
      type: 'solid',
      color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    });
    doc = d2;

    const shape1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc = addNode(doc, shape1);
    doc = addNode(doc, shape2);

    doc = applyStyleToNode(doc, 'n1', s1.id);

    const used = getUsedStyleIds(doc);
    expect(used.has(s1.id)).toBe(true);
    expect(used.has(s2.id)).toBe(false);
  });

  it('finds all nodes using a style', () => {
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

    doc = applyStyleToNode(doc, 'n1', style.id);
    doc = applyStyleToNode(doc, 'n2', style.id);

    const nodes = getNodesUsingStyle(doc, style.id);
    expect(nodes).toHaveLength(2);
    expect(nodes).toContain('n1');
    expect(nodes).toContain('n2');
  });
});

describe('Style System — Overrides & Duplicates', () => {
  it('resolves a style with overrides', () => {
    let doc = createDocument('test');
    const { style, doc: d1 } = createTextStyle(doc, 'Heading', { fontSize: 48, fontWeight: 700 });
    doc = d1;

    const resolved = resolveStyleWithOverrides(doc, style.id, { fontSize: 24 });
    expect(resolved).toBeDefined();
    if (resolved) {
      expect((resolved as import('./types').TextStyle).fontSize).toBe(24);
      expect((resolved as import('./types').TextStyle).fontWeight).toBe(700);
    }
  });

  it('returns style unchanged when no overrides', () => {
    let doc = createDocument('test');
    const { style, doc: d1 } = createTextStyle(doc, 'Body', { fontSize: 16 });
    doc = d1;

    const resolved = resolveStyleWithOverrides(doc, style.id);
    expect(resolved).toBeDefined();
    if (resolved) {
      expect((resolved as import('./types').TextStyle).fontSize).toBe(16);
    }
  });

  it('duplicates a style', () => {
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

    const result = duplicateStyle(doc, style.id);
    expect(result).toBeDefined();
    if (result) {
      expect(result.style.name).toBe('Teal Copy');
      expect(result.style.id).not.toBe(style.id);
      expect(result.doc.styles?.[result.style.id]).toBeDefined();
    }
  });

  it('returns undefined when duplicating non-existent style', () => {
    const doc = createDocument('test');
    expect(duplicateStyle(doc, 'nonexistent')).toBeUndefined();
  });
});

describe('Style System — Edge Cases', () => {
  it('handles empty styles gracefully', () => {
    const doc = createDocument('test');
    expect(getStylesByType(doc, 'color')).toHaveLength(0);
    expect(getUsedStyleIds(doc).size).toBe(0);
    expect(resolveStyle(doc, 'nonexistent')).toBeUndefined();
  });

  it('handles update on non-existent style', () => {
    const doc = createDocument('test');
    const result = updateStyle(doc, 'nonexistent', { name: 'Nope' });
    expect(result).toBe(doc);
  });

  it('handles delete on non-existent style', () => {
    const doc = createDocument('test');
    const result = deleteStyle(doc, 'nonexistent');
    expect(result).toBe(doc);
  });

  it('handles apply to non-existent node', () => {
    const doc = createDocument('test');
    const result = applyStyleToNode(doc, 'nonexistent', 's1');
    expect(result).toBe(doc);
  });

  it('handles unlink on node without style', () => {
    let doc = createDocument('test');
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addNode(doc, shape);
    doc = unlinkStyleFromNode(doc, 'n1');
    expect(doc.nodes.n1).toBeDefined();
    expect(doc.nodes.n1?.name).toBe('Shape');
  });

  it('handles unlink on non-existent node', () => {
    const doc = createDocument('test');
    const result = unlinkStyleFromNode(doc, 'nonexistent');
    expect(result).toBe(doc);
  });
});
