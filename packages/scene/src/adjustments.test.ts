/**
 * Tests for scene-level adjustment layer helpers.
 */

import type { Adjustment } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { adjustmentEnabledCount, makeAdjustment, visibleAdjustments } from './adjustments';
import { makeAdjustmentNode } from './document';
import type { AdjustmentNode } from './types';

function narrow<K extends Adjustment['kind']>(
  adjustment: Adjustment,
  kind: K,
): Extract<Adjustment, { kind: K }> {
  if (adjustment.kind !== kind) throw new Error(`Expected ${kind}, got ${adjustment.kind}`);
  return adjustment as Extract<Adjustment, { kind: K }>;
}

describe('makeAdjustment', () => {
  it('creates a brightness adjustment with defaults', () => {
    const a = narrow(makeAdjustment('adj1', 'brightness'), 'brightness');
    expect(a.id).toBe('adj1');
    expect(a.value).toBe(0);
    expect(a.visible).toBe(true);
    expect(a.opacity).toBe(1);
    expect(a.blendMode).toBe('normal');
  });

  it('applies overrides', () => {
    const a = narrow(
      makeAdjustment('adj2', 'contrast', { value: 40, opacity: 0.5, visible: false }),
      'contrast',
    );
    expect(a.value).toBe(40);
    expect(a.opacity).toBe(0.5);
    expect(a.visible).toBe(false);
  });

  it('creates exposure with all required fields', () => {
    const a = narrow(
      makeAdjustment('adj3', 'exposure', { value: 1.2, offset: 0.1, gammaCorrection: 0.95 }),
      'exposure',
    );
    expect(a.value).toBe(1.2);
    expect(a.offset).toBe(0.1);
    expect(a.gammaCorrection).toBe(0.95);
  });

  it('creates photo filter with default color and density', () => {
    const a = narrow(makeAdjustment('adj4', 'photoFilter'), 'photoFilter');
    expect(a.color).toEqual([255, 255, 0, 255]);
    expect(a.density).toBe(25);
    expect(a.preserveLuminosity).toBe(true);
  });
});

describe('visibleAdjustments', () => {
  it('returns only visible, non-zero opacity adjustments', () => {
    const adjustments = [
      makeAdjustment('v1', 'brightness', { value: 10 }),
      makeAdjustment('v2', 'contrast', { visible: false }),
      makeAdjustment('v3', 'saturation', { opacity: 0 }),
      makeAdjustment('v4', 'blur', { radius: 2, opacity: 0.5 }),
    ];
    const visible = visibleAdjustments(adjustments);
    expect(visible.length).toBe(2);
    expect(visible.map((a) => a.id)).toEqual(['v1', 'v4']);
  });

  it('returns empty array for empty input', () => {
    expect(visibleAdjustments([])).toEqual([]);
  });
});

describe('adjustmentEnabledCount', () => {
  it('counts enabled adjustments', () => {
    const adjustments = [
      makeAdjustment('e1', 'brightness', { value: 10 }),
      makeAdjustment('e2', 'contrast', { visible: false }),
      makeAdjustment('e3', 'blur', { radius: 2 }),
    ];
    expect(adjustmentEnabledCount(adjustments)).toBe(2);
  });
});

describe('AdjustmentNode', () => {
  it('can be constructed with a nondestructive adjustment stack', () => {
    const layer: AdjustmentNode = {
      ...makeAdjustmentNode(
        'layer1',
        'levels',
        {
          channel: 'rgb',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        },
        { name: 'Color Grade' },
      ),
      adjustments: [makeAdjustment('l1', 'brightness', { value: 10 })],
    };
    expect(layer.kind).toBe('adjustment');
    expect(layer.adjustments?.length).toBe(1);
    expect(adjustmentEnabledCount(layer.adjustments ?? [])).toBe(1);
  });
});
