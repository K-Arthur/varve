import { describe, expect, it } from 'vitest';
import type { Document, FrameNode, SceneNode } from './types';
import { effectivePaintOrder } from './paintOrder';

function makeFrame(children: string[], overlapOrder: 'firstOnTop'): FrameNode {
  return {
    id: 'frame', kind: 'frame', name: 'Frame', order: 'a0', index: 0,
    transform: [1, 0, 0, 1, 0, 0], w: 100, h: 100, children,
    layoutStyle: { mode: 'flex', direction: 'row', gap: -10, wrap: false, padding: [0, 0, 0, 0], grow: 0, shrink: 1, overlapOrder },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, fills: [], strokes: [], effects: [],
    opacity: 1, blendMode: 'normal', rotation: 0, visible: true, locked: false,
  } as FrameNode;
}

function child(id: string, layoutPosition?: SceneNode['layoutPosition']): SceneNode {
  return {
    id, kind: 'shape', name: id, order: 'a0', index: 0,
    transform: [1, 0, 0, 1, 0, 0], shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, fills: [], strokes: [], effects: [],
    opacity: 1, blendMode: 'normal', rotation: 0, visible: true, locked: false, layoutPosition,
  } as SceneNode;
}

describe('effectivePaintOrder', () => {
  it('reverses flow participants in place without moving absolute children', () => {
    const frame = makeFrame(['a', 'absolute', 'b'], 'firstOnTop');
    const doc = { nodes: { frame, a: child('a'), absolute: child('absolute', 'absolute'), b: child('b') } } as unknown as Document;
    expect(effectivePaintOrder(doc, frame)).toEqual(['b', 'absolute', 'a']);
  });

  it('keeps legacy order by default', () => {
    const frame = { ...makeFrame(['a', 'b'], 'firstOnTop'), layoutStyle: { ...makeFrame(['a', 'b'], 'firstOnTop').layoutStyle, overlapOrder: undefined } };
    const doc = { nodes: { frame, a: child('a'), b: child('b') } } as unknown as Document;
    expect(effectivePaintOrder(doc, frame)).toEqual(['a', 'b']);
  });
});
