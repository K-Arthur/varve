/**
 * Tests for the accessible palette generator.
 */

import { createDocument } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { applyPaletteAsSwatches, generateAccessiblePalette } from './paletteGenerator';

describe('generateAccessiblePalette', () => {
  const doc = createDocument();

  const heroColor = { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 1 };
  const whiteBg = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 1 };
  const darkBg = { space: 'rgb' as const, r: 16, g: 21, b: 31, a: 1 };

  it('generates palette candidates from hero color', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [
        { name: 'light', color: whiteBg },
        { name: 'dark', color: darkBg },
      ],
    });

    expect(result.candidates.length).toBeGreaterThanOrEqual(5);
    expect(result.heroColor).toEqual(heroColor);
    expect(result.disclaimer).toBeTruthy();
  });

  it('includes expected role-based candidates', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [{ name: 'light', color: whiteBg }],
    });

    const names = result.candidates.map((c) => c.name);
    expect(names).toContain('hero');
    expect(names).toContain('light');
    expect(names).toContain('dark');
    expect(names).toContain('surface');
    expect(names).toContain('text-primary');
    expect(names).toContain('accent');
  });

  it('computes contrast ratios for each candidate', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [
        { name: 'light', color: whiteBg },
        { name: 'dark', color: darkBg },
      ],
    });

    for (const candidate of result.candidates) {
      if (candidate.contrastRatios.length > 0) {
        expect(candidate.contrastRatios[0]!.ratio).toBeGreaterThan(0);
        expect(typeof candidate.contrastRatios[0]!.passesAA).toBe('boolean');
      }
    }
  });

  it('marks hero color as unchanged', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [{ name: 'light', color: whiteBg }],
    });

    const hero = result.candidates.find((c) => c.name === 'hero');
    expect(hero?.changed).toBe(false);
  });

  it('hero candidate has contrast ratios', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [{ name: 'light', color: whiteBg }],
    });

    const hero = result.candidates.find((c) => c.name === 'hero');
    expect(hero?.contrastRatios.length).toBeGreaterThanOrEqual(1);
    expect(hero?.changed).toBe(false);
  });

  it('generates CVD simulations when requested', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [{ name: 'light', color: whiteBg }],
      simulateCVD: true,
    });

    expect(result.cvdSimulations).toBeDefined();
    expect(result.cvdSimulations!.length).toBe(3);

    const types = result.cvdSimulations!.map((s) => s.type);
    expect(types).toContain('protanopia');
    expect(types).toContain('deuteranopia');
    expect(types).toContain('tritanopia');
  });

  it('creates palette candidates with valid RGB ranges', () => {
    const result = generateAccessiblePalette(doc, {
      heroColor,
      backgrounds: [{ name: 'light', color: whiteBg }],
    });

    for (const c of result.candidates) {
      if (c.color.space === 'rgb') {
        expect(c.color.r).toBeGreaterThanOrEqual(0);
        expect(c.color.r).toBeLessThanOrEqual(255);
        expect(c.color.g).toBeGreaterThanOrEqual(0);
        expect(c.color.g).toBeLessThanOrEqual(255);
        expect(c.color.b).toBeGreaterThanOrEqual(0);
        expect(c.color.b).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('applyPaletteAsSwatches', () => {
  it('adds palette colors as swatches', () => {
    const doc = createDocument();
    const result = generateAccessiblePalette(doc, {
      heroColor: { space: 'rgb', r: 57, g: 208, b: 198, a: 1 },
      backgrounds: [{ name: 'light', color: { space: 'rgb', r: 255, g: 255, b: 255, a: 1 } }],
    });

    const updated = applyPaletteAsSwatches(doc, result.candidates);
    expect(updated.swatches?.length).toBeGreaterThanOrEqual(5);

    const names = updated.swatches?.map((s) => s.name) ?? [];
    expect(names).toContain('palette-light');
    expect(names).toContain('palette-surface');
  });

  it('adds palette colors as swatches', () => {
    const doc = createDocument();
    const result = generateAccessiblePalette(doc, {
      heroColor: { space: 'rgb', r: 57, g: 208, b: 198, a: 1 },
      backgrounds: [{ name: 'light', color: { space: 'rgb', r: 255, g: 255, b: 255, a: 1 } }],
    });

    const updated = applyPaletteAsSwatches(doc, result.candidates);
    expect(updated.swatches?.length).toBeGreaterThan(0);
    const names = updated.swatches?.map((s) => s.name) ?? [];
    expect(names).toContain('palette-light');
    expect(names).toContain('palette-surface');
  });
});
