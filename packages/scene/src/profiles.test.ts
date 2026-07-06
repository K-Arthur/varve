import { describe, expect, it } from 'vitest';
import { BUNDLED_CMYK_PROFILES, BUNDLED_RGB_PROFILES, getProfileById } from './profiles';

describe('BUNDLED_RGB_PROFILES', () => {
  it('includes sRGB', () => {
    const srgb = BUNDLED_RGB_PROFILES.find((p) => p.id === 'srgb');
    expect(srgb).toBeDefined();
    expect(srgb?.name).toContain('sRGB');
  });

  it('includes Display P3', () => {
    const p3 = BUNDLED_RGB_PROFILES.find((p) => p.id === 'display-p3');
    expect(p3).toBeDefined();
  });

  it('each profile has id, name, embedded fields', () => {
    for (const p of BUNDLED_RGB_PROFILES) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.embedded).toBe('boolean');
    }
  });
});

describe('BUNDLED_CMYK_PROFILES', () => {
  it('includes Fogra39', () => {
    const f39 = BUNDLED_CMYK_PROFILES.find((p) => p.id === 'fogra39');
    expect(f39).toBeDefined();
    expect(f39?.name).toContain('Fogra39');
  });

  it('includes GRACoL 2006', () => {
    const gracol = BUNDLED_CMYK_PROFILES.find((p) => p.id === 'gracol2006');
    expect(gracol).toBeDefined();
  });

  it('each profile has id, name, embedded fields', () => {
    for (const p of BUNDLED_CMYK_PROFILES) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.embedded).toBe('boolean');
    }
  });
});

describe('getProfileById', () => {
  it('finds sRGB profile', () => {
    const p = getProfileById('srgb');
    expect(p).toBeDefined();
    expect(p?.id).toBe('srgb');
  });

  it('finds Fogra39 profile', () => {
    const p = getProfileById('fogra39');
    expect(p).toBeDefined();
    expect(p?.id).toBe('fogra39');
  });

  it('returns undefined for unknown profile', () => {
    expect(getProfileById('nonexistent')).toBeUndefined();
  });
});
