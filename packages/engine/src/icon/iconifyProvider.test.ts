/**
 * IconifyProvider unit tests — fixture-driven, no live network.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IconifyClient } from './iconifyClient';
import { buildSvgFromIconData, createIconifyProvider, iconifyCanonicalId } from './iconifyProvider';
import type { IconSourceDescriptor } from './iconProviders';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

function clientWithFixture(route: string, fixtureName: string): IconifyClient {
  return new IconifyClient({
    fetchFn: (async (url: string | URL | Request) => {
      if (String(url).includes(route)) {
        return new Response(fixture(fixtureName), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch,
  });
}

function descriptor(prefix: string, name: string): IconSourceDescriptor {
  return {
    canonicalId: iconifyCanonicalId(prefix, name),
    providerId: 'iconify',
    packId: prefix,
    iconId: name,
    name,
    displayName: name,
    aliases: [],
    keywords: [],
    categories: [],
    styles: ['outline'],
    paletteType: 'monotone',
    licence: {},
  };
}

describe('IconifyProvider search', () => {
  it('maps search hits to descriptors with canonical ids and verified licences', async () => {
    const client = clientWithFixture(
      'api.iconify.design/search?query=home&limit=24',
      'search-home.json',
    );
    const provider = createIconifyProvider(client);
    const page = await provider.search('home', { limit: 24 });
    expect(page.items.length).toBeGreaterThan(0);
    const first = page.items[0]!;
    expect(first.providerId).toBe('iconify');
    expect(first.canonicalId).toMatch(/^iconify:[a-z0-9-]+:[a-z0-9-]+$/);
    expect(first.licence).toBeDefined();
    // Verified policy: search responses carry the spdx field.
    expect(first.licence.spdxId ?? '').not.toBe('');
  });

  it('extracts style variants from suffix-based packs', async () => {
    const client = clientWithFixture(
      'api.iconify.design/search?query=home&limit=24',
      'search-home.json',
    );
    const provider = createIconifyProvider(client);
    const page = await provider.search('home', { limit: 24 });
    const filled = page.items.find((i) => i.iconId.includes('-filled'));
    if (filled) {
      expect(filled.styles).toContain('filled');
    }
  });

  it('threads the abort signal and pagination into the client', async () => {
    const seen: string[] = [];
    const client = new IconifyClient({
      fetchFn: (async (url: string | URL | Request) => {
        seen.push(String(url));
        return new Response(fixture('search-home.json'), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });
    const provider = createIconifyProvider(client);
    const controller = new AbortController();
    await provider.search('home', { start: 40, limit: 24, signal: controller.signal });
    expect(seen[0]).toContain('start=40');
    expect(seen[0]).toContain('limit=24');
  });

  it('reports pagination totals from the server', async () => {
    const client = clientWithFixture(
      'api.iconify.design/search?query=home&limit=24',
      'search-home.json',
    );
    const provider = createIconifyProvider(client);
    const page = await provider.search('home', { limit: 24 });
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
    expect(typeof page.exhausted).toBe('boolean');
  });
});

describe('IconifyProvider packs', () => {
  it('lists packs with verified metadata from the catalogue fixture', async () => {
    const client = clientWithFixture(
      'api.iconify.design/collections',
      'collections-catalogue.json',
    );
    const provider = createIconifyProvider(client);
    const packs = await provider.getPacks();
    expect(packs.length).toBeGreaterThanOrEqual(4);
    const mdi = packs.find((p) => p.prefix === 'mdi');
    expect(mdi?.licence?.spdxId).toBe('Apache-2.0');
    const simple = packs.find((p) => p.prefix === 'simple-icons');
    expect(simple?.licence?.spdxId).toBe('CC0-1.0');
    expect(simple?.licence?.attributionRequired).toBe(false);
  });

  it('browses a collection page with icon names and metadata', async () => {
    const client = clientWithFixture(
      'api.iconify.design/collection?prefix=mdi&limit=10',
      'collection-mdi.json',
    );
    const provider = createIconifyProvider(client);
    const page = await provider.getPackIcons('mdi', { limit: 10 });
    expect(page.total).toBeGreaterThan(1000);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.packId).toBe('mdi');
    expect(page.items[0]?.licence).toBeDefined();
  });
});

describe('IconifyProvider icon data and SVG', () => {
  it('fetches a single SVG via the modern route', async () => {
    const client = clientWithFixture('api.iconify.design/mdi/home.svg', 'svg-mdi-home.svg');
    const provider = createIconifyProvider(client);
    const svg = await provider.getSvg(descriptor('mdi', 'home'));
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it('returns null for 404 icons instead of throwing', async () => {
    const client = new IconifyClient({
      fetchFn: (async () => new Response('not found', { status: 404 })) as typeof fetch,
    });
    const provider = createIconifyProvider(client);
    const svg = await provider.getSvg(descriptor('mdi', 'missing-icon'));
    expect(svg).toBeNull();
  });

  it('batches icon data into one request and reconstructs SVGs', async () => {
    const client = clientWithFixture('api.iconify.design/mdi.json?icons=', 'icons-mdi-batch.json');
    const provider = createIconifyProvider(client);
    const results = await provider.getIconData([
      descriptor('mdi', 'home'),
      descriptor('mdi', 'account'),
      descriptor('mdi', 'settings'),
    ]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.svg).toContain('<svg');
      expect(r.svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('builds valid SVGs from icon data', () => {
    const svg = buildSvgFromIconData('home', {
      body: '<path fill="currentColor" d="M0 0h24v24H0z"/>',
      width: 24,
      height: 24,
    });
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('<title>home</title>');
    expect(svg).toContain('<path');
  });

  it('guards against non-finite icon dimensions', () => {
    const svg = buildSvgFromIconData('weird', {
      body: '<path d="M0 0"/>',
      width: Number.NaN,
      height: Number.NaN,
    });
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it('reports keyword suggestions through the client', async () => {
    const client = clientWithFixture(
      'api.iconify.design/keywords?keyword=home',
      'keywords-home.json',
    );
    const provider = createIconifyProvider(client);
    const matches = await provider.getKeywords('home');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('reports last-modified for cache invalidation', async () => {
    const client = clientWithFixture('api.iconify.design/last-modified', 'last-modified.json');
    const provider = createIconifyProvider(client);
    const modified = await provider.getLastModified(['mdi', 'lucide']);
    expect(modified.mdi).toBeGreaterThan(0);
    expect(modified.lucide).toBeGreaterThan(0);
  });

  it('maps client errors to structured provider errors', async () => {
    const client = new IconifyClient({
      fetchFn: (async () =>
        new Response('server error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        })) as typeof fetch,
      maxRetries: 0,
    });
    const provider = createIconifyProvider(client);
    await expect(provider.search('home')).rejects.toMatchObject({
      code: 'http-error',
      providerId: 'iconify',
    });
  });

  it('exposes an honest capability set', () => {
    const provider = createIconifyProvider(
      clientWithFixture('api.iconify.design/search?query=a&limit=1', 'search-home.json'),
    );
    expect(provider.capabilities).toContain('search');
    expect(provider.capabilities).toContain('batch-retrieval');
    expect(provider.capabilities).toContain('licence-metadata');
  });
});
