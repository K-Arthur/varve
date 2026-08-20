/**
 * Document font manifest — portable, per-document font library.
 *
 * A `FontManifest` is stored inside a Strata Document and records every font
 * referenced by the document, together with its canonical identity, embedding
 * rights, and availability status. It is the anchor for:
 *
 *   - Cross-device portability: a document opened on a different machine can
 *     resolve fonts by content hash / PostScript name instead of family name.
 *   - Missing-font detection: `missing` entries are surfaced to the user.
 *   - Substitution audit: `substituted` entries preserve the original reference.
 *   - Preflight / export: embedding rights are checked before embedding fonts.
 */

import type { FontCatalog, FontCatalogEntry } from './fontCatalog';
import type { EmbeddingRights, FontIdentity, FontSourceKind } from './fontIdentity';
import { fontIdentityKey } from './fontIdentity';
import type { FontReplacement, MissingFontInfo } from './fontResolver';
import { FontResolver } from './fontResolver';
import { FontUsageIndex, type UsageDocument } from './fontUsageIndex';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FontManifestStatus =
  | 'available' // present in the local catalog
  | 'missing' // referenced but not available
  | 'substituted' // replaced with a substitute font
  | 'restricted'; // embedding forbidden by fsType/license

export interface FontManifestEntry {
  /** Display family name used in the document/UI. */
  familyName: string;
  /** Requested weight, if known from the text node/style. */
  requestedWeight?: number;
  /** Requested style, if known. */
  requestedStyle?: string;
  /** Canonical identity of the resolved font (or identity stub when missing). */
  identity: FontIdentity;
  /** Where this font came from when the manifest was built. */
  source: FontSourceKind;
  /** Embedding permission from the OS/2 table or license policy. */
  embeddingRights: EmbeddingRights;
  /** Runtime status of the font reference. */
  status: FontManifestStatus;
  /** If status is `substituted`, the original family name that was replaced. */
  substituteFor?: string;
  /** Optional asset id if the font is embedded in the document itself. */
  assetId?: string;
}

export interface FontManifest {
  /** Manifest schema version. */
  version: 1;
  /** Ordered list of unique font references in the document. */
  fonts: FontManifestEntry[];
  /** Substitutions applied when the manifest was built. */
  replacements?: FontReplacement[];
}

