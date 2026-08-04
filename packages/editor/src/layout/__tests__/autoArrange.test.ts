// @ts-nocheck
import type { Document, SceneNode } from '@varve/scene';
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyAutoArrange, computeAutoArrange } from '../autoArrange';

function makeRectNode(id: string, w: number, h: number, x = 0, y = 0): SceneNode {
  return {
    id,
    name: id,
    kind: 'shape',
    transform: [1, 0, 0, 1, x, y] as const,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    fill: { space: 'rgb' as const, r: 100, g: 100, b: 200, a: 255 },
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
  };
}

function makeDoc(): Document {
  const doc = createDocument('test', true);
  const base = {
    ...doc,
    pages: [
      {
        id: 'page1',
        name: 'Page 1',
        contentRoot: doc.rootChildren[0] || 'root',
        backgrounds: [],
        width: 1920,
        height: 1080,
      },
    ],
    activePageId: 'page1',
  };
  return base;
}

describe('computeAutoArrange', () => {
  const nodes = [
    { id: 'a', width: 50, height: 50 },
    { id: 'b', width: 50, height: 50 },
    { id: 'c', width: 50, height: 50 },
    { id: 'd', width: 50, height: 50 },
  ];

  const bounds = { x: 0, y: 0, width: 400, height: 300 };

  it('grid layout produces column/row arrangement', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'grid',
      gap: 0,
      padding: 0,
    });

    expect(result.size).toBe(4);
    // 4 items in a 2x2 grid
    const coords = Array.from(result.values());
    const xs = new Set(coords.map((c) => Math.round(c.x)));
    const ys = new Set(coords.map((c) => Math.round(c.y)));
    expect(xs.size).toBe(2); // 2 columns
    expect(ys.size).toBe(2); // 2 rows
  });

  it('grid layout respects gap', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'grid',
      gap: 20,
      padding: 0,
    });

    const coords = Array.from(result.values());
    const xs = [...new Set(coords.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(70, 0); // 50 width + 20 gap
  });

  it('circle layout positions items around center', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'circle',
      gap: 0,
      padding: 0,
      radius: 100,
      startAngle: 0,
    });

    expect(result.size).toBe(4);
    for (const [, pos] of result) {
      expect(pos.rotation).toBeUndefined();
    }
  });

  it('circle layout with rotateItems produces rotations', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'circle',
      gap: 0,
      padding: 0,
      radius: 100,
      startAngle: 0,
      rotateItems: true,
    });

    expect(result.size).toBe(4);
    for (const [, pos] of result) {
      expect(pos.rotation).toBeDefined();
    }
  });

  it('flow layout with edges', () => {
    const result = computeAutoArrange(
      nodes,
      bounds,
      {
        layoutType: 'flow',
        gap: 0,
        padding: 0,
        idealLength: 80,
      },
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
      ],
    );

    expect(result.size).toBe(4);
    for (const [, pos] of result) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('flex-row lays items in a row', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'flex-row',
      gap: 10,
      padding: 0,
    });

    expect(result.size).toBe(4);
    const coords = Array.from(result.values());
    const ys = new Set(coords.map((c) => Math.round(c.y)));
    expect(ys.size).toBe(1); // all same Y in a row
  });

  it('flex-column stacks items vertically', () => {
    const result = computeAutoArrange(nodes, bounds, {
      layoutType: 'flex-column',
      gap: 10,
      padding: 0,
    });

    expect(result.size).toBe(4);
    const coords = Array.from(result.values());
    const xs = new Set(coords.map((c) => Math.round(c.x)));
    expect(xs.size).toBe(1); // all same X in a column
  });

  it('returns empty map for no nodes', () => {
    const result = computeAutoArrange([], bounds, {
      layoutType: 'grid',
      gap: 0,
      padding: 0,
    });
    expect(result.size).toBe(0);
  });
});

describe('applyAutoArrange', () => {
  it('produces new document with updated transforms', () => {
    let doc = makeDoc();
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        a: makeRectNode('a', 50, 50),
        b: makeRectNode('b', 50, 50),
        c: makeRectNode('c', 50, 50),
      },
    };

    const updated = applyAutoArrange(doc, ['a', 'b', 'c'], {
      layoutType: 'grid',
      gap: 0,
      padding: 0,
    });

    // All nodes should still exist
    expect(updated.nodes.a).toBeDefined();
    expect(updated.nodes.b).toBeDefined();
    expect(updated.nodes.c).toBeDefined();

    // Transforms should be identity with new positions
    const ta = updated.nodes.a.transform;
    expect(ta).toBeDefined();
    if (ta) {
      expect(ta[0]).toBe(1);
      expect(ta[1]).toBe(0);
      expect(ta[2]).toBe(0);
      expect(ta[3]).toBe(1);
    }
  });

  it('returns unchanged doc for empty node list', () => {
    const doc = makeDoc();
    const updated = applyAutoArrange(doc, [], {
      layoutType: 'grid',
      gap: 0,
      padding: 0,
    });
    expect(updated).toBe(doc);
  });
});
