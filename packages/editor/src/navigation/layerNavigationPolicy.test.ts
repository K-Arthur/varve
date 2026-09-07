import { describe, expect, it } from 'vitest';
import { automaticNavigationForLayerActivation } from './layerNavigationPolicy';

describe('automaticNavigationForLayerActivation', () => {
  it.each([
    ['select-only', null],
    ['reveal', 'reveal'],
    ['center', 'center'],
    ['fit', 'fit'],
  ] as const)('maps %s single activation to %s', (mode, expected) => {
    expect(automaticNavigationForLayerActivation(mode, 'single')).toBe(expected);
  });

  it.each(['modifier', 'range', 'focus'] as const)(
    'does not navigate during %s interactions',
    (activation) => {
      expect(automaticNavigationForLayerActivation('fit', activation)).toBeNull();
    },
  );
});
