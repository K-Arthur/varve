import type { GradientFill } from '@varve/scene';
import { linearGradientHandles, radialGradientHandles } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { moveGradientHandle } from './gradientHandleGeometry';

const bounds = { x: 20, y: 40, w: 120, h: 80 };
const explicit: GradientFill = {
  type: 'linear',
  transform: [80, 30, -20, 50, 12, 24],
  stops: [],
};

describe('moveGradientHandle', () => {
  it('moves a linear endpoint without losing the perpendicular affine basis', () => {
    const before = linearGradientHandles(explicit, bounds);
    const updated = moveGradientHandle(explicit, bounds, 'linear-start', [4, 18]);
    const after = linearGradientHandles(updated, bounds);

    expect(after.start).toEqual([4, 18]);
    expect(after.end).toEqual(before.end);
    expect(updated.transform?.slice(0, 4)).toEqual([
      before.end[0] - 4,
      before.end[1] - 18,
      -20,
      50,
    ]);
  });

  it('moves either radial axis independently and preserves the centre and other axis', () => {
    const radial: GradientFill = { ...explicit, type: 'radial' };
    const before = radialGradientHandles(radial, bounds);
    const uMoved = moveGradientHandle(radial, bounds, 'radial-u-axis', [160, 90]);
    const afterU = radialGradientHandles(uMoved, bounds);

    expect(afterU.center).toEqual(before.center);
    expect(afterU.uAxisEnd).toEqual([160, 90]);
    expect(afterU.vAxisEnd).toEqual(before.vAxisEnd);

    const vMoved = moveGradientHandle(uMoved, bounds, 'radial-v-axis', [10, 150]);
    const afterV = radialGradientHandles(vMoved, bounds);
    expect(afterV.center).toEqual(before.center);
    expect(afterV.uAxisEnd).toEqual([160, 90]);
    expect(afterV.vAxisEnd).toEqual([10, 150]);
  });

  it('materializes a legacy rotation-only gradient on direct manipulation', () => {
    const legacy: GradientFill = { type: 'linear', rotation: 30, stops: [] };
    const before = linearGradientHandles(legacy, bounds);
    const updated = moveGradientHandle(legacy, bounds, 'linear-end', [220, 80]);
    const after = linearGradientHandles(updated, bounds);

    expect(updated.transform).toBeDefined();
    expect(after.start).toEqual(before.start);
    expect(after.end).toEqual([220, 80]);
  });
});
