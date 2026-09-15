import type { Document, FrameNode, ShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { classifyLayout } from './layoutClassifier';

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
  } satisfies ShapeNode;
}

function makeFrame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  children: string[],
): FrameNode {
  return {
    id,
    name: `Frame ${id}`,
    kind: 'frame',
    transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number],
    w,
    h,
    children,
    fill: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    strokes: [],
    effects: [],
  };
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

describe('classifyLayout', () => {
  it('detects list layout for vertically stacked children with similar widths', () => {
    const childA = makeRectShape('a', 0, 0, 200, 50);
    const childB = makeRectShape('b', 0, 60, 200, 50);
    const childC = makeRectShape('c', 0, 120, 200, 50);
    const frame = makeFrame('f', 0, 0, 200, 200, ['a', 'b', 'c']);
    const doc = buildDoc({ f: frame, a: childA, b: childB, c: childC }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('list');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.features.childCount).toBe(3);
  });

  it('detects card-grid for children arranged in a grid pattern', () => {
    const card1 = makeRectShape('c1', 0, 0, 100, 100);
    const card2 = makeRectShape('c2', 110, 0, 100, 100);
    const card3 = makeRectShape('c3', 0, 110, 100, 100);
    const card4 = makeRectShape('c4', 110, 110, 100, 100);
    const frame = makeFrame('f', 0, 0, 300, 300, ['c1', 'c2', 'c3', 'c4']);
    const doc = buildDoc({ f: frame, c1: card1, c2: card2, c3: card3, c4: card4 }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('card-grid');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.features.alignment).toBe('grid');
  });

  it('detects hero layout with one large prominent child at top', () => {
    const hero = makeRectShape('hero', 0, 0, 500, 300);
    const sub = makeRectShape('sub', 0, 310, 500, 50);
    const frame = makeFrame('f', 0, 0, 500, 400, ['hero', 'sub']);
    const doc = buildDoc({ f: frame, hero, sub }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('hero');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects sidebar layout with a narrow vertical child', () => {
    const main = makeRectShape('main', 150, 0, 350, 400);
    const side = makeRectShape('side', 0, 0, 140, 400);
    const frame = makeFrame('f', 0, 0, 500, 400, ['side', 'main']);
    const doc = buildDoc({ f: frame, main, side }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('sidebar');
  });

  it('returns freeform for random unaligned children', () => {
    const a = makeRectShape('a', 10, 10, 50, 80);
    const b = makeRectShape('b', 200, 10, 30, 30);
    const c = makeRectShape('c', 10, 200, 100, 20);
    const frame = makeFrame('f', 0, 0, 300, 300, ['a', 'b', 'c']);
    const doc = buildDoc({ f: frame, a, b, c }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('freeform');
  });

  it('returns freeform for empty frame', () => {
    const frame = makeFrame('f', 0, 0, 200, 200, []);
    const doc = buildDoc({ f: frame }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('freeform');
  });

  it('returns freeform for single child', () => {
    const child = makeRectShape('c', 0, 0, 100, 100);
    const frame = makeFrame('f', 0, 0, 200, 200, ['c']);
    const doc = buildDoc({ f: frame, c: child }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.type).toBe('freeform');
  });

  it('populates features correctly', () => {
    const a = makeRectShape('a', 0, 0, 100, 100);
    const b = makeRectShape('b', 0, 110, 100, 100);
    const frame = makeFrame('f', 0, 0, 200, 300, ['a', 'b']);
    const doc = buildDoc({ f: frame, a, b }, ['f']);

    const result = classifyLayout(frame, doc);
    expect(result.features.childCount).toBe(2);
    expect(result.features.aspectRatios.length).toBe(2);
    expect(result.features.aspectRatios.every((r) => r > 0)).toBe(true);
  });

  it('is deterministic — same layout always returns same classification', () => {
    const a = makeRectShape('a', 0, 0, 200, 50);
    const b = makeRectShape('b', 0, 60, 200, 50);
    const frame = makeFrame('f', 0, 0, 200, 200, ['a', 'b']);
    const doc = buildDoc({ f: frame, a, b }, ['f']);

    const r1 = classifyLayout(frame, doc);
    const r2 = classifyLayout(frame, doc);
    expect(r1).toEqual(r2);
  });
});
