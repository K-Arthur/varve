/**
 * Iconify provider — wraps the public Iconify API for icon search and retrieval.
 *
 * The Iconify API is free, public, and supports 300,000+ icons from 200+
 * open-source icon sets. No API key required.
 *
 * API reference: https://iconify.design/docs/api/index.html
 */

import type {
  IconLicense,
  IconPackInfo,
  IconProvider,
  IconProviderIconDetails,
  IconProviderResult,
  IconProviderSearchOptions,
  IconStyle,
} from './iconProviders';

const ICONIFY_API_BASE = 'https://api.iconify.design';

/** Map Iconify style names to our internal IconStyle type. */
function mapIconifyStyle(style: string | undefined): IconStyle {
  switch (style) {
    case 'fill':
    case 'filled':
      return 'filled';
    case 'outline':
    case 'stroke':
      return 'outline';
    case 'sharp':
      return 'sharp';
    case 'rounded':
      return 'rounded';
    case 'duotone':
      return 'duotone';
    case 'thin':
      return 'thin';
    case 'light':
      return 'regular';
    case 'bold':
      return 'bold';
    default:
      return 'outline';
  }
}

/** Parse license info from Iconify collection metadata. */
function parseLicense(license: { title?: string; url?: string } | undefined): IconLicense {
  if (!license) {
    return {
      name: 'Unknown',
      commercial: false,
      modification: false,
      attributionRequired: false,
    };
  }
  return {
    name: license.title ?? 'Unknown',
    url: license.url,
    commercial: true, // Most iconify sets are open source
    modification: true,
    attributionRequired: true, // Conservative default
  };
}

export class IconifyProvider implements IconProvider {
  id = 'iconify';
  name = 'Iconify';
  kind = 'public-api' as const;
  enabled = true;
  requiresNetwork = true;

  async search(query: string, options?: IconProviderSearchOptions): Promise<IconProviderResult[]> {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', String(options?.limit ?? 50));

    if (options?.prefix) {
      params.set('prefix', options.prefix);
    }
    if (options?.offset) {
      params.set('start', String(options.offset));
    }
    if (options?.category) {
      params.set('category', options.category);
    }

    const url = `${ICONIFY_API_BASE}/search?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new IconProviderError(
        `Iconify search failed: ${res.status}`,
        'provider-error',
        this.id,
      );
    }

    const data = (await res.json()) as IconifySearchResponse;
    return (data.icons ?? []).map((icon) => this.mapSearchResult(icon, data.info));
  }

  async getDetails(iconId: string): Promise<IconProviderIconDetails | null> {
    const [prefix, name] = this.parseIconId(iconId);
    if (!prefix || !name) return null;

    const url = `${ICONIFY_API_BASE}/collection?prefix=${prefix}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as CollectionInfo;

    // Get the SVG for this icon
    const svgUrl = `${ICONIFY_API_BASE}/svg?prefix=${prefix}&icon=${name}`;
    const svgRes = await fetch(svgUrl);
    let svg: string | undefined;
    if (svgRes.ok) {
      svg = await svgRes.text();
    }

    const tags: string[] = [];
    if (data.categories) {
      tags.push(...Object.keys(data.categories));
    }
    if (data.uncategorized) {
      tags.push(...data.uncategorized);
    }

    const styles: IconStyle[] = [];
    if (data.styles) {
      styles.push(...data.styles.map(mapIconifyStyle));
    }

    return {
      id: iconId,
      name,
      prefix,
      category: data.category ?? '',
      styles: styles.length > 0 ? [...new Set(styles)] : ['outline'],
      license: parseLicense(data.license),
      author: data.author?.name,
      version: data.version,
      width: data.width,
      height: data.height,
      description: undefined,
      tags: [...new Set(tags)],
      sourceUrl: data.author?.url,
      variants: [
        {
          style: 'outline',
          svg,
        },
      ],
      totalIconsInPack: data.total,
      lastUpdated: data.lastModified ? new Date(data.lastModified * 1000).toISOString() : undefined,
      isOfflineAvailable: false,
    };
  }

  async getSvg(iconId: string, _style?: IconStyle): Promise<string | null> {
    const [prefix, name] = this.parseIconId(iconId);
    if (!prefix || !name) return null;

    const url = `${ICONIFY_API_BASE}/svg?prefix=${prefix}&icon=${name}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    return res.text();
  }

  async getPrefixes(): Promise<IconPackInfo[]> {
    const url = `${ICONIFY_API_BASE}/collections`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, CollectionPreview>;
    return Object.entries(data).map(([prefix, info]) => ({
      prefix,
      name: info.name,
      total: info.total,
      author: info.author ? { name: info.author.name ?? '', url: info.author.url } : undefined,
      license: info.license ? parseLicense(info.license) : undefined,
      category: info.category,
    }));
  }

  async getCategories(): Promise<string[]> {
    const url = `${ICONIFY_API_BASE}/categories`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as string[];
    return data;
  }

  private parseIconId(iconId: string): [string, string] | [null, null] {
    const colonIdx = iconId.indexOf(':');
    if (colonIdx < 0) return [null, null];
    return [iconId.slice(0, colonIdx), iconId.slice(colonIdx + 1)];
  }

  private mapSearchResult(icon: string, info?: Record<string, CollectionInfo>): IconProviderResult {
    const colonIdx = icon.indexOf(':');
    const prefix = colonIdx >= 0 ? icon.slice(0, colonIdx) : '';
    const name = colonIdx >= 0 ? icon.slice(colonIdx + 1) : icon;
    const collectionInfo = info?.[prefix];

    const styles: IconStyle[] = [];
    if (collectionInfo?.styles) {
      styles.push(...collectionInfo.styles.map(mapIconifyStyle));
    }

    return {
      id: icon,
      name,
      prefix,
      category: collectionInfo?.category ?? '',
      styles: styles.length > 0 ? [...new Set(styles)] : ['outline'],
      license: parseLicense(collectionInfo?.license),
      author: collectionInfo?.author?.name,
      version: collectionInfo?.version,
      width: collectionInfo?.width,
      height: collectionInfo?.height,
      isOfflineAvailable: false,
    };
  }
}

export class IconProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public providerId: string,
  ) {
    super(message);
    this.name = 'IconProviderError';
  }
}

// ---------------------------------------------------------------------------
// Iconify API response types
// ---------------------------------------------------------------------------

interface IconifySearchResponse {
  icons: string[];
  total: number;
  limit: number;
  start: number;
  info?: Record<string, CollectionInfo>;
  request?: string;
  collections?: Record<string, CollectionPreview>;
}

interface CollectionInfo {
  name: string;
  total: number;
  author?: { name?: string; url?: string };
  license?: { title?: string; url?: string };
  category?: string;
  categories?: Record<string, string[]>;
  uncategorized?: string[];
  styles?: string[];
  width?: number;
  height?: number;
  version?: string;
  lastModified?: number;
}

interface CollectionPreview {
  name: string;
  total: number;
  author?: { name?: string; url?: string };
  license?: { title?: string; url?: string };
  category?: string;
  styles?: string[];
  width?: number;
  height?: number;
}

/** Create and return the default Iconify provider instance. */
export function createIconifyProvider(): IconifyProvider {
  return new IconifyProvider();
}
