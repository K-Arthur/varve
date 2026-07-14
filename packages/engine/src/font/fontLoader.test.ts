import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedFontMetadata } from './fontIdentity';
import { detectSystemFonts, FontLoader, loadSystemFontsViaLocal } from './fontLoader';

// ── Mocks ──────────────────────────────────────────────────────────────────

function makeMeta(family = 'TestFont'): ParsedFontMetadata {
  return {
    identity: {
      contentHash: 'aabbccdd',
      postScriptName: `${family}-Regular`,
      familyName: family,
      subfamilyName: 'Regular',
      fullName: `${family} Regular`,
    },
    format: 'woff2',
    fileSize: 50_000,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 1200,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: [],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'system',
  };
}

// Minimal mock for FontFace, document.fonts, and FontRegistry
function setupMocks() {
  const addCalls: string[] = [];

  // @ts-expect-error — jsdom has no FontFace
  globalThis.FontFace = class MockFontFace {
    family: string;
    source: string;
    loaded: Promise<void>;
    constructor(family: string, source: string | ArrayBuffer) {
      this.family = family;
      this.source = typeof source === 'string' ? source : '<ArrayBuffer>';
      this.loaded = Promise.resolve();
    }
    load() {
      return this.loaded;
    }
  };

  globalThis.document = globalThis.document ?? {};
  // @ts-expect-error — document.fonts is read-only in DOM lib
  globalThis.document.fonts = {
    check: vi.fn(() => false),
    add: vi.fn((face: { family: string }) => {
      addCalls.push(face.family);
    }),
    delete: vi.fn(() => true),
    ready: Promise.resolve(),
    [Symbol.iterator]: function* () {
      for (const family of addCalls) {
        yield { family };
      }
    },
  };

  return { addCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FontLoader', () => {
  let addCalls: string[];

  beforeEach(() => {
    ({ addCalls } = setupMocks());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadFont with ArrayBuffer creates FontFace and adds to document.fonts', async () => {
    const loader = new FontLoader();
    const data = new ArrayBuffer(100);
    const meta = makeMeta('MyFont');

    const result = await loader.loadFont(meta, data);

    expect(result.success).toBe(true);
    expect(result.family).toBe('MyFont');
    expect(result.loadedFrom).toBe('network');
    expect(addCalls).toContain('MyFont');
  });

  it('loadFontFromUrl calls fetch and creates FontFace', async () => {
    const fakeData = new ArrayBuffer(100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData),
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = new FontLoader();
    const result = await loader.loadFontFromUrl(
      'RemoteFont',
      'https://fonts.example.com/remote.woff2',
    );

    expect(result.success).toBe(true);
    expect(result.family).toBe('RemoteFont');
    expect(result.loadedFrom).toBe('network');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://fonts.example.com/remote.woff2',
      expect.any(Object),
    );
  });

  it('loadFontFromUrl retries on failure', async () => {
    const fakeData = new ArrayBuffer(100);
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeData),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = new FontLoader({ retryCount: 2 });
    const result = await loader.loadFontFromUrl('RetryFont', 'https://example.com/retry.ttf');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('loadFonts respects concurrency limit', async () => {
    let activeCount = 0;
    let maxActive = 0;

    const fakeData = new ArrayBuffer(100);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise((r) => setTimeout(r, 10));
        activeCount--;
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(fakeData),
        };
      }),
    );

    const loader = new FontLoader({ maxConcurrent: 2 });
    const metas = Array.from({ length: 6 }, (_, i) => makeMeta(`Font${i}`));

    await loader.loadFonts(metas);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('isFontAvailable checks document.fonts.check', () => {
    const checkMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    globalThis.document.fonts.check = checkMock;

    const loader = new FontLoader();

    expect(loader.isFontAvailable('MissingFont')).toBe(false);
    expect(loader.isFontAvailable('PresentFont')).toBe(true);
  });

  it('unloadFont removes from document.fonts', async () => {
    const loader = new FontLoader();

    // Pre-load a font
    const data = new ArrayBuffer(100);
    await loader.loadFont(makeMeta('UnloadMe'), data);

    const removed = loader.unloadFont('UnloadMe');
    expect(removed).toBe(true);
  });

  it('subscriber notification fires on load', async () => {
    const loader = new FontLoader();
    const listener = vi.fn();
    loader.subscribe(listener);

    const data = new ArrayBuffer(100);
    await loader.loadFont(makeMeta('NotifyFont'), data);

    expect(listener).toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', async () => {
    const loader = new FontLoader();
    const listener = vi.fn();
    const unsub = loader.subscribe(listener);

    const data = new ArrayBuffer(100);
    await loader.loadFont(makeMeta('UnsubFont'), data);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    await loader.loadFont(makeMeta('UnsubFont2'), data);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('loadFontFromBlob converts Blob to FontFace', async () => {
    const loader = new FontLoader();
    const blob = new Blob([new ArrayBuffer(100)], { type: 'font/woff2' });

    const result = await loader.loadFontFromBlob('BlobFont', blob);

    expect(result.success).toBe(true);
    expect(result.family).toBe('BlobFont');
  });

  it('getLoadedFonts returns successfully loaded families', async () => {
    const loader = new FontLoader();
    const data = new ArrayBuffer(100);

    await loader.loadFont(makeMeta('Loaded1'), data);
    await loader.loadFont(makeMeta('Loaded2'), data);

    const loaded = loader.getLoadedFonts();
    expect(loaded).toContain('Loaded1');
    expect(loaded).toContain('Loaded2');
  });

  it('loadFont handles document.fonts unavailable gracefully', async () => {
    // Save and remove document.fonts
    const origFonts = document.fonts;
    // @ts-expect-error
    delete document.fonts;

    try {
      const loader = new FontLoader();
      const result = await loader.loadFont(makeMeta('NoFonts'), new ArrayBuffer(100));

      expect(result.success).toBe(false);
      expect(result.error).toContain('No document.fonts');
    } finally {
      // @ts-expect-error
      document.fonts = origFonts;
    }
  });
});

describe('detectSystemFonts', () => {
  it('returns an array of common system font families', () => {
    const fonts = detectSystemFonts();
    expect(Array.isArray(fonts)).toBe(true);
    expect(fonts.length).toBeGreaterThan(5);
    expect(fonts).toContain('Arial');
    expect(fonts).toContain('Helvetica');
    expect(fonts).toContain('Times New Roman');
    expect(fonts).toContain('Courier New');
  });
});

describe('loadSystemFontsViaLocal', () => {
  beforeEach(() => {
    setupMocks();
  });

  it('returns LoadResult array for each requested family', async () => {
    const results = await loadSystemFontsViaLocal(['Arial', 'Helvetica', 'Times New Roman']);
    expect(results).toHaveLength(3);
    expect(results[0]!.family).toBe('Arial');
  });
});
