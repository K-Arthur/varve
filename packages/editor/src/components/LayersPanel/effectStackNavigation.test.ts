import { describe, expect, it } from 'vitest';
import { getEffectStackInspectorTarget } from './effectStackNavigation';

describe('getEffectStackInspectorTarget', () => {
  it('routes Object Filters to the contextual Adjustments editor', () => {
    expect(getEffectStackInspectorTarget('object-filters')).toEqual({
      tab: 'adjustments',
      section: 'smart-filters',
      destinationLabel: 'Adjustments > Object Filters',
    });
  });

  it('routes standalone Layer Effects to the Design appearance editor', () => {
    expect(getEffectStackInspectorTarget('layer-effects')).toEqual({
      tab: 'properties',
      section: 'effects',
      destinationLabel: 'Design > Layer Effects',
    });
  });
});
