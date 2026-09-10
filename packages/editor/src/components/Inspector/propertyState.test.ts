import { describe, expect, it } from 'vitest';
import {
  classifySelectionProperty,
  describePropertyState,
  samePropertyValue,
} from './propertyState';

describe('classifySelectionProperty', () => {
  it('keeps a shared value as common', () => {
    expect(classifySelectionProperty([12, 12])).toEqual({
      kind: 'common',
      value: 12,
      applicableCount: 2,
    });
  });

  it('treats signed zero as the same numeric value', () => {
    expect(classifySelectionProperty([-0, 0])).toEqual({
      kind: 'common',
      value: -0,
      applicableCount: 2,
    });
  });

  it('reports mixed values without retaining a large values array', () => {
    const state = classifySelectionProperty([12, 24, 36]);
    expect(state).toEqual({
      kind: 'mixed',
      representative: 12,
      applicableCount: 3,
      distinctCount: 3,
    });
    expect('values' in state).toBe(false);
  });

  it('distinguishes unset and unavailable', () => {
    expect(classifySelectionProperty([undefined, undefined])).toEqual({
      kind: 'unset',
      applicableCount: 2,
    });
    expect(classifySelectionProperty([])).toEqual({
      kind: 'unavailable',
      reason: 'No selected objects support this property',
      applicableCount: 0,
      totalCount: 0,
    });
  });

  it('reports partial applicability and its selection scope', () => {
    const state = classifySelectionProperty([12], { totalCount: 3 });
    expect(state).toEqual({
      kind: 'partially-applicable',
      representative: 12,
      applicableCount: 1,
      totalCount: 3,
      mixed: false,
    });
    expect(describePropertyState(state)).toBe('1 of 3 selected objects support this property');
  });
});

describe('property-state equality', () => {
  it('compares nested arrays and records structurally', () => {
    expect(
      samePropertyValue({ stops: [1, { offset: 0.5 }] }, { stops: [1, { offset: 0.5 }] }),
    ).toBe(true);
    expect(samePropertyValue({ stops: [1] }, { stops: [2] })).toBe(false);
  });
});
