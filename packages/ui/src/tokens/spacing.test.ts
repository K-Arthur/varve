import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPACING_LAYOUT, SPACING_PRIMITIVES, SPACING_SEMANTIC } from './spacing';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('spacing source', () => {
  it('keeps a finite primitive ladder with zero as the only unitless value', () => {
    expect(Object.keys(SPACING_PRIMITIVES).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(SPACING_PRIMITIVES['0']).toBe('0');
    expect(
      Object.values(SPACING_PRIMITIVES)
        .slice(1)
        .every((value) => value.includes('rem')),
    ).toBe(true);
  });

  it('keeps semantic roles expressed in the primitive vocabulary', () => {
    expect(SPACING_SEMANTIC['page-inline']).toContain('clamp(');
    for (const value of Object.values(SPACING_SEMANTIC).slice(1)) {
      expect(value).toMatch(/^var\(--space-/);
    }
  });

  it('keeps shell chrome heights on the control ladder, not a viewport clamp', () => {
    // Bar heights are control geometry: a clamp made the status bar 22px on a
    // small window and 30px on a wide one, and controls inside it inherited
    // that drift. Resizable panel *widths* stay flexible by intent.
    expect(SPACING_LAYOUT['topbar-height']).toBe('var(--component-large-height)');
    expect(SPACING_LAYOUT['toolbar-height']).toBe('var(--component-large-height)');
    expect(SPACING_LAYOUT['statusbar-height']).toBe('var(--component-default-height)');
    expect(SPACING_LAYOUT['sidebar-width']).toContain('clamp(');
    expect(SPACING_LAYOUT['inspector-width']).toContain('clamp(');
    expect(SPACING_LAYOUT['panel-padding']).toBe('var(--space-panel)');
  });

  it('emits every primitive, semantic role, and layout alias to tokens.css', () => {
    for (const [token, value] of Object.entries(SPACING_PRIMITIVES)) {
      expect(tokensCss).toContain(`--space-${token}: ${value};`);
    }
    for (const [token, value] of Object.entries(SPACING_SEMANTIC)) {
      expect(tokensCss).toContain(`--space-${token}: ${value};`);
    }
    for (const [token, value] of Object.entries(SPACING_LAYOUT)) {
      expect(tokensCss).toContain(`--${token}: ${value};`);
    }
  });
});
