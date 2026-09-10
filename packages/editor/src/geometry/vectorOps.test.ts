/**
 * Unit tests for logo geometry operations (vectorOps.ts) — pure functions,
 * no editor context required.
 */

import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import { createEmptySelectionSetsData, makeShapeNode } from '@varve/scene';
import { type Affine, applyAffine, type Point } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  composeWorldTransform,
  duplicateWithTransform,
  expandStrokeNode,
  mirrorTransform,
  offsetPathNode,
  rotateAroundTransform,
  roundCornersNode,
  selectionCenter,
  shapeToPathPoints,
  simplifyPathNode,
  topmostSelected,
} from './vectorOps';

function pathShape(points: { x: number; y: number }[], closed: boolean) {
  return {
    kind: 'path' as const,
    points: points.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null })),
    closed,
    tolerance: 2,
  };
}

function strokeNode(overrides: Partial<ShapeNode> = {}): ShapeNode {
  return makeShapeNode(
    'n1',
    pathShape(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    ),
    {
      name: 'stroke path',
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 10,
          align: 'center',
          dashPattern: [],
          dashOffset: 0,
          cap: 'round',
          join: 'round',
          miterLimit: 4,
          visible: true,
        },
      ],
      ...overrides,
    },
  );
}

function baseDoc(nodes: SceneNode[]): Document {
  return {
    id: 'doc-1',
    formatVersion: '2.11',
    name: 'test',
    rootChildren: nodes.map((n) => n.id),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    components: {},
    nextId: nodes.length + 1,
    selectionSets: createEmptySelectionSetsData(),
  };
}

