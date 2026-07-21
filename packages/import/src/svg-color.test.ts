/**
 * Tests for SVG color parsing extensions: hsl(), icc-color(), currentColor.
 *
 * Research basis: CSS Color Module Level 4 (W3C), SVG 1.1 color syntax.
 */

import type { RgbColor } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { parseSvgColor } from './svg';

describe('parseSvgColor — hsl()', () => {
  it('parses hsl(120, 100%, 50%) to pure green RGB', () => {
    const c = parseSvgColor('hsl(120, 100%, 50%)');
    expect(c).toEqual({ space: 'rgb', r: 0, g: 255, b: 0, a: 255 });
  });

  it('parses hsla(0, 100%, 50%, 0.5) with alpha', () => {
    const c = parseSvgColor('hsla(0, 100%, 50%, 0.5)');
    expect(c).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 128 });
  });

  it('parses hsl(240, 100%, 50%) to pure blue', () => {
    const c = parseSvgColor('hsl(240,100%,50%)');
    expect(c).toEqual({ space: 'rgb', r: 0, g: 0, b: 255, a: 255 });
  });

  it('parses hsl(0, 0%, 50%) to gray', () => {
    const c = parseSvgColor('hsl(0, 0%, 50%)');
    expect(c).toEqual({ space: 'rgb', r: 128, g: 128, b: 128, a: 255 });
  });
});

describe('parseSvgColor — icc-color()', () => {
  it('parses icc-color(FOGRA39, ...) and stores profile field', () => {
    const c = parseSvgColor('icc-color(FOGRA39, 0.5, 0.2, 0.8)');
    expect(c).toBeDefined();
    const rgb = c as RgbColor;
    expect(rgb.space).toBe('rgb');
    expect(rgb.profile).toBe('FOGRA39');
  });

  it('parses icc-color with profile name containing digits', () => {
    const c = parseSvgColor('icc-color(GRACoL2006, 1, 0, 0)');
    expect(c).toBeDefined();
    const rgb = c as RgbColor;
    expect(rgb.profile).toBe('GRACoL2006');
  });
});

describe('parseSvgColor — currentColor', () => {
  it('returns null for currentColor', () => {
    expect(parseSvgColor('currentColor')).toBeNull();
  });
});
