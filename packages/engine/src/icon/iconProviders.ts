/**
 * Icon providers — provider-neutral discovery system for online icon
 * repositories. Each provider wraps a remote icon source behind a uniform
 * search/getDetails/getSvg interface so callers can query multiple sources in
 * parallel without coupling to any single API.
 *
 * Research basis: Iconify API (public, 300k+ icons), Simple Icons (brand),
 * and self-hosted icon set patterns.
 */

// ---------------------------------------------------------------------------
// Provider option/result types
// ---------------------------------------------------------------------------

/** Search options accepted by every icon provider. */
export interface IconProviderSearchOptions {
  /** Filter by category/tag. */
  category?: string;
  /** Filter by icon style (filled, outline, etc.). */
  style?: IconStyle;
  /** Max results to return (default 50). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
  /** Filter to a specific icon pack/prefix. */
  prefix?: string;
  /** Filter to free-only icons. */
  freeOnly?: boolean;
}

/** Supported icon styles. */
export type IconStyle =
  | 'outline'
  | 'filled'
  | 'sharp'
  | 'rounded'
  | 'duotone'
  | 'thin'
  | 'regular'
  | 'bold';

/** A single search-hit from an icon provider. */
export interface IconProviderResult {
  /** Stable icon identifier (provider-specific, e.g. "mdi:home"). */
  id: string;
  /** Human-readable icon name. */
  name: string;
  /** Icon pack/prefix (e.g. "mdi", "lucide", "phosphor"). */
  prefix: string;
  /** Category/tag for grouping. */
  category: string;
  /** Available styles for this icon. */
  styles: IconStyle[];
  /** License information. */
  license: IconLicense;
  /** Author/creator name. */
  author?: string;
  /** Icon version. */
  version?: string;
  /** Width of the icon in the source grid. */
  width?: number;
  /** Height of the icon in the source grid. */
  height?: number;
  /** Whether the icon is available offline (cached). */
  isOfflineAvailable?: boolean;
}

/** Extended icon info returned by getDetails(). */
export interface IconProviderIconDetails extends IconProviderResult {
  /** Longer description, if available. */
  description?: string;
  /** Tags for search. */
  tags: string[];
  /** Source URL metadata. */
  sourceUrl?: string;
  /** All available variants for this icon. */
  variants: IconVariantInfo[];
  /** Number of icons in the same pack. */
  totalIconsInPack?: number;
  /** Last updated date, if known. */
  lastUpdated?: string;
}

/** Information about a specific variant of an icon. */
export interface IconVariantInfo {
  style: IconStyle;
  /** SVG string for this variant (may be lazy-loaded). */
  svg?: string;
  /** Preview URL or data URL. */
  preview?: string;
}

/** License metadata for an icon. */
export interface IconLicense {
  /** License name (e.g. "Apache 2.0", "MIT", "CC-BY 4.0"). */
  name: string;
  /** URL to the full license text. */
  url?: string;
  /** Whether commercial use is permitted. */
  commercial: boolean;
  /** Whether modification is permitted. */
  modification: boolean;
  /** Whether attribution is required. */
  attributionRequired: boolean;
  /** Attribution text template, if required. */
  attributionText?: string;
}

// ---------------------------------------------------------------------------
// IconProvider interface
// ---------------------------------------------------------------------------

/** Uniform interface every icon provider must implement. */
export interface IconProvider {
  /** Unique provider identifier (e.g. "iconify"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Provider category. */
  kind: 'public-api' | 'local-filesystem' | 'bundled';
  /** Whether the provider is currently enabled. */
  enabled: boolean;
  /** Whether the provider requires network access. */
  requiresNetwork: boolean;
  /** Search for icons matching a query. */
  search(query: string, options?: IconProviderSearchOptions): Promise<IconProviderResult[]>;
  /** Retrieve extended info about a specific icon. */
  getDetails(iconId: string): Promise<IconProviderIconDetails | null>;
  /** Fetch the SVG string for a specific icon. */
  getSvg(iconId: string, style?: IconStyle): Promise<string | null>;
  /** List available prefixes/packs. */
  getPrefixes?(): Promise<IconPackInfo[]>;
  /** Get category list. */
  getCategories?(): Promise<string[]>;
}

/** Information about an icon pack. */
export interface IconPackInfo {
  /** Pack prefix (e.g. "mdi", "lucide"). */
  prefix: string;
  /** Pack name. */
  name: string;
  /** Number of icons in the pack. */
  total: number;
  /** Author info. */
  author?: { name: string; url?: string };
  /** License. */
  license?: IconLicense;
  /** Category. */
  category?: string;
}

// ---------------------------------------------------------------------------
// IconProviderRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for icon providers. Manages multiple providers and provides
 * unified search across all enabled sources.
 */
export class IconProviderRegistry {
  private providers = new Map<string, IconProvider>();

  register(provider: IconProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get(providerId: string): IconProvider | undefined {
    return this.providers.get(providerId);
  }

  getAll(): IconProvider[] {
    return Array.from(this.providers.values());
  }

  getEnabled(): IconProvider[] {
    return this.getAll().filter((p) => p.enabled);
  }

  /**
   * Search across all enabled providers in parallel.
   * Results are merged, deduplicated by icon ID, and ranked.
   */
  async search(query: string, options?: IconProviderSearchOptions): Promise<IconProviderResult[]> {
    const enabled = this.getEnabled();
    if (enabled.length === 0) return [];

    const results = await Promise.allSettled(enabled.map((p) => p.search(query, options)));

    const all: IconProviderResult[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        all.push(...result.value);
      }
    }

    return this.deduplicateResults(all);
  }

  /**
   * Fetch SVG for a specific icon from its provider.
   */
  async getSvg(iconId: string, style?: IconStyle): Promise<string | null> {
    // Icon IDs are in format "prefix:iconName"
    const colonIdx = iconId.indexOf(':');
    if (colonIdx < 0) return null;
    // Find the provider that handles this prefix
    for (const provider of this.getEnabled()) {
      const svg = await provider.getSvg(iconId, style);
      if (svg) return svg;
    }
    return null;
  }

  private deduplicateResults(results: IconProviderResult[]): IconProviderResult[] {
    const seen = new Map<string, IconProviderResult>();
    for (const r of results) {
      const existing = seen.get(r.id);
      if (!existing) {
        seen.set(r.id, r);
      } else if (r.styles.length > existing.styles.length) {
        // Prefer the entry with more style info
        seen.set(r.id, r);
      }
    }
    return Array.from(seen.values());
  }
}

/** Singleton registry instance. */
export const iconProviderRegistry = new IconProviderRegistry();

/** Register an icon provider with the global registry. */
export function registerIconProvider(provider: IconProvider): void {
  iconProviderRegistry.register(provider);
}

/** Get the global icon provider registry. */
export function getIconProviderRegistry(): IconProviderRegistry {
  return iconProviderRegistry;
}
