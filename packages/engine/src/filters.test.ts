/**
 * Tests for filter IR conversion and Canvas2D CSS fallback.
 */
import { describe, expect, it } from 'vitest';
import type { Adjustment } from './filters';
import {
  adjustmentsToFilters,
  adjustmentToFilter,
  applyFilterChain,
  filterChainToCss,
  filterKindDisplayName,
  filterToCss,
  makeAdjustment,
} from './filters';
import type { FilterIR } from './types';

function narrow<K extends FilterIR['kind']>(
  filter: FilterIR,
  kind: K,
): Extract<FilterIR, { kind: K }> {
  if (filter.kind !== kind) throw new Error(`Expected ${kind}, got ${filter.kind}`);
  return filter as Extract<FilterIR, { kind: K }>;
}

describe('adjustmentToFilter', () => {
  it('converts brightness adjustment to filter IR', () => {
    const adjustment = makeAdjustment('a1', 'brightness', { value: 30 });
    const filter = narrow(adjustmentToFilter(adjustment), 'brightness');
    expect(filter.value).toBe(30);
    expect(filter.opacity).toBe(1);
    expect(filter.blendMode).toBe('normal');
  });

  it('converts exposure adjustment with all parameters', () => {
    const adjustment = makeAdjustment('a2', 'exposure', {
      value: 1.5,
      offset: 0.2,
      gammaCorrection: 0.9,
    });
    const filter = narrow(adjustmentToFilter(adjustment), 'exposure');
    expect(filter.value).toBe(1.5);
    expect(filter.offset).toBe(0.2);
    expect(filter.gammaCorrection).toBe(0.9);
  });

  it('converts levels adjustment preserving channel', () => {
    const adjustment = makeAdjustment('a3', 'levels', {
      inputShadows: 10,
      inputMidtones: 1.2,
      inputHighlights: 240,
      outputShadows: 5,
      outputHighlights: 250,
      channel: 'blue',
    });
    const filter = narrow(adjustmentToFilter(adjustment), 'levels');
    expect(filter.channel).toBe('blue');
    expect(filter.inputHighlights).toBe(240);
  });

  it('converts photo filter adjustment preserving color', () => {
    const adjustment = makeAdjustment('a4', 'photoFilter', {
      color: [255, 200, 0, 255],
      density: 60,
    });
    const filter = narrow(adjustmentToFilter(adjustment), 'photoFilter');
    expect(filter.color).toEqual([255, 200, 0, 255]);
    expect(filter.density).toBe(60);
  });
});

describe('adjustmentsToFilters', () => {
  it('skips invisible adjustments', () => {
    const adjustments: Adjustment[] = [
      makeAdjustment('v1', 'brightness', { value: 20 }),
      makeAdjustment('v2', 'contrast', { visible: false }),
      makeAdjustment('v3', 'saturation', { opacity: 0 }),
    ];
    const filters = adjustmentsToFilters(adjustments);
    expect(filters.length).toBe(1);
    expect(filters[0]!.kind).toBe('brightness');
  });

  it('returns empty array for no visible adjustments', () => {
    expect(adjustmentsToFilters([])).toEqual([]);
  });
});

describe('filterToCss', () => {
  it('renders brightness as CSS brightness', () => {
    const filter = adjustmentToFilter(makeAdjustment('b1', 'brightness', { value: -20 }));
    expect(filterToCss(filter)).toBe('brightness(80%)');
  });

  it('renders contrast as CSS contrast', () => {
    const filter = adjustmentToFilter(makeAdjustment('c1', 'contrast', { value: 50 }));
    expect(filterToCss(filter)).toBe('contrast(150%)');
  });

  it('renders saturation as CSS saturate', () => {
    const filter = adjustmentToFilter(makeAdjustment('s1', 'saturation', { value: -100 }));
    expect(filterToCss(filter)).toBe('saturate(0%)');
  });

  it('renders hue rotate with deg unit', () => {
    const filter = adjustmentToFilter(makeAdjustment('h1', 'hueRotate', { value: 90 }));
    expect(filterToCss(filter)).toBe('hue-rotate(90deg)');
  });

  it('renders blur with px unit', () => {
    const filter = adjustmentToFilter(makeAdjustment('bl1', 'blur', { radius: 4 }));
    expect(filterToCss(filter)).toBe('blur(4px)');
  });

  it('returns null for adjustments without CSS equivalent', () => {
    const filter = adjustmentToFilter(makeAdjustment('e1', 'exposure', { value: 1 }));
    expect(filterToCss(filter)).toBeNull();
  });

  it('renders chain recursively', () => {
    const chain = {
      kind: 'chain' as const,
      filters: [adjustmentToFilter(makeAdjustment('b2', 'brightness', { value: 10 }))],
    };
    expect(filterToCss(chain)).toBe('brightness(110%)');
  });
});

describe('filterChainToCss', () => {
  it('composes multiple filters into a single string', () => {
    const filters = [
      adjustmentToFilter(makeAdjustment('b3', 'brightness', { value: 10 })),
      adjustmentToFilter(makeAdjustment('c3', 'contrast', { value: 20 })),
      adjustmentToFilter(makeAdjustment('e3', 'exposure', { value: 1 })), // no CSS
    ];
    expect(filterChainToCss(filters)).toBe('brightness(110%) contrast(120%)');
  });

  it('returns null when no filters are convertible', () => {
    const filters = [adjustmentToFilter(makeAdjustment('e4', 'exposure', { value: 1 }))];
    expect(filterChainToCss(filters)).toBeNull();
  });
});

describe('applyFilterChain', () => {
  it('sets filter property when chain has CSS', () => {
    const target = { filter: 'none' };
    const filters = [adjustmentToFilter(makeAdjustment('b4', 'brightness', { value: 10 }))];
    applyFilterChain(target, filters);
    expect(target.filter).toBe('brightness(110%)');
  });

  it('leaves filter property unchanged when chain has no CSS', () => {
    const target = { filter: 'none' };
    const filters = [adjustmentToFilter(makeAdjustment('e5', 'exposure', { value: 1 }))];
    applyFilterChain(target, filters);
    expect(target.filter).toBe('none');
  });
});

describe('filterKindDisplayName', () => {
  it('returns title case for simple kinds', () => {
    expect(filterKindDisplayName('brightness')).toBe('Brightness');
    expect(filterKindDisplayName('contrast')).toBe('Contrast');
  });

  it('returns multi-word names for compound kinds', () => {
    expect(filterKindDisplayName('hueRotate')).toBe('Hue Rotate');
    expect(filterKindDisplayName('selectiveColor')).toBe('Selective Color');
    expect(filterKindDisplayName('colorBalance')).toBe('Color Balance');
  });
});
