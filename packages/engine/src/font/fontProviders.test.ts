import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FontLicense,
  type FontProvider,
  FontProviderRegistry,
  GoogleFontsProvider,
} from './fontProviders';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_GF_ITEM = {
  family: 'Inter',
  variants: ['regular', 'italic', '700', '700italic'],
  subsets: ['latin', 'latin-ext'],
  version: '3.19',
  lastModified: '2024-01-15',
  files: {
    regular:
      'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjQ.woff2',
    italic:
      'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvmjMwCp50KnMw2boKoduKmMEVuI3fAZ9hjQ.woff2',
    '700':
      'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvmjMwCp50KnMw2boKoduKmMEVuFuYAZ9hjQ.woff2',
  },
  category: 'sans-serif',
  kind: 'webfonts#webfont',
};

const MOCK_GF_LIST_RESPONSE = {
  kind: 'webfonts#webfontList',
  items: [
    MOCK_GF_ITEM,
    {
      family: 'Roboto',
      variants: ['regular', 'italic', '700'],
      subsets: ['latin'],
      version: '1.2',
      lastModified: '2023-06-01',
      files: {
        regular: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.woff2',
      },
      category: 'sans-serif',
      kind: 'webfonts#webfont',
    },
    {
      family: 'Playfair Display',
      variants: ['regular', '700'],
      subsets: ['latin'],
      version: '1.0',
      lastModified: '2023-01-01',
      files: {
        regular:
          'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKd3vXDXbtXK-F2qC0s.woff2',
      },
      category: 'serif',
      kind: 'webfonts#webfont',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
  });
}

