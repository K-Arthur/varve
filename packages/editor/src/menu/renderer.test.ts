import { describe, expect, it } from 'vitest';
import { formatMenuShortcut } from './renderer';

describe('formatMenuShortcut', () => {
  it('uses the compact command glyphs on macOS', () => {
    expect(formatMenuShortcut({ key: 's', ctrl: true, shift: true }, 'mac')).toBe('⌘⇧S');
    expect(formatMenuShortcut({ key: 'Backspace' }, 'mac')).toBe('⌫');
  });

  it('uses named modifiers on non-macOS platforms', () => {
    expect(formatMenuShortcut({ key: 's', ctrl: true, alt: true }, 'windows')).toBe('Ctrl+Alt+S');
    expect(formatMenuShortcut({ key: 'Delete' }, 'linux')).toBe('Del');
  });

  it('omits empty accelerators', () => {
    expect(formatMenuShortcut(undefined, 'linux')).toBeUndefined();
    expect(formatMenuShortcut({ key: '' }, 'linux')).toBeUndefined();
  });
});
