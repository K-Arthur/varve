import { describe, expect, it } from 'vitest';
import {
  CMYK_PROFILES,
  cmykToTuple,
  DEFAULT_BLACK_GENERATION,
  DEFAULT_BLEED,
  DEFAULT_SAFE_AREA,
  defaultCmykColorConfig,
  defaultColorConfig,
  defaultRgbColorConfig,
  isCmykColor,
  isGrayColor,
  isRgbColor,
  isSpotColor,
  RGB_PROFILES,
  rgbFromTuple,
  rgbToTuple,
  uniformBleed,
} from './colorManagement';

describe('ColorMode', () => {
  it('defaultColorConfig returns RGB for rgb mode', () => {
    const cfg = defaultColorConfig('rgb');
    expect(cfg.mode).toBe('rgb');
    expect(cfg.rgbProfile.id).toBe('srgb');
  });

  it('defaultColorConfig returns CMYK for cmyk mode', () => {
    const cfg = defaultColorConfig('cmyk');
    expect(cfg.mode).toBe('cmyk');
    expect(cfg.cmykProfile.id).toBe('fogra39');
    expect(cfg.outputIntent).toBeDefined();
    expect(cfg.outputIntent?.renderingIntent).toBe('relative');
  });

  it('defaultColorConfig defaults to rgb', () => {
    expect(defaultColorConfig().mode).toBe('rgb');
  });

  it('defaultRgbColorConfig has sRGB and Fogra39', () => {
    const cfg = defaultRgbColorConfig();
    expect(cfg.rgbProfile.id).toBe('srgb');
    expect(cfg.cmykProfile.id).toBe('fogra39');
    expect(cfg.outputIntent).toBeUndefined();
  });

  it('defaultCmykColorConfig has output intent', () => {
    const cfg = defaultCmykColorConfig();
    expect(cfg.outputIntent).toBeDefined();
    expect(cfg.outputIntent?.profile.id).toBe('fogra39');
    expect(cfg.outputIntent?.blackPointCompensation).toBe(true);
  });
});

describe('ManagedColor type guards', () => {
  it('isRgbColor', () => {
    expect(isRgbColor({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 })).toBe(true);
    expect(isRgbColor({ space: 'cmyk', c: 0, m: 100, y: 100, k: 0, a: 255 })).toBe(false);
  });

  it('isCmykColor', () => {
    expect(isCmykColor({ space: 'cmyk', c: 0, m: 100, y: 100, k: 0, a: 255 })).toBe(true);
    expect(isCmykColor({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 })).toBe(false);
  });

  it('isGrayColor', () => {
    expect(isGrayColor({ space: 'gray', v: 128, a: 255 })).toBe(true);
    expect(isGrayColor({ space: 'rgb', r: 128, g: 128, b: 128, a: 255 })).toBe(false);
  });

  it('isSpotColor', () => {
    expect(isSpotColor({ space: 'spot', name: 'Pantone 185 C', tint: 100, a: 255 })).toBe(true);
    expect(isSpotColor({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 })).toBe(false);
  });
});

describe('rgbFromTuple / rgbToTuple', () => {
  it('converts legacy Color tuple to RgbColor', () => {
    const c = rgbFromTuple([57, 208, 198, 255]);
    expect(c.space).toBe('rgb');
    expect(c.r).toBe(57);
    expect(c.g).toBe(208);
    expect(c.b).toBe(198);
    expect(c.a).toBe(255);
  });

  it('converts RgbColor back to tuple', () => {
    const tuple = rgbToTuple({ space: 'rgb', r: 255, g: 0, b: 0, a: 128 });
    expect(tuple).toEqual([255, 0, 0, 128]);
  });

  it('round-trips tuple -> RgbColor -> tuple', () => {
    const original: [number, number, number, number] = [100, 150, 200, 255];
    const c = rgbFromTuple(original);
    const back = rgbToTuple(c);
    expect(back).toEqual(original);
  });
});

describe('cmykToTuple', () => {
  it('converts CmykColor to 5-tuple', () => {
    const c = { space: 'cmyk' as const, c: 100, m: 50, y: 0, k: 25, a: 255 };
    expect(cmykToTuple(c)).toEqual([100, 50, 0, 25, 255]);
  });
});

describe('BleedConfig', () => {
  it('uniformBleed creates linked config', () => {
    const b = uniformBleed(3, 'mm');
    expect(b.top).toBe(3);
    expect(b.right).toBe(3);
    expect(b.bottom).toBe(3);
    expect(b.left).toBe(3);
    expect(b.linked).toBe(true);
    expect(b.unit).toBe('mm');
  });

  it('DEFAULT_BLEED is 3mm linked', () => {
    expect(DEFAULT_BLEED.top).toBe(3);
    expect(DEFAULT_BLEED.linked).toBe(true);
    expect(DEFAULT_BLEED.unit).toBe('mm');
  });
});

describe('SafeAreaConfig', () => {
  it('DEFAULT_SAFE_AREA is 5mm disabled', () => {
    expect(DEFAULT_SAFE_AREA.top).toBe(5);
    expect(DEFAULT_SAFE_AREA.enabled).toBe(false);
    expect(DEFAULT_SAFE_AREA.unit).toBe('mm');
  });
});

describe('BlackGenerationConfig', () => {
  it('DEFAULT_BLACK_GENERATION is standard no overprint', () => {
    expect(DEFAULT_BLACK_GENERATION.mode).toBe('standard');
    expect(DEFAULT_BLACK_GENERATION.overprintBlack).toBe(false);
  });
});

describe('Profile registries', () => {
  it('RGB_PROFILES has srgb and display-p3', () => {
    expect(RGB_PROFILES.srgb.id).toBe('srgb');
    expect(RGB_PROFILES.displayP3.id).toBe('display-p3');
  });

  it('CMYK_PROFILES has fogra39 and gracol2006', () => {
    expect(CMYK_PROFILES.fogra39.id).toBe('fogra39');
    expect(CMYK_PROFILES.gracol2006.id).toBe('gracol2006');
  });
});
