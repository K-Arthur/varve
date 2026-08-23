/**
 * Unit tests for object-local smart filter stack helpers.
 *
 * Covers: makeSmartFilter, canHaveSmartFilters, cloneSmartFilters,
 * SMART_FILTER_KINDS, and the invert-preset special case.
 */

import type { Adjustment, AdjustmentKind } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import {
  activeSmartFilters,
  canHaveSmartFilters,
  cloneSmartFilters,
  makeSmartFilter,
  SMART_FILTER_KINDS,
} from './smartFilters';

function narrow<K extends Adjustment['kind']>(
  filter: Adjustment,
  kind: K,
): Extract<Adjustment, { kind: K }> {
  if (filter.kind !== kind) throw new Error(`Expected ${kind}, got ${filter.kind}`);
  return filter as Extract<Adjustment, { kind: K }>;
}

describe('SMART_FILTER_KINDS', () => {
  it('contains invert', () => {
    expect(SMART_FILTER_KINDS).toContain('invert');
  });

  it('contains all common adjustment kinds', () => {
    const expected: AdjustmentKind[] = [
      'brightness',
      'contrast',
      'saturation',
      'hueRotate',
      'grayscale',
      'invert',
      'blur',
      'posterize',
      'threshold',
      'gradientMap',
    ];
    for (const kind of expected) {
      expect(SMART_FILTER_KINDS).toContain(kind);
    }
  });
});

describe('makeSmartFilter', () => {
  it('creates a brightness filter with neutral defaults', () => {
    const f = narrow(makeSmartFilter('sf1', 'brightness'), 'brightness');
    expect(f.id).toBe('sf1');
    expect(f.kind).toBe('brightness');
    expect(f.value).toBe(0);
    expect(f.visible).toBe(true);
    expect(f.opacity).toBe(1);
    expect(f.blendMode).toBe('normal');
  });

  it('creates invert at 100% by default (command preset)', () => {
    const f = narrow(makeSmartFilter('sf2', 'invert'), 'invert');
    expect(f.value).toBe(100);
    expect(f.visible).toBe(true);
    expect(f.opacity).toBe(1);
  });

  it('invert respects explicit value override', () => {
    const f = narrow(makeSmartFilter('sf3', 'invert', { value: 50 }), 'invert');
    expect(f.value).toBe(50);
  });

  it('invert respects explicit value=0 override', () => {
    const f = narrow(makeSmartFilter('sf3b', 'invert', { value: 0 }), 'invert');
    expect(f.value).toBe(0);
  });

  it('grayscale creates with neutral default (not 100%)', () => {
    const f = narrow(makeSmartFilter('sf4', 'grayscale'), 'grayscale');
    expect(f.value).toBe(0);
  });

  it('blur creates with radius 0', () => {
    const f = narrow(makeSmartFilter('sf5', 'blur'), 'blur');
    expect(f.radius).toBe(0);
  });

  it('posterize creates with levels default', () => {
    const f = narrow(makeSmartFilter('sf6', 'posterize'), 'posterize');
    expect(f.levels).toBe(4);
  });

  it('threshold creates with level=128', () => {
    const f = narrow(makeSmartFilter('sf7', 'threshold'), 'threshold');
    expect(f.level).toBe(128);
  });

  it('applies arbitrary overrides', () => {
    const f = narrow(
      makeSmartFilter('sf8', 'brightness', { value: 25, opacity: 0.5, visible: false }),
      'brightness',
    );
    expect(f.value).toBe(25);
    expect(f.opacity).toBe(0.5);
    expect(f.visible).toBe(false);
  });

  it('preserves id when overriding', () => {
    const f = narrow(makeSmartFilter('my-id', 'contrast', { value: 30 }), 'contrast');
    expect(f.id).toBe('my-id');
  });
});

describe('canHaveSmartFilters', () => {
  it('allows shape nodes', () => {
    expect(canHaveSmartFilters({ kind: 'shape' })).toBe(true);
  });

  it('allows text nodes', () => {
    expect(canHaveSmartFilters({ kind: 'text' })).toBe(true);
  });

  it('allows frame nodes', () => {
    expect(canHaveSmartFilters({ kind: 'frame' })).toBe(true);
  });

  it('allows group nodes', () => {
    expect(canHaveSmartFilters({ kind: 'group' })).toBe(true);
  });

  it('allows rasterLayer nodes', () => {
    expect(canHaveSmartFilters({ kind: 'rasterLayer' })).toBe(true);
  });

  it('rejects adjustment nodes', () => {
    expect(canHaveSmartFilters({ kind: 'adjustment' })).toBe(false);
  });
});

describe('cloneSmartFilters', () => {
  it('produces a new array', () => {
    const src = [makeSmartFilter('c1', 'invert'), makeSmartFilter('c2', 'blur')];
    const cloned = cloneSmartFilters(src);
    expect(cloned).not.toBe(src);
    expect(cloned.length).toBe(2);
  });

  it('assigns new ids to each filter', () => {
    const src = [makeSmartFilter('c3', 'invert')];
    const cloned = cloneSmartFilters(src);
    expect(cloned[0]!.id).not.toBe('c3');
    expect(typeof cloned[0]!.id).toBe('string');
    expect(cloned[0]!.id.length).toBeGreaterThan(0);
  });

  it('preserves kind and parameters', () => {
    const src = [makeSmartFilter('c4', 'invert', { value: 75 })];
    const cloned = cloneSmartFilters(src);
    const f = narrow(cloned[0]!, 'invert');
    expect(f.kind).toBe('invert');
    expect(f.value).toBe(75);
  });

  it('preserves visible and opacity', () => {
    const src = [makeSmartFilter('c5', 'brightness', { visible: false, opacity: 0.3 })];
    const cloned = cloneSmartFilters(src);
    expect(cloned[0]!.visible).toBe(false);
    expect(cloned[0]!.opacity).toBe(0.3);
  });

  it('does not share mutable state with source', () => {
    const src = [makeSmartFilter('c6', 'brightness', { value: 10 })];
    const cloned = cloneSmartFilters(src);
    cloned[0]!.visible = false;
    expect(src[0]!.visible).toBe(true);
  });

  it('handles empty array', () => {
    expect(cloneSmartFilters([])).toEqual([]);
  });

  it('preserves filter order', () => {
    const src = [
      makeSmartFilter('c7', 'invert'),
      makeSmartFilter('c8', 'blur'),
      makeSmartFilter('c9', 'grayscale'),
    ];
    const cloned = cloneSmartFilters(src);
    expect(cloned.map((f) => f.kind)).toEqual(['invert', 'blur', 'grayscale']);
  });

  it('supports a stack-level bypass without mutating filter entries', () => {
    const filters = [makeSmartFilter('bypass-1', 'invert')];
    expect(activeSmartFilters({ smartFilters: filters })).toHaveLength(1);
    expect(activeSmartFilters({ smartFilters: filters, smartFiltersEnabled: false })).toEqual([]);
    expect(filters[0]?.visible).toBe(true);
  });
});
