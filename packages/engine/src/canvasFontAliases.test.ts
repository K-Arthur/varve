// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canResolveCanvasFontFamily,
  resetCanvasFontAliases,
  resolveCanvasFontFamily,
} from './canvasFontAliases';

describe('canvas font aliases', () => {
  let originalStyleSheets: StyleSheetList;

  beforeEach(() => {
    resetCanvasFontAliases();
    originalStyleSheets = document.styleSheets;
    const declarations: Record<string, string> = {
      'font-family': '"Fixture Sans"',
      src: 'url("/fixture.woff2") format("woff2")',
      'font-weight': '100 700',
      'font-style': 'normal',
    };
    const rule = {
      style: { getPropertyValue: (property: string) => declarations[property] ?? '' },
    };
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [{ cssRules: [rule] }],
    });
  });

  afterEach(() => {
    resetCanvasFontAliases();
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: originalStyleSheets,
    });
  });

  it('creates a local alias for whole-run feature values', () => {
    const family = resolveCanvasFontFamily('Fixture Sans', { liga: false });

    expect(family).not.toBe('Fixture Sans');
    expect(canResolveCanvasFontFamily('Fixture Sans', { liga: false })).toBe(true);
    expect(document.querySelector('style#varve-canvas-font-aliases')?.textContent).toContain(
      'font-feature-settings:"liga" 0',
    );
  });

  it('does not pretend that source ranges fit a face-wide alias', () => {
    const features = {
      liga: { value: false, ranges: [{ startUtf16: 0, endUtf16: 2, value: true }] },
    };

    expect(resolveCanvasFontFamily('Fixture Sans', features)).toBe('Fixture Sans');
    expect(canResolveCanvasFontFamily('Fixture Sans', features)).toBe(false);
  });

  it('leaves system-only families unchanged', () => {
    expect(resolveCanvasFontFamily('System Only', { liga: false })).toBe('System Only');
    expect(canResolveCanvasFontFamily('System Only', { liga: false })).toBe(false);
  });

  it('loads whole-run settings through FontFace descriptors when available', async () => {
    const previousFontFace = globalThis.FontFace;
    const previousFonts = document.fonts;
    const added: Array<{
      family: string;
      source: string;
      descriptors: FontFaceDescriptors;
    }> = [];

    class FixtureFontFace {
      status = 'unloaded';

      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {
        added.push({ family, source, descriptors });
      }

      load(): Promise<this> {
        this.status = 'loaded';
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(globalThis, 'FontFace', {
      configurable: true,
      value: FixtureFontFace,
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        add: (face: unknown) => face,
        delete: () => true,
      },
    });

    try {
      expect(resolveCanvasFontFamily('Fixture Sans', { liga: false })).toBe('Fixture Sans');
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      const alias = resolveCanvasFontFamily('Fixture Sans', { liga: false });
      expect(alias).not.toBe('Fixture Sans');
      expect(added).toHaveLength(1);
      expect(added[0]?.descriptors).toMatchObject({
        weight: '100 700',
        style: 'normal',
        featureSettings: '"liga" 0',
      });
    } finally {
      if (previousFontFace) {
        Object.defineProperty(globalThis, 'FontFace', {
          configurable: true,
          value: previousFontFace,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'FontFace');
      }
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: previousFonts,
      });
    }
  });
});