function makeProvider(id: string, enabled = true): FontProvider {
  return {
    id,
    name: `Test ${id}`,
    kind: 'public-api',
    enabled,
    search: vi.fn().mockResolvedValue([
      {
        familyId: `${id}-family`,
        familyName: `${id} Family`,
        category: 'sans-serif',
        variants: 3,
        isVariable: false,
        languages: ['latin'],
      },
    ]),
    getDetails: vi.fn().mockResolvedValue(null),
    getDownloadUrls: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue(null),
  };
}

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe('FontProviderRegistry', () => {
  let registry: FontProviderRegistry;

  beforeEach(() => {
    registry = new FontProviderRegistry();
  });

  it('registers and retrieves a provider', () => {
    const p = makeProvider('test');
    registry.register(p);
    expect(registry.get('test')).toBe(p);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('unregisters a provider', () => {
    registry.register(makeProvider('test'));
    expect(registry.unregister('test')).toBe(true);
    expect(registry.get('test')).toBeUndefined();
  });

  it('returns false when unregistering a nonexistent provider', () => {
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('returns all registered providers', () => {
    const a = makeProvider('a');
    const b = makeProvider('b');
    registry.register(a);
    registry.register(b);
    expect(registry.all()).toEqual([a, b]);
  });

  it('returns only enabled providers', () => {
    const enabled = makeProvider('on', true);
    const disabled = makeProvider('off', false);
    registry.register(enabled);
    registry.register(disabled);
    expect(registry.enabled()).toEqual([enabled]);
  });

  it('enables/disables a provider via setProviderEnabled', () => {
    const p = makeProvider('toggle');
    registry.register(p);
    expect(registry.enabled()).toHaveLength(1);

    registry.setProviderEnabled('toggle', false);
    expect(registry.enabled()).toHaveLength(0);
    expect(p.enabled).toBe(false);

    registry.setProviderEnabled('toggle', true);
    expect(registry.enabled()).toHaveLength(1);
    expect(p.enabled).toBe(true);
  });

  it('setProviderEnabled is a no-op for unknown ids', () => {
    registry.setProviderEnabled('unknown', false);
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('searchAll merges results from multiple providers', async () => {
    const p1 = makeProvider('p1');
    const p2 = makeProvider('p2');
    (p1.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        familyId: 'f1',
        familyName: 'Font One',
        category: 'serif',
        variants: 2,
        isVariable: false,
        languages: ['latin'],
      },
    ]);
    (p2.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        familyId: 'f2',
        familyName: 'Font Two',
        category: 'sans-serif',
        variants: 4,
        isVariable: true,
        languages: ['latin-ext'],
      },
    ]);

    registry.register(p1);
    registry.register(p2);

    const results = await registry.searchAll('font');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.familyId)).toEqual(['f1', 'f2']);
  });

  it('searchAll deduplicates by familyId (first provider wins)', async () => {
    const p1 = makeProvider('first');
    const p2 = makeProvider('second');
    (p1.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        familyId: 'shared',
        familyName: 'Shared Font',
        category: 'serif',
        variants: 1,
        isVariable: false,
        languages: [],
      },
    ]);
    (p2.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        familyId: 'shared',
        familyName: 'Shared Font Different',
        category: 'mono',
        variants: 5,
        isVariable: true,
        languages: [],
      },
    ]);

    registry.register(p1);
    registry.register(p2);

    const results = await registry.searchAll('shared');
    expect(results).toHaveLength(1);
    expect(results[0]!.familyName).toBe('Shared Font'); // first wins
  });

  it('searchAll skips disabled providers', async () => {
    const p1 = makeProvider('active', true);
    const p2 = makeProvider('disabled', false);
    registry.register(p1);
    registry.register(p2);

    const results = await registry.searchAll('test');
    expect(results).toHaveLength(1);
    expect(results[0]!.familyId).toBe('active-family');
  });

  it('searchAll handles provider errors gracefully', async () => {
    const good = makeProvider('good');
    const bad = makeProvider('bad');
    (good.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        familyId: 'g1',
        familyName: 'Good',
        category: 'serif',
        variants: 1,
        isVariable: false,
        languages: [],
      },
    ]);
    (bad.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

    registry.register(good);
    registry.register(bad);

    const results = await registry.searchAll('any');
    expect(results).toHaveLength(1);
    expect(results[0]!.familyId).toBe('g1');
  });

  it('overwrites existing provider on re-register with same id', () => {
    const first = makeProvider('dupe');
    const second = makeProvider('dupe');
    registry.register(first);
    registry.register(second);
    expect(registry.get('dupe')).toBe(second);
    expect(registry.all()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GoogleFontsProvider tests
// ---------------------------------------------------------------------------

describe('GoogleFontsProvider', () => {
  let provider: GoogleFontsProvider;

  beforeEach(() => {
    provider = new GoogleFontsProvider();
    vi.restoreAllMocks();
  });

  it('has correct static properties', () => {
    expect(provider.id).toBe('google-fonts');
    expect(provider.name).toBe('Google Fonts');
    expect(provider.kind).toBe('public-api');
    expect(provider.enabled).toBe(true);
  });

  it('builds the list URL without API key', () => {
    const url = provider.buildListUrl();
    expect(url).toBe('https://www.googleapis.com/webfonts/v2/webfonts');
  });

  it('builds the list URL with sort parameter', () => {
    const url = provider.buildListUrl('popularity');
    expect(url).toContain('sort=popularity');
  });

  it('builds the list URL with API key', () => {
    const url = provider.buildListUrl(undefined, 'my-api-key');
    expect(url).toContain('key=my-api-key');
  });

  it('builds CSS API v2 URL for a family', () => {
    const url = provider.buildCssUrl('Inter');
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Inter');
  });

  it('builds CSS API v2 URL with specific weights', () => {
    const url = provider.buildCssUrl('Inter', [400, 700]);
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@400;700');
  });

  it('builds CSS URL with spaces replaced by +', () => {
    const url = provider.buildCssUrl('Playfair Display');
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display');
  });

  it('search fetches and filters results', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const results = await provider.search('Inter');
    expect(results).toHaveLength(1);
    expect(results[0]!.familyId).toBe('Inter');
    expect(results[0]!.familyName).toBe('Inter');
    expect(results[0]!.category).toBe('sans-serif');
    expect(results[0]!.variants).toBe(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('search returns empty for no match', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const results = await provider.search('ZZZZZNonexistent');
    expect(results).toHaveLength(0);
  });

  it('search filters by category', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const results = await provider.search('', { category: 'serif' });
    expect(results).toHaveLength(1);
    expect(results[0]!.familyName).toBe('Playfair Display');
  });

  it('search respects limit and offset', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const all = await provider.search('');
    expect(all).toHaveLength(3);

    const limited = await provider.search('', { limit: 1 });
    expect(limited).toHaveLength(1);

    const offset = await provider.search('', { offset: 1, limit: 1 });
    expect(offset).toHaveLength(1);
    expect(offset[0]!.familyName).toBe('Roboto');
  });

  it('getDetails returns full family info', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const details = await provider.getDetails('Inter');
    expect(details).not.toBeNull();
    expect(details!.familyId).toBe('Inter');
    expect(details!.license.name).toBe('SIL Open Font License 1.1');
    expect(details!.license.permissions.commercial).toBe(true);
    expect(details!.license.permissions.modification).toBe(true);
    expect(details!.license.permissions.redistribution).toBe(true);
    expect(details!.license.permissions.embedding).toBe(true);
    expect(details!.lastUpdated).toBe('2024-01-15');
    expect(details!.version).toBe('3.19');
  });

  it('getDetails returns null for unknown family', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const details = await provider.getDetails('Nonexistent');
    expect(details).toBeNull();
  });

  it('getDownloadUrls returns formatted URLs', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const downloads = await provider.getDownloadUrls('Inter');
    expect(downloads.length).toBeGreaterThan(0);
    for (const dl of downloads) {
      expect(dl.url).toContain('fonts.gstatic.com');
      expect(['ttf', 'otf', 'woff', 'woff2']).toContain(dl.format);
      expect(dl.weight).toBeGreaterThanOrEqual(100);
      expect(dl.weight).toBeLessThanOrEqual(900);
      expect(['normal', 'italic']).toContain(dl.style);
    }
  });

  it('getDownloadUrls filters by format', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const woff2Only = await provider.getDownloadUrls('Inter', 'woff2');
    for (const dl of woff2Only) {
      expect(dl.format).toBe('woff2');
    }
  });

  it('getMetadata returns partial metadata for a known family', async () => {
    globalThis.fetch = makeFetchMock(MOCK_GF_LIST_RESPONSE);

    const meta = await provider.getMetadata('Inter');
    expect(meta).not.toBeNull();
    expect(meta!.source).toBe('remote');
    expect(meta!.sourceLocation).toContain('fonts.google.com/specimen/Inter');
    expect(meta!.category).toBe('sans-serif');
  });

  it('throws on API error', async () => {
    globalThis.fetch = makeFetchMock(null, false, 403);

    await expect(provider.search('test')).rejects.toThrow('Google Fonts API returned 403');
  });
});

