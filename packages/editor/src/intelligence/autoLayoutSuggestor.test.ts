// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { suggestAutoLayout } from './autoLayoutSuggestor';

function makeFrame(id: string): import('@strata/scene').FrameNode {
  return {
    id,
    name: 'Frame',
    kind: 'frame',
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    transform: [1, 0, 0, 1, 0, 0] as import('@strata/shared').Affine,
    visible: true,
    locked: false,
    children: [],
    w: 400,
    h: 300,
    clipContent: true,
  };
}

function makeShape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): import('@strata/scene').SceneNode {
  return {
    id,
    name: 'Rect',
    kind: 'shape',
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    transform: [1, 0, 0, 1, x, y] as import('@strata/shared').Affine,
    visible: true,
    locked: false,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
  } as import('@strata/scene').SceneNode;
}

function buildDoc(
  nodes: Record<string, import('@strata/scene').SceneNode>,
  rootChildren: string[],
) {
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
  } as unknown as import('@strata/scene').Document;
}

describe('suggestAutoLayout', () => {
  it('detects row alignment', () => {
    const node1 = makeShape('a', 0, 50, 100, 100);
    const node2 = makeShape('b', 120, 50, 100, 100);
    const node3 = makeShape('c', 240, 50, 100, 100);
    const doc = buildDoc({ a: node1, b: node2, c: node3 }, ['a', 'b', 'c']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2, node3], doc);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('row');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('detects column alignment', () => {
    const node1 = makeShape('a', 50, 0, 100, 100);
    const node2 = makeShape('b', 50, 120, 100, 100);
    const node3 = makeShape('c', 50, 240, 100, 100);
    const doc = buildDoc({ a: node1, b: node2, c: node3 }, ['a', 'b', 'c']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2, node3], doc);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('column');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns null for scattered children (no alignment)', () => {
    const node1 = makeShape('a', 0, 0, 50, 50);
    const node2 = makeShape('b', 300, 200, 50, 50);
    const node3 = makeShape('c', 100, 400, 50, 50);
    const doc = buildDoc({ a: node1, b: node2, c: node3 }, ['a', 'b', 'c']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2, node3], doc);
    expect(result).toBeNull();
  });

  it('returns null with single child', () => {
    const node1 = makeShape('a', 0, 0, 100, 100);
    const doc = buildDoc({ a: node1 }, ['a']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1], doc);
    expect(result).toBeNull();
  });

  it('returns null with no children', () => {
    const frame = makeFrame('f');
    const doc = buildDoc({}, []);
    const result = suggestAutoLayout(frame, [], doc);
    expect(result).toBeNull();
  });

  it('includes a reason in the suggestion', () => {
    const node1 = makeShape('a', 0, 50, 100, 100);
    const node2 = makeShape('b', 120, 50, 100, 100);
    const doc = buildDoc({ a: node1, b: node2 }, ['a', 'b']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2], doc);
    expect(result).not.toBeNull();
    expect(result!.reason.length).toBeGreaterThan(0);
  });

  it('handles approximate alignment', () => {
    const node1 = makeShape('a', 0, 50, 100, 100);
    const node2 = makeShape('b', 120, 55, 100, 100);
    const node3 = makeShape('c', 240, 48, 100, 100);
    const doc = buildDoc({ a: node1, b: node2, c: node3 }, ['a', 'b', 'c']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2, node3], doc);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('row');
  });

  it('suggests a gap value', () => {
    const node1 = makeShape('a', 0, 50, 100, 100);
    const node2 = makeShape('b', 120, 50, 100, 100);
    const doc = buildDoc({ a: node1, b: node2 }, ['a', 'b']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2], doc);
    expect(result).not.toBeNull();
    expect(result!.gap).toBeGreaterThanOrEqual(0);
    expect(result!.gap).toBe(20);
  });

  it('detects alignment axis', () => {
    const node1 = makeShape('a', 0, 50, 100, 100);
    const node2 = makeShape('b', 120, 50, 100, 100);
    const doc = buildDoc({ a: node1, b: node2 }, ['a', 'b']);
    const frame = makeFrame('f');
    const result = suggestAutoLayout(frame, [node1, node2], doc);
    expect(result).not.toBeNull();
    expect(result!.alignItems).toBe('start');
  });
});