export interface BuildManifestOptions {
  /**
   * If true, automatically replace missing fonts with the highest-confidence
   * substitute from the catalog. The original reference is preserved in
   * `substituteFor`.
   */
  autoSubstitute?: boolean;
  /**
   * Source kind to assign to missing/unresolved references.
   */
  missingSource?: FontSourceKind;
  /**
   * Previously applied substitutions to preserve across a rebuild. The
   * document stores the replacement family in its text runs; this history is
   * what keeps the original family recoverable in the manifest.
   */
  previousReplacements?: FontReplacement[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_MISSING_IDENTITY = {
  contentHash: '',
  postScriptName: '',
  familyName: '',
  subfamilyName: 'Regular',
  fullName: '',
};

/**
 * Build a `FontManifest` for a document by scanning all text nodes/styles,
 * matching them against the local `FontCatalog`, and detecting missing fonts.
 */
export function buildDocumentFontManifest(
  doc: UsageDocument,
  catalog: FontCatalog,
  opts: BuildManifestOptions = {},
): FontManifest {
  const usageIndex = new FontUsageIndex();
  const usage = usageIndex.build(doc);
  const resolver = new FontResolver();

  const missingMap = new Map<string, MissingFontInfo>();
  for (const info of resolver.detectMissing(doc, catalog)) {
    missingMap.set(info.familyName.toLowerCase(), info);
  }

  const entries: FontManifestEntry[] = [];
  const replacements: FontReplacement[] = [...(opts.previousReplacements ?? [])];
  const seen = new Set<string>();

  for (const u of usage.values()) {
    const family = u.familyName;
    const key = family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const catalogEntry = findBestCatalogEntry(catalog, family, u.weight, u.style);
    const missing = missingMap.get(key);

    if (catalogEntry) {
      const appliedReplacement = findReplacementForFamily(replacements, family);
      entries.push(
        catalogEntryToManifest(catalogEntry, {
          requestedWeight: u.weight,
          requestedStyle: u.style,
          status: appliedReplacement
            ? 'substituted'
            : embeddingAllowed(catalogEntry.embeddingRights)
              ? 'available'
              : 'restricted',
          substituteFor: appliedReplacement?.original,
        }),
      );
      continue;
    }

    if (missing && opts.autoSubstitute && missing.substitutes.length > 0) {
      const sub = missing.substitutes[0]!;
      const subEntry = findBestCatalogEntry(catalog, sub.familyName, u.weight, u.style);
      const subCatalogEntry = subEntry ?? buildStubEntry(sub.familyName, 'system');
      entries.push(
        catalogEntryToManifest(subCatalogEntry, {
          requestedWeight: u.weight,
          requestedStyle: u.style,
          status: embeddingAllowed(subCatalogEntry.embeddingRights) ? 'substituted' : 'restricted',
          substituteFor: family,
        }),
      );
      addReplacement(replacements, {
        original: family,
        replacement: sub.familyName,
        applyToAll: true,
        preserveOriginalReference: true,
      });
      continue;
    }

    // Missing and not auto-substituted.
    entries.push({
      familyName: family,
      requestedWeight: u.weight,
      requestedStyle: u.style,
      identity: { ...DEFAULT_MISSING_IDENTITY, familyName: family, fullName: family },
      source: opts.missingSource ?? 'missing',
      embeddingRights: 'unknown',
      status: 'missing',
    });
  }

  // Include missing families that have no usage characters (e.g. styles only)
  for (const missing of missingMap.values()) {
    const key = missing.familyName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      familyName: missing.familyName,
      requestedWeight: missing.requestedWeight,
      requestedStyle: missing.requestedStyle,
      identity: {
        ...DEFAULT_MISSING_IDENTITY,
        familyName: missing.familyName,
        fullName: missing.familyName,
      },
      source: opts.missingSource ?? 'missing',
      embeddingRights: 'unknown',
      status: 'missing',
    });
  }

  return {
    version: 1,
    fonts: entries,
    replacements: replacements.length > 0 ? replacements : undefined,
  };
}

/**
 * Re-resolve a manifest against a new catalog (e.g. after opening a document
 * on a different device). Updates statuses and substitution proposals without
 * mutating the original manifest.
 */
