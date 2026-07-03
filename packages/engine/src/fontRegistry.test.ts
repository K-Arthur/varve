import { describe, expect, it } from 'vitest';
import { FontRegistry, getFontRegistry, resetFontRegistry } from './fontRegistry';

describe('FontRegistry', () => {
  it('registers fonts and lists families', () => {
    const reg = new FontRegistry();
    const families = reg.families();
    expect(families).toContain('Inter');
    expect(families).toContain('Arial');
  });

  it('lists variants for a registered family', () => {
    const reg = new FontRegistry();
    const v = reg.variants('Inter');
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v.some((f) => f.weight === 400)).toBe(true);
  });

  it('hasVariant returns true for existing variant', () => {
    const reg = new FontRegistry();
    expect(reg.hasVariant('Inter', 400, 'normal')).toBe(true);
  });

  it('hasVariant returns false for missing variant', () => {
    const reg = new FontRegistry();
    expect(reg.hasVariant('nonexistent', 400, 'normal')).toBe(false);
  });

  it('fallbackChain returns generic fallbacks', () => {
    const reg = new FontRegistry();
    const chain = reg.fallbackChain('Inter');
    expect(chain).toContain('sans-serif');
  });

  it('fallbackChain returns empty for generic names', () => {
    const reg = new FontRegistry();
    expect(reg.fallbackChain('sans-serif')).toEqual([]);
  });

  it('resolve builds a CSS font-family string with fallbacks', () => {
    const reg = new FontRegistry();
    const result = reg.resolve('Inter');
    expect(result).toBe('Inter, sans-serif, serif, monospace');
  });

  it('resolve handles generic font names', () => {
    const reg = new FontRegistry();
    expect(reg.resolve('sans-serif')).toBe('sans-serif');
  });

  it('singleton getFontRegistry returns same instance', () => {
    resetFontRegistry();
    const a = getFontRegistry();
    const b = getFontRegistry();
    expect(a).toBe(b);
  });
});
