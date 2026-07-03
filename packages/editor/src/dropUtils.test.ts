import type { SceneNode, ShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { applyDropPosition } from './dropUtils';

function makeRectNode(overrides?: Partial<ShapeNode>): SceneNode {
  return {
    id: 'test',
    kind: 'shape',
    name: 'Rect',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 100, 200] as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    fill: [0, 0, 0, 1] as const,
    fills: [],
    strokes: [],
    effects: [],
    ...overrides,
  } as SceneNode;
}

describe('applyDropPosition', () => {
  it('offsets a node transform by the given world position', () => {
    const node = makeRectNode();
    const result = applyDropPosition(node, { x: 300, y: 400 });
    // local bounds center was at (25, 25) transformed by [1,0,0,1,100,200] → world (125, 225)
    // offset = (300, 400) - (125, 225) = (175, 175)
    // new transform = [1, 0, 0, 1, 100 + 175, 200 + 175] = [1, 0, 0, 1, 275, 375]
    expect(result.transform[4]).toBeCloseTo(275);
    expect(result.transform[5]).toBeCloseTo(375);
  });

  it('returns the same node when no position is given', () => {
    const node = makeRectNode();
    const result = applyDropPosition(node, undefined);
    expect(result).toBe(node);
  });

  it('handles frame nodes', () => {
    const node = {
      id: 'frame1',
      kind: 'frame',
      name: 'Frame',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 50, 60] as const,
      children: ['child1'],
      w: 200,
      h: 160,
      fill: [0, 0, 0, 1] as const,
      fills: [],
      strokes: [],
      effects: [],
    } as SceneNode;
    const result = applyDropPosition(node, { x: 0, y: 0 });
    // center was (150, 140), offset = (0, 0) - (150, 140) = (-150, -140)
    // new transform = [1, 0, 0, 1, 50 - 150, 60 - 140] = [1, 0, 0, 1, -100, -80]
    expect(result.transform[4]).toBeCloseTo(-100);
    expect(result.transform[5]).toBeCloseTo(-80);
  });

  it('handles text nodes', () => {
    const node = {
      id: 'text1',
      kind: 'text',
      name: 'Text',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 200, 200] as const,
      text: 'Hello',
      fontSize: 16,
      fontFamily: 'Inter',
      fill: [0, 0, 0, 1] as const,
      fills: [],
      strokes: [],
      effects: [],
    } as SceneNode;
    const result = applyDropPosition(node, { x: 500, y: 500 });
    // offset from current center to new position
    expect(result.transform[4]).not.toBe(200);
    expect(result.transform[5]).not.toBe(200);
  });
});
