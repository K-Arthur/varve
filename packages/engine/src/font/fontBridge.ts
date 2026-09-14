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

import type { FontEntry, FontRegistry } from '../fontRegistry';
import type { FontCapabilityState } from './fontCapabilities';
import { FontCatalog, type FontCatalogEntry } from './fontCatalog';
import {
  fontReferenceFromIdentity,
  fontReferenceKey,
  type ParsedFontMetadata,
} from './fontIdentity';
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

/**
 * Create the catalog projection used by editor services from the authoritative
 * runtime registry.  Callers should use this adapter instead of manufacturing
 * one family-level placeholder entry: a registry can contain several exact
 * faces (including collection members) and its metadata may be richer than the
 * legacy family-only shape suggests.
 */
export function createFontCatalogFromRegistry(registry: FontRegistry): FontCatalog {
  const catalog = new FontCatalog();
  for (const family of registry.families()) {
    for (const entry of registry.getEntries(family)) {
      const catalogEntry = catalog.addEntry(parsedMetadataFromRegistryEntry(registry, entry));
      catalog.setActive(catalogEntry.id, registry.isAvailable(family));
      catalog.setCapabilities(catalogEntry.id, capabilitiesFromRegistryEntry(registry, entry));
    }
  }
  return catalog;
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
      for (const entry of this.registry.getEntries(family)) {
        const catalogEntry = this.catalog.addEntry(
          parsedMetadataFromRegistryEntry(this.registry, entry),
        );
        this.catalog.setActive(catalogEntry.id, this.registry.isAvailable(family));
        this.catalog.setCapabilities(
          catalogEntry.id,
          capabilitiesFromRegistryEntry(this.registry, entry),
        );
      }
    }
  }

  /**
   * Synchronise fonts from FontCatalog into FontRegistry.
   * Catalog fonts without registry entries get minimal registry entries.
   */
  syncCatalogToRegistry(): void {
    for (const entry of this.catalog.all()) {
      const family = entry.identity.familyName;
      const fontReference = fontReferenceFromIdentity(entry.identity);
      const alreadyRegistered = this.registry
        .getEntries(family)
        .some((candidate) =>
          fontReference
            ? candidate.faceKey === fontReferenceKey(fontReference)
            : entry.identity.postScriptName
              ? candidate.postScriptName === entry.identity.postScriptName &&
                candidate.weight === weightFromSubfamily(entry.identity.subfamilyName) &&
                candidate.style ===
                  (entry.identity.subfamilyName.toLowerCase().includes('italic')
                    ? 'italic'
                    : 'normal')
              : candidate.weight === weightFromSubfamily(entry.identity.subfamilyName) &&
                candidate.style ===
                  (entry.identity.subfamilyName.toLowerCase().includes('italic')
                    ? 'italic'
                    : 'normal'),
        );
      if (alreadyRegistered) continue;

      this.registry.register({
        family,
        weight: weightFromSubfamily(entry.identity.subfamilyName),
        style: entry.identity.subfamilyName.toLowerCase().includes('italic') ? 'italic' : 'normal',
        source: registrySourceFromKind(entry.source),
        ...(fontReference ? { faceKey: fontReferenceKey(fontReference) } : {}),
        ...(entry.identity.postScriptName ? { postScriptName: entry.identity.postScriptName } : {}),
        ...(entry.identity.collectionIndex === undefined
          ? {}
          : { collectionIndex: entry.identity.collectionIndex }),
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

function parsedMetadataFromRegistryEntry(
  registry: FontRegistry,
  entry: FontEntry,
): ParsedFontMetadata {
  const familyMetadata = registry.getMetadata(entry.family);
  const axes = entry.axisDefinitions ?? [];
  const identity = identityFromRegistryEntry(entry, familyMetadata);
  return {
    identity,
    format: normalizeFontFormat(familyMetadata?.format),
    fileSize: 0,
    ...(familyMetadata?.vendor ? { vendor: familyMetadata.vendor } : {}),
    ...(familyMetadata?.version ? { version: familyMetadata.version } : {}),
    ...(familyMetadata?.copyright ? { copyright: familyMetadata.copyright } : {}),
    ...(familyMetadata?.license ? { license: familyMetadata.license } : {}),
    ...(familyMetadata?.embeddingRights
      ? { embeddingRights: familyMetadata.embeddingRights }
      : { embeddingRights: entry.source === 'system' ? 'installable' : 'unknown' }),
    ...(familyMetadata?.embeddingPolicy ? { embeddingPolicy: familyMetadata.embeddingPolicy } : {}),
    ...(familyMetadata?.licenseProvenance
      ? { licenseProvenance: familyMetadata.licenseProvenance }
      : {}),
    unitsPerEm: familyMetadata?.unitsPerEm ?? 1000,
    ascender: familyMetadata?.ascender ?? 800,
    descender: familyMetadata?.descender ?? -200,
    lineGap: familyMetadata?.lineGap ?? 0,
    ...(familyMetadata?.xHeight === undefined ? {} : { xHeight: familyMetadata.xHeight }),
    ...(familyMetadata?.capHeight === undefined ? {} : { capHeight: familyMetadata.capHeight }),
    glyphCount: familyMetadata?.glyphCount ?? 0,
    isVariable: axes.length > 0 || Boolean(entry.variableAxes) || registry.isVariable(entry.family),
    axes: axes.map(({ tag, name, min, default: defaultValue, max }) => ({
      tag,
      name,
      min,
      default: defaultValue,
      max,
    })),
    namedInstances: entry.namedInstances ?? familyMetadata?.namedInstances ?? [],
    openTypeFeatures:
      familyMetadata?.openTypeFeatures ?? registry.getSupportedFeatures(entry.family),
    unicodeRanges: [],
    scripts: [],
    ...(familyMetadata?.isCJK ? { languages: ['CJK'] } : {}),
    hasColorGlyphs: familyMetadata?.hasColorGlyphs ?? false,
    ...(familyMetadata?.colorFormats ? { colorFormats: familyMetadata.colorFormats } : {}),
    ...(familyMetadata?.paletteCount === undefined
      ? {}
      : { paletteCount: familyMetadata.paletteCount }),
    category: categoryFromMetadata(familyMetadata?.isCJK, entry.family),
    source: sourceKindFromRegistry(entry.source),
    ...(entry.sourceLocation ? { sourceLocation: entry.sourceLocation } : {}),
    ...(entry.sourceHandle ? { sourceHandle: entry.sourceHandle } : {}),
  };
}

function capabilitiesFromRegistryEntry(
  registry: FontRegistry,
  entry: FontEntry,
): FontCapabilityState {
  const metadata = registry.getMetadata(entry.family);
  const loaded = registry.isAvailable(entry.family);
  const embedding = metadata?.embeddingRights;
  const embeddingAllowed =
    embedding === 'installable' || embedding === 'editable' || embedding === 'no-subsetting';
  return {
    catalog: 'present',
    // Registry entries can be system, bundled, or provider metadata without
    // proving that the original artifact bytes are persisted locally.
    storedBytes: 'unknown',
    validatedFace: entry.faceKey || entry.postScriptName ? 'available' : 'unknown',
    mainThread: loaded
      ? 'ready'
      : registry.state(entry.family) === 'loading'
        ? 'pending'
        : 'unavailable',
    worker: 'unavailable',
    shaping: metadata?.openTypeFeatures?.length ? 'supported' : 'fallback',
    export: embedding === undefined ? 'unknown' : embeddingAllowed ? 'supported' : 'restricted',
    network: entry.source === 'google' ? 'online' : 'unknown',
    permissions: {
      localAccess: entry.source === 'system' ? 'allowed' : 'unknown',
      embedding: embedding === undefined ? 'unknown' : embeddingAllowed ? 'allowed' : 'denied',
      redistribution: 'unknown',
    },
  };
}

function identityFromRegistryEntry(
  entry: FontEntry,
  familyMetadata: ReturnType<FontRegistry['getMetadata']>,
): ParsedFontMetadata['identity'] {
  const exact = parseFaceKey(entry.faceKey);
  const collectionIndex = exact?.collectionIndex ?? entry.collectionIndex;
  const postScriptName = entry.postScriptName ?? familyMetadata?.postScriptName ?? '';
  const subfamilyName = weightToSubfamily(entry.weight, entry.style);
  const contentHash =
    exact?.artifactHash ??
    [
      'registry',
      entry.family,
      entry.source,
      entry.weight,
      entry.style,
      entry.postScriptName ?? '',
      entry.url ?? '',
      entry.sourceLocation ?? '',
      entry.sourceHandle ?? '',
      collectionIndex ?? '',
    ].join(':');
  return {
    contentHash,
    ...(exact ? { hashAlgorithm: 'sha256' as const } : { hashAlgorithm: 'unknown' as const }),
    postScriptName,
    familyName: entry.family,
    subfamilyName,
    fullName: `${entry.family} ${subfamilyName}`,
    ...(collectionIndex === undefined ? {} : { collectionIndex }),
  };
}

function parseFaceKey(
  faceKey: string | undefined,
): { artifactHash: string; collectionIndex?: number } | undefined {
  if (!faceKey) return undefined;
  const match = /^sha256:([0-9a-f]{64}):(single|[0-9]+)$/i.exec(faceKey);
  if (!match) return undefined;
  return {
    artifactHash: match[1]!.toLowerCase(),
    ...(match[2] === 'single' ? {} : { collectionIndex: Number(match[2]) }),
  };
}

function normalizeFontFormat(format: string | undefined): ParsedFontMetadata['format'] {
  switch (format?.toLowerCase()) {
    case 'ttf':
    case 'truetype':
      return 'ttf';
    case 'otf':
    case 'opentype':
      return 'otf';
    case 'ttc':
      return 'ttc';
    case 'otc':
      return 'otc';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    default:
      return 'unknown';
  }
}

function categoryFromMetadata(
  isCJK: boolean | undefined,
  family: string,
): ParsedFontMetadata['category'] {
  if (isCJK) return 'sans-serif';
  const lower = family.toLowerCase();
  if (lower.includes('mono') || lower.includes('code')) return 'monospace';
  if (lower.includes('serif') || lower.includes('times') || lower.includes('georgia')) {
    return 'serif';
  }
  return 'sans-serif';
}

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
    default:
      return false;
  }
}
