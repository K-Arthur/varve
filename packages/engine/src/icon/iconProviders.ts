/**
 * Icon providers — provider-neutral discovery system for online icon
 * repositories. Each provider wraps a remote icon source behind a uniform
 * interface so callers can query multiple sources in parallel without
 * coupling to any single API.
 *
 * Identifier rules:
 * - `IconSourceDescriptor.canonicalId` is globally stable:
 *       provider-id:pack-prefix:icon-name[:variant]
 *   e.g. "iconify:mdi:home:outline"
 * - A pack prefix is never used as the provider id.
 *
 * Provider lifecycle:
 * - Registration is idempotent (re-registering the same provider id
 *   replaces the entry).
 * - `ensureProviders(callback)` runs the registration callback exactly once
 *   per registry instance and is safe to call from any component before the
 *   first search.
 * - `reset()` clears the registry and provider state for tests and hot
 *   reload. An empty registry produces a machine-readable diagnostic
 *   (`registry-empty`) instead of silently returning zero results.
 */

import type { IconLicenceSnapshot } from './iconLicence';

// ---------------------------------------------------------------------------
// Provider option/result types
// ---------------------------------------------------------------------------

/** Explicit capability flags — the UI tests capabilities, not optional methods. */
export const ICON_PROVIDER_CAPABILITIES = [
  'search',
  'browse-collections',
  'browse-collection',
  'fetch-icon-data',
  'fetch-svg',
  'batch-retrieval',
  'keyword-suggestions',
  'update-checks',
  'offline-packs',
  'licence-metadata',
  'style-variants',
  'multicolor',
] as const;

export type IconProviderCapability = (typeof ICON_PROVIDER_CAPABILITIES)[number];

/** Style family of an icon (source-agnostic vocabulary). */
export type IconStyle =
  | 'outline'
  | 'filled'
  | 'sharp'
  | 'rounded'
  | 'duotone'
  | 'thin'
  | 'regular'
  | 'bold';

export type IconPaletteType = 'monotone' | 'multicolor';

/** Search options accepted by every icon provider. */
export interface IconProviderSearchOptions {
  /** Filter by category/tag. */
  category?: string;
  /** Filter by icon style. */
  style?: IconStyle;
  /** Max results to return (default 50). */
  limit?: number;
  /** Pagination start index (default 0). */
  start?: number;
  /** Filter to a specific icon pack prefix. */
  prefix?: string;
  /** Monotone-only search. */
  monotoneOnly?: boolean;
  /** Abort signal — the provider must thread it into every fetch. */
  signal?: AbortSignal;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

/** Search result total + page from a provider (for correct pagination). */
export interface IconSearchPage {
  /** Results for the current page. */
  items: IconSourceDescriptor[];
  /** Server-reported total across all pages. */
  total: number;
  /** The start index the server applied. */
  start: number;
  /** True when the returned items cover the whole result set. */
  exhausted: boolean;
}

/**
 * Normalized descriptor for one icon from one provider. Providers MUST NOT
 * leak their raw API objects here; the editor only sees this model.
 */
export interface IconSourceDescriptor {
  /** Globally stable id: provider:prefix:name[:variant]. */
  canonicalId: string;
  /** Provider id (e.g. "iconify"). Never a pack prefix. */
  providerId: string;
  /** Pack/collection prefix (e.g. "mdi", "lucide"). */
  packId: string;
  /** Icon name within the pack (e.g. "home"). */
  iconId: string;
  /** Human-readable name (e.g. "home"). */
  name: string;
  /** Display name (may include pack disambiguation). */
  displayName: string;
  /** Alias names (e.g. "house" for "home"). */
  aliases: string[];
  /** Keywords for local search. */
  keywords: string[];
  /** Categories/tags. */
  categories: string[];
  /** Available style families. */
  styles: IconStyle[];
  paletteType: IconPaletteType;
  /** Native grid width/height (viewport units), if known. */
  width?: number;
  height?: number;
  /** Licence snapshot (may be unknown). */
  licence: IconLicenceSnapshot;
  author?: string;
  sourceUrl?: string;
  version?: string;
  lastModified?: number;
  /** True when the icon is available from the offline cache. */
  isOfflineAvailable?: boolean;
  /** True when the icon is already embedded in the open document. */
  isInDocument?: boolean;
}

/** Information about an icon pack/collection. */
export interface IconPackInfo {
  /** Pack prefix (e.g. "mdi", "lucide"). */
  prefix: string;
  /** Pack name. */
  name: string;
  /** Number of icons in the pack. */
  total: number;
  /** Author info. */
  author?: { name: string; url?: string };
  /** Licence metadata. */
  licence?: IconLicenceSnapshot;
  /** Category. */
  category?: string;
  /** Version string if reported. */
  version?: string;
  /** Last-modified timestamp (unix seconds) if reported. */
  lastModified?: number;
  /** True when the pack is a brand/trademark collection. */
  brand?: boolean;
  /** True when the pack contains multicolor icons. */
  hasPalette?: boolean;
  /** True when the pack is hidden in Iconify's own listing. */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Structured provider errors
// ---------------------------------------------------------------------------

export type IconProviderErrorCode =
  | 'network-error'
  | 'timeout'
  | 'cancelled'
  | 'http-error'
  | 'invalid-response'
  | 'response-too-large'
  | 'csp-blocked'
  | 'provider-unavailable'
  | 'icon-not-found'
  | 'registry-empty'
  | 'unsupported-operation';

export class IconProviderError extends Error {
  constructor(
    message: string,
    public readonly code: IconProviderErrorCode,
    public readonly providerId: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'IconProviderError';
  }

