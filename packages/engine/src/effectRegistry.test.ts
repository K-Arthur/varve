import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_LAYER_KINDS,
  EFFECT_CATEGORIES,
  EFFECT_REGISTRY,
  EFFECT_STUDIO_CATEGORIES,
  EFFECT_STUDIO_KINDS,
  EFFECT_SURFACE_GUIDANCE,
  IMAGE_TUNING_KINDS,
  listEffectDefinitions,
  listEffectStudioDefinitions,
  searchEffectDefinitions,
  searchEffectStudioDefinitions,
} from './effectRegistry';
import { ADJUSTMENT_KINDS } from './filters';

describe('Effect Studio registry', () => {
  it('has exactly one definition for every stable adjustment kind', () => {
    expect(Object.keys(EFFECT_REGISTRY).sort()).toEqual([...ADJUSTMENT_KINDS].sort());
    expect(listEffectDefinitions()).toHaveLength(ADJUSTMENT_KINDS.length);
    for (const definition of listEffectDefinitions()) {
      expect(definition.schemaVersion).toBe(1);
      expect(definition.displayNameKey).toMatch(/^effect\..+\.name$/);
      expect(definition.parameters).toEqual(expect.any(Array));
      expect(definition.renderCapabilities.canvas2d).toBe(true);
    }
  });

  it('keeps categories populated and uses outcome-oriented search tags', () => {
    for (const category of EFFECT_CATEGORIES) {
      expect(
        listEffectDefinitions().some((definition) => definition.categoryId === category.id),
      ).toBe(true);
    }
    expect(searchEffectDefinitions('film').map((definition) => definition.id)).toContain('grain');
    expect(searchEffectDefinitions('glow').map((definition) => definition.id)).toEqual(
      expect.arrayContaining(['bloom', 'softBloom']),
    );
  });

  it('filters by stable category IDs without changing definition order', () => {
    const definitions = searchEffectDefinitions('', 'colour');
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.every((definition) => definition.categoryId === 'colour')).toBe(true);
  });

  it('does not expose unknown or localized labels as registry IDs', () => {
    expect(EFFECT_REGISTRY['not-an-effect' as keyof typeof EFFECT_REGISTRY]).toBeUndefined();
    expect(Object.keys(EFFECT_REGISTRY).some((id) => id.includes(' '))).toBe(false);
  });

  it('keeps surface catalogs intentionally distinct while sharing definitions', () => {
    expect(listEffectStudioDefinitions().map((definition) => definition.id)).toEqual(
      EFFECT_STUDIO_KINDS,
    );
    expect(
      listEffectStudioDefinitions().every((definition) =>
        definition.surfaces.includes('effect-studio'),
      ),
    ).toBe(true);
    expect(
      EFFECT_STUDIO_KINDS.some((kind) => (IMAGE_TUNING_KINDS as readonly string[]).includes(kind)),
    ).toBe(false);
    expect(
      EFFECT_STUDIO_KINDS.some((kind) =>
        (ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(kind),
      ),
    ).toBe(false);
    expect(
      IMAGE_TUNING_KINDS.some((kind) =>
        (ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(kind),
      ),
    ).toBe(true);
  });

  it('gives Effect Studio its own creative categories and excludes photographic corrections', () => {
    for (const category of EFFECT_STUDIO_CATEGORIES) {
      expect(
        listEffectStudioDefinitions().some(
          (definition) => definition.studioCategoryId === category.id,
        ),
      ).toBe(true);
    }
    expect(searchEffectStudioDefinitions('retro').map((definition) => definition.id)).toContain(
      'vhs',
    );
    expect(searchEffectStudioDefinitions('brightness')).toEqual([]);
  });

  it('documents raster and vector semantics for every product surface', () => {
    for (const guidance of Object.values(EFFECT_SURFACE_GUIDANCE)) {
      expect(guidance.rasterBehavior).toBeTruthy();
      expect(guidance.vectorBehavior).toBeTruthy();
    }
    expect(EFFECT_SURFACE_GUIDANCE['image-tuning'].vectorBehavior).toMatch(/not offered/i);
    expect(EFFECT_SURFACE_GUIDANCE['effect-studio'].vectorBehavior).toMatch(/editable/i);
  });
});
