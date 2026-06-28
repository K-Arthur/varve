import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  hitTest,
  invertAffine,
  pointInEllipse,
  rectContains,
  scale,
  shapeContains,
  translate,
} from './geometry';
import type { SceneNode } from './types';

describe('affine', () => {
  it('translate moves a point', () => {
    expect(applyAffine(translate(10, 20), [1, 1])).toEqual([11, 21]);
  });

  it('scale multiplies', () => {
    expect(applyAffine(scale(2), [3, 5])).toEqual([6, 10]);
  });

  it('inverse round-trips a point', () => {
    const m = [2, 0, 0, 3, 10, 20] as const;
    const p = [5, 7] as const;
    const back = applyAffine(invertAffine(m), applyAffine(m, p));
    expect(back[0]).toBeCloseTo(p[0], 10);
    expect(back[1]).toBeCloseTo(p[1], 10);
  });

  it('inverse is correct for a translate', () => {
    const m = translate(10, 20);
    const back = applyAffine(m, applyAffine(invertAffine(m), [3, 4]));
    expect(back).toEqual([3, 4]);
  });
});

describe('containment', () => {
  it('rectContains is closed', () => {
    expect(rectContains(0, 0, 10, 10, [5, 5])).toBe(true);
    expect(rectContains(0, 0, 10, 10, [0, 0])).toBe(true);
    expect(rectContains(0, 0, 10, 10, [10.01, 5])).toBe(false);
  });

  it('pointInEllipse', () => {
    expect(pointInEllipse(0, 0, 10, 4, [9, 0])).toBe(true);
    expect(pointInEllipse(0, 0, 10, 4, [0, 4.5])).toBe(false);
  });

  it('shapeContains dispatches', () => {
    expect(shapeContains({ kind: 'circle', cx: 0, cy: 0, r: 5 }, [3, 3])).toBe(true);
    expect(shapeContains({ kind: 'circle', cx: 0, cy: 0, r: 5 }, [4, 4])).toBe(false);
  });
});

describe('hitTest', () => {
  const rect = (id: string, x: number, y: number): SceneNode => ({
    id,
    name: `n${id}`,
    transform: translate(x, y),
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    fill: [0, 0, 0, 255],
  });

  it('returns the topmost overlapping node', () => {
    const nodes = [rect('1', 0, 0), rect('2', 2, 2)];
    expect(hitTest(nodes, [5, 5])).toBe(1); // node 2 on top
  });

  it('returns null when nothing contains the point', () => {
    expect(hitTest([rect('1', 0, 0)], [99, 99])).toBeNull();
  });

  it('respects transforms', () => {
    const node: SceneNode = {
      id: '1',
      name: 's',
      transform: scale(2),
      shape: { kind: 'rect', x: 0, y: 0, w: 5, h: 5 },
      fill: [0, 0, 0, 255],
    };
    expect(hitTest([node], [9, 9])).toBe(0); // world 9 -> local 4.5 inside 0..5
  });
});
