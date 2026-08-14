import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EXTENSIONS,
  formatFileName,
  resolveCollisions,
  safeFolder,
  sanitizeFileName,
  sanitizeSegment,
  scaleToken,
} from './naming';

describe('sanitizeSegment', () => {
  it('strips reserved filename characters', () => {
    expect(sanitizeSegment('a:b<c>d/e\\f|g?h*i"j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('removes trailing dots and spaces', () => {
    expect(sanitizeSegment('Logo.')).toBe('Logo');
    expect(sanitizeSegment('Logo  ')).toBe('Logo');
    expect(sanitizeSegment('Logo...')).toBe('Logo');
  });

  it('replaces a leading dot', () => {
    expect(sanitizeSegment('.hidden')).toBe('_hidden');
  });

  it('guards reserved Windows device names case-insensitively', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('con')).toBe('_con');
    expect(sanitizeSegment('LPT1')).toBe('_LPT1');
    expect(sanitizeSegment('NotCon')).toBe('NotCon');
  });

  it('normalizes unicode to NFC', () => {
    expect(sanitizeSegment('caf\u00e9')).toBe('caf\u00e9');
    // e + combining acute -> NFC e-acute
    expect(sanitizeSegment('cafe\u0301')).toBe('caf\u00e9');
  });

  it('falls back when the result is empty', () => {
    expect(sanitizeSegment('')).toBe('_');
    expect(sanitizeSegment('...')).toBe('_');
  });

  it('truncates over-long segments', () => {
    expect(sanitizeSegment('a'.repeat(200), { maxLength: 16 })).toHaveLength(16);
  });
});

describe('sanitizeFileName', () => {
  it('keeps the extension', () => {
    expect(sanitizeFileName('Logo', '.png')).toBe('Logo.png');
    expect(sanitizeFileName('Logo', 'png')).toBe('Logo.png');
  });

  it('sanitizes the base and keeps the extension', () => {
    expect(sanitizeFileName('A/B', '.svg')).toBe('A_B.svg');
    expect(sanitizeFileName('CON', '.pdf')).toBe('_CON.pdf');
  });
});

describe('scaleToken', () => {
  it('renders multiplier, width, height, and dpi tokens', () => {
    expect(scaleToken({ mode: 'multiplier', value: 2 })).toBe('2x');
    expect(scaleToken({ mode: 'multiplier', value: 1.5 })).toBe('1.5x');
    expect(scaleToken({ mode: 'width', value: 400, unit: 'px' })).toBe('400w');
    expect(scaleToken({ mode: 'height', value: 200, unit: 'px' })).toBe('200h');
    expect(scaleToken({ mode: 'resolution', dpi: 300 })).toBe('300dpi');
  });
});

describe('formatFileName', () => {
  const base = {
    name: 'Logo',
    format: 'png' as const,
    scale: { mode: 'multiplier' as const, value: 2 },
  };

  it('resolves the default template with suffix and extension', () => {
    const name = formatFileName('{name}{suffix}.{ext}', {
      ...base,
      suffix: '@2x',
    });
    expect(name).toBe('Logo@2x.png');
  });

  it('sanitizes the name portion but not the extension', () => {
    const name = formatFileName('{name}.{ext}', {
      ...base,
      name: 'My:Logo',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('My_Logo.png');
  });

  it('supports folder templates with page grouping', () => {
    const name = formatFileName('{page}/{name}.{ext}', {
      ...base,
      page: 'Chapter 1',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('Chapter 1/Logo.png');
  });

  it('supports index and width tokens', () => {
    const name = formatFileName('{name}-{index}-{width}w.{ext}', {
      ...base,
      index: 3,
      width: 200,
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('Logo-3-200w.png');
  });

  it('drops empty folder segments but keeps the file', () => {
    const name = formatFileName('/{name}.{ext}', {
      ...base,
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('Logo.png');
  });

  it('uses the canonical extension when none given', () => {
    const name = formatFileName('{name}.{ext}', {
      ...base,
      format: 'jpeg',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('Logo.jpg');
  });

  it('collapses a duplicate extension when the name already carries it', () => {
    // A node named `logo.png` must not export as `logo.png.png`.
    const name = formatFileName('{name}.{ext}', {
      ...base,
      name: 'logo.png',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('logo.png');
  });

  it('collapses a duplicate extension case-insensitively', () => {
    const name = formatFileName('{name}.{ext}', {
      ...base,
      name: 'logo.PNG',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('logo.png');
  });

  it('keeps legitimate interior dots when the extension differs', () => {
    const name = formatFileName('{name}.{ext}', {
      ...base,
      name: 'my.design',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(name).toBe('my.design.png');
  });
});

describe('resolveCollisions', () => {
  const outputs = [
    { configurationId: 'a', fileName: 'logo.png', relativePath: 'logo.png' },
    { configurationId: 'b', fileName: 'logo.png', relativePath: 'logo.png' },
    { configurationId: 'c', fileName: 'hero.svg', relativePath: 'hero.svg' },
  ];

  it('renames duplicates deterministically by default', () => {
    const result = resolveCollisions(outputs);
    expect(result.outputs.map((o) => o.relativePath)).toEqual([
      'logo.png',
      'logo-2.png',
      'hero.svg',
    ]);
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.configurationIds).toEqual(['a', 'b']);
  });

  it('detects case-insensitive collisions', () => {
    const result = resolveCollisions([
      { configurationId: 'a', fileName: 'Logo.PNG', relativePath: 'Logo.PNG' },
      { configurationId: 'b', fileName: 'logo.png', relativePath: 'logo.png' },
    ]);
    expect(result.collisions).toHaveLength(1);
    expect(result.outputs.map((o) => o.relativePath)).toEqual(['Logo.PNG', 'logo-2.png']);
  });

  it('supports a skip policy', () => {
    const result = resolveCollisions(outputs, 'skip');
    expect(result.skipped).toEqual(['b']);
    expect(result.outputs.map((o) => o.relativePath)).toEqual(['logo.png', 'hero.svg']);
  });

  it('supports a replace policy (last writer wins)', () => {
    const result = resolveCollisions(outputs, 'replace');
    expect(result.replaced).toEqual(['a']);
    expect(result.outputs.map((o) => o.relativePath)).toEqual(['logo.png', 'hero.svg']);
  });
});

describe('safeFolder', () => {
  it('rejects traversal and absolute paths', () => {
    expect(safeFolder('../escape')).toBeNull();
    expect(safeFolder('a/../../b')).toBeNull();
    expect(safeFolder('/abs/path')).toBe('abs/path');
  });

  it('normalizes backslashes and trims leading slashes', () => {
    expect(safeFolder('//exports')).toBe('exports');
    expect(safeFolder('folder\\sub')).toBe('folder/sub');
  });

  it('returns null for empty input', () => {
    expect(safeFolder('')).toBeNull();
    expect(safeFolder(null)).toBeNull();
    expect(safeFolder(undefined)).toBeNull();
  });
});

describe('CANONICAL_EXTENSIONS', () => {
  it('maps every format to a non-empty extension', () => {
    for (const ext of Object.values(CANONICAL_EXTENSIONS)) {
      expect(ext.startsWith('.')).toBe(true);
      expect(ext.length).toBeGreaterThan(1);
    }
  });
});
