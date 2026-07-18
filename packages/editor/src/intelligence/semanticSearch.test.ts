import type { Document } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { findSimilarComponents } from './semanticSearch';

function makeRectShape(id: string, x: number, y: number, w: number, h: number) {
  return {
    id,
    name: `Rect ${id}`,
    kind: 'shape' as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number],
    visible: true,
    locked: false,
    shape: { kind: 'rect' as const, x: 0, y: 0, w, h },
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
  } satisfies import('@strata/scene').ShapeNode;
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
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
  } satisfies import('@strata/scene').ShapeNode;
}

function buildDoc(nodes: Record<string, unknown>, rootChildren: string[]): Document {
  return {
    id: 'test-doc',
    name: 'test',
    formatVersion: '2.0',
    rootChildren,
    nodes: nodes as Record<string, any>,
    components: {},
    nextId: 100,
  } as Document;
}

describe('findSimilarComponents', () => {
  it('returns similar components for a node in a duplicate group', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const doc = buildDoc({ a, b }, ['a', 'b']);

    const results = findSimilarComponents(doc, 'a');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.nodeId).toBe('b');
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.matchType).toBe('structural');
  });

  it('returns multiple matches when available', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const c = makeRectShape('c', 400, 0, 100, 100);
    const doc = buildDoc({ a, b, c }, ['a', 'b', 'c']);

    const results = findSimilarComponents(doc, 'a');
    expect(results.length).toBe(2);
    expect(results.map((r) => r.nodeId).sort()).toEqual(['b', 'c']);
  });

  it('returns empty for a node with no similar components', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeEllipseShape('b', 200, 0, 50, 50);
    const doc = buildDoc({ a, b }, ['a', 'b']);

    const results = findSimilarComponents(doc, 'a');
    expect(results.length).toBe(0);
  });

  it('returns empty when node id does not exist in document', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const doc = buildDoc({ a }, ['a']);

    const results = findSimilarComponents(doc, 'nonexistent');
    expect(results.length).toBe(0);
  });

  it('respects maxResults parameter', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const c = makeRectShape('c', 400, 0, 100, 100);
    const d = makeRectShape('d', 600, 0, 100, 100);
    const doc = buildDoc({ a, b, c, d }, ['a', 'b', 'c', 'd']);

    const results = findSimilarComponents(doc, 'a', 2);
    expect(results.length).toBe(2);
  });

  it('returns results sorted by score descending', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const c = makeRectShape('c', 400, 0, 101, 99);
    const doc = buildDoc({ a, b, c }, ['a', 'b', 'c']);

    const results = findSimilarComponents(doc, 'a');
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });

  it('is deterministic — same input returns same results', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 200, 0, 100, 100);
    const doc = buildDoc({ a, b }, ['a', 'b']);

    const r1 = findSimilarComponents(doc, 'a');
    const r2 = findSimilarComponents(doc, 'a');
    expect(r1).toEqual(r2);
  });
});
