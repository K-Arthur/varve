import type { FrameNode, ShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { buildSmartAnimateValues, matchLayersByName } from './smartAnimate';

function makeFrame(id: string, name: string, children: string[]): FrameNode {
  return {
    id,
    kind: 'frame',
    name,
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    strokes: [],
    effects: [],
    children,
    w: 400,
    h: 800,
  };
}

function makeRect(id: string, name: string): ShapeNode {
  return {
    id,
    kind: 'shape',
    name,
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 10, 20],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
  };
}

describe('smartAnimate', () => {
  it('matchLayersByName pairs children with same name', () => {
    const nodes = {
      f1: makeFrame('f1', 'Screen A', ['r1']),
      f2: makeFrame('f2', 'Screen B', ['r2']),
      r1: makeRect('r1', 'Button'),
      r2: makeRect('r2', 'Button'),
    };
    const matches = matchLayersByName(nodes, 'f1', 'f2');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe('Button');
  });

  it('buildSmartAnimateValues extracts opacity and transform', () => {
    const nodes = {
      r1: { ...makeRect('r1', 'Btn'), opacity: 0.5 },
      r2: { ...makeRect('r2', 'Btn'), opacity: 1 },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Btn' }]);
    expect(values.Btn?.opacity).toEqual({ from: 0.5, to: 1 });
  });
});
