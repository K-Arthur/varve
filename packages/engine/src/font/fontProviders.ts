/**
 * Font providers — provider-neutral discovery system for public font
 * repositories. Each provider wraps a remote or local font source behind a
 * uniform search/getDetails/getDownloadUrls interface so callers can query
 * multiple sources in parallel without coupling to any single API.
 *
 * Research basis: Google Fonts Developer API v2, Fontsource CDN,
 * Adobe Fonts registry, OS fontconfig/scanner patterns.
 */

import type { ParsedAxis, ParsedFontMetadata } from './fontIdentity';

// ---------------------------------------------------------------------------
// Provider option/result types
// ---------------------------------------------------------------------------

/** Search options accepted by every provider. */
export interface FontProviderSearchOptions {
  /** Filter by classification (sans-serif, serif, monospace, display, handwriting). */
  category?: string;
  /** Max results to return (default 20). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
  /** Sort order. */
  sort?: 'relevance' | 'popularity' | 'date' | 'alphabetical';
}

/** A single search-hit from a provider. */
export interface FontProviderResult {
  /** Stable family identifier (provider-specific). */
  familyId: string;
  /** Human-readable family name. */
  familyName: string;
  /** Classification (sans-serif, serif, …). */
  category: string;
  /** Number of variants (weights × styles) available. */
  variants: number;
  /** Whether the family offers a variable font. */
  isVariable: boolean;
  /** Supported language/region tags (e.g. ["latin", "latin-ext"]). */
  languages: string[];
  /** Optional sample text for previews. */
  previewText?: string;
}

/** Extended family info returned by getDetails(). */
export interface FontProviderFamily extends FontProviderResult {
  /** Longer description of the family. */
  description?: string;
  /** Designer name(s). */
  designers?: string[];
  /** License metadata. */
  license: FontLicense;
  /** ISO-8601 date of last update, if known. */
  lastUpdated?: string;
  /** Semantic version string, if known. */
  version?: string;
}

/** A downloadable font file. */
export interface FontProviderDownload {
  /** Direct download URL. */
  url: string;
  /** File format. */
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  /** CSS weight value (100–900). */
  weight: number;
  /** CSS font style. */
  style: 'normal' | 'italic';
  /** File size in bytes, if known. */
  size?: number;
}

/** License metadata for a font family. */
export interface FontLicense {
  /** License name (e.g. "SIL Open Font License 1.1"). */
  name: string;
  /** URL to the full license text. */
  url?: string;
  /** Granular permission flags. */
  permissions: {
    /** May be used for commercial products/services. */
    commercial: boolean;
    /** May be modified and redistributed. */
    modification: boolean;
    /** May be redistributed as-is. */
    redistribution: boolean;
    /** May be embedded in documents/apps. */
    embedding: boolean;
  };
}

// ---------------------------------------------------------------------------
// FontProvider interface
// ---------------------------------------------------------------------------

/** Uniform interface every font provider must implement. */
export interface FontProvider {
  /** Unique provider identifier (e.g. "google-fonts"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Provider category. */
  kind: 'public-api' | 'local-filesystem' | 'custom-url';
  /** Whether the provider is currently enabled. */
  enabled: boolean;
  /** Search for font families matching a query. */
  search(query: string, options?: FontProviderSearchOptions): Promise<FontProviderResult[]>;
  /** Retrieve extended info about a specific family. */
  getDetails(familyId: string): Promise<FontProviderFamily | null>;
  /** Get download URLs for a family's font files. */
  getDownloadUrls(familyId: string, format?: string): Promise<FontProviderDownload[]>;
  /** Get parsed metadata (axes, features, etc.) for a family, if available. */
  getMetadata(familyId: string): Promise<Partial<ParsedFontMetadata> | null>;
}

// ---------------------------------------------------------------------------
// Google Fonts Provider
// ---------------------------------------------------------------------------

const GOOGLE_FONTS_API_BASE = 'https://www.googleapis.com/webfonts/v2/webfonts';
const GOOGLE_FONTS_CSS_BASE = 'https://fonts.googleapis.com/css2';

/** Well-known Google Fonts categories. */
const GF_CATEGORIES: Record<string, string> = {
  'sans-serif': 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
  display: 'display',
  handwriting: 'handwriting',
};

/** Default Google Fonts license — SIL OFL 1.1 for the vast majority. */
const SIL_OFL_LICENSE: FontLicense = {
  name: 'SIL Open Font License 1.1',
  url: 'https://scripts.sil.org/OFL',
  permissions: {
    commercial: true,
    modification: true,
    redistribution: true,
    embedding: true,
  },
};

