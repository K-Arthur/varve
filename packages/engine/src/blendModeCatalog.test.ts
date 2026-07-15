/**
 * Research basis: W3C Compositing and Blending Level 1; verifies the product
 * applicability catalog that keeps engine blend capabilities explicit.
 */

import { describe, expect, it } from 'vitest';
import { blendModeDefinition, blendModesForDomain } from './blendModeCatalog';

describe('blendModeDefinition', () => {
  it('maps Color Dodge to interoperable CSS and PDF names', () => {
    expect(blendModeDefinition('colorDodge')).toMatchObject({
      id: 'colorDodge',
      css: 'color-dodge',
      pdf: 'ColorDodge',
      kind: 'blend',
    });
  });

  it('does not silently normalize an unknown mode', () => {
    expect(blendModeDefinition('mystery-mode')).toBeNull();
  });

  it('keeps Pass Through group-only', () => {
    expect(blendModesForDomain('group').map((mode) => mode.id)).toContain('passThrough');
    expect(blendModesForDomain('fill').map((mode) => mode.id)).not.toContain('passThrough');
  });

  it('keeps Plus Darker out of editable domains', () => {
    expect(blendModesForDomain('object').map((mode) => mode.id)).not.toContain('plusDarker');
  });
});