describe('shapeToPathPoints', () => {
  it('converts a rect to a closed 4-corner path', () => {
    const out = shapeToPathPoints({ kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    expect(out?.closed).toBe(true);
    expect(out?.points).toHaveLength(4);
    expect(out?.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(out?.points[2]).toMatchObject({ x: 10, y: 20 });
  });

  it('converts an ellipse to a closed 5-point bezier ring with handles', () => {
    const out = shapeToPathPoints({ kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 20 });
    expect(out?.closed).toBe(true);
    expect(out?.points).toHaveLength(5);
    expect(out?.points[1]?.handleIn).not.toBeNull();
    expect(out?.points[1]?.handleOut).not.toBeNull();
    expect(out?.points[4]?.handleIn).not.toBeNull();
    expect(out?.points[0]?.handleOut).toBeNull();
  });

  it('converts polygon and star to corner-only closed paths', () => {
    const poly = shapeToPathPoints({
      kind: 'polygon',
      cx: 0,
      cy: 0,
      radius: 10,
      sides: 6,
      rotation: 0,
    });
    expect(poly?.closed).toBe(true);
    expect(poly?.points).toHaveLength(6);
    expect(poly?.points.every((p) => p.handleIn === null && p.handleOut === null)).toBe(true);

    const star = shapeToPathPoints({
      kind: 'star',
      cx: 0,
      cy: 0,
      innerRadius: 5,
      outerRadius: 10,
      points: 5,
      rotation: 0,
    });
    expect(star?.points).toHaveLength(10);
  });

  it('converts line to an open 2-point path', () => {
    const out = shapeToPathPoints({ kind: 'line', from: [0, 0], to: [10, 5], tolerance: 2 });
    expect(out?.closed).toBe(false);
    expect(out?.points).toHaveLength(2);
  });

  it('passes paths through unchanged', () => {
    const shape = pathShape(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      false,
    );
    const out = shapeToPathPoints(shape);
    expect(out?.closed).toBe(false);
    expect(out?.points).toHaveLength(2);
  });
});

describe('expandStrokeNode', () => {
  it('converts stroke to a closed filled outline and clears strokes', () => {
    const node = strokeNode();
    const result = expandStrokeNode(node);
    expect(result).not.toBeNull();
    expect(result?.shape.kind).toBe('path');
    if (result?.shape.kind === 'path') {
      expect(result.shape.closed).toBe(true);
      expect(result.shape.points.length).toBeGreaterThanOrEqual(8);
    }
    expect(result?.strokes).toEqual([]);
    expect(result?.fills).toHaveLength(1);
    expect(result?.fills?.[0]?.type).toBe('solid');
    expect(result?.fills?.[0]?.color).toEqual({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 });
  });

  it('returns null when there is no stroke', () => {
    const node = { ...strokeNode(), strokes: [] };
    expect(expandStrokeNode(node)).toBeNull();
  });

  it('expands parametric shapes after converting to path', () => {
    const node = makeShapeNode(
      'n2',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      {
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            weight: 4,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'butt',
            join: 'miter',
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    );
    const result = expandStrokeNode(node);
    expect(result).not.toBeNull();
    expect(result?.shape.kind).toBe('path');
  });
});

describe('offsetPathNode', () => {
  it('expands the bounds when offset positive', () => {
    const node = strokeNode();
    const out = offsetPathNode(node, 20);
    expect(out).not.toBeNull();
    if (out?.shape.kind === 'path') {
      const xs = out.shape.points.map((p) => p.x);
      const ys = out.shape.points.map((p) => p.y);
      expect(Math.min(...xs)).toBeLessThan(0);
      expect(Math.min(...ys)).toBeLessThan(0);
      expect(Math.max(...xs)).toBeGreaterThan(100);
    }
  });

  it('contracts the bounds when offset negative', () => {
    const node = strokeNode();
    const out = offsetPathNode(node, -20);
    expect(out).not.toBeNull();
    if (out?.shape.kind === 'path') {
      const xs = out.shape.points.map((p) => p.x);
      expect(Math.min(...xs)).toBeGreaterThan(0);
    }
  });

  it('returns the same node for a zero distance', () => {
    const node = strokeNode();
    expect(offsetPathNode(node, 0)).toBe(node);
  });
});

describe('roundCornersNode', () => {
  it('rounds corners by inserting arc points on a closed path', () => {
    const node = strokeNode();
    const out = roundCornersNode(node, 15);
    expect(out).not.toBeNull();
    if (out?.shape.kind === 'path') {
      expect(out.shape.points.length).toBeGreaterThan(4);
      // Corner at (0,0) becomes an arc: points move off the sharp corner.
      expect(out.shape.points.some((p) => Math.abs(p.x) > 1e-6 || Math.abs(p.y) > 1e-6)).toBe(true);
    }
  });

  it('returns the same node for a non-positive radius', () => {
    const node = strokeNode();
    expect(roundCornersNode(node, 0)).toBe(node);
  });
});

describe('simplifyPathNode', () => {
  it('reduces point count on a noisy path', () => {
    const points = [];
    for (let i = 0; i <= 60; i++) {
      points.push({ x: i * 2, y: Math.sin(i / 3) * 5 });
    }
    const node = makeShapeNode('n3', pathShape(points, false));
    const out = simplifyPathNode(node, 3);
    expect(out).not.toBeNull();
    if (node.shape.kind === 'path' && out?.shape.kind === 'path') {
      expect(out.shape.points.length).toBeLessThan(node.shape.points.length);
    }
  });

  it('returns null for an invalid tolerance', () => {
    expect(simplifyPathNode(strokeNode(), 0)).toBeNull();
  });
});

describe('world-space transforms', () => {
  it('mirrorTransform reflects points across the vertical axis', () => {
    const m = mirrorTransform([50, 0], 'vertical');
    const [x, y] = applyAffine(m, [80, 10]);
    expect(x).toBeCloseTo(20);
    expect(y).toBeCloseTo(10);
  });

  it('mirrorTransform reflects points across the horizontal axis', () => {
    const m = mirrorTransform([0, 50], 'horizontal');
    const [, y] = applyAffine(m, [10, 80]);
    expect(y).toBeCloseTo(20);
  });

  it('rotateAroundTransform rotates points around a center', () => {
    const m = rotateAroundTransform([50, 50], 90);
    const [x, y] = applyAffine(m, [60, 50]);
    expect(x).toBeCloseTo(50);
    expect(y).toBeCloseTo(60);
  });

  it('composeWorldTransform preserves the world position through a parent chain', () => {
    const parentWorld: Affine = [1, 0, 0, 1, 100, 50];
    const own: Affine = [1, 0, 0, 1, 10, 10];
    const mirror = mirrorTransform([0, 0], 'vertical');
    const newOwn = composeWorldTransform(own, parentWorld, mirror);
    // World before: applyAffine(parentWorld, applyAffine(own, p))
    const worldBefore = applyAffine(parentWorld, applyAffine(own, [5, 5]));
    // World after: applyAffine(parentWorld, applyAffine(newOwn, p)) should be mirrored
    const worldAfter = applyAffine(parentWorld, applyAffine(newOwn, [5, 5]));
    expect(worldAfter[0]).toBeCloseTo(-worldBefore[0]);
    expect(worldAfter[1]).toBeCloseTo(worldBefore[1]);
  });
});

describe('topmostSelected', () => {
  it('filters out nodes whose ancestor is also selected', () => {
    const child = makeShapeNode('n-child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const group: SceneNode = {
      ...makeShapeNode('n-group', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      kind: 'group',
      children: [child.id],
    };
    const doc = baseDoc([group, child]);
    expect(topmostSelected(doc, ['n-group', 'n-child'])).toEqual(['n-group']);
    expect(topmostSelected(doc, ['n-child'])).toEqual(['n-child']);
  });
});

describe('duplicateWithTransform', () => {
  it('duplicates a node with a mirrored transform, preserving z-order', () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      { transform: [1, 0, 0, 1, 100, 100] },
    );
    const doc = baseDoc([node]);
    const result = duplicateWithTransform(doc, ['n1'], mirrorTransform([150, 100], 'vertical'));
    expect(result).not.toBeNull();
    const { doc: d, addedIds } = result!;
    expect(addedIds).toHaveLength(1);
    const dup = d.nodes[addedIds[0]!] as ShapeNode;
    expect(dup.id).not.toBe('n1');
    expect(dup.shape.kind).toBe(node.shape.kind);
    // Mirror through x=150: a point at world x=125 maps to 175.
    const worldPos = applyAffine(dup.transform as Affine, [25, 25]);
    expect(worldPos[0]).toBeCloseTo(175);
    expect(worldPos[1]).toBeCloseTo(125);
    // Duplicate sits directly after the source in z-order.
    expect(d.rootChildren).toEqual(['n1', addedIds[0]]);
  });

  it('duplicates a group subtree with children intact', () => {
    const child = makeShapeNode('c1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const group: SceneNode = {
      ...makeShapeNode('g1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      kind: 'group',
      children: ['c1'],
    };
    const doc = baseDoc([group, child]);
    const result = duplicateWithTransform(doc, ['g1'], mirrorTransform([5, 0], 'vertical'));
    const { doc: d, addedIds } = result!;
    const dupGroup = d.nodes[addedIds[0]!] as Extract<
      Document['nodes'][string],
      { children: string[] }
    >;
    expect(dupGroup.children).toHaveLength(1);
    const dupChild = d.nodes[dupGroup.children[0]!] as ShapeNode;
    expect(dupChild.id).not.toBe('c1');
    expect(dupChild.shape.kind).toBe('rect');
  });

  it('radial duplication creates evenly rotated copies around the center', () => {
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 100, 100] },
    );
    const doc = baseDoc([node]);
    let d = doc;
    const center = selectionCenter(doc, ['n1'])!;
    const added: string[] = [];
    for (let i = 1; i < 4; i++) {
      const r = duplicateWithTransform(d, ['n1'], rotateAroundTransform(center, (360 * i) / 4));
      d = r!.doc;
      added.push(...r!.addedIds);
    }
    expect(added).toHaveLength(3);
    // All copies share the rotation center.
    for (const id of added) {
      const dup = d.nodes[id] as ShapeNode;
      const pos = applyAffine(dup.transform as Affine, [5, 5]);
      expect(Math.hypot(pos[0] - center[0], pos[1] - center[1])).toBeCloseTo(
        Math.hypot(105 - center[0], 105 - center[1]),
        4,
      );
    }
  });
});

describe('selectionCenter', () => {
  it('returns the union center of multiple nodes', () => {
    const a = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const b = makeShapeNode('n2', { kind: 'rect', x: 20, y: 20, w: 10, h: 10 });
    const doc = baseDoc([a, b]);
    const center = selectionCenter(doc, ['n1', 'n2']);
    expect(center?.[0]).toBeCloseTo(15);
    expect(center?.[1]).toBeCloseTo(15);
  });

  it('returns null for an empty selection', () => {
    expect(selectionCenter(baseDoc([]), [])).toBeNull();
  });
});

export type { Point };
