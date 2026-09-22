import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_GUIDE_LAYOUT_PRESETS,
  materializeGuideLayoutPreset,
  readPersonalGuideLayoutPresets,
} from './guideLayoutPresets';

describe('guide layout presets', () => {
  it('ships distinct square, column, and modular built-ins', () => {
    expect(BUILT_IN_GUIDE_LAYOUT_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(
      BUILT_IN_GUIDE_LAYOUT_PRESETS.find((preset) => preset.id === 'uniform-eight-unit')
        ?.layouts[0],
    ).toMatchObject({
      layoutMode: 'uniform',
      cellSize: 8,
    });
    expect(
      BUILT_IN_GUIDE_LAYOUT_PRESETS.find((preset) => preset.id === 'modular-composition')?.layouts,
    ).toHaveLength(2);
  });

  it('remints IDs and strips owner linkage when applying a preset', () => {
    const preset = BUILT_IN_GUIDE_LAYOUT_PRESETS[0]!;
    const first = materializeGuideLayoutPreset(preset);
    const second = materializeGuideLayoutPreset(preset);
    expect(first[0]!.id).toBe('preset-layout-1');
    expect(first[0]).not.toBe(preset.layouts[0]);
    expect(second[0]).not.toBe(first[0]);
    expect(first[0]!.frameId).toBeUndefined();
  });

  it('ignores corrupted personal preset storage', () => {
    const storage = {
      getItem: () => '{not-json',
      setItem: () => undefined,
    } as unknown as Storage;
    expect(readPersonalGuideLayoutPresets(storage)).toEqual([]);
  });
});
