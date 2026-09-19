// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ButtonSize, ButtonVariant } from './Button';

/**
 * The Button component and its stylesheet must not drift.
 *
 * A modifier class that exists only in TSX or only in CSS is invisible until a
 * user hits the affected surface: `varve-btn--primary` / `varve-btn--danger`
 * were written by call sites for months while no rule existed, so destructive
 * actions rendered with neutral button chrome. This test makes the vocabulary
 * closed: every TSX variant/size has a rule, and every `varve-btn--*` class in
 * the stylesheet is a declared variant, size, or state.
 */
const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8');

const VARIANTS: readonly ButtonVariant[] = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
  'toolbar',
];

const SIZES: readonly ButtonSize[] = [
  'xs',
  'sm',
  'md',
  'lg',
  'icon-xs',
  'icon-sm',
  'icon',
  'icon-lg',
];

/** State modifiers the component adds without a matching prop value. */
const STATES = ['loading', 'confirming', 'pressed'];

function declaredModifiers(): Set<string> {
  const found = new Set<string>();
  for (const match of css.matchAll(/\.varve-btn--([a-z0-9-]+)/g)) {
    found.add(match[1] as string);
  }
  return found;
}

describe('Button vocabulary parity', () => {
  it('defines a rule for every variant', () => {
    const declared = declaredModifiers();
    const missing = VARIANTS.filter((variant) => !declared.has(variant));
    expect(missing).toEqual([]);
  });

  it('defines a rule for every size', () => {
    const declared = declaredModifiers();
    const missing = SIZES.filter((size) => !declared.has(size));
    expect(missing).toEqual([]);
  });

  it('declares no modifier outside the vocabulary', () => {
    const allowed = new Set<string>([...VARIANTS, ...SIZES, ...STATES]);
    const unknown = [...declaredModifiers()].filter((name) => !allowed.has(name));
    expect(unknown).toEqual([]);
  });

  it('keeps the base class, focus ring, and coarse-pointer target promotion', () => {
    expect(css).toMatch(/\.varve-btn\s*\{/);
    expect(css).toMatch(/\.varve-btn:focus-visible/);
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.varve-btn\s*\{[\s\S]*--touch-target-min/,
    );
  });

  it('gives pressed controls the shared checked-selection tokens', () => {
    const pressedRules = css.match(
      /\.varve-btn--[a-z-]+\[aria-pressed="true"\][\s\S]*?\{[\s\S]*?\}/g,
    );
    expect(pressedRules?.length ?? 0).toBeGreaterThan(0);
    expect(pressedRules?.join('\n')).toContain('--color-interactive-checked-surface');
  });
});
