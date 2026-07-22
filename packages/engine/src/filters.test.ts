/**
 * Tests for filter IR conversion and Canvas2D CSS fallback.
 */
import { describe, expect, it } from 'vitest';
import type { Adjustment, HalftoneAdjustment } from './filters';
import {
  adjustmentDefaults,
  adjustmentsToFilters,
  adjustmentToFilter,
  applyFilterChain,
  filterChainToCss,
  filterKindDisplayName,
  filterToCss,
  makeAdjustment,
  supportsCanvasFilter,
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

  it('converts halftone adjustment preserving all screening parameters', () => {
    const adjustment = makeAdjustment('a5', 'halftone', {
      pattern: 'line',
      frequency: 65,
      angle: 30,
      dotShape: 'elliptical',
      channel: 'cmyk',
      method: 'fm',
    });
    const filter = narrow(adjustmentToFilter(adjustment), 'halftone');
    expect(filter.pattern).toBe('line');
    expect(filter.frequency).toBe(65);
    expect(filter.angle).toBe(30);
    expect(filter.dotShape).toBe('elliptical');
    expect(filter.channel).toBe('cmyk');
    expect(filter.method).toBe('fm');
  });
});

describe('new adjustment kinds', () => {
  it('makeAdjustment for duotone produces fully-populated DuotoneAdjustment', () => {
    const adj = makeAdjustment('d1', 'duotone') as import('./filters').DuotoneAdjustment;
    expect(adj.kind).toBe('duotone');
    expect(adj.shadowColor).toBeDefined();
    expect(adj.highlightColor).toBeDefined();
    expect(typeof adj.shadowPoint).toBe('number');
    expect(typeof adj.intensity).toBe('number');
    const filter = narrow(adjustmentToFilter(adj), 'duotone');
    expect(filter.shadowColor).toEqual(adj.shadowColor);
  });

  it('makeAdjustment for blackAndWhite produces fully-populated BlackAndWhiteAdjustment', () => {
    const adj = makeAdjustment(
      'bw1',
      'blackAndWhite',
    ) as import('./filters').BlackAndWhiteAdjustment;
    expect(adj.kind).toBe('blackAndWhite');
    expect(typeof adj.reds).toBe('number');
    expect(typeof adj.greens).toBe('number');
    expect(typeof adj.blues).toBe('number');
    const filter = narrow(adjustmentToFilter(adj), 'blackAndWhite');
    expect(filter.reds).toBe(adj.reds);
  });

  it('makeAdjustment for posterize produces fully-populated PosterizeAdjustment', () => {
    const adj = makeAdjustment('p1', 'posterize') as import('./filters').PosterizeAdjustment;
    expect(adj.kind).toBe('posterize');
    expect(adj.levels).toBeGreaterThanOrEqual(2);
    const filter = narrow(adjustmentToFilter(adj), 'posterize');
    expect(filter.levels).toBe(adj.levels);
  });

  it('makeAdjustment for threshold produces fully-populated ThresholdAdjustment', () => {
    const adj = makeAdjustment('t1', 'threshold') as import('./filters').ThresholdAdjustment;
    expect(adj.kind).toBe('threshold');
    expect(typeof adj.level).toBe('number');
    const filter = narrow(adjustmentToFilter(adj), 'threshold');
    expect(filter.level).toBe(adj.level);
  });

  it('filterKindDisplayName shows correct names for new kinds', () => {
    expect(filterKindDisplayName('duotone')).toBe('Duotone');
    expect(filterKindDisplayName('blackAndWhite')).toBe('Black & White');
    expect(filterKindDisplayName('posterize')).toBe('Posterize');
    expect(filterKindDisplayName('threshold')).toBe('Threshold');
  });

  it('filterToCss returns null for all new kinds (no CSS equivalent)', () => {
    expect(
      filterToCss({
        kind: 'duotone',
        shadowColor: [0, 0, 0, 255],
        highlightColor: [255, 255, 255, 255],
        shadowPoint: 0.25,
        highlightPoint: 0.75,
        intensity: 1,
        preserveLuminosity: false,
        opacity: 1,
        blendMode: 'normal',
      }),
    ).toBeNull();
    expect(
      filterToCss({
        kind: 'blackAndWhite',
        reds: 40,
        yellows: 60,
        greens: 40,
        cyans: 60,
        blues: 20,
        magentas: 80,
        brightness: 0,
        preserveLuminosity: true,
        opacity: 1,
        blendMode: 'normal',
      }),
    ).toBeNull();
    expect(
      filterToCss({ kind: 'posterize', levels: 4, opacity: 1, blendMode: 'normal' }),
    ).toBeNull();
    expect(
      filterToCss({ kind: 'threshold', level: 128, opacity: 1, blendMode: 'normal' }),
    ).toBeNull();
  });
});

describe('adjustmentDefaults', () => {
  it('provides concrete halftone screening defaults (not undefined fields)', () => {
    const defaults = adjustmentDefaults('halftone') as Partial<HalftoneAdjustment>;
    expect(defaults.pattern).toBeDefined();
    expect(typeof defaults.frequency).toBe('number');
    expect(typeof defaults.angle).toBe('number');
    expect(defaults.dotShape).toBeDefined();
    expect(defaults.channel).toBeDefined();
    expect(defaults.method).toBeDefined();
  });

  it('makeAdjustment produces a fully-populated HalftoneAdjustment', () => {
    const adj = makeAdjustment('h1', 'halftone') as HalftoneAdjustment;
    expect(adj.kind).toBe('halftone');
    expect(adj.pattern).toBeDefined();
    expect(adj.frequency).toBeGreaterThan(0);
    expect(adj.dotShape).toBeDefined();
    expect(adj.channel).toBeDefined();
    expect(adj.method).toBeDefined();
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
    expect(filters[0]?.kind).toBe('brightness');
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
      opacity: 1,
      blendMode: 'normal',
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

describe('supportsCanvasFilter', () => {
  it('feature-detects the optional Canvas 2D filter property', () => {
    expect(supportsCanvasFilter({ filter: 'none' })).toBe(true);
    expect(supportsCanvasFilter({})).toBe(false);
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
