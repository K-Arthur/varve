import { describe, expect, it } from 'vitest';
import {
  expandReplayDependencies,
  groupNeedsFullSubtree,
  rectsIntersectAny,
  worldRectsToScreen,
} from '../dirtyQuery';
import {
  buildParentIndexMap,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  type Document,
  type SceneNode,
} from '@strata/scene';

function buildDoc(nodes: SceneNode[], roots: string[]): Document {
  const document = createDocument('query', true);
  return {
    ...document,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootChildren: roots,
  };
}

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('rectsIntersectAny', () => {
  it('detects intersection with any of several rects', () => {
    expect(
      rectsIntersectAny(
        rect(0, 0, 10, 10),
        [rect(100, 100, 10, 10), rect(5, 5, 10, 10)],
      ),
    ).toBe(true);
    expect(rectsIntersectAny(rect(0, 0, 10, 10), [rect(20, 20, 5, 5)])).toBe(false);
  });

  it('treats edge-touching as non-intersecting', () => {
    expect(rectsIntersectAny(rect(0, 0, 10, 10), [rect(10, 0, 10, 10)])).toBe(false);
  });
});

describe('groupNeedsFullSubtree', () => {
  it('is false for plain leaf shapes', () => {
    const shape = makeShapeNode('s', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    expect(groupNeedsFullSubtree(shape)).toBe(false);
  });

  it('is false for pass-through groups', () => {
    const group = makeGroupNode('g', { children: ['a'] });
    expect(groupNeedsFullSubtree(group)).toBe(false);
  });

  it('is true for isolated groups, low opacity, blends and effects', () => {
    expect(groupNeedsFullSubtree(makeGroupNode('g', { isolated: true }))).toBe(true);
    expect(groupNeedsFullSubtree(makeGroupNode('g', { opacity: 0.5 }))).toBe(true);
    expect(groupNeedsFullSubtree(makeGroupNode('g', { blendMode: 'multiply' }))).toBe(true);
    expect(
      groupNeedsFullSubtree(
        makeGroupNode('g', {
          effects: [
            {
              type: 'dropShadow',
              x: 0,
              y: 0,
              blur: 4,
              spread: 0,
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('ignores invisible effects', () => {
    expect(
      groupNeedsFullSubtree(
        makeGroupNode('g', {
          effects: [
            {
              type: 'layerBlur',
              radius: 4,
              visible: false,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('expandReplayDependencies', () => {
  it('adds ancestors of accepted nodes', () => {
    const doc = buildDoc(
      [
        makeFrameNode('frame', { w: 100, h: 100, children: ['leaf'] }),
        makeShapeNode('leaf', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      ],
      ['frame'],
    );
    const parents = buildParentIndexMap(doc);
    const expansion = expandReplayDependencies({
      doc,
      accepted: ['leaf'],
      parentIndex: parents,
    });
    expect(expansion.replaySet.has('leaf')).toBe(true);
    expect(expansion.replaySet.has('frame')).toBe(true);
    expect(expansion.ancestorsIncluded).toBe(1);
    expect(expansion.appendIds).toContain('frame');
  });

  it('adds every ancestor level of a deep tree', () => {
    const doc = buildDoc(
      [
        makeFrameNode('f1', { w: 100, h: 100, children: ['f2'] }),
        makeFrameNode('f2', { w: 50, h: 50, children: ['f3'] }),
        makeFrameNode('f3', { w: 20, h: 20, children: ['leaf'] }),
        makeShapeNode('leaf', { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
      ],
      ['f1'],
    );
    const parents = buildParentIndexMap(doc);
    const expansion = expandReplayDependencies({
      doc,
      accepted: ['leaf'],
      parentIndex: parents,
    });
    expect(expansion.replaySet.has('f1')).toBe(true);
    expect(expansion.replaySet.has('f2')).toBe(true);
    expect(expansion.replaySet.has('f3')).toBe(true);
    expect(expansion.ancestorsIncluded).toBe(3);
  });

  it('includes the full subtree of an isolated group', () => {
    const doc = buildDoc(
      [
        makeGroupNode('g', { isolated: true, children: ['a', 'b'] }),
        makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
        makeShapeNode('b', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      ],
      ['g'],
    );
    const expansion = expandReplayDependencies({ doc, accepted: ['g'] });
    expect(expansion.replaySet.has('a')).toBe(true);
    expect(expansion.replaySet.has('b')).toBe(true);
    expect(expansion.compositingDependencies).toBe(2);
    expect(expansion.appendIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('does not pull unrelated subtrees into the replay set', () => {
    const doc = buildDoc(
      [
        makeGroupNode('g1', { children: ['a'] }),
        makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
        makeGroupNode('g2', { children: ['b'] }),
        makeShapeNode('b', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      ],
      ['g1', 'g2'],
    );
    const parents = buildParentIndexMap(doc);
    const expansion = expandReplayDependencies({
      doc,
      accepted: ['a'],
      parentIndex: parents,
    });
    expect(expansion.replaySet.has('a')).toBe(true);
    expect(expansion.replaySet.has('g1')).toBe(true);
    expect(expansion.replaySet.has('b')).toBe(false);
    expect(expansion.replaySet.has('g2')).toBe(false);
  });

  it('is deterministic across calls', () => {
    const doc = buildDoc(
      [
        makeFrameNode('f', { w: 100, h: 100, children: ['l'] }),
        makeShapeNode('l', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      ],
      ['f'],
    );
    const parents = buildParentIndexMap(doc);
    const first = expandReplayDependencies({ doc, accepted: ['l'], parentIndex: parents });
    const second = expandReplayDependencies({ doc, accepted: ['l'], parentIndex: parents });
    expect([...first.replaySet].sort()).toEqual([...second.replaySet].sort());
    expect(first.appendIds).toEqual(second.appendIds);
  });
});

describe('worldRectsToScreen', () => {
  const identity = (wx: number, wy: number): readonly [number, number] => [wx, wy];

  it('maps and clamps rects to the viewport with a margin', () => {
    const result = worldRectsToScreen(
      [rect(10, 10, 20, 20)],
      identity,
      1600,
      1000,
      40,
    );
    expect(result).toHaveLength(1);
    // floor(10 − 40) clamped to 0; ceil(30 + 40) = 70.
    expect(result[0]).toEqual({ x: 0, y: 0, w: 70, h: 70 });
  });

  it('clamps to the viewport edges', () => {
    const result = worldRectsToScreen(
      [rect(1580, 20, 100, 30)],
      identity,
      1600,
      1000,
      40,
    );
    expect(result[0]).toEqual({ x: 1540, y: 0, w: 60, h: 90 });
  });

  it('rounds outward for fractional transforms', () => {
    const fractional = (wx: number, wy: number): readonly [number, number] => [wx * 1.1, wy * 0.7];
    const result = worldRectsToScreen([rect(10.4, 7.6, 21.2, 13.4)], fractional, 1600, 1000, 0);
    // x: floor(10.4*1.1 - 0) = 11, maxX: ceil((10.4+21.2)*1.1) = ceil(34.76) = 35
    expect(result[0]).toEqual({ x: 11, y: 5, w: 24, h: 10 });
  });

  it('drops rects fully outside the viewport', () => {
    const result = worldRectsToScreen(
      [rect(-500, -500, 10, 10), rect(10, 10, 20, 20)],
      identity,
      1600,
      1000,
      40,
    );
    expect(result).toHaveLength(1);
  });
});