  /** Map a transport/API client error to a provider error code. */
  static fromTransport(
    providerId: string,
    err: unknown,
    fallbackMessage = 'Provider request failed',
  ): IconProviderError {
    if (err instanceof IconProviderError) return err;
    const message = err instanceof Error ? err.message : fallbackMessage;
    const code =
      err instanceof Error && err.name === 'TimeoutError'
        ? ('timeout' as const)
        : ('network-error' as const);
    return new IconProviderError(message, code, providerId);
  }
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
  /** Explicit capability flags — test these instead of optional methods. */
  capabilities: readonly IconProviderCapability[];
  /** Search for icons matching a query (normalized by the caller). */
  search(query: string, options?: IconProviderSearchOptions): Promise<IconSearchPage>;
  /** Fetch the SVG for an icon. Returns null when the icon is missing. */
  getSvg(
    descriptor: IconSourceDescriptor,
    options?: IconProviderSearchOptions,
  ): Promise<string | null>;
  /** Batch icon data for previews (best-effort; may fall back per-icon). */
  getIconData?(
    descriptors: IconSourceDescriptor[],
    options?: IconProviderSearchOptions,
  ): Promise<Array<{ descriptor: IconSourceDescriptor; svg: string | null }>>;
  /** List available packs. */
  getPacks?(options?: IconProviderSearchOptions): Promise<IconPackInfo[]>;
  /** Browse the icons of one pack (paginated). */
  getPackIcons?(prefix: string, options?: IconProviderSearchOptions): Promise<IconSearchPage>;
  /** Keyword suggestions for a partial query. */
  getKeywords?(query: string, options?: IconProviderSearchOptions): Promise<string[]>;
  /** Last-modified timestamps for cache invalidation. */
  getLastModified?(
    prefixes: string[],
    options?: IconProviderSearchOptions,
  ): Promise<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class IconProviderRegistry {
  private providers = new Map<string, IconProvider>();
  private initialized = false;
  private ensureProvidersFn: (() => void) | null = null;

  /** True once the built-in provider registration callback has run. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  get providerIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Idempotent provider registration. Re-registering the same id replaces
   * the previous instance (safe under hot reload).
   */
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
    return this.getAll().filter((p) => p.enabled !== false);
  }

  /**
   * Run the registration callback exactly once. Components may call this
   * before the first search; it is deterministic and import-order safe.
   */
  ensureProviders(fn: () => void): void {
    if (this.initialized) return;
    this.initialized = true;
    this.ensureProvidersFn = fn;
    fn();
  }

  /** Re-run the registration callback (hot reload / window remount). */
  reinitialize(): void {
    this.initialized = false;
    if (this.ensureProvidersFn) this.ensureProvidersFn();
    this.initialized = true;
  }

