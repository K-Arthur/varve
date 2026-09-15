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

  it('maps numpad operator codes to their symbols', () => {
    expect(physicalKeyFromEvent(keyOf('+', 'NumpadAdd'))).toBe('+');
    expect(physicalKeyFromEvent(keyOf('-', 'NumpadSubtract'))).toBe('-');
    expect(physicalKeyFromEvent(keyOf('*', 'NumpadMultiply'))).toBe('*');
    expect(physicalKeyFromEvent(keyOf('/', 'NumpadDivide'))).toBe('/');
  });

  it('resolves numpad digits with NumLock on', () => {
    expect(physicalKeyFromEvent(keyOf('1', 'Numpad1'))).toBe('1');
    expect(physicalKeyFromEvent(keyOf('0', 'Numpad0'))).toBe('0');
  });

  it('does not resolve numpad digits with NumLock off (navigation keys)', () => {
    // NumLock off: the numpad reports End/arrows, not digits.
    expect(physicalKeyFromEvent(keyOf('End', 'Numpad1'))).toBe('End');
    expect(physicalKeyFromEvent(keyOf('ArrowRight', 'Numpad6'))).toBe('ArrowRight');
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
    expect(physicalDigit(keyOf('6', 'Numpad6'))).toBe('6');
    expect(physicalDigit(keyOf('0', 'Numpad0'))).toBe('0');
  });

  it('returns null for numpad keys with NumLock off (navigation keys)', () => {
    // NumLock off: Numpad1 reads as End, Numpad6 as ArrowRight.
    expect(physicalDigit(keyOf('End', 'Numpad1'))).toBeNull();
    expect(physicalDigit(keyOf('ArrowRight', 'Numpad6'))).toBeNull();
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
