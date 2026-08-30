import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_LAYER_KINDS,
  ADJUSTMENT_LAYER_PRESETS,
  EFFECT_STUDIO_CATEGORIES,
  EFFECT_STUDIO_KINDS,
  EFFECT_STUDIO_PRESETS,
  EFFECT_STUDIO_TREATMENTS,
  FEATURED_EFFECT_STUDIO_TREATMENTS,
  IMAGE_TUNING_KINDS,
  IMAGE_TUNING_PRESETS,
  searchEffectStudioTreatments,
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
      surfacePresetKinds(EFFECT_STUDIO_TREATMENTS).every((kind) =>
        (ADJUSTMENT_KINDS as readonly string[]).includes(kind),
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
    expect(surfacePresetKinds(EFFECT_STUDIO_TREATMENTS)).toContain('grain');
    expect(EFFECT_STUDIO_KINDS).not.toContain('grain');
    expect(surfacePresetKinds(IMAGE_TUNING_PRESETS)).not.toContain('halftone');
  });

  it('provides a populated outcome catalog instead of single-slider aliases', () => {
    expect(EFFECT_STUDIO_TREATMENTS.length).toBeGreaterThanOrEqual(32);
    expect(EFFECT_STUDIO_TREATMENTS.every((treatment) => treatment.effects.length > 1)).toBe(true);
    expect(FEATURED_EFFECT_STUDIO_TREATMENTS.length).toBeGreaterThanOrEqual(4);
    for (const category of EFFECT_STUDIO_CATEGORIES) {
      expect(
        EFFECT_STUDIO_TREATMENTS.some((treatment) => treatment.categoryId === category.id),
      ).toBe(true);
    }
    expect(EFFECT_STUDIO_CATEGORIES.map((category) => category.label)).toEqual([
      'Illustrative',
      'Mark Making',
      'Optics & Shift',
      'Drawing & Graphic',
      'Light & Signal',
      'Print & Material',
    ]);
    expect(
      EFFECT_STUDIO_TREATMENTS.filter((treatment) => treatment.categoryId === 'sketch').length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      EFFECT_STUDIO_TREATMENTS.filter((treatment) => treatment.categoryId === 'stylize').length,
    ).toBeGreaterThanOrEqual(8);
    expect(searchEffectStudioTreatments('crosshatch').map((treatment) => treatment.id)).toContain(
      'studio-crosshatch',
    );
    expect(IMAGE_TUNING_PRESETS.some((preset) => preset.effects.length > 1)).toBe(true);
    expect(ADJUSTMENT_LAYER_PRESETS.some((preset) => preset.effects.length > 1)).toBe(true);
  });
});
