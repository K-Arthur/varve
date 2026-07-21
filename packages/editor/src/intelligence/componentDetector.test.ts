// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { findDuplicateStructures } from './componentDetector';

function makeRectShape(id: string, x: number, y: number, w: number, h: number, r = 0) {
  return {
    id,
    name: `Rect ${id}`,
    kind: 'shape' as const,
    fill: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
    transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number],
    visible: true,
    locked: false,
    shape: { kind: 'rect' as const, x: 0, y: 0, w, h, cornerRadius: r },
  };
}

function makeEllipseShape(id: string, cx: number, cy: number, rx: number, ry: number) {
  return {
    id,
    name: `Ellipse ${id}`,
    kind: 'shape' as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 },
    transform: [1, 0, 0, 1, cx, cy] as [number, number, number, number, number, number],
    visible: true,
    locked: false,
    shape: { kind: 'ellipse' as const, cx: 0, cy: 0, rx, ry },
  };
}

function buildDoc(nodes: Record<string, unknown>, rootChildren: string[]) {
  return {
    name: 'test',
    canvasWidth: 1920,
    canvasHeight: 1080,
    nodes,
    rootChildren,
    version: '2.0',
    components: {},
    interactions: [],
    interactionsVersion: 0,
    id: 'test-doc',
    formatVersion: '2.0',
    nextId: 1,
  };
}

describe('findDuplicateStructures', () => {
  it('finds exact duplicates', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const doc = buildDoc({ a, b }, ['a', 'b']);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0]!.nodeIds.length).toBe(2);
  });

  it('finds dimension-similar nodes', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 102, 98);
    const doc = buildDoc({ a, b }, ['a', 'b']);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it('does not match different kind', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeEllipseShape('b', 200, 0, 50, 50);
    const doc = buildDoc({ a, b }, ['a', 'b']);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBe(0);
  });

  it('groups multiple similar nodes', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const c = makeRectShape('c', 400, 0, 100, 100);
    const doc = buildDoc({ a, b, c }, ['a', 'b', 'c']);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0]!.nodeIds.length).toBe(3);
  });

  it('suggests component for 3+ matches', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const c = makeRectShape('c', 400, 0, 100, 100);
    const doc = buildDoc({ a, b, c }, ['a', 'b', 'c']);
    const groups = findDuplicateStructures(doc);
    expect(groups[0]!.suggestComponent).toBe(true);
  });

  it('does not suggest component for 2 matches', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const doc = buildDoc({ a, b }, ['a', 'b']);
    const groups = findDuplicateStructures(doc);
    if (groups.length > 0) {
      expect(groups[0]!.suggestComponent).toBe(false);
    }
  });

  it('returns empty for no duplicates', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const doc = buildDoc({ a }, ['a']);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBe(0);
  });

  it('returns empty for empty document', () => {
    const doc = buildDoc({}, []);
    const groups = findDuplicateStructures(doc);
    expect(groups.length).toBe(0);
  });
});
