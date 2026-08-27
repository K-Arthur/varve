import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontRegistry, getFontRegistry, resetFontRegistry } from './fontRegistry';

/** Check if the current test environment has document (i.e. jsdom). */
function hasDom(): boolean {
  try {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  } catch {
    return false;
  }
}

afterEach(() => {
  resetFontRegistry();
});

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

  it('resolve builds a CSS font-family string with quoted family and unquoted fallbacks', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'Inter', weight: 400, style: 'normal', source: 'system' });
    const result = reg.resolve('Inter');
    expect(result).toBe('"Inter", sans-serif, serif, monospace');
  });

  it('resolve does not quote generic font names', () => {
    const reg = new FontRegistry();
    expect(reg.resolve('sans-serif')).toBe('sans-serif');
    expect(reg.resolve('serif')).toBe('serif');
    expect(reg.resolve('monospace')).toBe('monospace');
  });

  it('buildFontCSS produces a valid shorthand with quoted family and fallbacks', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'Inter', weight: 400, style: 'normal', source: 'system' });
    const css = reg.buildFontCSS('Inter', 16, 700, 'italic', 1.5);
    expect(css).toBe('italic 700 16px/1.5 "Inter", sans-serif, serif, monospace');
  });

  it('isAvailable returns true only for loaded state', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'A', weight: 400, style: 'normal', source: 'system' });
    expect(reg.isAvailable('A')).toBe(false);
    (reg as unknown as { loadState: Map<string, string> }).loadState.set('A', 'loaded');
    expect(reg.isAvailable('A')).toBe(true);
    (reg as unknown as { loadState: Map<string, string> }).loadState.set('A', 'error');
    expect(reg.isAvailable('A')).toBe(false);
  });

  it('isRegistered returns true for registered families regardless of load state', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'B', weight: 400, style: 'normal', source: 'system' });
    expect(reg.isRegistered('B')).toBe(true);
    expect(reg.isRegistered('Unknown')).toBe(false);
  });

  it('singleton getFontRegistry returns same instance', () => {
    resetFontRegistry();
    const a = getFontRegistry();
    const b = getFontRegistry();
    expect(a).toBe(b);
  });

  it('advances its revision when font registration changes', () => {
    const reg = new FontRegistry([]);
    const initial = reg.revision;
    reg.register({ family: 'Revision Test', weight: 400, style: 'normal', source: 'system' });
    expect(reg.revision).not.toBe(initial);
  });

  it('registers a font entry with url source', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'Roboto',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400',
    });
    expect(reg.families()).toContain('Roboto');
    const v = reg.variants('Roboto');
    expect(v).toHaveLength(1);
    expect(v[0]?.weight).toBe(400);
  });

  it('registers a font entry with variableAxes', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'Roboto Flex',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@100..900',
      variableAxes: { wght: 400, wdth: 100, slnt: 0 },
    });
    expect(reg.hasVariant('Roboto Flex', 400, 'normal')).toBe(true);
  });

  it('getEntries returns all entries for a family', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'Open Sans',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'url',
    });
    reg.register({
      family: 'Open Sans',
      weight: 700,
      style: 'normal',
      source: 'google',
      url: 'url',
    });
    const entries = reg.getEntries('Open Sans');
    expect(entries).toHaveLength(2);
  });

  it('loadAll loads all unique families', async () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'TestA', weight: 400, style: 'normal', source: 'system' });
    reg.register({ family: 'TestA', weight: 700, style: 'normal', source: 'system' });
    reg.register({ family: 'TestB', weight: 400, style: 'normal', source: 'system' });
    const loadSpy = vi.spyOn(reg as any, 'doLoad').mockResolvedValue(undefined);
    await reg.loadAll();
    expect(loadSpy).toHaveBeenCalledWith('TestA');
    expect(loadSpy).toHaveBeenCalledWith('TestB');
    loadSpy.mockRestore();
  });

  it('state returns unknown for unloaded font', () => {
    const reg = new FontRegistry([]);
    expect(reg.state('Nonexistent')).toBe('unknown');
  });

  it('state returns loaded after successful load', async () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'TestFont', weight: 400, style: 'normal', source: 'system' });
    vi.spyOn(reg as any, 'doLoad').mockResolvedValue(undefined);
    await reg.load('TestFont');
    expect(reg.state('TestFont')).toBe('loaded');
  });

  it('state returns error after failed load', async () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'BadFont', weight: 400, style: 'normal', source: 'system' });
    vi.spyOn(reg as any, 'doLoad').mockRejectedValue(new Error('fail'));
    await reg.load('BadFont');
    expect(reg.state('BadFont')).toBe('error');
  });

  it('isAvailable returns true for fonts with loaded state', async () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'OkFont', weight: 400, style: 'normal', source: 'system' });
    vi.spyOn(reg as any, 'doLoad').mockResolvedValue(undefined);
    await reg.load('OkFont');
    expect(reg.isAvailable('OkFont')).toBe(true);
  });

  it('isAvailable returns false for unregistered fonts', () => {
    const reg = new FontRegistry([]);
    expect(reg.isAvailable('Ghost')).toBe(false);
  });

  it('isAvailable returns false for failed fonts', async () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'FailFont', weight: 400, style: 'normal', source: 'system' });
    vi.spyOn(reg as any, 'doLoad').mockRejectedValue(new Error('fail'));
    await reg.load('FailFont');
    expect(reg.isAvailable('FailFont')).toBe(false);
  });

  it('isMissing returns true for unregistered fonts', () => {
    const reg = new FontRegistry([]);
    expect(reg.isMissing('SomeUnknownFont')).toBe(true);
  });

  it('isMissing returns false for registered fonts', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'KnownFont', weight: 400, style: 'normal', source: 'system' });
    expect(reg.isMissing('KnownFont')).toBe(false);
  });

  it('isMissing returns false for generic names', () => {
    const reg = new FontRegistry([]);
    expect(reg.isMissing('sans-serif')).toBe(false);
    expect(reg.isMissing('serif')).toBe(false);
    expect(reg.isMissing('monospace')).toBe(false);
  });

  it('buildFontCSS returns a font shorthand string', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'TestFont', weight: 400, style: 'normal', source: 'system' });
    const css = reg.buildFontCSS('TestFont', 16, 700, 'italic', 1.5);
    expect(css).toContain('italic');
    expect(css).toContain('700');
    expect(css).toContain('16px');
    expect(css).toContain('1.5');
    expect(css).toContain('TestFont');
  });

  it('buildVariationSettings returns undefined when no axes registered', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'PlainFont', weight: 400, style: 'normal', source: 'system' });
    expect(reg.buildVariationSettings('PlainFont')).toBeUndefined();
  });

  it('buildVariationSettings returns CSS when axes registered', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'VarFont',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'url',
      variableAxes: { wght: 500, wdth: 75 },
    });
    const css = reg.buildVariationSettings('VarFont');
    expect(css).toContain('font-variation-settings');
    expect(css).toContain('"wght"');
    expect(css).toContain('500');
    expect(css).toContain('"wdth"');
    expect(css).toContain('75');
  });

  it('getVariableAxes returns axes for a family', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'AxesFont',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'url',
      variableAxes: { slnt: 0, opsz: 14 },
    });
    const axes = reg.getVariableAxes('AxesFont');
    expect(axes).toEqual({ slnt: 0, opsz: 14 });
  });

  it('getVariableAxes returns undefined for fonts without axes', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'NoAxes', weight: 400, style: 'normal', source: 'system' });
    expect(reg.getVariableAxes('NoAxes')).toBeUndefined();
  });

  it('buildFeatureSettings returns undefined for empty features', () => {
    const reg = new FontRegistry();
    expect(reg.buildFeatureSettings(undefined)).toBeUndefined();
    expect(reg.buildFeatureSettings({})).toBeUndefined();
  });

  it('buildFeatureSettings returns CSS for enabled features', () => {
    const reg = new FontRegistry();
    const css = reg.buildFeatureSettings({ liga: true, kern: true, dlig: false });
    expect(css).toContain('font-feature-settings');
    expect(css).toContain('"liga" 1');
    expect(css).toContain('"kern" 1');
    expect(css).toContain('"dlig" 0');
  });

  it('buildFeatureSettings handles custom features', () => {
    const reg = new FontRegistry();
    const features: Record<string, unknown> = {
      liga: true,
      custom: { ss01: true, ss02: false },
    };
    const css = reg.buildFeatureSettings(features);
    expect(css).toContain('"liga" 1');
    expect(css).toContain('"ss01" 1');
    expect(css).toContain('"ss02" 0');
  });

  it('registerFeatures and getSupportedFeatures work', () => {
    const reg = new FontRegistry();
    reg.registerFeatures('Inter', ['liga', 'kern', 'tnum', 'ss01']);
    expect(reg.getSupportedFeatures('Inter')).toEqual(['liga', 'kern', 'tnum', 'ss01']);
    expect(reg.getSupportedFeatures('Unknown')).toEqual([]);
  });

  it('registerMetadata and getMetadata work', () => {
    const reg = new FontRegistry();
    reg.registerMetadata({
      family: 'Inter',
      postScriptName: 'Inter-Regular',
      format: 'woff2',
      openTypeFeatures: ['liga', 'kern'],
      unitsPerEm: 2816,
      ascender: 2750,
      isCJK: false,
    });
    const meta = reg.getMetadata('Inter');
    expect(meta).toBeDefined();
    expect(meta?.postScriptName).toBe('Inter-Regular');
    expect(meta?.openTypeFeatures).toEqual(['liga', 'kern']);
    expect(meta?.unitsPerEm).toBe(2816);
  });

  it('isVariable returns true for variable fonts', () => {
    const reg = new FontRegistry([]);
    reg.register({
      family: 'VarFont',
      weight: 400,
      style: 'normal',
      source: 'google',
      variableAxes: { wght: 400 },
    });
    expect(reg.isVariable('VarFont')).toBe(true);
    expect(reg.isVariable('Inter')).toBe(false);
  });

  it('variableFamilies lists only variable fonts', () => {
    const reg = new FontRegistry([]);
    reg.register({ family: 'StaticFont', weight: 400, style: 'normal', source: 'system' });
    reg.register({
      family: 'VarFont',
      weight: 400,
      style: 'normal',
      source: 'google',
      variableAxes: { wght: 400 },
    });
    const vars = reg.variableFamilies();
    expect(vars).toContain('VarFont');
    expect(vars).not.toContain('StaticFont');
  });

  it('availableFamilies returns a Set of family names', () => {
    const reg = new FontRegistry();
    const available = reg.availableFamilies();
    expect(available).toBeInstanceOf(Set);
    expect(available.has('Inter')).toBe(true);
    expect(available.has('Arial')).toBe(true);
  });
});