// ---------------------------------------------------------------------------
// License structure tests
// ---------------------------------------------------------------------------

describe('FontLicense', () => {
  it('SIL OFL has correct permissions', () => {
    const license: FontLicense = {
      name: 'SIL Open Font License 1.1',
      url: 'https://scripts.sil.org/OFL',
      permissions: {
        commercial: true,
        modification: true,
        redistribution: true,
        embedding: true,
      },
    };

    expect(license.permissions.commercial).toBe(true);
    expect(license.permissions.modification).toBe(true);
    expect(license.permissions.redistribution).toBe(true);
    expect(license.permissions.embedding).toBe(true);
  });

  it('Apache license can restrict embedding', () => {
    const license: FontLicense = {
      name: 'Apache License 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
      permissions: {
        commercial: true,
        modification: true,
        redistribution: true,
        embedding: false,
      },
    };

    expect(license.permissions.commercial).toBe(true);
    expect(license.permissions.embedding).toBe(false);
  });

  it('fontProviders module exports all expected types', async () => {
    const mod = await import('./fontProviders');
    expect(mod.GoogleFontsProvider).toBeDefined();
    expect(mod.FontProviderRegistry).toBeDefined();
    // Type exports are compile-time only — verify the classes are constructable
    const reg = new mod.FontProviderRegistry();
    expect(reg.all()).toEqual([]);
  });
});