  /** Clear all providers and reset initialization state (tests). */
  reset(): void {
    this.providers.clear();
    this.initialized = false;
    this.ensureProvidersFn = null;
  }

  /**
   * Search across all enabled providers in parallel. Results are merged,
   * deduplicated by canonical id, and ranked. An empty registry produces a
   * structured `registry-empty` error instead of silently returning zero
   * results.
   */
  async search(query: string, options?: IconProviderSearchOptions): Promise<IconSearchPage> {
    const enabled = this.getEnabled();
    if (enabled.length === 0) {
      throw new IconProviderError(
        'No icon providers are registered — icon search is unavailable',
        'registry-empty',
        '',
      );
    }

    const results = await Promise.allSettled(enabled.map((p) => p.search(query, options)));

    const all: IconSourceDescriptor[] = [];
    const failures: IconProviderError[] = [];
    let total = 0;
    let start = 0;
    let exhausted = true;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        all.push(...result.value.items);
        total += result.value.total;
        start = Math.max(start, result.value.start);
        exhausted = exhausted && result.value.exhausted;
      } else if (result.reason instanceof IconProviderError) {
        failures.push(result.reason);
      } else if (result.reason instanceof Error) {
        failures.push(
          new IconProviderError(result.reason.message, 'network-error', enabled[0]?.id ?? ''),
        );
      }
    }

    // When every provider failed, surface the failure instead of silently
    // returning zero results.
    if (all.length === 0 && failures.length > 0 && failures.length === enabled.length) {
      const codes = new Set(failures.map((f) => f.code));
      const code: IconProviderErrorCode = codes.has('timeout')
        ? 'timeout'
        : codes.has('csp-blocked')
          ? 'csp-blocked'
          : codes.has('invalid-response') || codes.has('response-too-large')
            ? 'invalid-response'
            : 'network-error';
      throw new IconProviderError(
        failures.map((f) => f.message).join('; '),
        code,
        failures[0]?.providerId ?? '',
      );
    }

    const deduped = this.deduplicateResults(all);
    return { items: deduped, total, start, exhausted };
  }

  /** Fetch SVG for a descriptor from its owning provider. */
  async getSvg(
    descriptor: IconSourceDescriptor,
    options?: IconProviderSearchOptions,
  ): Promise<string | null> {
    const provider = this.providers.get(descriptor.providerId);
    if (!provider) {
      throw new IconProviderError(
        `No provider registered for "${descriptor.providerId}"`,
        'provider-unavailable',
        descriptor.providerId,
      );
    }
    return provider.getSvg(descriptor, options);
  }

  /** Batch icon data across descriptors, grouped by provider. */
  async getIconData(
    descriptors: IconSourceDescriptor[],
    options?: IconProviderSearchOptions,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const byProvider = new Map<string, IconSourceDescriptor[]>();
    for (const d of descriptors) {
      const list = byProvider.get(d.providerId) ?? [];
      list.push(d);
      byProvider.set(d.providerId, list);
    }
    await Promise.all(
      Array.from(byProvider.entries()).map(async ([providerId, items]) => {
        const provider = this.providers.get(providerId);
        if (!provider) return;
        try {
          if (provider.getIconData) {
            const results = await provider.getIconData(items, options);
            for (const r of results) {
              if (r.svg) out.set(r.descriptor.canonicalId, r.svg);
            }
          } else {
            await Promise.all(
              items.map(async (item) => {
                const svg = await provider.getSvg(item, options);
                if (svg) out.set(item.canonicalId, svg);
              }),
            );
          }
        } catch {
          // Batch is best-effort; individual acquisition reports errors.
        }
      }),
    );
    return out;
  }

  /** List packs from all providers that support browsing. */
  async getPacks(): Promise<IconPackInfo[]> {
    const enabled = this.getEnabled();
    const results = await Promise.allSettled(
      enabled
        .filter((p) => p.getPacks && p.capabilities.includes('browse-collections'))
        .map((p) => p.getPacks!()),
    );
    const packs: IconPackInfo[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') packs.push(...result.value);
    }
    return packs;
  }