describe('FontRegistry DOM-dependent', () => {
  it('bridges CSS FontFaceSet completion into the registry revision stream', () => {
    if (!hasDom() || !document.fonts || typeof document.fonts.dispatchEvent !== 'function') return;
    const reg = new FontRegistry([]);
    const listener = vi.fn();
    reg.subscribe(listener);
    document.fonts.dispatchEvent(new Event('loadingdone'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('prefetches only requested document faces and advances the revision', async () => {
    if (!hasDom() || !document.fonts || typeof document.fonts.load !== 'function') return;
    const reg = new FontRegistry([]);
    const load = vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const listener = vi.fn();
    reg.subscribe(listener);
    await reg.ensureDocumentFonts([
      { family: 'Geist Variable' },
      { family: 'Geist Variable' },
      { family: 'IBM Plex Sans Variable' },
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalled();
    load.mockRestore();
  });

  it('requests each weight and style the document uses, not only regular 400', async () => {
    if (!hasDom() || !document.fonts || typeof document.fonts.load !== 'function') return;
    const reg = new FontRegistry([]);
    const load = vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    await reg.ensureDocumentFonts([
      { family: 'Geist Variable', weight: 400, style: 'normal' },
      { family: 'Geist Variable', weight: 700, style: 'normal' },
      { family: 'Geist Variable', weight: 400, style: 'italic' },
    ]);
    const descriptors = load.mock.calls.map((call) => call[0]);
    expect(descriptors).toHaveLength(3);
    expect(descriptors).toContain('normal 700 16px "Geist Variable"');
    expect(descriptors).toContain('italic 400 16px "Geist Variable"');
    load.mockRestore();
  });

  it('one failing face does not abandon the rest of the document', async () => {
    if (!hasDom() || !document.fonts || typeof document.fonts.load !== 'function') return;
    const reg = new FontRegistry([]);
    const load = vi
      .spyOn(document.fonts, 'load')
      .mockImplementation(async (descriptor: string) =>
        descriptor.includes('Broken') ? Promise.reject(new Error('no such face')) : [],
      );
    await expect(
      reg.ensureDocumentFonts([{ family: 'Broken' }, { family: 'Geist Variable' }]),
    ).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    load.mockRestore();
  });

  it('injectGoogleFontLink creates a link element for google source', () => {
    if (!hasDom()) return; // skip if no DOM
    const reg = new FontRegistry([]);
    reg.register({
      family: 'Lato',
      weight: 400,
      style: 'normal',
      source: 'google',
      url: 'https://fonts.googleapis.com/css2?family=Lato:wght@400',
    });
    const createSpy = vi.spyOn(document, 'createElement');
    reg.injectGoogleFontLink('Lato');
    expect(createSpy).toHaveBeenCalledWith('link');
    createSpy.mockRestore();
  });
});
