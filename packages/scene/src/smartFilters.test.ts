import { describe, expect, it } from 'vitest';
import type { Adjustment } from '@varve/engine';
import {
  canHaveSmartFilters,
  cloneSmartFilters,
  makeSmartFilter,
  SMART_FILTER_KINDS,
} from './smartFilters';

describe('object-local filter model', () => {
  it('creates a meaningful full invert for the Object Filter command', () => {
    const invert = makeSmartFilter('invert-1', 'invert');
    expect(invert).toMatchObject({ id: 'invert-1', kind: 'invert', value: 100 });
  });

  it('preserves an explicit neutral override for reset and identity behavior', () => {
    expect(makeSmartFilter('invert-1', 'invert', { value: 0 })).toMatchObject({ value: 0 });
  });

  it('clones parameters deeply and mints independent filter IDs', () => {
    const source = {
      ...makeSmartFilter('curves-1', 'curves'),
      points: [
        { input: 0, output: 255 },
        { input: 255, output: 0 },
      ],
    } as Adjustment;
    const clone = cloneSmartFilters([source])[0]!;
    expect(clone.id).not.toBe(source.id);
    expect(clone).toEqual({ ...source, id: clone.id });
    if ('points' in clone && 'points' in source) {
      clone.points[0]!.output = 0.25;
      expect(clone.points).not.toBe(source.points);
      expect(source.points[0]!.output).not.toBe(0.25);
    }
  });

  it('keeps adjustment layers out of the object-local stack', () => {
    expect(canHaveSmartFilters({ kind: 'shape' })).toBe(true);
    expect(canHaveSmartFilters({ kind: 'path' })).toBe(true);
    expect(canHaveSmartFilters({ kind: 'rasterLayer' })).toBe(true);
    expect(canHaveSmartFilters({ kind: 'adjustment' })).toBe(false);
    expect(SMART_FILTER_KINDS).toContain('invert');
  });
});
