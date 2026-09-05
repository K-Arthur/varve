import { describe, expect, it } from 'vitest';
import { FONT_LINE_HEIGHTS, FONT_SIZES, TYPOGRAPHY_ROLES } from './typography';

describe('typography source', () => {
  it('keeps a finite primitive scale', () => {
    expect(Object.keys(FONT_SIZES)).toEqual(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
    expect(FONT_LINE_HEIGHTS.control).toBe('1.25');
    expect(FONT_LINE_HEIGHTS.label).toBe('1.35');
  });

  it('defines complete semantic roles', () => {
    for (const role of Object.values(TYPOGRAPHY_ROLES)) {
      expect(role.size).toBeTruthy();
      expect(role.lineHeight).toBeTruthy();
      expect(role.weight).toBeTruthy();
      expect(role.family).toBeTruthy();
    }
    expect(TYPOGRAPHY_ROLES['interface-control'].size).toBe('var(--font-size-sm)');
    expect(TYPOGRAPHY_ROLES['content-body'].family).toBe('var(--font-body)');
  });
});
