/**
 * Iconify provider — wraps the Iconify public API through the dedicated
 * `IconifyClient` (timeouts, fallback hosts, validation, batching).
 *
 * API reference: https://iconify.design/docs/api/
 *
 * Verified against live responses on 2026-08-04:
 * - /search returns { icons, total, limit, start, collections } — the
 *   collection metadata lives under `collections`, not `info`.
 * - The legacy /svg?prefix=&icon= route is NOT supported (404); the modern
 *   /{prefix}/{icon}.svg route is used instead.
 * - /categories does NOT exist; categories come from collection metadata.
 * - /keywords requires `keyword=` (not `query=`).
 * - /{prefix}.json?icons=a,b,c returns batched icon data.
 */

import type {
  IconifyClient,
  IconifyCollectionInfo,
  IconifyCollectionResponse,
  IconifyIconData,
} from './iconifyClient';
import { getIconifyClient, IconifyClientError } from './iconifyClient';
import { type IconLicenceSnapshot, resolveLicenceSnapshot } from './iconLicence';
import {
  type IconPackInfo,
  type IconProvider,
  type IconProviderCapability,
  IconProviderError,
  type IconProviderErrorCode,
  type IconProviderSearchOptions,
  type IconSearchPage,
  type IconSourceDescriptor,
  type IconStyle,
} from './iconProviders';

const PROVIDER_ID = 'iconify';

/** Style suffixes used by variant-rich packs (e.g. material-symbols). */
const STYLE_SUFFIXES: ReadonlyArray<readonly [string, IconStyle]> = [
  ['outline-rounded', 'rounded'],
  ['outline', 'outline'],
  ['rounded', 'rounded'],
  ['sharp', 'sharp'],
  ['filled', 'filled'],
  ['twotone', 'duotone'],
  ['duotone', 'duotone'],
  ['bold', 'bold'],
  ['light', 'regular'],
  ['thin', 'thin'],
  ['regular', 'regular'],
  ['broken', 'outline'],
  ['linear', 'regular'],
];

/** Extract a style suffix from an icon name when it is a known variant marker. */
function extractStyleSuffix(name: string): { base: string; style?: IconStyle } {
  const lower = name.toLowerCase();
  for (const [suffix, style] of STYLE_SUFFIXES) {
    if (lower.endsWith(`-${suffix}`)) {
      const base = name.slice(0, name.length - suffix.length - 1);
      if (base.length > 0) return { base, style };
    }
  }
  return { base: name };
}

/** Deterministic canonical id for a search hit ("iconify:mdi:home"). */
export function iconifyCanonicalId(prefix: string, name: string): string {
  return `${PROVIDER_ID}:${prefix}:${name}`;
}

function parseIconifyId(canonicalId: string): { prefix: string; name: string } | null {
  const [, prefix, name] = canonicalId.split(':');
  if (!prefix || !name) return null;
  return { prefix, name };
}

function collectionLicence(
  info: IconifyCollectionInfo | undefined,
  source: string,
): IconLicenceSnapshot {
  if (!info?.license) {
    return resolveLicenceSnapshot({ metadataSource: source });
  }
  return resolveLicenceSnapshot({
    title: info.license.title,
    spdxId: info.license.spdx,
    url: info.license.url,
    rawScope: info.license.scope,
    metadataSource: source,
  });
}

function descriptorFromSearchHit(
  hit: string,
  info: Record<string, IconifyCollectionInfo> | undefined,
): IconSourceDescriptor {
  const colon = hit.indexOf(':');
  const prefix = colon >= 0 ? hit.slice(0, colon) : '';
  const rawName = colon >= 0 ? hit.slice(colon + 1) : hit;
  const { style } = extractStyleSuffix(rawName);
  const collection = info?.[prefix];
  const licence = collectionLicence(collection, 'iconify:search');
  const keywords = [...(collection?.tags ?? [])];
  if (collection?.category) keywords.push(collection.category);
  const categories: string[] = [];
  if (collection?.category) categories.push(collection.category);
  return {
    canonicalId: iconifyCanonicalId(prefix, rawName),
    providerId: PROVIDER_ID,
    packId: prefix,
    iconId: rawName,
    name: rawName,
    displayName: rawName,
    aliases: [],
    keywords,
    categories,
    styles: style ? [style] : ['outline'],
    paletteType: collection?.palette ? 'multicolor' : 'monotone',
    width: collection?.width,
    height: collection?.height,
    licence,
    author: collection?.author?.name,
    sourceUrl: collection?.author?.url,
    version: collection?.version,
    lastModified: collection?.lastModified,
  };
}

