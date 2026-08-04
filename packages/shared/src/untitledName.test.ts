import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNTITLED_BASE,
  isValidFileName,
  nextUntitledName,
  sanitizeFileName,
  stripExtension,
} from './untitledName';

describe('nextUntitledName', () => {
  it('starts at 1 with no used names', () => {
    expect(nextUntitledName([])).toBe('Untitled 1');
  });

  it('increments past taken names', () => {
    expect(nextUntitledName(['Untitled 1'])).toBe('Untitled 2');
    expect(nextUntitledName(['Untitled 1', 'Untitled 2', 'Untitled 3'])).toBe('Untitled 4');
  });

  it('fills gaps', () => {
    expect(nextUntitledName(['Untitled 1', 'Untitled 3'])).toBe('Untitled 2');
  });

  it('uses a custom base name', () => {
    expect(nextUntitledName(['Draft 1'], 'Draft')).toBe('Draft 2');
  });

  it('compares case-insensitively (filesystems may be case-insensitive)', () => {
    expect(nextUntitledName(['untitled 1'])).toBe('Untitled 2');
  });

  it('ignores extensions when comparing', () => {
    expect(nextUntitledName(['Untitled 1.varve', 'Untitled 2.strata'])).toBe('Untitled 3');
  });

  it('handles many documents without infinite loops', () => {
    const used = Array.from({ length: 500 }, (_, i) => `Untitled ${i + 1}`);
    expect(nextUntitledName(used)).toBe('Untitled 501');
  });

  it('default base constant matches the name generation', () => {
    expect(nextUntitledName([])).toBe(`${DEFAULT_UNTITLED_BASE} 1`);
  });
});

describe('sanitizeFileName', () => {
  it('removes filesystem-invalid characters', () => {
    expect(sanitizeFileName('My <Design>: 2026?')).toBe('My Design 2026');
    expect(sanitizeFileName('a/b\\c|d')).toBe('abcd');
  });

  it('preserves Unicode and spaces', () => {
    expect(sanitizeFileName('Свадебный альбом 婚礼')).toBe('Свадебный альбом 婚礼');
    expect(sanitizeFileName('Brand  Redesign')).toBe('Brand  Redesign');
  });

  it('strips trailing dots and spaces (Windows-invalid)', () => {
    expect(sanitizeFileName('My Doc.')).toBe('My Doc');
    expect(sanitizeFileName('My Doc ')).toBe('My Doc');
    expect(sanitizeFileName('...')).toBe('Untitled');
  });

  it('handles Windows reserved names', () => {
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('com1')).toBe('_com1');
    expect(sanitizeFileName('NUL.txt')).toBe('_NUL.txt');
  });

  it('does not prepend the extension', () => {
    expect(sanitizeFileName('Untitled 1')).not.toMatch(/\.(varve|strata)$/);
  });

  it('falls back when the result is empty', () => {
    expect(sanitizeFileName('///')).toBe('Untitled');
    expect(sanitizeFileName('')).toBe('Untitled');
    expect(sanitizeFileName('  ')).toBe('Untitled');
  });
});

describe('stripExtension', () => {
  it('strips known extensions case-insensitively', () => {
    expect(stripExtension('My Doc.varve')).toBe('My Doc');
    expect(stripExtension('Old.strata')).toBe('Old');
    expect(stripExtension('Image.PNG')).toBe('Image');
  });

  it('leaves names without extensions alone', () => {
    expect(stripExtension('My Doc')).toBe('My Doc');
    expect(stripExtension('a.b.c')).toBe('a.b.c');
  });
});

describe('isValidFileName', () => {
  it('accepts normal and Unicode names', () => {
    expect(isValidFileName('My Design')).toBe(true);
    expect(isValidFileName('投影仪')).toBe(true);
  });

  it('rejects empty and hostile names', () => {
    expect(isValidFileName('')).toBe(false);
    expect(isValidFileName('///')).toBe(false);
  });
});
