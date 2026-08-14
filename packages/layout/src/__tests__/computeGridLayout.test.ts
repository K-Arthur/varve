// @ts-nocheck
import type { Document, LayoutStyle } from '@varve/scene';
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyGridLayout, computeGridLayout, parseGridTracks } from '../computeGridLayout';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const base = createDocument('test', true);
  base.pages = [
    {
      id: 'page1',
      name: 'Page 1',
      contentRoot: base.rootChildren[0] || 'root',
      backgrounds: [],
      width: 1920,
      height: 1080,
    },
  ];
  base.activePageId = 'page1';
  return { ...base, ...overrides };
}

function makeLayoutStyle(overrides: Partial<LayoutStyle> = {}): LayoutStyle {
  return {
    mode: 'grid',
    direction: 'row',
    gap: 0,
    wrap: false,
    padding: [0, 0, 0, 0],
    grow: 0,
    shrink: 0,
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr 1fr',
    gridAutoFlow: 'row',
    ...overrides,
  };
}

function addNode(doc: Document, id: string, overrides: Record<string, unknown> = {}): Document {
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: {
        id,
        name: id,
        kind: 'shape',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
        index: 0,
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        fills: [],
        strokes: [],
        effects: [],
        ...overrides,
      },
    },
  };
}

// ── parseGridTracks ──────────────────────────────────────────────────────────

describe('parseGridTracks', () => {
  it('parses px values', () => {
    const result = parseGridTracks('100px 200px 300px', 1000, 0);
    expect(result).toEqual([100, 200, 300]);
  });

  it('parses fr values', () => {
    const result = parseGridTracks('1fr 1fr', 400, 0);
    expect(result).toEqual([200, 200]);
  });

  it('parses auto values', () => {
    const result = parseGridTracks('auto 100px', 500, 0);
    expect(result[0]).toBe(-1);
    expect(result[1]).toBe(100);
  });

  it('resolves fr units proportionally', () => {
    const result = parseGridTracks('1fr 2fr', 300, 0);
    expect(result[0]).toBeCloseTo(100);
    expect(result[1]).toBeCloseTo(200);
  });

  it('handles mixed track sizes', () => {
    const result = parseGridTracks('100px 1fr 50px 2fr', 500, 0);
    // fixed: 100 + 50 = 150, remaining = 350, fr total = 3, per fr ≈ 116.67
    expect(result[0]).toBe(100);
    expect(result[1]).toBeCloseTo(116.667, 2);
    expect(result[2]).toBe(50);
    expect(result[3]).toBeCloseTo(233.333, 2);
  });

  it('returns empty array for empty template', () => {
    expect(parseGridTracks('', 500, 0)).toEqual([]);
  });

  it('handles gap in fr resolution', () => {
    const result = parseGridTracks('1fr 1fr 1fr', 320, 10);
    // gaps: 2 * 10 = 20, remaining = 300, per fr = 100
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(100);
  });
});

// ── computeGridLayout ────────────────────────────────────────────────────────

