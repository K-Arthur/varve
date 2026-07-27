/**
 * FontBridge — synchronises the legacy FontRegistry with the modern FontCatalog.
 *
 * The older FontRegistry (fontRegistry.ts) is used by UI components (FontSelector,
 * FloatingTextBar) and manages CSS Font Loading API integration. The newer
 * FontCatalog (font/fontCatalog.ts) is the searchable in-memory database used
 * by the FontResolver, preflight, and export systems.
 *
 * This bridge keeps both in sync so that fonts discovered or imported through
 * either path are immediately visible to all consumers.
 *
 * Research basis: adapter pattern for systems with overlapping responsibilities,
 * avoiding a single massive migration while both systems are in active use.
 */

import { type FontCatalog, type FontCatalogEntry } from './fontCatalog';
import type { FontEntry, FontRegistry } from '../fontRegistry';
import { type ParsedFontMetadata } from './fontIdentity';
import type { FontLicensePolicy } from './fontLicensePolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unified view combining data from both systems. */
export interface UnifiedFontInfo {
  family: string;
  catalogEntry?: FontCatalogEntry;
  registryEntries: FontEntry[];
  isLoaded: boolean;
  isMissing: boolean;
  isVariable: boolean;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class FontBridge {
  private registry: FontRegistry;
  private catalog: FontCatalog;
  private policy: FontLicensePolicy;
  private unsubscribe: (() => void) | null = null;

  constructor(registry: FontRegistry, catalog: FontCatalog, policy: FontLicensePolicy) {
    this.registry = registry;
    this.catalog = catalog;
    this.policy = policy;
  }

  /** Start listening for registry changes and syncing to catalog. */
  connect(): void {
    this.unsubscribe = this.registry.subscribe(() => {
      this.syncRegistryToCatalog();
    });
  }

  /** Stop listening and clean up. */
  disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Synchronise fonts from FontRegistry into FontCatalog.
   * Registry fonts without catalog entries get minimal catalog entries.
   */
  syncRegistryToCatalog(): void {
    for (const family of this.registry.families()) {
      if (this.catalog.getEntriesForFamily(family).length > 0) continue;

      const entries = this.registry.getEntries(family);
      const first = entries[0];
      if (!first) continue;

      const catalogEntry: ParsedFontMetadata = {
        identity: {
          contentHash: `registry:${family}`,
          postScriptName: family.replace(/\s+/g, '-'),
          familyName: family,
          subfamilyName: weightToSubfamily(first.weight, first.style),
          fullName: `${family} ${weightToSubfamily(first.weight, first.style)}`,
        },
        format: 'unknown',
        fileSize: 0,
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        lineGap: 0,
        glyphCount: 0,
        isVariable: this.registry.isVariable(family),
        axes: [],
        namedInstances: [],
        openTypeFeatures: this.registry.getSupportedFeatures(family),
        unicodeRanges: [],
        scripts: [],
        embeddingRights: first.source === 'system' ? 'installable' : 'unknown',
        hasColorGlyphs: false,
        category: 'sans-serif',
        source: sourceKindFromRegistry(first.source),
      };
      this.catalog.addEntry(catalogEntry);
    }
  }

  /**
   * Synchronise fonts from FontCatalog into FontRegistry.
   * Catalog fonts without registry entries get minimal registry entries.
   */
  syncCatalogToRegistry(): void {
    for (const entry of this.catalog.all()) {
      const family = entry.identity.familyName;
      if (this.registry.isRegistered(family)) continue;

      this.registry.register({
        family,
        weight: weightFromSubfamily(entry.identity.subfamilyName),
        style: entry.identity.subfamilyName.toLowerCase().includes('italic') ? 'italic' : 'normal',
        source: registrySourceFromKind(entry.source),
      });
    }
  }

  /** Full bi-directional sync. */
  sync(): void {
    this.syncRegistryToCatalog();
    this.syncCatalogToRegistry();
  }

  /** Get unified info for all known fonts. */
  getAllFonts(): UnifiedFontInfo[] {
    const families = new Set([...this.registry.families(), ...this.catalog.families()]);

    return [...families]
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({
        family,
        catalogEntry: this.catalog.getEntriesForFamily(family)[0],
        registryEntries: this.registry.getEntries(family),
        isLoaded: this.registry.isAvailable(family),
        isMissing: this.registry.isMissing(family),
        isVariable: this.registry.isVariable(family),
      }));
  }

  /** Check if a font can be embedded in documents. */
  canEmbed(family: string): boolean {
    const entries = this.catalog.getEntriesForFamily(family);
    if (entries.length === 0) return false;
    const first = entries[0]!;
    const license = this.policy.getLicense(first.identity.contentHash);
    if (license) return this.policy.canEmbedInDocument(first.identity.contentHash);
    return getEmbeddingRights(first.embeddingRights);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weightToSubfamily(weight: number, style: string): string {
  const weightNames: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };
  const base = weightNames[weight] ?? 'Regular';
  return style === 'italic' ? `${base} Italic` : base;
}

function weightFromSubfamily(subfamily: string): number {
  const lower = subfamily.toLowerCase();
  if (lower.includes('thin')) return 100;
  if (lower.includes('extralight')) return 200;
  if (lower.includes('light')) return 300;
  if (lower.includes('medium')) return 500;
  if (lower.includes('semibold')) return 600;
  if (lower.includes('bold')) return 700;
  if (lower.includes('extrabold')) return 800;
  if (lower.includes('black')) return 900;
  return 400;
}

function sourceKindFromRegistry(source: FontEntry['source']): ParsedFontMetadata['source'] {
  switch (source) {
    case 'system':
      return 'system';
    case 'bundled':
      return 'bundled';
    case 'google':
      return 'remote';
    default:
      return 'system';
  }
}

function registrySourceFromKind(source: ParsedFontMetadata['source']): FontEntry['source'] {
  switch (source) {
    case 'system':
      return 'system';
    case 'bundled':
      return 'bundled';
    case 'remote':
      return 'google';
    default:
      return 'bundled';
  }
}

function getEmbeddingRights(rights: string): boolean {
  switch (rights) {
    case 'installable':
    case 'editable':
      return true;
    case 'preview-and-print':
    case 'no-subsetting':
      return false;
    case 'restricted':
    case 'unknown':
    default:
      return false;
  }
}