interface GoogleFontsListItem {
  family: string;
  variants: string[];
  subsets: string[];
  version: string;
  lastModified: string;
  files: Record<string, string>;
  category: string;
  kind: string;
}

interface GoogleFontsListResponse {
  kind: string;
  items: GoogleFontsListItem[];
}

/** Map sort option to Google Fonts API sort parameter. */
function mapSortParam(sort?: string): string {
  switch (sort) {
    case 'popularity':
      return 'popularity';
    case 'date':
      return 'date';
    case 'alphabetical':
      return 'alpha';
    default:
      return 'trending';
  }
}

/**
 * Parse a weight string like "regular" → 400, "bold" → 700,
 * "italic" → 400+italic, "700italic" → 700+italic.
 */
function parseWeightStyle(variant: string): { weight: number; style: 'normal' | 'italic' } {
  const isItalic = variant.endsWith('italic');
  const weightStr = isItalic ? variant.slice(0, -7) : variant;

  let weight: number;
  switch (weightStr) {
    case 'thin':
      weight = 100;
      break;
    case 'extralight':
      weight = 200;
      break;
    case 'light':
      weight = 300;
      break;
    case 'regular':
      weight = 400;
      break;
    case 'medium':
      weight = 500;
      break;
    case 'semibold':
      weight = 600;
      break;
    case 'bold':
      weight = 700;
      break;
    case 'extrabold':
      weight = 800;
      break;
    case 'black':
      weight = 900;
      break;
    default: {
      const parsed = parseInt(weightStr, 10);
      weight = Number.isFinite(parsed) ? parsed : 400;
    }
  }

  return { weight, style: isItalic ? 'italic' : 'normal' };
}

/** Convert a Google Fonts list item into our provider result format. */
function gfItemToResult(item: GoogleFontsListItem): FontProviderResult {
  const isVariable = item.variants.some((v) => v.includes('..') || v.startsWith('1'));
  return {
    familyId: item.family,
    familyName: item.family,
    category: item.category || 'unknown',
    variants: item.variants.length,
    isVariable,
    languages: item.subsets || [],
  };
}

export class GoogleFontsProvider implements FontProvider {
  readonly id = 'google-fonts';
  readonly name = 'Google Fonts';
  readonly kind = 'public-api' as const;
  enabled = true;

  private apiKey: string | undefined;
  private cache: Map<string, GoogleFontsListItem> = new Map();
  private listCache: GoogleFontsListItem[] | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /** Build the URL for the webfonts list endpoint. */
  buildListUrl(sort?: string, apiKey?: string): string {
    const params = new URLSearchParams();
    if (sort && sort !== 'relevance') {
      params.set('sort', mapSortParam(sort));
    }
    if (apiKey) {
      params.set('key', apiKey);
    }
    const qs = params.toString();
    return qs ? `${GOOGLE_FONTS_API_BASE}?${qs}` : GOOGLE_FONTS_API_BASE;
  }

  /** Build the CSS API v2 URL for a given family + weights. */
  buildCssUrl(family: string, weights?: number[]): string {
    const encoded = family.replace(/ /g, '+');
    if (weights && weights.length > 0) {
      const weightStr = weights.join(';');
      return `${GOOGLE_FONTS_CSS_BASE}?family=${encoded}:wght@${weightStr}`;
    }
    return `${GOOGLE_FONTS_CSS_BASE}?family=${encoded}`;
  }

