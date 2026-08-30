import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_LAYER_KINDS,
  ADJUSTMENT_LAYER_PRESETS,
  EFFECT_STUDIO_KINDS,
  EFFECT_STUDIO_PRESETS,
  IMAGE_TUNING_KINDS,
  IMAGE_TUNING_PRESETS,
  surfacePresetKinds,
} from './index';

describe('surface preset catalogs', () => {
  it('keeps preset IDs unique and recipes non-empty', () => {
    const presets = [
      ...EFFECT_STUDIO_PRESETS,
      ...IMAGE_TUNING_PRESETS,
      ...ADJUSTMENT_LAYER_PRESETS,
    ];
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.effects.length).toBeGreaterThan(0);
    }
  });

  it('does not leak surface-specific recipes into another catalog', () => {
    expect(
      surfacePresetKinds(EFFECT_STUDIO_PRESETS).every((kind) =>
        (EFFECT_STUDIO_KINDS as readonly string[]).includes(kind),
      ),
    ).toBe(true);
    expect(
      surfacePresetKinds(IMAGE_TUNING_PRESETS).every((kind) =>
        (IMAGE_TUNING_KINDS as readonly string[]).includes(kind),
      ),
    ).toBe(true);
    expect(
      surfacePresetKinds(ADJUSTMENT_LAYER_PRESETS).every((kind) =>
        (ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(kind),
      ),
    ).toBe(true);
    expect(surfacePresetKinds(EFFECT_STUDIO_PRESETS)).not.toContain('microDetail');
    expect(surfacePresetKinds(IMAGE_TUNING_PRESETS)).not.toContain('halftone');
  });

  it('provides stack recipes rather than only single-slider aliases', () => {
    expect(EFFECT_STUDIO_PRESETS.some((preset) => preset.effects.length > 1)).toBe(true);
    expect(IMAGE_TUNING_PRESETS.some((preset) => preset.effects.length > 1)).toBe(true);
    expect(ADJUSTMENT_LAYER_PRESETS.some((preset) => preset.effects.length > 1)).toBe(true);
  });
});