export class IconifyProvider implements IconProvider {
  id = PROVIDER_ID;
  name = 'Iconify';
  kind = 'public-api' as const;
  enabled = true;
  requiresNetwork = true;

  capabilities = [
    'search',
    'browse-collections',
    'browse-collection',
    'fetch-icon-data',
    'fetch-svg',
    'batch-retrieval',
    'keyword-suggestions',
    'update-checks',
    'licence-metadata',
    'multicolor',
  ] as const satisfies readonly IconProviderCapability[];

  private readonly client: IconifyClient;

  constructor(client?: IconifyClient) {
    this.client = client ?? getIconifyClient();
  }

  async search(query: string, options?: IconProviderSearchOptions): Promise<IconSearchPage> {
    const limit = options?.limit ?? 50;
    try {
      const data = await this.client.search(
        query,
        {
          limit,
          start: options?.start,
          prefix: options?.prefix,
          category: options?.category,
        },
        { signal: options?.signal, timeoutMs: options?.timeoutMs },
      );
      const items = (data.icons ?? []).map((hit) => descriptorFromSearchHit(hit, data.collections));
      return {
        items,
        total: data.total,
        start: data.start,
        exhausted: data.start + items.length >= data.total,
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getPacks(options?: IconProviderSearchOptions): Promise<IconPackInfo[]> {
    try {
      const data = await this.client.collections(undefined, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
      return Object.entries(data).map(([prefix, info]) => ({
        prefix,
        name: info.name ?? prefix,
        total: info.total ?? 0,
        author: info.author?.name ? { name: info.author.name, url: info.author.url } : undefined,
        licence: collectionLicence(info, 'iconify:collections'),
        category: info.category,
        version: info.version,
        lastModified: info.lastModified,
        hasPalette: info.palette,
        hidden: info.hidden,
      }));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getPackIcons(prefix: string, options?: IconProviderSearchOptions): Promise<IconSearchPage> {
    try {
      const limit = options?.limit ?? 200;
      const data = await this.client.collection(
        prefix,
        { limit, start: options?.start },
        { signal: options?.signal, timeoutMs: options?.timeoutMs },
      );
      const info = data.info ?? (data as unknown as { info?: IconifyCollectionInfo }).info;
      const names = Array.isArray(data.icons) ? data.icons : Object.keys(data.icons);
      const licence = collectionLicence(info, 'iconify:collection');
      const keywords = [...(info?.tags ?? [])];
      const categories: string[] = [];
      if (info?.category) categories.push(info.category);
      const items: IconSourceDescriptor[] = names.map((name) => {
        const { base, style } = extractStyleSuffix(name);
        return {
          canonicalId: iconifyCanonicalId(prefix, name),
          providerId: PROVIDER_ID,
          packId: prefix,
          iconId: name,
          name: base,
          displayName: name,
          aliases: [],
          keywords,
          categories,
          styles: style ? [style] : ['outline'],
          paletteType: info?.palette ? 'multicolor' : 'monotone',
          width: info?.width,
          height: info?.height,
          licence,
          author: info?.author?.name,
          sourceUrl: info?.author?.url,
          version: info?.version,
          lastModified: data.lastModified ?? info?.lastModified,
        };
      });
      return {
        items,
        total: data.total ?? names.length,
        start: options?.start ?? 0,
        exhausted: names.length === 0 || (options?.start ?? 0) + names.length >= data.total,
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getSvg(
    descriptor: IconSourceDescriptor,
    options?: IconProviderSearchOptions,
  ): Promise<string | null> {
    const parsed = parseIconifyId(descriptor.canonicalId);
    if (!parsed) return null;
    try {
      return await this.client.svg(parsed.prefix, parsed.name, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      if (err instanceof IconifyClientError && err.code === 'http-error' && err.status === 404) {
        return null;
      }
      throw this.translateError(err);
    }
  }

  async getIconData(
    descriptors: IconSourceDescriptor[],
    options?: IconProviderSearchOptions,
  ): Promise<Array<{ descriptor: IconSourceDescriptor; svg: string | null }>> {
    const byPack = new Map<string, IconSourceDescriptor[]>();
    for (const d of descriptors) {
      const parsed = parseIconifyId(d.canonicalId);
      if (!parsed) continue;
      const list = byPack.get(parsed.prefix) ?? [];
      list.push(d);
      byPack.set(parsed.prefix, list);
    }

    const out: Array<{ descriptor: IconSourceDescriptor; svg: string | null }> = [];
    for (const [prefix, items] of byPack) {
      const names = items.map((d) => parseIconifyId(d.canonicalId)!.name);
      try {
        const batch = await this.client.icons(prefix, names, {
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
        });
        for (const item of items) {
          const parsed = parseIconifyId(item.canonicalId);
          if (!parsed) continue;
          const body = resolveIconBody(parsed.name, batch);
          out.push({
            descriptor: item,
            svg: body ? buildSvgFromIconData(parsed.name, body, batch.width ?? batch.height) : null,
          });
        }
      } catch (err) {
        if (err instanceof IconifyClientError && err.code === 'cancelled') throw err;
        for (const item of items) out.push({ descriptor: item, svg: null });
      }
    }
    return out;
  }

  async getKeywords(query: string, options?: IconProviderSearchOptions): Promise<string[]> {
    try {
      const data = await this.client.keywords(query, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
      return data.matches ?? [];
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getLastModified(
    prefixes: string[],
    options?: IconProviderSearchOptions,
  ): Promise<Record<string, number>> {
    try {
      return await this.client.lastModified(prefixes, {
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private translateError(err: unknown): IconProviderError {
    if (err instanceof IconProviderError) return err;
    if (err instanceof IconifyClientError) {
      const code = mapClientErrorCode(err.code);
      return new IconProviderError(
        err.message,
        code,
        PROVIDER_ID,
        `host=${err.host}${err.status ? ` status=${err.status}` : ''}`,
      );
    }
    return IconProviderError.fromTransport(PROVIDER_ID, err);
  }
}

function mapClientErrorCode(code: IconifyClientError['code']): IconProviderErrorCode {
  switch (code) {
    case 'timeout':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    case 'http-error':
      return 'http-error';
    case 'invalid-response':
    case 'content-type-mismatch':
      return 'invalid-response';
    case 'response-too-large':
      return 'response-too-large';
    default:
      return 'network-error';
  }
}

/** Reconstruct a full SVG from Iconify icon data (batched retrieval). */
export function buildSvgFromIconData(
  name: string,
  data: { body: string; width?: number; height?: number },
  fallbackSize = 24,
): string {
  const width = data.width ?? fallbackSize;
  const height = data.height ?? fallbackSize;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : fallbackSize;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : fallbackSize;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}" ` +
    `width="${safeWidth}" height="${safeHeight}">` +
    `<title>${escapeXml(name)}</title>` +
    `${data.body}</svg>`
  );
}

/**
 * Resolve an icon body, following alias chains (e.g. "settings" -> parent
 * "cog"). Returns the resolved body with the alias's own dimensions when
 * present. Depth-limited against cyclic alias definitions.
 */
export function resolveIconBody(
  name: string,
  batch: {
    icons: ReadonlyMap<string, IconifyIconData>;
    aliases?: Record<string, { parent?: string }>;
  },
): { body: string; width?: number; height?: number } | null {
  const seen = new Set<string>();
  let current: string | undefined = name;
  while (current) {
    if (seen.has(current)) return null;
    seen.add(current);
    const direct = batch.icons.get(current);
    if (direct) return direct;
    const alias: { parent?: string } | undefined = batch.aliases?.[current];
    if (alias && typeof alias.parent === 'string') {
      current = alias.parent;
      continue;
    }
    return null;
  }
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Create and return the default Iconify provider instance. */
export function createIconifyProvider(client?: IconifyClient): IconifyProvider {
  return new IconifyProvider(client);
}

export type { IconifyCollectionInfo, IconifyCollectionResponse };
