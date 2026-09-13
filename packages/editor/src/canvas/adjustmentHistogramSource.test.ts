import type { Adjustment } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { adjustmentsBeforeEntry } from './adjustmentHistogramSource';

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
