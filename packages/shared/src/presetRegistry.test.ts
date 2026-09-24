import { describe, expect, it } from 'vitest';
import { ratioValue } from './presetAspectRatio';
import {
  BLANK_DOCUMENT_PRESET,
  BUILTIN_PRESET_GROUPS,
  builtinCategories,
  findBuiltinPreset,
  findMatchingPreset,
  flattenBuiltinPresets,
} from './presetRegistry';

describe('BUILTIN_PRESET_GROUPS', () => {
  it('has positive, finite width/height for every preset', () => {
    for (const preset of flattenBuiltinPresets()) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
      expect(Number.isFinite(preset.width)).toBe(true);
      expect(Number.isFinite(preset.height)).toBe(true);
    }
  });

  it('has unique ids across the entire registry, including the blank preset', () => {
    const ids = [BLANK_DOCUMENT_PRESET, ...flattenBuiltinPresets()].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset belongs to the group category it is nested under', () => {
    for (const group of BUILTIN_PRESET_GROUPS) {
      for (const preset of group.presets) {
        expect(preset.category).toBe(group.category);
      }
    }
  });

  it('presets with a fixed aspect ratio have one consistent with their width/height', () => {
    for (const preset of flattenBuiltinPresets()) {
      if (!preset.aspectRatio) continue;
      const expected = preset.width / preset.height;
      expect(ratioValue(preset.aspectRatio)).toBeCloseTo(expected, 4);
    }
  });

  it('has at least one group per curated category, none empty', () => {
    for (const group of BUILTIN_PRESET_GROUPS) {
      expect(group.presets.length).toBeGreaterThan(0);
    }
  });

  it('web breakpoints have no fixed aspect ratio and "any" orientation', () => {
    const webGroup = BUILTIN_PRESET_GROUPS.find((g) => g.category === 'web');
    expect(webGroup).toBeDefined();
    for (const preset of webGroup?.presets ?? []) {
      expect(preset.aspectRatio).toBeUndefined();
      expect(preset.orientation).toBe('any');
    }
  });

  it('paper presets stay generic (no forced dpi/colorMode/bleed), unlike print presets', () => {
    const paperGroup = BUILTIN_PRESET_GROUPS.find((g) => g.category === 'paper');
    const printGroup = BUILTIN_PRESET_GROUPS.find((g) => g.category === 'print');
    for (const preset of paperGroup?.presets ?? []) {
      expect(preset.dpi).toBeUndefined();
      expect(preset.colorMode).toBeUndefined();
      expect(preset.bleed).toBeUndefined();
    }
    for (const preset of printGroup?.presets ?? []) {
      expect(preset.dpi).toBeDefined();
      expect(preset.colorMode).toBe('cmyk');
      expect(preset.bleed).toBeDefined();
    }
  });

  it('comic presets describe page/strip defaults without pretending to be panel layouts', () => {
    const comicGroup = BUILTIN_PRESET_GROUPS.find((g) => g.category === 'comic');
    expect(comicGroup?.label).toBe('Comic pages & strips');
    expect(comicGroup?.presets.map((preset) => preset.id)).toEqual([
      'comic-print-a4',
      'manga-a5',
      'webtoon-vertical',
    ]);
    expect(findBuiltinPreset('comic-print-a4')?.description).toContain('print comics');
    expect(findBuiltinPreset('manga-a5')?.description).toContain('right-to-left');
    expect(findBuiltinPreset('webtoon-vertical')?.description).toContain('slice');
  });

  it('the one non-square-pixel video preset carries a pixelAspectRatio != 1', () => {
    const ntsc = findBuiltinPreset('video-ntsc-dv');
    expect(ntsc?.pixelAspectRatio).toBeDefined();
    expect(ntsc?.pixelAspectRatio).not.toBe(1);
  });
});

describe('BLANK_DOCUMENT_PRESET', () => {
  it('is a standalone rgb preset, not part of any group', () => {
    expect(BLANK_DOCUMENT_PRESET.category).toBe('blank');
    for (const group of BUILTIN_PRESET_GROUPS) {
      expect(group.presets.some((p) => p.id === BLANK_DOCUMENT_PRESET.id)).toBe(false);
    }
  });
});

describe('findBuiltinPreset', () => {
  it('finds a preset nested in a group', () => {
    expect(findBuiltinPreset('ig-post')?.name).toBe('Instagram Post');
  });

  it('finds the standalone blank preset', () => {
    expect(findBuiltinPreset('blank')).toBe(BLANK_DOCUMENT_PRESET);
  });

  it('returns undefined for an unknown id', () => {
    expect(findBuiltinPreset('does-not-exist')).toBeUndefined();
  });
});

describe('builtinCategories', () => {
  it('lists one category per group, in group order', () => {
    expect(builtinCategories()).toEqual(BUILTIN_PRESET_GROUPS.map((g) => g.category));
  });
});

describe('findMatchingPreset', () => {
  it('matches portrait dimensions exactly', () => {
    const match = findMatchingPreset(393, 852);
    expect(match).not.toBeNull();
    expect(match?.preset.id).toBe('iphone-16');
    expect(match?.isLandscape).toBe(false);
  });

  it('matches transposed landscape dimensions', () => {
    const match = findMatchingPreset(852, 393);
    expect(match).not.toBeNull();
    expect(match?.preset.id).toBe('iphone-16');
    expect(match?.isLandscape).toBe(true);
  });

  it('matches desktop preset', () => {
    const match = findMatchingPreset(1440, 1024);
    expect(match).not.toBeNull();
    expect(match?.preset.name).toBe('Desktop');
  });

  it('returns null for arbitrary custom dimensions', () => {
    expect(findMatchingPreset(512, 513)).toBeNull();
  });

  it('returns null for invalid/zero/negative dimensions', () => {
    expect(findMatchingPreset(0, 0)).toBeNull();
    expect(findMatchingPreset(-100, 200)).toBeNull();
  });
});