  /** Fetch the full font list, using an in-memory cache. */
  private async fetchList(): Promise<GoogleFontsListItem[]> {
    if (this.listCache) return this.listCache;

    const url = this.buildListUrl(undefined, this.apiKey);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Google Fonts API returned ${res.status}: ${res.statusText}`);
    }
    const data: GoogleFontsListResponse = await res.json();
    this.listCache = data.items || [];

    // Populate per-family cache
    for (const item of this.listCache) {
      this.cache.set(item.family, item);
    }

    return this.listCache;
  }

  private async getItem(familyId: string): Promise<GoogleFontsListItem | null> {
    if (this.cache.has(familyId)) {
      return this.cache.get(familyId)!;
    }
    await this.fetchList();
    return this.cache.get(familyId) || null;
  }

  async search(query: string, options?: FontProviderSearchOptions): Promise<FontProviderResult[]> {
    const list = await this.fetchList();
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    let filtered = list;

    // Text filter
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter((item) => item.family.toLowerCase().includes(q));
    }

    // Category filter
    if (options?.category) {
      const cat = GF_CATEGORIES[options.category] || options.category;
      filtered = filtered.filter((item) => item.category === cat);
    }

    // Sort
    if (options?.sort === 'alphabetical') {
      filtered = [...filtered].sort((a, b) => a.family.localeCompare(b.family));
    } else if (options?.sort === 'date') {
      filtered = [...filtered].sort(
        (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
      );
    }
    // 'popularity' and 'relevance' rely on API order (already sorted by trending/popularity)

    return filtered.slice(offset, offset + limit).map(gfItemToResult);
  }

  async getDetails(familyId: string): Promise<FontProviderFamily | null> {
    const item = await this.getItem(familyId);
    if (!item) return null;

    const result = gfItemToResult(item);
    return {
      ...result,
      description: undefined,
      designers: [],
      license: SIL_OFL_LICENSE,
      lastUpdated: item.lastModified,
      version: item.version,
    };
  }

  async getDownloadUrls(familyId: string, format?: string): Promise<FontProviderDownload[]> {
    const item = await this.getItem(familyId);
    if (!item) return [];

    const downloads: FontProviderDownload[] = [];

    // item.files maps variant key → URL (e.g. "regular" → "…woff2", "700" → "…woff2")
    for (const [variantKey, url] of Object.entries(item.files)) {
      const { weight, style } = parseWeightStyle(variantKey);

      // Infer format from the URL extension
      const urlPath = url.split('?')[0] || url;
      const lastDot = urlPath.lastIndexOf('.');
      const ext =
        lastDot >= 0
          ? (urlPath.slice(lastDot + 1).toLowerCase() as 'ttf' | 'otf' | 'woff' | 'woff2')
          : 'woff2';

      if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) continue;
      if (format && ext !== format) continue;

      downloads.push({
        url,
        format: ext,
        weight,
        style,
      });
    }

    return downloads;
  }

  async getMetadata(familyId: string): Promise<Partial<ParsedFontMetadata> | null> {
    const item = await this.getItem(familyId);
    if (!item) return null;

    const isVariable = item.variants.some((v) => v.includes('..') || v.startsWith('1'));

    const axes: ParsedAxis[] = [];
    if (isVariable) {
      // Google Fonts variable fonts typically expose wght axis
      const wghtVariant = item.variants.find((v) => v.includes('..'));
      if (wghtVariant) {
        const range = wghtVariant.split('..');
        axes.push({
          tag: 'wght',
          name: 'Weight',
          min: parseInt(range[0] ?? '100', 10) || 100,
          default: 400,
          max: parseInt(range[1] ?? '900', 10) || 900,
        });
      }
    }

    return {
      isVariable,
      axes,
      category: (item.category as ParsedFontMetadata['category']) || 'unknown',
      source: 'remote',
      sourceLocation: `https://fonts.google.com/specimen/${item.family.replace(/ /g, '+')}`,
      version: item.version,
      description: undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/** Central registry for font providers. */
export class FontProviderRegistry {
  private providers: Map<string, FontProvider> = new Map();

  /** Register a provider. Overwrites any existing provider with the same id. */
  register(provider: FontProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Unregister a provider by id. */
  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  /** Get a provider by id. */
  get(id: string): FontProvider | undefined {
    return this.providers.get(id);
  }

  /** Return all registered providers. */
  all(): FontProvider[] {
    return Array.from(this.providers.values());
  }

  /** Return only enabled providers. */
  enabled(): FontProvider[] {
    return this.all().filter((p) => p.enabled);
  }

  /** Enable or disable a provider by id. */
  setProviderEnabled(id: string, enabled: boolean): void {
    const provider = this.providers.get(id);
    if (provider) {
      provider.enabled = enabled;
    }
  }

  /**
   * Search all enabled providers in parallel, then merge and deduplicate
   * results by familyId (first provider wins on duplicates).
   */
  async searchAll(
    query: string,
    options?: FontProviderSearchOptions,
  ): Promise<FontProviderResult[]> {
    const providers = this.enabled();
    const seen = new Set<string>();
    const merged: FontProviderResult[] = [];

    const results = await Promise.allSettled(providers.map((p) => p.search(query, options)));

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        if (!seen.has(item.familyId)) {
          seen.add(item.familyId);
          merged.push(item);
        }
      }
    }

    return merged;
  }
}
