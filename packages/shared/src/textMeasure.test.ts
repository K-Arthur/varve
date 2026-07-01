import { describe, expect, it } from 'vitest';
import { measureText, textWrap } from './textMeasure';

describe('measureText', () => {
  it('measures single-line text width using canvas measureText', () => {
    const result = measureText('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.width).toBeGreaterThan(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('Hello');
  });

  it('returns zero width for empty string', () => {
    const result = measureText('', { fontSize: 16, fontFamily: 'sans-serif' });
    expect(result.width).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('');
  });

  it('accounts for letterSpacing in total width', () => {
    const normal = measureText('Hello', { fontSize: 16, fontFamily: 'sans-serif' });
    const spaced = measureText('Hello', { fontSize: 16, fontFamily: 'sans-serif', letterSpacing: 2 });
    expect(spaced.width).toBeGreaterThan(normal.width);
  });

  it('accounts for lineHeight in total height', () => {
    const tight = measureText('Hello\nWorld', { fontSize: 16, fontFamily: 'sans-serif', lineHeight: 1.2 });
    const loose = measureText('Hello\nWorld', { fontSize: 16, fontFamily: 'sans-serif', lineHeight: 2.0 });
    expect(loose.height).toBeGreaterThan(tight.height);
  });

  it('handles multi-line text with correct line count', () => {
    const result = measureText('Line 1\nLine 2\nLine 3', {
      fontSize: 16,
      fontFamily: 'sans-serif',
    });
    expect(result.lines).toHaveLength(3);
  });

  it('applies textCase uppercase transform before measurement', () => {
    const result = measureText('hello', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      textCase: 'uppercase',
    });
    expect(result.lines[0]?.text).toBe('HELLO');
  });

  it('applies textCase capitalize transform', () => {
    const result = measureText('hello world', {
      fontSize: 16,
      fontFamily: 'sans-serif',
      textCase: 'capitalize',
    });
    expect(result.lines[0]?.text).toBe('Hello World');
  });
});

describe('textWrap', () => {
  it('does not wrap text shorter than maxWidth', () => {
    const lines = textWrap('Hello', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello');
  });

  it('wraps text at word boundaries', () => {
    const lines = textWrap('one two three four', 50, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('does not break when no spaces exist and text fits', () => {
    const lines = textWrap('Supercalifragilistic', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(1);
  });

  it('respects newlines as explicit breaks', () => {
    const lines = textWrap('Hello\nWorld', 500, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(2);
  });

  it('returns empty array for empty string', () => {
    const lines = textWrap('', 100, { fontSize: 16, fontFamily: 'sans-serif' });
    expect(lines).toHaveLength(0);
  });
});
