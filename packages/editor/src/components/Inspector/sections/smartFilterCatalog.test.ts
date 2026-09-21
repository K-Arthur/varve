import { SMART_FILTER_KINDS } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  blendModeDisplayName,
  buildSmartFilterGroups,
  filterKindIcon,
  SMART_FILTER_GROUPS,
} from './smartFilterCatalog';

describe('smartFilterCatalog', () => {
  it('includes all SMART_FILTER_KINDS across categorized groups', () => {
    const allOptionValues = SMART_FILTER_GROUPS.flatMap((group) =>
      group.options.map((opt) => opt.value),
    );

    for (const kind of SMART_FILTER_KINDS) {
      expect(allOptionValues).toContain(kind);
    }
    expect(allOptionValues.length).toBe(SMART_FILTER_KINDS.length);
  });

  it('has non-empty groups with valid labels', () => {
    expect(SMART_FILTER_GROUPS.length).toBeGreaterThanOrEqual(5);
    for (const group of SMART_FILTER_GROUPS) {
      expect(group.label).toBeTruthy();
      expect(group.options.length).toBeGreaterThan(0);
      for (const opt of group.options) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
      }
    }
  });

  it('returns appropriate icon for kinds', () => {
    expect(filterKindIcon('blur')).toBe('CloudFog');
    expect(filterKindIcon('sharpen')).toBe('Crosshair');
    expect(filterKindIcon('grain')).toBe('GridFour');
    expect(filterKindIcon('softBloom')).toBe('Flower');
    expect(filterKindIcon('gradientMap')).toBe('ChartLineUp');
    expect(filterKindIcon('blackAndWhite')).toBe('StarHalf');
  });

  it('formats blend modes accurately', () => {
    expect(blendModeDisplayName('normal')).toBe('Normal');
    expect(blendModeDisplayName('multiply')).toBe('Multiply');
    expect(blendModeDisplayName('screen')).toBe('Screen');
    expect(blendModeDisplayName('overlay')).toBe('Overlay');
    expect(blendModeDisplayName('colorDodge')).toBe('Color Dodge');
    expect(blendModeDisplayName('softLight')).toBe('Soft Light');
  });

  it('handles unknown remainder kinds cleanly in buildSmartFilterGroups', () => {
    const custom = buildSmartFilterGroups(['blur', 'unknownFutureEffect' as never]);
    const values = custom.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain('blur');
    expect(values).toContain('unknownFutureEffect');
    const remainderGroup = custom.find((g) => g.label === 'Other Effects');
    expect(remainderGroup?.options.map((o) => o.value)).toContain('unknownFutureEffect');
  });
});
