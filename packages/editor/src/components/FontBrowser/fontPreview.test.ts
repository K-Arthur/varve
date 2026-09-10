// @vitest-environment jsdom

import { getFontSemanticCatalog } from '@varve/engine/font';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFontPreview, removeFontPreview } from './fontPreview';

interface FakeFace {
  family: string;
  source: string;
  load: () => Promise<FakeFace>;
}

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalFonts) {
    Object.defineProperty(document, 'fonts', originalFonts);
  } else {
    Reflect.deleteProperty(document, 'fonts');
  }
});

describe('font preview loader', () => {
  it('does not fetch catalog artifacts during browse-only preview', async () => {
    const record = getFontSemanticCatalog().findByFamilyName('Gothic A1');
    expect(record?.providerId).toBe('fontsource');

    const added: FakeFace[] = [];
    const fontSet = {
      add: vi.fn((face: FakeFace) => {
        added.push(face);
      }),
      check: vi.fn(() => true),
      delete: vi.fn((face: FakeFace) => {
        const index = added.indexOf(face);
        if (index >= 0) added.splice(index, 1);
        return index >= 0;
      }),
      load: vi.fn(async () => added),
    };
    class PreviewFace implements FakeFace {
      static last: PreviewFace | undefined;
      readonly family: string;
      readonly source: string;

      constructor(family: string, source: string) {
        this.family = family;
        this.source = source;
        PreviewFace.last = this;
      }

      load = async () => this;
    }

    Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
    vi.stubGlobal('FontFace', PreviewFace);

    const result = await loadFontPreview(record!);

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Install');
    expect(PreviewFace.last).toBeUndefined();
    expect(fontSet.add).not.toHaveBeenCalled();
    expect(record?.installed).toBe(false);

    removeFontPreview(result.face);
    expect(fontSet.delete).not.toHaveBeenCalled();
  });
});
