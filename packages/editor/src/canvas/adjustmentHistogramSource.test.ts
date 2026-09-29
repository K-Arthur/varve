import { docCoordOf } from '@varve/engine/liveEffects';
import type { Adjustment } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  adjustmentsBeforeEntry,
  createAdjustmentSampleCoordSpace,
} from './adjustmentHistogramSource';

describe('adjustment source sample registration', () => {
  it('maps the first sample pixel through scale and halo to document space', () => {
    const coordSpace = createAdjustmentSampleCoordSpace(100, -50, 0.5, 3);

    expect(coordSpace).toEqual({
      scale: 0.5,
      originX: 0,
      originY: 0,
      regionX: 47,
      regionY: -28,
    });
    expect(docCoordOf(0, 0, coordSpace)).toEqual({ x: 94, y: -56 });
  });
});

function adjustment(id: string, kind: Adjustment['kind']): Adjustment {
  return {
    id,
    kind,
    value: 0,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
  } as Adjustment;
}

describe('adjustmentsBeforeEntry', () => {
  it('returns only the ordered upstream entries for a selected stage', () => {
    const first = adjustment('first', 'brightness');
    const second = adjustment('second', 'levels');
    const third = adjustment('third', 'curves');
    const node = { adjustments: [first, second, third] };

    expect(adjustmentsBeforeEntry(node, 'third')).toEqual([first, second]);
    expect(adjustmentsBeforeEntry(node, 'first')).toEqual([]);
  });

  it('does not invent an upstream stage for a missing or unset entry', () => {
    const first = adjustment('first', 'brightness');
    const node = { adjustments: [first] };

    expect(adjustmentsBeforeEntry(node)).toEqual([]);
    expect(adjustmentsBeforeEntry(node, 'missing')).toEqual([]);
  });
});
