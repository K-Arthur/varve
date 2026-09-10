import { describe, expect, it } from 'vitest';
import {
  familyFromLabel,
  getClassIndicesForFamily,
  getKnownFamilies,
  normalizeFamilyName,
  resolveClassIndex,
  TOTAL_CLASS_COUNT,
} from './fontClassLabels';

describe('resolveClassIndex', () => {
  it('resolves known class indices from embedded map', () => {
    const result = resolveClassIndex(0);
    expect(result.family).toBe('Inter');
    expect(result.style).toBe('Regular');
    expect(result.isExact).toBe(true);
  });

  it('resolves Roboto Bold', () => {
    const result = resolveClassIndex(7);
    expect(result.family).toBe('Roboto');
    expect(result.style).toBe('Bold');
    expect(result.isExact).toBe(true);
  });

  it('falls back gracefully for unknown indices', () => {
    const result = resolveClassIndex(3000);
    expect(result.family).toBe('Unknown Font 3000');
    expect(result.isExact).toBe(false);
  });

  it('returns the class index in the result', () => {
    const result = resolveClassIndex(42);
    expect(result.classIndex).toBe(42);
  });
});

describe('normalizeFamilyName', () => {
  it('strips "Variable" suffix', () => {
    expect(normalizeFamilyName('Inter Variable')).toBe('Inter');
  });

  it('strips "VF" suffix', () => {
    expect(normalizeFamilyName('Roboto VF')).toBe('Roboto');
  });

  it('strips weight tokens from the end', () => {
    expect(normalizeFamilyName('Inter Bold')).toBe('Inter');
    expect(normalizeFamilyName('Inter Semi Bold')).toBe('Inter');
  });

  it('preserves names without variant tokens', () => {
    expect(normalizeFamilyName('Inter')).toBe('Inter');
  });

  it('handles multi-word family names', () => {
    expect(normalizeFamilyName('Open Sans Bold')).toBe('Open Sans');
  });
});

describe('familyFromLabel', () => {
  it('combines family and style', () => {
    expect(familyFromLabel('Inter', 'Bold')).toBe('Inter');
  });

  it('returns family alone for Regular style', () => {
    expect(familyFromLabel('Inter', 'Regular')).toBe('Inter');
  });
});

describe('getClassIndicesForFamily', () => {
  it('returns all indices for a family', () => {
    const indices = getClassIndicesForFamily('Inter');
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(0);
    expect(indices).toContain(1);
  });

  it('returns empty array for unknown family', () => {
    expect(getClassIndicesForFamily('NonExistentFont')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const lower = getClassIndicesForFamily('inter');
    const upper = getClassIndicesForFamily('INTER');
    expect(lower).toEqual(upper);
  });
});

describe('getKnownFamilies', () => {
  it('returns sorted unique family names', () => {
    const families = getKnownFamilies();
    expect(families.length).toBeGreaterThan(0);
    expect(families).toContain('Inter');
    expect(families).toContain('Roboto');
    const sorted = [...families].sort((a, b) => a.localeCompare(b));
    expect(families).toEqual(sorted);
  });
});

describe('TOTAL_CLASS_COUNT', () => {
  it('equals 3473', () => {
    expect(TOTAL_CLASS_COUNT).toBe(3473);
  });
});
