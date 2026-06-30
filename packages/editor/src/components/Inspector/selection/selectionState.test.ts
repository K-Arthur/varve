import type { SceneNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { commonValue, isMixed, MIXED, summarize } from './selectionState';

function shape(id: string, x: number): SceneNode {
  return {
    id,
    kind: 'shape',
    name: id,
    fill: [0, 0, 0, 255] as const,
    index: 0,
    visible: true,
    locked: false,
    shape: { kind: 'rect', x, y: 0, w: 10, h: 10 },
    transform: [1, 0, 0, 1, x, 0],
  } as unknown as SceneNode;
}
function text(id: string): SceneNode {
  return {
    id,
    kind: 'text',
    name: id,
    fill: [0, 0, 0, 255] as const,
    index: 0,
    visible: true,
    locked: false,
    text: 'hi',
    transform: [1, 0, 0, 1, 0, 0],
    fontSize: 16,
  } as unknown as SceneNode;
}

describe('summarize', () => {
  it('reports empty', () => {
    expect(summarize([]).kind).toBe('empty');
  });
  it('reports single with sharedKind', () => {
    const s = summarize([shape('a', 1)]);
    expect(s.kind).toBe('single');
    expect(s.sharedKind).toBe('shape');
  });
  it('reports multi homogeneous', () => {
    const s = summarize([shape('a', 1), shape('b', 2)]);
    expect(s.kind).toBe('multi');
    expect(s.count).toBe(2);
    expect(s.sharedKind).toBe('shape');
  });
  it('reports multi with no sharedKind when heterogeneous', () => {
    const s = summarize([shape('a', 1), text('b')]);
    expect(s.kind).toBe('multi');
    expect(s.sharedKind).toBeUndefined();
  });
});

describe('commonValue', () => {
  it('returns the common value when all agree', () => {
    const nodes = [shape('a', 5), shape('b', 5)];
    const v = commonValue(nodes, (n) => (n.kind === 'shape' ? n.transform[4] : 0));
    expect(v).toBe(5);
    expect(isMixed(v)).toBe(false);
  });
  it('returns MIXED when values differ', () => {
    const nodes = [shape('a', 5), shape('b', 9)];
    const v = commonValue(nodes, (n) => (n.kind === 'shape' ? n.transform[4] : 0));
    expect(v).toBe(MIXED);
    expect(isMixed(v)).toBe(true);
  });
  it('returns MIXED for an empty selection', () => {
    expect(commonValue([], () => 0)).toBe(MIXED);
  });
});
