/**
 * Unit tests for logo preview helpers — mode filters, surface colors, and
 * the small-size ladder. Pure functions; no canvas required.
 */
import { describe, expect, it } from 'vitest';
import { LOGO_SMALL_SIZES, previewFilter, surfaceColor } from './logoPreview';

describe('logoPreview helpers', () => {
  it('covers the favicon-to-social ladder', () => {
    expect([...LOGO_SMALL_SIZES]).toEqual([16, 24, 32, 48, 64, 128]);
  });

  it('maps surfaces to concrete colors, checker to null', () => {
    expect(surfaceColor('light')).toBe('#ffffff');
    expect(surfaceColor('dark')).toBe('#16181d');
    expect(surfaceColor('checker')).toBeNull();
  });

  it('maps preview modes to canvas filters', () => {
    expect(previewFilter('original')).toBe('none');
    expect(previewFilter('grayscale')).toBe('grayscale(1)');
    expect(previewFilter('monochrome')).toContain('grayscale(1)');
    expect(previewFilter('monochrome')).toContain('contrast');
    expect(previewFilter('reversed')).toBe('invert(1)');
  });
});
