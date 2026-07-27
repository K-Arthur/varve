import { describe, expect, it } from 'vitest';
import {
  createIconVariant,
  createIconVariantFamily,
  getAvailableStates,
  getAvailableStyles,
  resolveVariant,
} from './iconVariants';

describe('createIconVariant', () => {
  it('creates a variant with computed id', () => {
    const v = createIconVariant('home', 'filled', '<svg></svg>');
    expect(v.id).toBe('home-filled');
    expect(v.style).toBe('filled');
  });
});

describe('createIconVariantFamily', () => {
  it('creates a family from variant definitions', () => {
    const family = createIconVariantFamily('star', [
      { style: 'outline', svg: '<svg>outline</svg>' },
      { style: 'filled', svg: '<svg>filled</svg>' },
    ]);
    expect(family.concept).toBe('star');
    expect(family.variants).toHaveLength(2);
    expect(family.defaultVariantId).toBe('star-outline');
  });
});

describe('resolveVariant', () => {
  const family = createIconVariantFamily('bookmark', [
    { style: 'outline', svg: '<svg>outline</svg>' },
    { style: 'filled', svg: '<svg>filled</svg>' },
    { style: 'sharp', svg: '<svg>sharp</svg>' },
  ]);

  it('resolves default variant when no preferences', () => {
    const result = resolveVariant(family);
    expect(result?.style).toBe('outline');
  });

  it('resolves by style', () => {
    const result = resolveVariant(family, { style: 'filled' });
    expect(result?.style).toBe('filled');
  });

  it('returns null for unknown style', () => {
    const result = resolveVariant(family, { style: 'duotone' });
    expect(result).toBeNull();
  });
});

describe('getAvailableStyles', () => {
  it('returns unique styles', () => {
    const family = createIconVariantFamily('test', [
      { style: 'outline', svg: '' },
      { style: 'filled', svg: '' },
    ]);
    expect(getAvailableStyles(family)).toEqual(['outline', 'filled']);
  });
});

describe('getAvailableStates', () => {
  it('returns unique states', () => {
    const family = createIconVariantFamily('toggle', [
      { style: 'outline', svg: '', state: 'unchecked' },
      { style: 'filled', svg: '', state: 'checked' },
    ]);
    expect(getAvailableStates(family)).toEqual(['unchecked', 'checked']);
  });
});