describe('computeGridLayout', () => {
  it('places items in a simple 2x2 grid', () => {
    const doc = addNode(addNode(makeDoc(), 'a'), 'b');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle(),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle();
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // 2 cols × 2 rows grid, each cell = 200 × 100
    // item 'a' goes to (0, 0), item 'b' goes to (200, 0)
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 200, h: 100 });
    expect(result[1]).toMatchObject({ id: 'b', x: 200, y: 0, w: 200, h: 100 });
  });

  it('respects gap between cells', () => {
    const doc = addNode(addNode(makeDoc(), 'a'), 'b');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle({ gap: 10 }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ gap: 10 });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // 2 cols: (400 - 10) / 2 = 195 each, with 10px column gap
    // 2 rows: (200 - 10) / 2 = 95 each, with 10px row gap (from shared `gap`)
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 195, h: 95 });
    expect(result[1]).toMatchObject({ id: 'b', x: 205, y: 0, w: 195, h: 95 });
  });

  it('respects padding on parent', () => {
    const doc = addNode(addNode(makeDoc(), 'a'), 'b');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle({ padding: [10, 10, 10, 10] }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ padding: [10, 10, 10, 10] });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // Padding 10 all sides → usable = 380 × 180
    // 2 cols: 380 / 2 = 190 each
    // item 'a' at (10, 10), item 'b' at (200, 10)
    expect(result[0]).toMatchObject({ id: 'a', x: 10, y: 10, w: 190, h: 90 });
    expect(result[1]).toMatchObject({ id: 'b', x: 200, y: 10, w: 190, h: 90 });
  });

  it('handles explicit placement via gridPlacement', () => {
    const doc = addNode(
      addNode(makeDoc(), 'a', {
        gridPlacement: { gridColumnStart: 2, gridColumnEnd: 3, gridRowStart: 1, gridRowEnd: 2 },
      }),
      'b',
    );
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle(),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle();
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // 'a' explicitly placed at column 2, row 1
    // 2 cols each 200px → col 2 starts at x=200, spans 200
    // 2 rows each 100px → row 1 starts at y=0, spans 100
    expect(result[0]).toMatchObject({ id: 'a', x: 200, y: 0, w: 200, h: 100 });
    // 'b' auto-placed at the first available cell (col 1, row 1)
    expect(result[1]).toMatchObject({ id: 'b', x: 0, y: 0, w: 200, h: 100 });
  });

  it('auto-flows items row by row by default', () => {
    const doc = addNode(addNode(addNode(addNode(makeDoc(), 'a'), 'b'), 'c'), 'd');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 400,
          children: ['a', 'b', 'c', 'd'],
          layoutStyle: makeLayoutStyle({
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
          }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 400, ls, [
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(result).toHaveLength(4);
    // 2x2 grid: 200×200 each
    // Row 1: a(0,0), b(200,0)
    // Row 2: c(0,200), d(200,200)
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 200, h: 200 });
    expect(result[1]).toMatchObject({ id: 'b', x: 200, y: 0, w: 200, h: 200 });
    expect(result[2]).toMatchObject({ id: 'c', x: 0, y: 200, w: 200, h: 200 });
    expect(result[3]).toMatchObject({ id: 'd', x: 200, y: 200, w: 200, h: 200 });
  });

  it('handles uneven row and column counts', () => {
    const doc = addNode(addNode(addNode(makeDoc(), 'a'), 'b'), 'c');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 300,
          h: 200,
          children: ['a', 'b', 'c'],
          layoutStyle: makeLayoutStyle({
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr',
          }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 300, 200, ls, [
      'a',
      'b',
      'c',
    ]);
    expect(result).toHaveLength(3);
    // 2 cols × 1 row explicit, 3rd child flows to new implicit row
    // Cols: 150 each, Row1: 200
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 150, h: 200 });
    expect(result[1]).toMatchObject({ id: 'b', x: 150, y: 0, w: 150, h: 200 });
    // 'c' flows to row 2 (implicit) - same column size
    expect(result[2]).toMatchObject({ id: 'c', x: 0, y: 200, w: 150, h: 200 });
  });

  it('returns correct positions for fixed+fr mixed tracks', () => {
    const doc = addNode(addNode(makeDoc(), 'a'), 'b');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle({
            gridTemplateColumns: '100px 1fr',
            gridTemplateRows: '1fr',
          }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ gridTemplateColumns: '100px 1fr', gridTemplateRows: '1fr' });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // Col 1: 100px fixed, Col 2: 300px fr
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 100, h: 200 });
    expect(result[1]).toMatchObject({ id: 'b', x: 100, y: 0, w: 300, h: 200 });
  });

  it('handles empty children', () => {
    const parentId = 'parent';
    const doc = {
      ...makeDoc(),
      nodes: {
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: [],
          layoutStyle: makeLayoutStyle(),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle();
    const result = computeGridLayout(doc as unknown as Document, parentId, 400, 200, ls, []);
    expect(result).toEqual([]);
  });

  it('auto-flows in column direction', () => {
    const doc = addNode(addNode(addNode(addNode(makeDoc(), 'a'), 'b'), 'c'), 'd');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 400,
          children: ['a', 'b', 'c', 'd'],
          layoutStyle: makeLayoutStyle({
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gridAutoFlow: 'column',
          }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gridAutoFlow: 'column',
    });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 400, ls, [
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(result).toHaveLength(4);
    // 2x2 grid, col auto-flow fills column-by-column:
    // Col 1: a at (0,0), c at (0,200)
    // Col 2: b at (200,0), d at (200,200)
    // So result order = placement order = a→b→c→d
    // a placed at (col=0,row=0), b at (col=0,row=1), c at (col=1,row=0), d at (col=1,row=1)
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0 });
    expect(result[1]).toMatchObject({ id: 'b', x: 0, y: 200 });
    expect(result[2]).toMatchObject({ id: 'c', x: 200, y: 0 });
    expect(result[3]).toMatchObject({ id: 'd', x: 200, y: 200 });
  });

  it('respects separate columnGap and rowGap', () => {
    const doc = addNode(addNode(makeDoc(), 'a'), 'b');
    const parentId = 'parent';
    const docWithParent = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle({ gap: 0, columnGap: 20, rowGap: 10 }),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const ls = makeLayoutStyle({ gap: 0, columnGap: 20, rowGap: 10 });
    const result = computeGridLayout(docWithParent as unknown as Document, parentId, 400, 200, ls, [
      'a',
      'b',
    ]);
    expect(result).toHaveLength(2);
    // 2 cols: (400 - 20) / 2 = 190 each, with 20px column gap
    // Row gap = 10, so each row: (200 - 10) / 2 = 95
    expect(result[0]).toMatchObject({ id: 'a', x: 0, y: 0, w: 190, h: 95 });
    expect(result[1]).toMatchObject({ id: 'b', x: 210, y: 0, w: 190, h: 95 });
  });
});

// ── applyGridLayout ──────────────────────────────────────────────────────────

describe('applyGridLayout', () => {
  it('produces updated document with child transforms', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'a');
    doc = addNode(doc, 'b');
    const parentId = 'parent';
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Grid',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a', 'b'],
          layoutStyle: makeLayoutStyle(),
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };

    const updated = applyGridLayout(doc, parentId);
    expect(updated.nodes.a?.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(updated.nodes.b?.transform).toEqual([1, 0, 0, 1, 200, 0]);
  });

  it('returns doc unchanged when parent is not a frame', () => {
    const doc = makeDoc();
    const updated = applyGridLayout(doc, 'nonexistent');
    expect(updated).toBe(doc);
  });

  it('returns doc unchanged when parent has no layoutStyle', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'a');
    const parentId = 'parent';
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'NoLayout',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a'],
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const updated = applyGridLayout(doc, parentId);
    expect(updated).toBe(doc);
  });

  it('returns doc unchanged when layoutStyle mode is not grid', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'a');
    const parentId = 'parent';
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [parentId]: {
          id: parentId,
          name: 'Flex',
          kind: 'frame',
          transform: [1, 0, 0, 1, 0, 0] as const,
          w: 400,
          h: 200,
          children: ['a'],
          layoutStyle: { ...makeLayoutStyle(), mode: 'flex' as const },
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
          index: 0,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
        },
      },
    };
    const updated = applyGridLayout(doc, parentId);
    expect(updated).toBe(doc);
  });
});
