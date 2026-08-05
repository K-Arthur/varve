import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  descriptorMatchesQuery,
  expandSearchTokens,
  getIconProviderRegistry,
  IconProviderError,
  IconProviderRegistry,
  type IconSearchPage,
  type IconSourceDescriptor,
  normalizeIconQuery,
  resetIconProviderRegistry,
} from './iconProviders';

function makeDescriptor(partial: Partial<IconSourceDescriptor> = {}): IconSourceDescriptor {
  return {
    canonicalId: 'iconify:mdi:home',
    providerId: 'iconify',
    packId: 'mdi',
    iconId: 'home',
    name: 'home',
    displayName: 'home',
    aliases: [],
    keywords: [],
    categories: [],
    styles: ['outline'],
    paletteType: 'monotone',
    licence: {},
    ...partial,
  };
}

function makeProvider(
  id: string,
  page: IconSearchPage,
  opts: { getSvg?: (d: IconSourceDescriptor) => Promise<string | null> } = {},
) {
  return {
    id,
    name: id,
    kind: 'public-api' as const,
    enabled: true,
    requiresNetwork: true,
    capabilities: ['search', 'fetch-svg'] as const,
    search: vi.fn(async () => page),
    getSvg: vi.fn(opts.getSvg ?? (async () => `<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`)),
  };
}

describe('IconProviderRegistry lifecycle', () => {
  let registry: IconProviderRegistry;

  beforeEach(() => {
    registry = new IconProviderRegistry();
  });

  it('registers and retrieves providers', () => {
    const p = makeProvider('iconify', { items: [], total: 0, start: 0, exhausted: true });
    registry.register(p);
    expect(registry.get('iconify')).toBe(p);
  });

  it('re-registering the same id replaces the provider (idempotent, hot-reload safe)', () => {
    const a = makeProvider('iconify', { items: [], total: 0, start: 0, exhausted: true });
    const b = makeProvider('iconify', { items: [], total: 0, start: 0, exhausted: true });
    registry.register(a);
    registry.register(b);
    expect(registry.get('iconify')).toBe(b);
  });

  it('runs the ensureProviders callback exactly once', () => {
    let calls = 0;
    registry.ensureProviders(() => {
      calls++;
      registry.register(
        makeProvider('iconify', { items: [], total: 0, start: 0, exhausted: true }),
      );
    });
    registry.ensureProviders(() => {
      calls++;
    });
    expect(calls).toBe(1);
    expect(registry.get('iconify')).toBeDefined();
  });

  it('reset clears providers and initialization', () => {
    registry.ensureProviders(() => {
      registry.register(
        makeProvider('iconify', { items: [], total: 0, start: 0, exhausted: true }),
      );
    });
    registry.reset();
    expect(registry.providerIds).toEqual([]);
    expect(registry.isInitialized).toBe(false);
  });

  it('throws a structured registry-empty error when no providers are registered', async () => {
    await expect(registry.search('home')).rejects.toMatchObject({ code: 'registry-empty' });
  });
});

