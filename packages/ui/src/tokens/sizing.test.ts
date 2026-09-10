import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENT_DIMENSIONS, COMPONENT_SIZES } from './sizing';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('component sizing source', () => {
  it('keeps three meaningful size tiers', () => {
    expect(Object.keys(COMPONENT_SIZES)).toEqual(['compact', 'default', 'large']);
    expect(COMPONENT_SIZES.compact.controlHeight).toBe('32px');
    expect(COMPONENT_SIZES.default.controlHeight).toBe('40px');
    expect(COMPONENT_SIZES.large.controlHeight).toBe('48px');
  });

  it('emits semantic dimensions and icon tokens to the runtime stylesheet', () => {
    for (const [name, value] of Object.entries(COMPONENT_DIMENSIONS)) {
      expect(tokensCss).toContain(`--${name}: ${value};`);
    }
    expect(tokensCss).toContain('--icon-size-sm: 16px;');
    expect(tokensCss).toContain('--icon-touch-target: 44px;');
  });
});
