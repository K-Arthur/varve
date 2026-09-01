import { describe, expect, it } from 'vitest';
import { SPACING_LAYOUT, SPACING_PRIMITIVES, SPACING_SEMANTIC } from './spacing';

describe('spacing source', () => {
  it('keeps a finite primitive ladder with zero as the only unitless value', () => {
    expect(Object.keys(SPACING_PRIMITIVES).sort()).toEqual([
      '0',
      '05',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '20',
      '24',
      '32',
    ].sort());
    expect(SPACING_PRIMITIVES['0']).toBe('0');
    expect(Object.values(SPACING_PRIMITIVES).slice(1).every((value) => value.includes('rem'))).toBe(
      true,
    );
  });

  it('keeps semantic roles expressed in the primitive vocabulary', () => {
    expect(SPACING_SEMANTIC['page-inline']).toContain('clamp(');
    for (const value of Object.values(SPACING_SEMANTIC).slice(1)) {
      expect(value).toMatch(/^var\(--space-/);
    }
  });

  it('keeps legacy shell geometry as compatibility aliases only', () => {
    expect(SPACING_LAYOUT['panel-padding']).toBe('var(--space-panel)');
    expect(SPACING_LAYOUT['toolbar-height']).toContain('clamp(');
  });
});