describe('IconProviderRegistry search', () => {
  it('merges results from all enabled providers', async () => {
    const registry = new IconProviderRegistry();
    registry.register(
      makeProvider('a', {
        items: [makeDescriptor({ canonicalId: 'a:p:1' })],
        total: 1,
        start: 0,
        exhausted: true,
      }),
    );
    registry.register(
      makeProvider('b', {
        items: [makeDescriptor({ canonicalId: 'b:p:2' })],
        total: 1,
        start: 0,
        exhausted: true,
      }),
    );
    const res = await registry.search('x');
    expect(res.items).toHaveLength(2);
  });

  it('deduplicates by canonical id, preferring the richer entry', async () => {
    const registry = new IconProviderRegistry();
    registry.register(
      makeProvider('a', {
        items: [
          makeDescriptor({ canonicalId: 'iconify:mdi:home', styles: ['outline'] }),
          makeDescriptor({ canonicalId: 'iconify:mdi:home', styles: ['outline', 'filled'] }),
        ],
        total: 2,
        start: 0,
        exhausted: true,
      }),
    );
    const res = await registry.search('x');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.styles).toEqual(['outline', 'filled']);
  });

  it('passes the abort signal through to providers', async () => {
    const registry = new IconProviderRegistry();
    const provider = makeProvider('a', { items: [], total: 0, start: 0, exhausted: true });
    registry.register(provider);
    const controller = new AbortController();
    await registry.search('x', { signal: controller.signal });
    expect(provider.search).toHaveBeenCalledWith('x', { signal: controller.signal });
  });

  it('handles provider failures gracefully and preserves totals', async () => {
    const registry = new IconProviderRegistry();
    registry.register(
      makeProvider('ok', {
        items: [makeDescriptor({ canonicalId: 'ok:p:1' })],
        total: 7,
        start: 0,
        exhausted: false,
      }),
    );
    const failing = makeProvider('fail', { items: [], total: 0, start: 0, exhausted: true });
    failing.search = vi.fn(async () => {
      throw new IconProviderError('down', 'network-error', 'fail');
    });
    registry.register(failing);
    const res = await registry.search('x');
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(7);
  });

  it('routes getSvg to the owning provider', async () => {
    const registry = new IconProviderRegistry();
    const provider = makeProvider('iconify', {
      items: [],
      total: 0,
      start: 0,
      exhausted: true,
    });
    registry.register(provider);
    const svg = await registry.getSvg(makeDescriptor());
    expect(svg).toContain('<svg');
    expect(provider.getSvg).toHaveBeenCalledTimes(1);
  });

  it('reports a missing provider for getSvg', async () => {
    const registry = new IconProviderRegistry();
    await expect(registry.getSvg(makeDescriptor())).rejects.toMatchObject({
      code: 'provider-unavailable',
    });
  });
});

describe('query normalization', () => {
  it('normalizes case, spaces, hyphens, underscores', () => {
    expect(normalizeIconQuery('Arrow_Left--Up')).toBe('arrow left up');
    expect(normalizeIconQuery('  Home   Icon  ')).toBe('home icon');
  });

  it('expands synonyms for common concepts', () => {
    const tokens = expandSearchTokens('trash');
    expect(tokens).toContain('delete');
    expect(tokens).toContain('bin');
    const gearTokens = expandSearchTokens('gear');
    expect(gearTokens).toContain('settings');
  });

  it('matches descriptors through name, aliases, and keywords', () => {
    const descriptor = makeDescriptor({
      name: 'home',
      aliases: ['house'],
      keywords: ['building', 'real-estate'],
    });
    expect(descriptorMatchesQuery(descriptor, 'HOUSE')).toBe(true);
    expect(descriptorMatchesQuery(descriptor, 'building')).toBe(true);
    expect(descriptorMatchesQuery(descriptor, 'home')).toBe(true);
    expect(descriptorMatchesQuery(descriptor, 'trash')).toBe(false);
  });

  it('matches "settings" to gear/cog icons', () => {
    const gear = makeDescriptor({ name: 'gear', aliases: ['cog'], keywords: [] });
    expect(descriptorMatchesQuery(gear, 'settings')).toBe(true);
  });

  it('matches "user" to account icons', () => {
    const account = makeDescriptor({ name: 'account', aliases: [], keywords: [] });
    expect(descriptorMatchesQuery(account, 'user')).toBe(true);
  });
});

describe('global registry', () => {
  beforeEach(() => {
    resetIconProviderRegistry();
  });

  it('creates a stable global registry and can be reset', () => {
    const a = getIconProviderRegistry();
    const b = getIconProviderRegistry();
    expect(a).toBe(b);
    resetIconProviderRegistry();
    const c = getIconProviderRegistry();
    expect(c).not.toBe(a);
  });
});
