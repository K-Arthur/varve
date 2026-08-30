import { describe, expect, it } from 'vitest';
import {
  EFFECT_CATEGORIES,
  EFFECT_REGISTRY,
  listEffectDefinitions,
  searchEffectDefinitions,
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
});
