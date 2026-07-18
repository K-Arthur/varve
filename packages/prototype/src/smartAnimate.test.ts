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

  it('buildSmartAnimateValues extracts rotation', () => {
    const nodes = {
      r1: { ...makeRect('r1', 'Box'), rotation: 0 },
      r2: { ...makeRect('r2', 'Box'), rotation: 45 },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Box' }]);
    expect(values.Box?.rotation).toEqual({ from: 0, to: 45 });
  });

  it('buildSmartAnimateValues defaults rotation to 0 when absent', () => {
    const nodes = {
      r1: { ...makeRect('r1', 'Box'), rotation: 30 },
      r2: { ...makeRect('r2', 'Box') },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Box' }]);
    expect(values.Box?.rotation).toEqual({ from: 30, to: 0 });
  });

  it('buildSmartAnimateValues extracts uniform cornerRadius', () => {
    const nodes = {
      r1: { ...makeRect('r1', 'Card'), cornerRadius: 8 },
      r2: { ...makeRect('r2', 'Card'), cornerRadius: 24 },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Card' }]);
    expect(values.Card?.cornerRadius).toEqual({ from: 8, to: 24 });
  });

  it('buildSmartAnimateValues skips cornerRadius when from is per-corner tuple', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Card'),
        cornerRadius: [4, 8, 12, 16] as [number, number, number, number],
      },
      r2: { ...makeRect('r2', 'Card'), cornerRadius: 12 },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Card' }]);
    expect(values.Card?.cornerRadius).toBeUndefined();
  });

  it('buildSmartAnimateValues extracts fill colour from fills[]', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Btn'),
        fills: [
          {
            type: 'solid' as const,
            color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
            opacity: 1,
            blendMode: 'normal' as const,
            visible: true,
          },
        ],
      },
      r2: {
        ...makeRect('r2', 'Btn'),
        fills: [
          {
            type: 'solid' as const,
            color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 },
            opacity: 1,
            blendMode: 'normal' as const,
            visible: true,
          },
        ],
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Btn' }]);
    expect(values.Btn?.fill).toEqual({ from: [255, 0, 0, 255], to: [0, 0, 255, 255] });
  });

  it('buildSmartAnimateValues extracts fill colour from legacy node.fill', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Btn'),
        fill: { space: 'rgb' as const, r: 100, g: 200, b: 50, a: 255 },
      },
      r2: {
        ...makeRect('r2', 'Btn'),
        fill: { space: 'rgb' as const, r: 50, g: 100, b: 200, a: 200 },
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Btn' }]);
    expect(values.Btn?.fill).toEqual({ from: [100, 200, 50, 255], to: [50, 100, 200, 200] });
  });

  it('buildSmartAnimateValues skips fill when non-solid fills[] present', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Img'),
        fills: [
          { type: 'image' as const, opacity: 1, blendMode: 'normal' as const, visible: true },
        ],
      },
      r2: {
        ...makeRect('r2', 'Img'),
        fills: [
          { type: 'image' as const, opacity: 1, blendMode: 'normal' as const, visible: true },
        ],
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Img' }]);
    expect(values.Img?.fill).toBeUndefined();
  });

  it('buildSmartAnimateValues extracts strokeWeight from visible strokes', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Border'),
        strokes: [
          {
            color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
            weight: 1,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'miter' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
      },
      r2: {
        ...makeRect('r2', 'Border'),
        strokes: [
          {
            color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
            weight: 3,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'miter' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Border' }]);
    expect(values.Border?.strokeWidth).toEqual({ from: 1, to: 3 });
  });

  it('buildSmartAnimateValues skips strokeWidth when no visible strokes', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Plain'),
        strokes: [
          {
            color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
            weight: 2,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'miter' as const,
            miterLimit: 4,
            visible: false,
          },
        ],
      },
      r2: {
        ...makeRect('r2', 'Plain'),
        strokes: [],
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Plain' }]);
    expect(values.Plain?.strokeWidth).toBeUndefined();
  });

  it('buildSmartAnimateValues extracts all new properties together', () => {
    const nodes = {
      r1: {
        ...makeRect('r1', 'Full'),
        opacity: 0.5,
        rotation: 10,
        cornerRadius: 4,
        fill: { space: 'rgb' as const, r: 255, g: 100, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
            weight: 2,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'miter' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
      },
      r2: {
        ...makeRect('r2', 'Full'),
        opacity: 1,
        rotation: 90,
        cornerRadius: 16,
        fill: { space: 'rgb' as const, r: 0, g: 200, b: 100, a: 200 },
        strokes: [
          {
            color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
            weight: 4,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'miter' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    };
    const values = buildSmartAnimateValues(nodes, [{ fromId: 'r1', toId: 'r2', name: 'Full' }]);
    const full = values.Full;
    expect(full?.opacity).toEqual({ from: 0.5, to: 1 });
    expect(full?.rotation).toEqual({ from: 10, to: 90 });
    expect(full?.cornerRadius).toEqual({ from: 4, to: 16 });
    expect(full?.fill).toEqual({ from: [255, 100, 0, 255], to: [0, 200, 100, 200] });
    expect(full?.strokeWidth).toEqual({ from: 2, to: 4 });
  });
});