  private deduplicateResults(results: IconSourceDescriptor[]): IconSourceDescriptor[] {
    const seen = new Map<string, IconSourceDescriptor>();
    for (const r of results) {
      const existing = seen.get(r.canonicalId);
      if (!existing) {
        seen.set(r.canonicalId, r);
      } else if (r.styles.length > existing.styles.length) {
        // Prefer the entry with more style info.
        seen.set(r.canonicalId, r);
      }
    }
    return Array.from(seen.values());
  }
}

// ---------------------------------------------------------------------------
// Query normalization (shared by online + local search)
// ---------------------------------------------------------------------------

/** Case, punctuation, and space normalization shared by all search paths. */
export function normalizeIconQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, ' ')
    .trim();
}

/** Common synonyms folded into the normalized query token set. */
export const ICON_SEARCH_SYNONYMS: Readonly<Record<string, string[]>> = {
  trash: ['delete', 'bin', 'remove'],
  delete: ['trash', 'bin', 'remove'],
  settings: ['gear', 'cog', 'preferences'],
  gear: ['cog', 'settings'],
  cog: ['gear', 'settings'],
  user: ['account', 'profile', 'person'],
  account: ['user', 'profile', 'person'],
  person: ['user', 'account', 'profile'],
  arrowleft: ['arrow left', 'chevron-left', 'back'],
  arrowright: ['arrow right', 'chevron-right', 'forward'],
  arrowdown: ['arrow down', 'chevron-down'],
  arrowup: ['arrow up', 'chevron-up'],
  close: ['x', 'cancel', 'dismiss'],
  exit: ['logout', 'sign-out'],
  refresh: ['reload', 'sync'],
  plus: ['add', 'new'],
  edit: ['pencil', 'pen'],
  camera: ['photo', 'picture'],
  image: ['photo', 'picture'],
  send: ['paper-plane'],
  menu: ['hamburger', 'list'],
};

/** Expand a normalized query into tokens + synonym tokens for matching. */
export function expandSearchTokens(rawQuery: string): string[] {
  const tokens = normalizeIconQuery(rawQuery).split(' ');
  const out = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    out.add(token);
    const syns = ICON_SEARCH_SYNONYMS[token];
    if (syns) {
      for (const s of syns) {
        out.add(normalizeIconQuery(s));
        for (const part of s.split(' ')) out.add(part);
      }
    }
  }
  return Array.from(out);
}

/** Match a descriptor's name/aliases/keywords against an expanded query. */
export function descriptorMatchesQuery(
  descriptor: Pick<IconSourceDescriptor, 'name' | 'aliases' | 'keywords' | 'categories'>,
  rawQuery: string,
): boolean {
  const haystack =
    normalizeIconQuery(descriptor.name) +
    ' ' +
    descriptor.aliases.map(normalizeIconQuery).join(' ') +
    ' ' +
    descriptor.keywords.map(normalizeIconQuery).join(' ') +
    ' ' +
    descriptor.categories.map(normalizeIconQuery).join(' ');

  const baseTokens = normalizeIconQuery(rawQuery).split(' ').filter(Boolean);
  if (baseTokens.length === 0) return true;
  // Every literal query token must appear (e.g. "arrow left").
  if (baseTokens.every((t) => haystack.includes(t))) return true;
  // Single-concept queries additionally match through synonym expansion
  // ("settings" finds gear/cog; "trash" finds delete/bin).
  if (baseTokens.length === 1) {
    return expandSearchTokens(rawQuery).some((t) => haystack.includes(t));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

let globalRegistry: IconProviderRegistry | null = null;

/**
 * Get the global icon provider registry, creating it on first use. The
 * registry instance is stable across hot reloads; `resetIconProviderRegistry`
 * replaces it (tests).
 */
export function getIconProviderRegistry(): IconProviderRegistry {
  if (!globalRegistry) globalRegistry = new IconProviderRegistry();
  return globalRegistry;
}

/** Register an icon provider with the global registry. */
export function registerIconProvider(provider: IconProvider): void {
  getIconProviderRegistry().register(provider);
}

/** Replace the global registry (tests). */
export function resetIconProviderRegistry(): void {
  globalRegistry = null;
}
