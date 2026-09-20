import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_CSS_CUSTOM_PROPERTIES } from './iconTokens';
import { COMPONENT_DIMENSIONS, COMPONENT_SIZES } from './sizing';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('component sizing source', () => {
  it('keeps one five-step control ladder', () => {
    expect(Object.keys(COMPONENT_SIZES)).toEqual(['xs', 'compact', 'default', 'large', 'xl']);
    // The ladder must stay strictly increasing: two tiers that render at the
    // same height are indistinguishable and invite per-component overrides.
    const heights = Object.values(COMPONENT_SIZES).map((tier) =>
      Number.parseInt(tier.controlHeight, 10),
    );
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(heights.length);
  });

  it('anchors the default tier at the height the application actually uses', () => {
    expect(COMPONENT_SIZES.xs.controlHeight).toBe('24px');
    expect(COMPONENT_SIZES.compact.controlHeight).toBe('28px');
    expect(COMPONENT_SIZES.default.controlHeight).toBe('32px');
    expect(COMPONENT_SIZES.large.controlHeight).toBe('40px');
    expect(COMPONENT_SIZES.xl.controlHeight).toBe('48px');
  });

  it('never lets a tier name imply a glyph larger than its control', () => {
    for (const tier of Object.values(COMPONENT_SIZES)) {
      expect(tier.iconSize).toMatch(/^var\(--icon-size-(xs|sm|md|lg|xl)\)$/);
    }
  });

  it('emits every size tier, semantic dimension, and icon token to the runtime stylesheet', () => {
    for (const [name, values] of Object.entries(COMPONENT_SIZES)) {
      expect(tokensCss).toContain(`--component-${name}-height: ${values.controlHeight};`);
      expect(tokensCss).toContain(`--component-${name}-icon-size: ${values.iconSize};`);
      expect(tokensCss).toContain(`--component-${name}-padding-inline: ${values.paddingInline};`);
    }
    for (const [name, value] of Object.entries(COMPONENT_DIMENSIONS)) {
      expect(tokensCss).toContain(`--${name}: ${value};`);
    }
    for (const [token, value] of Object.entries(ICON_CSS_CUSTOM_PROPERTIES)) {
      expect(tokensCss).toContain(`${token}: ${value};`);
    }
  });

  it('gates touch target sizing below the doubled control height', () => {
    expect(COMPONENT_DIMENSIONS['touch-target-min']).toBe('44px');
    expect(COMPONENT_DIMENSIONS['target-min-compact']).toBe('24px');
  });
});
