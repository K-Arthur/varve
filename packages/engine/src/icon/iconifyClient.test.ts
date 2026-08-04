/**
 * IconifyClient unit tests — fixtures only, no live network.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconifyClient, IconifyClientError } from './iconifyClient';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

type FetchRoute = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeFetch(routes: Record<string, Response | FetchRoute>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        if (handler instanceof Response) return handler;
        return handler(urlStr, init);
      }
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

function fetchForFixture(fixtureName: string, route: string): typeof fetch {
  return makeFetch({
    [route]: jsonResponse(fixture(fixtureName)),
  });
}

const SEARCH_URL = 'api.iconify.design/search?query=home&limit=3';
const SEARCH_ROUTE = 'api.iconify.design/search?query=home&limit=3';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IconifyClient endpoint parsing', () => {
  it('parses a real search response (icons + collections, not info)', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture('search-home.json', SEARCH_ROUTE),
    });
    const res = await client.search('home', { limit: 3 });
    expect(res.icons.length).toBeGreaterThan(0);
    expect(res.icons[0]).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
    expect(res.total).toBeGreaterThan(0);
    expect(res.collections).toBeDefined();
    if (res.collections) {
      const first = Object.values(res.collections)[0];
      expect(first?.license?.spdx).toBeDefined();
    }
  });

  it('parses a real collection response', async () => {
    const client = new IconifyClient({
      hosts: ['https://api.iconify.design'],
      fetchFn: fetchForFixture('collection-mdi.json', 'api.iconify.design/collection?prefix=mdi'),
    });
    const res = await client.collection('mdi', { limit: 10 });
    expect(res.prefix).toBe('mdi');
    expect(res.total).toBeGreaterThan(0);
    expect(res.icons.length).toBeGreaterThan(0);
  });

  it('parses a real icon-data batch response', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture('icons-mdi-batch.json', 'api.iconify.design/mdi.json?icons='),
    });
    const res = await client.icons('mdi', ['home', 'account', 'settings']);
    expect(res.prefix).toBe('mdi');
    expect(res.icons.get('home')?.body).toContain('<path');
    expect(res.icons.get('account')).toBeDefined();
  });

  it('fetches a real single SVG through the modern route', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture('svg-mdi-home.svg', 'api.iconify.design/mdi/home.svg'),
    });
    const svg = await client.svg('mdi', 'home');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });

  it('parses keyword suggestions', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture('keywords-home.json', 'api.iconify.design/keywords?keyword=home'),
    });
    const res = await client.keywords('home');
    expect(res.exists).toBe(true);
    expect(res.matches.length).toBeGreaterThan(0);
  });

  it('parses last-modified timestamps', async () => {
    const client = new IconifyClient({
      hosts: ['https://api.iconify.design'],
      fetchFn: fetchForFixture('last-modified.json', 'api.iconify.design/last-modified'),
    });
    const res = await client.lastModified(['mdi', 'lucide']);
    expect(res.mdi).toBeGreaterThan(1_700_000_000);
    expect(res.lucide).toBeGreaterThan(0);
  });

  it('parses the collections catalogue', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture(
        'collections-catalogue.json',
        'api.iconify.design/collections?prefixes=',
      ),
    });
    const res = await client.collections(['mdi', 'lucide', 'ph', 'simple-icons']);
    expect(res.mdi?.license?.spdx).toBe('Apache-2.0');
    expect(res['simple-icons']?.license?.spdx).toBe('CC0-1.0');
  });
});

describe('IconifyClient request behavior', () => {
  it('encodes prefixes and icon names in URLs', async () => {
    const seen: string[] = [];
    const client = new IconifyClient({
      fetchFn: makeFetch({
        'api.iconify.design/': (url) => {
          seen.push(url);
          return jsonResponse({});
        },
      }),
    });
    await client.svg('weird prefix/name', 'a+b&c');
    expect(seen[0]).toContain('weird%20prefix%2Fname');
    expect(seen[0]).toContain('a%2Bb%26c');
  });

  it('sends pagination parameters', async () => {
    const seen: string[] = [];
    const client = new IconifyClient({
      fetchFn: makeFetch({
        'api.iconify.design/search': (url) => {
          seen.push(url);
          return jsonResponse({ icons: ['mdi:home'], total: 100, limit: 40, start: 40 });
        },
      }),
    });
    await client.search('home', { limit: 40, start: 40 });
    expect(seen[0]).toContain('limit=40');
    expect(seen[0]).toContain('start=40');
  });

  it('splits batches before URL length limits', async () => {
    const urls: string[] = [];
    const client = new IconifyClient({
      maxUrlLength: 120,
      fetchFn: makeFetch({
        'api.iconify.design/mdi.json': (url) => {
          urls.push(url);
          return jsonResponse({ prefix: 'mdi', icons: {} });
        },
      }),
    });
    const names = Array.from({ length: 10 }, (_, i) => `icon-${i}-with-a-long-name`);
    await client.icons('mdi', names);
    expect(urls.length).toBeGreaterThan(1);
    const firstNames = urls[0]!.split('icons=')[1] ?? '';
    expect(firstNames.length).toBeLessThan(120);
  });

  it('falls back to a backup host when the primary fails', async () => {
    const calls: string[] = [];
    const client = new IconifyClient({
      maxRetries: 0,
      fetchFn: makeFetch({
        'api.iconify.design': () => {
          calls.push('primary');
          return new Response('boom', { status: 503 });
        },
        'api.simplesvg.com': () => {
          calls.push('backup');
          return jsonResponse({ icons: ['mdi:home'], total: 1, limit: 1, start: 0 });
        },
      }),
    });
    const res = await client.search('home', { limit: 1 });
    expect(res.icons).toContain('mdi:home');
    expect(calls).toEqual(['primary', 'backup']);
  });

  it('remembers the last working host for subsequent requests', async () => {
    let primaryFailures = 0;
    const client = new IconifyClient({
      maxRetries: 0,
      fetchFn: makeFetch({
        'api.iconify.design': () => {
          primaryFailures++;
          return new Response('boom', { status: 503 });
        },
        'api.simplesvg.com': () =>
          jsonResponse({ icons: ['mdi:home'], total: 1, limit: 1, start: 0 }),
      }),
    });
    await client.search('home', { limit: 1 });
    await client.search('home', { limit: 1 });
    expect(primaryFailures).toBe(1);
  });

  it('times out requests that exceed the limit', async () => {
    const client = new IconifyClient({
      timeoutMs: 20,
      hosts: ['https://api.iconify.design'],
      fetchFn: makeFetch({
        'api.iconify.design/search': (_url, init) =>
          new Promise((resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
              // Real browsers reject fetch with the signal's reason (a
              // TimeoutError DOMException when the client aborts for timeout).
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            });
            setTimeout(() => resolve(jsonResponse({})), 200);
          }),
      }),
    });
    await expect(client.search('home')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('propagates cancellation from an external AbortSignal', async () => {
    const client = new IconifyClient({
      fetchFn: makeFetch({
        'api.iconify.design/search': () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 50);
          }),
      }),
    });
    const controller = new AbortController();
    const promise = client.search('home', {}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('rejects a request cancelled before it starts', async () => {
    const client = new IconifyClient({
      fetchFn: fetchForFixture('search-home.json', SEARCH_ROUTE),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client.search('home', {}, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('retries 5xx failures with backoff and succeeds', async () => {
    let attempts = 0;
    const client = new IconifyClient({
      maxRetries: 2,
      timeoutMs: 1000,
      fetchFn: makeFetch({
        'api.iconify.design/search': () => {
          attempts++;
          if (attempts < 3) return new Response('server error', { status: 500 });
          return jsonResponse({ icons: ['mdi:home'], total: 1, limit: 1, start: 0 });
        },
      }),
    });
    const res = await client.search('home', { limit: 1 });
    expect(attempts).toBe(3);
    expect(res.icons).toContain('mdi:home');
  });

  it('never retries 4xx responses', async () => {
    let attempts = 0;
    const client = new IconifyClient({
      maxRetries: 2,
      fetchFn: makeFetch({
        'api.iconify.design/search': () => {
          attempts++;
          return new Response('bad request', { status: 400 });
        },
      }),
    });
    await expect(client.search('home')).rejects.toMatchObject({ code: 'http-error' });
    expect(attempts).toBe(1);
  });

  it('opens the circuit after repeated failures and stops probing the dead host', async () => {
    let primaryAttempts = 0;
    let backupAttempts = 0;
    const suppressed: string[] = [];
    const client = new IconifyClient({
      circuitFailureThreshold: 2,
      circuitOpenMs: 60_000,
      maxRetries: 0,
      onDiagnostic: (e) => {
        if (e.kind === 'host-suppressed') suppressed.push(e.host);
      },
      fetchFn: makeFetch({
        'api.iconify.design/search': () => {
          primaryAttempts++;
          return new Response('down', { status: 502 });
        },
        'api.simplesvg.com/search': () => {
          backupAttempts++;
          if (backupAttempts === 1) return new Response('down', { status: 502 });
          return jsonResponse({ icons: ['mdi:home'], total: 1, limit: 1, start: 0 });
        },
      }),
    });
    // First search: both hosts fail once (circuit count 1 each).
    await expect(client.search('a')).rejects.toBeInstanceOf(IconifyClientError);
    expect(primaryAttempts).toBe(1);
    // Second search: primary fails (circuit opens), backup recovers.
    await client.search('b');
    expect(primaryAttempts).toBe(2);
    expect(suppressed).toContain('https://api.iconify.design');
    // Circuit open: primary gets no more traffic; backup serves.
    const attemptsAfterOpen = primaryAttempts;
    await client.search('c');
    await client.search('d');
    expect(primaryAttempts).toBe(attemptsAfterOpen);
  });

  it('rejects oversized responses before parsing', async () => {
    const big = 'x'.repeat(10_000);
    const client = new IconifyClient({
      maxResponseBytes: 1_000,
      hosts: ['https://api.iconify.design'],
      fetchFn: makeFetch({ 'api.iconify.design/search': jsonResponse(big) }),
    });
    await expect(client.search('home')).rejects.toMatchObject({ code: 'response-too-large' });
  });

  it('rejects invalid response shapes', async () => {
    const client = new IconifyClient({
      fetchFn: makeFetch({ 'api.iconify.design/search': jsonResponse({ nope: true }) }),
    });
    await expect(client.search('home')).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects non-JSON content types', async () => {
    const client = new IconifyClient({
      hosts: ['https://api.iconify.design'],
      fetchFn: makeFetch({
        'api.iconify.design/search': new Response('<html>oops</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      }),
    });
    await expect(client.search('home')).rejects.toMatchObject({
      code: 'content-type-mismatch',
    });
  });
});
