/**
 * Tests for import color validation — checks compatibility between imported
 * colors and the target document's color model.
 */

import type { ColorConfig, ManagedColor } from '@varve/scene';
import { defaultCmykColorConfig, defaultColorConfig } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { validateImportColor } from './validation';

function warningMessages(warnings: { message: string }[]): string[] {
  return warnings.map((w) => w.message);
}

describe('validateImportColor', () => {
  it('returns no warnings for RGB color into RGB document (same bit depth)', () => {
    const docConfig = defaultColorConfig('rgb', 'uint8');
    const color: ManagedColor = { space: 'rgb', r: 128, g: 64, b: 255, a: 255 };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings).toEqual([]);
  });

  it('warns when imported color has higher bitDepth than document', () => {
    const docConfig = defaultColorConfig('rgb', 'uint8');
    const color: ManagedColor = {
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.5,
      g: 0.2,
      b: 0.8,
      a: 1,
    };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(warningMessages(result.warnings)[0]).toMatch(/float32/i);
    expect(warningMessages(result.warnings)[0]).toMatch(/precision/i);
  });

  it('warns when importing CMYK color into RGB document', () => {
    const docConfig = defaultColorConfig('rgb', 'uint8');
    const color: ManagedColor = {
      space: 'cmyk',
      c: 100,
      m: 50,
      y: 0,
      k: 10,
      a: 255,
    };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(warningMessages(result.warnings)[0]).toMatch(/cmyk.*rgb/i);
  });

  it('includes rendering intent in CMYK→RGB warning when output intent set', () => {
    const docConfig: ColorConfig = {
      ...defaultCmykColorConfig('uint8'),
      outputIntent: {
        profile: { id: 'fogra39', name: 'Fogra39' },
        renderingIntent: 'relative',
        blackPointCompensation: true,
      },
    };
    const color: ManagedColor = {
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(warningMessages(result.warnings)[0]).toMatch(/relative/i);
  });

  it('warns when imported ICC profile differs from document profile', () => {
    const docConfig = defaultColorConfig('rgb', 'uint8');
    const color: ManagedColor = {
      space: 'rgb',
      r: 100,
      g: 150,
      b: 200,
      a: 255,
      profile: 'display-p3',
    };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(warningMessages(result.warnings)[0]).toMatch(/profile/i);
  });

  it('returns no warnings for CMYK color into CMYK document', () => {
    const docConfig = defaultCmykColorConfig('uint8');
    const color: ManagedColor = {
      space: 'cmyk',
      c: 50,
      m: 25,
      y: 0,
      k: 5,
      a: 255,
    };
    const result = validateImportColor(color, docConfig);
    expect(result.warnings).toEqual([]);
  });
});
