/**
 * Research basis: W3C Compositing and Blending Level 1; verifies the product
 * applicability catalog that keeps engine blend capabilities explicit.
 */

import { describe, expect, it } from 'vitest';
import {
  BLEND_MODE_DEFINITIONS,
  blendModeDefinition,
  blendModesForDomain,
} from './blendModeCatalog';

describe('blendModeDefinition', () => {
  it('maps Color Dodge to interoperable CSS and PDF names', () => {
    expect(blendModeDefinition('colorDodge')).toMatchObject({
      id: 'colorDodge',
      css: 'color-dodge',
      pdf: 'ColorDodge',
      kind: 'blend',
    });
  });

  it('maps Normal to the Canvas2D source-over operation', () => {
    expect(blendModeDefinition('normal')?.css).toBe('source-over');
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

  it('exports definitions in product menu order', () => {
    expect(BLEND_MODE_DEFINITIONS.map((mode) => mode.id)).toEqual([
      'passThrough',
      'normal',
      'darken',
      'multiply',
      'colorBurn',
      'lighten',
      'screen',
      'colorDodge',
      'overlay',
      'softLight',
      'hardLight',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
      'plusLighter',
      'plusDarker',
    ]);
  });
});
