// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUTTON_SIZES, BUTTON_VARIANTS } from './Button';

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

const VARIANTS = BUTTON_VARIANTS;
const SIZES = BUTTON_SIZES;

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

/**
 * The unavailable-control contract: `aria-disabled` is the *focusable*
 * unavailable state that carries `disabledReason`/`title`, so pointer events
 * must keep flowing to it — a `pointer-events: none` here makes the reason
 * unhoverable (the defect Fluent UI #17606 and Calcite #5318 fixed).
 * HTML-disabled keeps pointer events off; there is no reason to read.
 */
describe('aria-disabled stays pointer-active', () => {
  function ruleBody(selector: string): string | undefined {
    const match = css.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`),
    );
    return match?.[0];
  }

  it('does not block pointer events on aria-disabled buttons', () => {
    const body = ruleBody('.varve-btn[aria-disabled="true"]');
    expect(body).toBeDefined();
    expect(body).not.toContain('pointer-events');
  });

  it('does not block pointer events on aria-disabled close buttons', () => {
    const body = ruleBody('.varve-close[aria-disabled="true"]');
    expect(body).toBeDefined();
    expect(body).not.toContain('pointer-events');
  });

  it('still blocks pointer events on HTML-disabled buttons', () => {
    expect(ruleBody('.varve-btn:disabled')).toContain('pointer-events: none');
    expect(ruleBody('.varve-close:disabled')).toContain('pointer-events: none');
  });
});
