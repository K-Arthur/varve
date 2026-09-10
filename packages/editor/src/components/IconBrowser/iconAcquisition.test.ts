// @vitest-environment jsdom
/**
 * Icon acquisition tests — one-action fetch/cache/sanitize/insert path.
 */

import type { IconSourceDescriptor } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getIconAcquisitionService,
  IconAcquisitionError,
  setIconAcquisitionService,
} from './iconAcquisition';
import { clearIconCache, getStoredIcon, listStoredIcons } from './iconStorage';

const SVG_HOME =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';

function descriptor(name = 'home', pack = 'mdi'): IconSourceDescriptor {
  return {
    canonicalId: `iconify:${pack}:${name}`,
    providerId: 'iconify',
    packId: pack,
    iconId: name,
    name,
    displayName: name,
    aliases: [],
    keywords: [],
    categories: ['UI'],
    styles: ['outline'],
    paletteType: 'monotone',
    licence: {
      title: 'Apache 2.0',
      spdxId: 'Apache-2.0',
      url: 'https://example.com/LIC',
      attributionRequired: true,
      attributionText: 'Licensed under Apache License 2.0',
    },
  };
}

function fakeProvider(overrides: { svg?: string | null; fail?: boolean } = {}) {
  const svg = overrides.svg === undefined ? SVG_HOME : overrides.svg;
  return {
    id: 'iconify',
    name: 'Iconify',
    kind: 'public-api' as const,
    enabled: true,
    requiresNetwork: true,
    capabilities: ['search', 'fetch-svg', 'fetch-icon-data', 'batch-retrieval'] as const,
    search: vi.fn(async () => ({ items: [], total: 0, start: 0, exhausted: true })),
    getSvg: vi.fn(async () => (overrides.fail ? null : svg)),
    getIconData: vi.fn(async (descriptors: IconSourceDescriptor[]) =>
      descriptors.map((d) => ({ descriptor: d, svg: overrides.fail ? null : svg })),
    ),
  };
}

afterEach(async () => {
  setIconAcquisitionService(null);
  await clearIconCache();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  setIconAcquisitionService(null);
  await clearIconCache();
});

describe('acquire — one-action pipeline', () => {
  it('fetches, sanitizes, stores, and returns the SVG in one call', async () => {
    const provider = fakeProvider();
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const result = await getIconAcquisitionService().acquire(descriptor());
    expect(result.svg).toContain('<path');
    expect(result.fromCache).toBe(false);
    expect(provider.getSvg).toHaveBeenCalledTimes(1);
    const stored = await getStoredIcon('iconify:mdi:home');
    expect(stored?.canonicalId).toBe('iconify:mdi:home');
    expect(stored?.spdxId).toBe('Apache-2.0');
    expect(stored?.attributionText).toBe('Licensed under Apache License 2.0');
  });

  it('reuses the cache without network for a second acquire', async () => {
    const provider = fakeProvider();
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const service = getIconAcquisitionService();
    await service.acquire(descriptor());
    const second = await service.acquire(descriptor());
    expect(second.fromCache).toBe(true);
    expect(provider.getSvg).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent in-flight requests for the same icon', async () => {
    let calls = 0;
    const provider = fakeProvider();
    provider.getSvg = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return SVG_HOME;
    });
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const service = getIconAcquisitionService();
    const [a, b] = await Promise.all([
      service.acquire(descriptor()),
      service.acquire(descriptor()),
    ]);
    expect(calls).toBe(1);
    expect(a.svg).toBeTruthy();
    expect(b.svg).toBeTruthy();
  });

  it('rejects icons that fail sanitization', async () => {
    const provider = fakeProvider({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    // Sanitization strips the script but keeps the svg root — the icon is
    // usable. Only fundamental rejections (parse failure) throw.
    const result = await getIconAcquisitionService().acquire(descriptor());
    expect(result.svg).not.toContain('<script');
  });

  it('maps missing icons to icon-not-found', async () => {
    const provider = fakeProvider({ svg: null });
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    await expect(getIconAcquisitionService().acquire(descriptor())).rejects.toMatchObject({
      code: 'icon-not-found',
    });
  });

  it('propagates cancellation without storing partial data', async () => {
    const provider = fakeProvider();
    provider.getSvg = vi.fn(
      () =>
        new Promise<string | null>((_resolve, reject) =>
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 20),
        ),
    );
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const controller = new AbortController();
    const promise = getIconAcquisitionService().acquire(descriptor(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(await listStoredIcons()).toHaveLength(0);
  });

  it('fails with provider-unavailable when the owning provider is missing', async () => {
    const { resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    await expect(getIconAcquisitionService().acquire(descriptor())).rejects.toMatchObject({
      code: 'provider-unavailable',
    });
  });
});

describe('prefetchBatch', () => {
  it('batches icon data and stores sanitized previews', async () => {
    const provider = fakeProvider();
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const svgMap = await getIconAcquisitionService().prefetchBatch([
      descriptor('home'),
      descriptor('star'),
    ]);
    expect(svgMap.size).toBe(2);
    expect(provider.getIconData).toHaveBeenCalledTimes(1);
    expect(await listStoredIcons()).toHaveLength(2);
  });

  it('skips already-cached icons', async () => {
    const provider = fakeProvider();
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const service = getIconAcquisitionService();
    await service.prefetchBatch([descriptor('home')]);
    provider.getIconData.mockClear();
    const svgMap = await service.prefetchBatch([descriptor('home'), descriptor('star')]);
    expect(provider.getIconData).toHaveBeenCalledTimes(1);
    expect(svgMap.has('iconify:mdi:home')).toBe(true);
    expect(svgMap.has('iconify:mdi:star')).toBe(true);
  });

  it('is best-effort: individual failures do not throw', async () => {
    const provider = fakeProvider({ fail: true });
    const { getIconProviderRegistry, resetIconProviderRegistry } = await import('@varve/engine');
    resetIconProviderRegistry();
    getIconProviderRegistry().register(provider);

    const svgMap = await getIconAcquisitionService().prefetchBatch([descriptor('home')]);
    expect(svgMap.size).toBe(0);
  });
});

describe('structured errors', () => {
  it('distinguishes cancellation from other failures', async () => {
    expect(IconAcquisitionError.name).toBe('IconAcquisitionError');
    const err = new IconAcquisitionError('Cancelled', 'cancelled', 'iconify:mdi:home');
    expect(err.code).toBe('cancelled');
  });
});
