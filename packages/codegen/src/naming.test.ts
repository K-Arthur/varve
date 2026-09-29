import { describe, expect, it } from 'vitest';
import {
  isSafeIdentifier,
  styleKeyAccess,
  toComponentName,
  toCssClassName,
  toFileStem,
  uniqueName,
} from './naming';

describe('toCssClassName', () => {
  it('kebab-cases readable names', () => {
    expect(toCssClassName('Hero Card')).toBe('hero-card');
    expect(toCssClassName('Hero-Card')).toBe('hero-card');
    expect(toCssClassName('heroCard')).toBe('hero-card');
    expect(toCssClassName('card')).toBe('card');
  });

  it('never returns an empty or digit-leading identifier', () => {
    expect(toCssClassName('')).toBe('node');
    expect(toCssClassName('---')).toBe('node');
    expect(toCssClassName('2 column')).toBe('n-2-column');
  });

  it('drops characters no CSS toolchain escapes reliably', () => {
    // Emoji and non-ASCII scripts become word boundaries rather than raw bytes.
    // The emoji is written as an escape so the zero-emoji gate can scan the
    // source; the string value is unchanged.
    expect(toCssClassName('card \u{1F389}')).toBe('card');
    expect(toCssClassName('按钮')).toBe('node');
    expect(toCssClassName('café')).toBe('caf');
  });

  it('is deterministic for the same input', () => {
    expect(toCssClassName('Hero Card')).toBe(toCssClassName('Hero Card'));
  });
});

describe('toComponentName', () => {
  it('produces valid PascalCase bindings', () => {
    expect(toComponentName('hero card')).toBe('HeroCard');
    expect(toComponentName('Hero-Card')).toBe('HeroCard');
    expect(toComponentName('heroCard')).toBe('HeroCard');
    expect(toComponentName('card')).toBe('Card');
  });

  it('avoids empty, digit-leading, and reserved identifiers', () => {
    expect(toComponentName('')).toBe('Component');
    expect(toComponentName('2 columns')).toBe('C2Columns');
    // `class` is reserved lowercase; PascalCase is already safe, but a
    // lowercase-only name that survives as-is must still not collide.
    expect(toComponentName('class')).toBe('Class');
  });

  it('never emits the literal "undefined" for a nameless node', () => {
    expect(toComponentName('')).not.toBe('undefined');
    expect(toFileStem('')).not.toBe('undefined');
  });
});

describe('isSafeIdentifier / styleKeyAccess', () => {
  it('classifies identifiers', () => {
    expect(isSafeIdentifier('card')).toBe(true);
    expect(isSafeIdentifier('card2')).toBe(true);
    expect(isSafeIdentifier('hero-card')).toBe(false);
    expect(isSafeIdentifier('2card')).toBe(false);
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('uses bracket access for kebab-case keys', () => {
    expect(styleKeyAccess('styles', 'hero-card')).toBe('styles["hero-card"]');
    expect(styleKeyAccess('styles', 'card')).toBe('styles.card');
    // A reserved word must not become a bare property access.
    expect(styleKeyAccess('styles', 'default')).toBe('styles["default"]');
  });
});

describe('uniqueName', () => {
  it('suffixes repeats deterministically', () => {
    const used = new Set<string>();
    expect(uniqueName('card', used)).toBe('card');
    expect(uniqueName('card', used)).toBe('card-2');
    expect(uniqueName('card', used)).toBe('card-3');
    expect(uniqueName('other', used)).toBe('other');
  });
});
