import type { Preset } from '@varve/shared';
import { physicalToPx } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { CMYK_PROFILES, RGB_PROFILES } from './colorManagement';
import {
  createDocumentFromPreset,
  createDocumentOptionsFromPreset,
  resolveColorProfileRef,
} from './presetToDocument';

const printPreset: Preset = {
  id: 'a4-print',
  name: 'A4',
  category: 'paper',
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  dpi: 300,
  colorMode: 'cmyk',
  colorProfileId: 'fogra51',
  bleed: { value: 3, unit: 'mm' },
};

const screenPreset: Preset = {
  id: 'web-frame',
  name: 'Web Frame',
  category: 'web',
  width: 1440,
  height: 900,
  unit: 'px',
  orientation: 'landscape',
  colorMode: 'rgb',
};

describe('createDocumentOptionsFromPreset', () => {
  it('maps sizing, unit, color mode, dpi, and converts bleed to a BleedConfig', () => {
    const opts = createDocumentOptionsFromPreset(printPreset);
    expect(opts.physicalWidth).toBe(210);
    expect(opts.physicalHeight).toBe(297);
    expect(opts.documentUnit).toBe('mm');
    expect(opts.colorMode).toBe('cmyk');
    expect(opts.dpi).toBe(300);
    expect(opts.bleed).toEqual({ top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' });
  });

  it('leaves bleed undefined when the preset has none', () => {
    const opts = createDocumentOptionsFromPreset(screenPreset);
    expect(opts.bleed).toBeUndefined();
    expect(opts.dpi).toBeUndefined();
  });
});

describe('createDocumentFromPreset', () => {
  it('creates a document whose page geometry reflects the fixed-96dpi physical conversion', () => {
    const doc = createDocumentFromPreset(printPreset);
    expect(doc.pages?.[0]?.width).toBeCloseTo(physicalToPx(210, 'mm'), 4);
    expect(doc.pages?.[0]?.height).toBeCloseTo(physicalToPx(297, 'mm'), 4);
    expect(doc.physicalWidth).toBe(210);
    expect(doc.dpi).toBe(300);
  });

  it('resolves a preset colorProfileId into the real ColorProfileRef for the mode (cmyk)', () => {
    const doc = createDocumentFromPreset(printPreset);
    expect(doc.colorConfig?.mode).toBe('cmyk');
    expect(doc.colorConfig?.cmykProfile).toEqual(CMYK_PROFILES.fogra51);
  });

  it('resolves an rgb colorProfileId into rgbProfile, not cmykProfile', () => {
    const rgbPreset: Preset = { ...screenPreset, colorMode: 'rgb', colorProfileId: 'display-p3' };
    const doc = createDocumentFromPreset(rgbPreset);
    expect(doc.colorConfig?.rgbProfile).toEqual(RGB_PROFILES.displayP3);
  });

  it('is a no-op on colorConfig when the preset has no colorProfileId', () => {
    const doc = createDocumentFromPreset(screenPreset);
    expect(doc.colorConfig?.rgbProfile).toEqual(RGB_PROFILES.srgb);
  });

  it('does not crash and keeps the default profile when colorProfileId is unknown', () => {
    const doc = createDocumentFromPreset({ ...printPreset, colorProfileId: 'does-not-exist' });
    expect(doc.colorConfig?.cmykProfile).toEqual(CMYK_PROFILES.fogra39);
  });

  it('uses the preset name as the document name by default', () => {
    const doc = createDocumentFromPreset(screenPreset);
    expect(doc.name).toBe('Web Frame');
  });

  it('accepts an explicit name override', () => {
    const doc = createDocumentFromPreset(screenPreset, 'My Custom Name');
    expect(doc.name).toBe('My Custom Name');
  });
});

describe('resolveColorProfileRef', () => {
  it('finds a profile in either the RGB or CMYK registry', () => {
    expect(resolveColorProfileRef('srgb')).toEqual(RGB_PROFILES.srgb);
    expect(resolveColorProfileRef('fogra39')).toEqual(CMYK_PROFILES.fogra39);
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveColorProfileRef('not-a-real-profile')).toBeUndefined();
  });
});