export function resolveManifestAgainstCatalog(
  manifest: FontManifest,
  catalog: FontCatalog,
): FontManifest {
  const resolver = new FontResolver();
  const updated: FontManifestEntry[] = [];

  for (const entry of manifest.fonts) {
    if (entry.status === 'available' || entry.status === 'restricted') {
      // Verify the font is still available and the identity still matches.
      const catalogEntry = entry.identity.contentHash
        ? catalog.getEntry(fontIdentityKey(entry.identity))
        : findBestCatalogEntry(
            catalog,
            entry.familyName,
            entry.requestedWeight,
            entry.requestedStyle,
          );

      if (catalogEntry) {
        updated.push(
          catalogEntryToManifest(catalogEntry, {
            requestedWeight: entry.requestedWeight,
            requestedStyle: entry.requestedStyle,
            status: embeddingAllowed(catalogEntry.embeddingRights) ? 'available' : 'restricted',
          }),
        );
      } else {
        updated.push({ ...entry, status: 'missing' });
      }
      continue;
    }

    if (entry.substituteFor) {
      // A previously substituted font still appears in the document under
      // the replacement family. Re-resolve that actual family; the presence
      // of the original on this machine must not silently rewrite the
      // manifest because the text nodes have not been restored.
      const replacementEntry = findBestCatalogEntry(
        catalog,
        entry.familyName,
        entry.requestedWeight,
        entry.requestedStyle,
      );
      if (replacementEntry) {
        updated.push(
          catalogEntryToManifest(replacementEntry, {
            requestedWeight: entry.requestedWeight,
            requestedStyle: entry.requestedStyle,
            status: embeddingAllowed(replacementEntry.embeddingRights)
              ? 'substituted'
              : 'restricted',
            substituteFor: entry.substituteFor,
          }),
        );
      } else {
        updated.push({ ...entry, status: 'missing' });
      }
      continue;
    }

    // Missing entry: try to resolve.
    const candidates = resolver.findSubstitutes(
      {
        familyName: entry.familyName,
        requestedWeight: entry.requestedWeight,
        requestedStyle: entry.requestedStyle,
        nodeIds: [],
        status: 'missing',
        substitutes: [],
        originalReference: entry.familyName,
      },
      catalog,
    );

    if (candidates.length > 0) {
      const sub = candidates[0]!;
      const subEntry = findBestCatalogEntry(
        catalog,
        sub.familyName,
        entry.requestedWeight,
        entry.requestedStyle,
      );
      if (subEntry) {
        const isExactFamily = sub.familyName.toLowerCase() === entry.familyName.toLowerCase();
        updated.push(
          catalogEntryToManifest(subEntry, {
            requestedWeight: entry.requestedWeight,
            requestedStyle: entry.requestedStyle,
            status: isExactFamily
              ? embeddingAllowed(subEntry.embeddingRights)
                ? 'available'
                : 'restricted'
              : embeddingAllowed(subEntry.embeddingRights)
                ? 'substituted'
                : 'restricted',
            substituteFor: isExactFamily ? undefined : entry.familyName,
          }),
        );
      } else {
        updated.push({ ...entry });
      }
    } else {
      updated.push({ ...entry });
    }
  }

  return { ...manifest, fonts: updated };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findBestCatalogEntry(
  catalog: FontCatalog,
  family: string,
  weight?: number,
  style?: string,
): FontCatalogEntry | undefined {
  const entries = catalog.getEntriesForFamily(family);
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0];

  const lowerStyle = style?.toLowerCase() ?? '';
  const wantsItalic = lowerStyle === 'italic';

  return (
    entries.find((e) => {
      const sub = e.identity.subfamilyName.toLowerCase();
      const weightName = weight ? weightToName(weight).toLowerCase() : '';
      const weightMatch = !weightName || sub.includes(weightName);
      const italicMatch = wantsItalic ? sub.includes('italic') : !sub.includes('italic');
      return weightMatch && italicMatch;
    }) ?? entries[0]
  );
}

function catalogEntryToManifest(
  entry: FontCatalogEntry,
  overrides: {
    requestedWeight?: number;
    requestedStyle?: string;
    status: FontManifestStatus;
    substituteFor?: string;
  },
): FontManifestEntry {
  return {
    familyName: entry.identity.familyName,
    requestedWeight: overrides.requestedWeight,
    requestedStyle: overrides.requestedStyle,
    identity: entry.identity,
    source: entry.source,
    embeddingRights: entry.embeddingRights,
    status: overrides.status,
    substituteFor: overrides.substituteFor,
  };
}

function findReplacementForFamily(
  replacements: FontReplacement[],
  family: string,
): FontReplacement | undefined {
  const key = family.toLowerCase();
  return replacements.find((replacement) => replacement.replacement.toLowerCase() === key);
}

function addReplacement(replacements: FontReplacement[], replacement: FontReplacement): void {
  const existingIndex = replacements.findIndex(
    (existing) =>
      existing.original.toLowerCase() === replacement.original.toLowerCase() &&
      existing.replacement.toLowerCase() === replacement.replacement.toLowerCase(),
  );
  if (existingIndex >= 0) {
    replacements[existingIndex] = replacement;
    return;
  }
  replacements.push(replacement);
}

function buildStubEntry(family: string, source: FontSourceKind): FontCatalogEntry {
  return {
    identity: { ...DEFAULT_MISSING_IDENTITY, familyName: family, fullName: family },
    format: 'unknown',
    fileSize: 0,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 0,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: [],
    languages: [],
    embeddingRights: 'unknown',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source,
    id: fontIdentityKey({ ...DEFAULT_MISSING_IDENTITY, familyName: family, fullName: family }),
    isActive: false,
    isFavorite: false,
    tags: [],
  };
}

function embeddingAllowed(rights: EmbeddingRights): boolean {
  return rights === 'installable' || rights === 'editable' || rights === 'no-subsetting';
}

function weightToName(weight: number): string {
  if (weight <= 100) return 'Thin';
  if (weight <= 200) return 'ExtraLight';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  if (weight <= 700) return 'Bold';
  if (weight <= 800) return 'ExtraBold';
  return 'Black';
}
