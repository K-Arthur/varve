import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_LINE_HEIGHTS, FONT_SIZES, TYPOGRAPHY_ROLES } from './typography';

const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Steps that describe interface chrome; these must be stable rem. */
const STABLE_STEPS = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
/** Display steps; these are allowed to be bounded fluid clamps. */
const FLUID_STEPS = ['2xl', '3xl'] as const;

describe('typography source', () => {
  it('keeps a finite primitive scale', () => {
    expect(Object.keys(FONT_SIZES)).toEqual(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
    expect(FONT_LINE_HEIGHTS.control).toBe('1.25');
    expect(FONT_LINE_HEIGHTS.label).toBe('1.35');
  });

  it('keeps interface chrome on stable rem steps', () => {
    for (const step of STABLE_STEPS) {
      expect(FONT_SIZES[step]).toMatch(/^\d*\.?\d+rem$/);
    }
  });

  it('keeps display steps bounded fluid so they cannot invert below chrome', () => {
    for (const step of FLUID_STEPS) {
      expect(FONT_SIZES[step]).toMatch(/^clamp\(/);
    }
  });

  it('holds a readable floor and a strictly increasing ladder', () => {
    const px = (value: string) => Number.parseFloat(value) * 16;
    const floor = px(FONT_SIZES['2xs']);
    // 12px is the interface floor: below it, no interface text carries
    // meaning reliably (Figma UI3's ~11px chrome is the documented failure).
    expect(floor).toBeGreaterThanOrEqual(12);

    const stable = STABLE_STEPS.map((step) => px(FONT_SIZES[step]));
    for (let i = 1; i < stable.length; i += 1) {
      const previous = stable[i - 1] ?? 0;
      const current = stable[i] ?? 0;
      // Every adjacent pair must be strictly and visibly distinguishable.
      expect(current - previous).toBeGreaterThanOrEqual(1);
    }
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

  it('resolves every role through primitives or a bounded clamp', () => {
    for (const [name, role] of Object.entries(TYPOGRAPHY_ROLES)) {
      expect(role.size, `${name} size`).toMatch(/^var\(--font-size-[a-z0-9]+\)$|^clamp\(/);
      expect(role.lineHeight, `${name} line-height`).toMatch(
        /^var\(--font-line-[a-z]+\)$|^[\d.]+$/,
      );
      expect(role.weight, `${name} weight`).toMatch(/^var\(--font-weight-[a-z]+\)$/);
      expect(role.family, `${name} family`).toMatch(/^var\(--font-[a-z]+\)$/);
    }
  });

  it('emits every primitive, line height, and role property to tokens.css', () => {
    for (const [step, value] of Object.entries(FONT_SIZES)) {
      expect(tokensCss).toContain(`--font-size-${step}: ${value};`);
    }
    for (const [name, value] of Object.entries(FONT_LINE_HEIGHTS)) {
      expect(tokensCss).toContain(`--font-line-${name}: ${value};`);
    }
    for (const [role, values] of Object.entries(TYPOGRAPHY_ROLES)) {
      expect(tokensCss).toContain(`--type-${role}-size: ${values.size};`);
      expect(tokensCss).toContain(`--type-${role}-line-height: ${values.lineHeight};`);
      expect(tokensCss).toContain(`--type-${role}-weight: ${values.weight};`);
      expect(tokensCss).toContain(`--type-${role}-family: ${values.family};`);
    }
  });
});
