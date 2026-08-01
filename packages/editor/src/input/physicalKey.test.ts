import { describe, expect, it } from 'vitest';
import { canonicalShortcutKey, physicalDigit, physicalKeyFromEvent } from '../input/physicalKey';

function keyOf(key: string, code: string): { key: string; code: string } {
  return { key, code };
}

describe('physicalKeyFromEvent', () => {
  it('resolves digits from the physical code regardless of the printed key', () => {
    // Real US-layout Shift+1 reports key '!' (Playwright synthesizes '1').
    expect(physicalKeyFromEvent(keyOf('!', 'Digit1'))).toBe('1');
    expect(physicalKeyFromEvent(keyOf('@', 'Digit2'))).toBe('2');
  });

  it('resolves numpad digits regardless of NumLock', () => {
    // NumLock off: numpad keys report Insert/End/arrows, not digits.
    expect(physicalKeyFromEvent(keyOf('Insert', 'Numpad0'))).toBe('0');
    expect(physicalKeyFromEvent(keyOf('End', 'Numpad1'))).toBe('1');
    // NumLock on: the key already reports the digit.
    expect(physicalKeyFromEvent(keyOf('0', 'Numpad0'))).toBe('0');
    expect(physicalKeyFromEvent(keyOf('7', 'Numpad7'))).toBe('7');
  });

  it('maps numpad operator codes to their symbols', () => {
    expect(physicalKeyFromEvent(keyOf('+', 'NumpadAdd'))).toBe('+');
    expect(physicalKeyFromEvent(keyOf('-', 'NumpadSubtract'))).toBe('-');
    expect(physicalKeyFromEvent(keyOf('*', 'NumpadMultiply'))).toBe('*');
    expect(physicalKeyFromEvent(keyOf('/', 'NumpadDivide'))).toBe('/');
  });

  it('falls back to the printed key for non-digit, non-numpad keys', () => {
    expect(physicalKeyFromEvent(keyOf('=', 'Equal'))).toBe('=');
    expect(physicalKeyFromEvent(keyOf('z', 'KeyZ'))).toBe('z');
    expect(physicalKeyFromEvent(keyOf('Escape', 'Escape'))).toBe('Escape');
  });
});

describe('physicalDigit', () => {
  it('returns the digit for main-row and numpad digit keys', () => {
    expect(physicalDigit(keyOf('1', 'Digit1'))).toBe('1');
    expect(physicalDigit(keyOf('!', 'Digit1'))).toBe('1');
    expect(physicalDigit(keyOf('End', 'Numpad1'))).toBe('1');
    expect(physicalDigit(keyOf('0', 'Numpad0'))).toBe('0');
  });

  it('returns null for non-digit keys', () => {
    expect(physicalDigit(keyOf('=', 'Equal'))).toBeNull();
    expect(physicalDigit(keyOf('z', 'KeyZ'))).toBeNull();
    expect(physicalDigit(keyOf('+', 'NumpadAdd'))).toBeNull();
  });
});

describe('canonicalShortcutKey', () => {
  it('treats + and = as interchangeable (the zoom-in physical key)', () => {
    expect(canonicalShortcutKey('+')).toBe('=');
    expect(canonicalShortcutKey('=')).toBe('=');
  });

  it('leaves other keys unchanged', () => {
    expect(canonicalShortcutKey('1')).toBe('1');
    expect(canonicalShortcutKey('z')).toBe('z');
  });
});
