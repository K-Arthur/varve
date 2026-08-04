import type { FrameNode, SceneNode } from '@varve/scene';
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
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
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
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
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

  it('wraps to next row when children exceed frame width', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: true,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    // Two 250-wide children don't fit in 400-wide frame → second wraps
    const children: SceneNode[] = [makeChild('c1', 0, 0, 250, 50), makeChild('c2', 0, 0, 250, 50)];
    const results = computeFlexLayout(frame, children);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'c1', x: 0, y: 0 });
    expect(results[1]).toMatchObject({ id: 'c2', x: 0, y: 50 });
  });

  it('alignItems center centers children on cross axis', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
      alignItems: 'center',
    });
    const children: SceneNode[] = [makeChild('c1', 0, 0, 100, 40)];
    const results = computeFlexLayout(frame, children);
    // Frame is 200h, child is 40h → center at (200-40)/2 = 80
    expect(results[0]).toMatchObject({ id: 'c1', y: 80 });
  });

  it('justifyContent center centers children on primary axis', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
      justifyContent: 'center',
    });
    const children: SceneNode[] = [makeChild('c1', 0, 0, 100, 50)];
    const results = computeFlexLayout(frame, children);
    // Frame is 400w, child is 100w → center at (400-100)/2 = 150
    expect(results[0]).toMatchObject({ id: 'c1', x: 150 });
  });

  it('uses font-size-based text sizing instead of hardcoded 120x32', () => {
    const textNode: SceneNode = {
      id: 't1',
      name: 'Text',
      kind: 'text',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      text: 'Hello World',
      fontSize: 24,
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal',
      strokes: [],
      effects: [],
    };
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    const results = computeFlexLayout(frame, [textNode]);
    // fontSize 24 * text length 11 * 0.6 ≈ 158
    expect(results[0]?.w).toBeGreaterThan(100);
    expect(results[0]?.h).toBeCloseTo(24 * 1.4, 0);
  });

  it('layoutSizing fill distributes remaining space proportionally', () => {
    const frame = makeFrame({
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    const child1 = makeChild('c1', 0, 0, 100, 50);
    child1.layoutSizing = 'fill';
    const child2 = makeChild('c2', 0, 0, 100, 50);
    child2.layoutSizing = 'fill';
    const results = computeFlexLayout(frame, [child1, child2]);
    // Two fill children in 400px → each gets 200px
    expect(results[0]?.w).toBe(200);
    expect(results[1]?.w).toBe(200);
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
