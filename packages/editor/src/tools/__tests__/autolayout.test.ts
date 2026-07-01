import type { FrameNode, SceneNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeFlexLayout } from '../../layout/computeFlexLayout';

function makeFrame(layoutStyle: FrameNode['layoutStyle']): FrameNode {
  return {
    id: 'frame1',
    name: 'Frame',
    kind: 'frame',
    transform: [1, 0, 0, 1, 0, 0],
    w: 400,
    h: 200,
    children: ['c1', 'c2'],
    layoutStyle,
    fill: [0, 0, 0, 1],
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    strokes: [],
    effects: [],
  };
}

function makeChild(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    id,
    name: id,
    kind: 'shape',
    transform: [1, 0, 0, 1, x, y],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    fill: [0, 0, 0, 1],
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fills: [],
    strokes: [],
    effects: [],
    cornerRadius: 0,
  };
}

describe('computeFlexLayout', () => {
  it('lays out row children sequentially with gap', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 10,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    const children: SceneNode[] = [makeChild('c1', 0, 0, 100, 100), makeChild('c2', 0, 0, 80, 100)];
    const results = computeFlexLayout(frame, children);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'c1', x: 0, y: 0 });
    expect(results[1]).toMatchObject({ id: 'c2', x: 110, y: 0 });
  });

  it('lays out column children sequentially with gap', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'column',
      gap: 8,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    const children: SceneNode[] = [makeChild('c1', 0, 0, 100, 60), makeChild('c2', 0, 0, 100, 40)];
    const results = computeFlexLayout(frame, children);
    expect(results[0]).toMatchObject({ id: 'c1', y: 0 });
    expect(results[1]).toMatchObject({ id: 'c2', y: 68 });
  });

  it('respects padding in row layout', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [5, 5, 5, 10],
      grow: 0,
      shrink: 0,
    });
    const children: SceneNode[] = [makeChild('c1', 0, 0, 100, 100)];
    const results = computeFlexLayout(frame, children);
    expect(results[0]).toMatchObject({ id: 'c1', x: 10, y: 5 });
  });

  it('returns empty array for frame with no layoutStyle', () => {
    const frame = makeFrame(undefined);
    const results = computeFlexLayout(frame, [makeChild('c1', 0, 0, 100, 100)]);
    expect(results).toHaveLength(0);
  });

  it('returns empty array for empty children list', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 10,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    const results = computeFlexLayout(frame, []);
    expect(results).toHaveLength(0);
  });
});
