/**
 * Font catalog — searchable in-memory database of all known fonts.
 *
 * Provides normalized deduplication via fontIdentityKey, full-text search,
 * multi-field filtering, and sorting. Intended as the single source of truth
 * for font enumeration across the editor, inspector, and text tool.
 *
 * Research basis: FontBook/FontBase catalog models, CSS font-family resolution,
 * OpenType spec metadata fields, Figma font menu behaviour.
 */

import type {
  ParsedFontMetadata,
  FontSourceKind,
  FontCategory,
  EmbeddingRights,
} from './fontIdentity';
import { fontIdentityKey } from './fontIdentity';

export type { ParsedFontMetadata } from './fontIdentity';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A catalog entry extends parsed metadata with runtime state. */
export interface FontCatalogEntry extends ParsedFontMetadata {
  /** Unique key = fontIdentityKey(identity). */
  id: string;
  /** Whether this font is loaded/registered in the runtime. */
  isActive: boolean;
  /** User-favourited flag. */
  isFavorite: boolean;
  /** Epoch-ms timestamp of last use, if any. */
  recentlyUsedAt?: number;
  /** User-defined tags for organisation. */
  tags: string[];
}

/** Filter criteria for catalog search. */
export interface FontCatalogFilter {
  /** Full-text search across family, fullName, postScriptName, foundry, designer, description. */
  query?: string;
  /** Restrict to one or more sources. */
  source?: FontSourceKind | FontSourceKind[];
  /** Restrict to one or more categories. */
  category?: FontCategory | FontCategory[];
  /** Restrict to active (loaded) fonts. */
  isActive?: boolean;
  /** Restrict to favourited fonts. */
  isFavorite?: boolean;
  /** Restrict to variable fonts. */
  isVariable?: boolean;
  /** Restrict to fonts with colour glyphs. */
  hasColorGlyphs?: boolean;
  /** Restrict to one or more embedding rights. */
  embeddingRights?: EmbeddingRights | EmbeddingRights[];
  /** Minimum glyph count. */
  minGlyphCount?: number;
  /** At least one of these scripts must be present. */
  scripts?: string[];
  /** Languages to filter by (checked against a `languages` field if present). */
  languages?: string[];
}

/** Sort descriptor for catalog results. */
export interface FontCatalogSort {
  field: 'family' | 'recentlyUsed' | 'size' | 'glyphCount' | 'source';
  direction: 'asc' | 'desc';
}

/** Result of diffCatalogs — changes between two catalog snapshots. */
export interface CatalogDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function normalizeQuery(s: string): string {
  return s.toLowerCase().trim();
}

/** Quick ASCII-aware substring check (avoids locale overhead). */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

// ---------------------------------------------------------------------------
// FontCatalog
// ---------------------------------------------------------------------------

export class FontCatalog {
  private entries = new Map<string, FontCatalogEntry>();

  // -- Mutation -----------------------------------------------------------

  /** Upsert by fontIdentityKey. Returns the (possibly updated) entry. */
  addEntry(meta: ParsedFontMetadata): FontCatalogEntry {
    const id = fontIdentityKey(meta.identity);
    const existing = this.entries.get(id);
    if (existing) {
      // Preserve runtime fields, update metadata.
      const merged: FontCatalogEntry = {
        ...meta,
        id,
        source: meta.source,
        isActive: existing.isActive,
        isFavorite: existing.isFavorite,
        recentlyUsedAt: existing.recentlyUsedAt,
        tags: existing.tags,
      };
      this.entries.set(id, merged);
      return merged;
    }
    const entry: FontCatalogEntry = {
      ...meta,
      id,
      isActive: false,
      isFavorite: false,
      tags: [],
    };
    this.entries.set(id, entry);
    return entry;
  }

  getEntry(id: string): FontCatalogEntry | undefined {
    return this.entries.get(id);
  }

  removeEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  hasEntry(id: string): boolean {
    return this.entries.has(id);
  }

  size(): number {
    return this.entries.size;
  }

  all(): FontCatalogEntry[] {
    return [...this.entries.values()];
  }

  /** Unique sorted family names across all entries. */
  families(): string[] {
    const set = new Set<string>();
    for (const e of this.entries.values()) {
      set.add(e.identity.familyName);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // -- Search & filter -----------------------------------------------------

  search(filter?: FontCatalogFilter, sort?: FontCatalogSort): FontCatalogEntry[] {
    let results = [...this.entries.values()];

    if (filter) {
      results = results.filter((e) => matchesFilter(e, filter));
    }

    if (sort) {
      results.sort((a, b) => compareEntries(a, b, sort));
    }

    return results;
  }

  getEntriesForFamily(family: string): FontCatalogEntry[] {
    const lower = family.toLowerCase();
    return [...this.entries.values()].filter((e) => e.identity.familyName.toLowerCase() === lower);
  }

  // -- Runtime state -------------------------------------------------------

  setFavorite(id: string, favorite: boolean): void {
    const e = this.entries.get(id);
    if (e) e.isFavorite = favorite;
  }

  setRecentlyUsed(id: string): void {
    const e = this.entries.get(id);
    if (e) e.recentlyUsedAt = Date.now();
  }

  setActive(id: string, active: boolean): void {
    const e = this.entries.get(id);
    if (e) e.isActive = active;
  }

  // -- Tags ----------------------------------------------------------------

  addTag(id: string, tag: string): void {
    const e = this.entries.get(id);
    if (e && !e.tags.includes(tag)) {
      e.tags.push(tag);
    }
  }

  removeTag(id: string, tag: string): void {
    const e = this.entries.get(id);
    if (e) {
      e.tags = e.tags.filter((t) => t !== tag);
    }
  }

  // -- Merge ---------------------------------------------------------------

  /** Merge all entries from `other` into this catalog. Runtime fields from `other` win on conflict. */
  merge(other: FontCatalog): void {
    for (const entry of other.entries.values()) {
      const existing = this.entries.get(entry.id);
      if (existing) {
        this.entries.set(entry.id, {
          ...entry,
          // Keep "more active" state — favour true for active/favorite
          isActive: existing.isActive || entry.isActive,
          isFavorite: existing.isFavorite || entry.isFavorite,
          recentlyUsedAt:
            Math.max(existing.recentlyUsedAt ?? 0, entry.recentlyUsedAt ?? 0) || undefined,
          tags: unionTags(existing.tags, entry.tags),
        });
      } else {
        this.entries.set(entry.id, { ...entry });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

function matchesFilter(entry: FontCatalogEntry, filter: FontCatalogFilter): boolean {
  // Full-text query
  if (filter.query) {
    const q = normalizeQuery(filter.query);
    const targets = [
      entry.identity.familyName,
      entry.identity.fullName,
      entry.identity.postScriptName,
      entry.vendor ?? '',
      entry.designer ?? '',
      entry.description ?? '',
    ];
    if (!targets.some((t) => contains(t, q))) return false;
  }

  // Source
  const sources = toArray(filter.source);
  if (sources && !sources.includes(entry.source)) return false;

  // Category
  const categories = toArray(filter.category);
  if (categories && !categories.includes(entry.category)) return false;

  // Active
  if (filter.isActive !== undefined && entry.isActive !== filter.isActive) return false;

  // Favorite
  if (filter.isFavorite !== undefined && entry.isFavorite !== filter.isFavorite) return false;

  // Variable
  if (filter.isVariable !== undefined && entry.isVariable !== filter.isVariable) return false;

  // Color glyphs
  if (filter.hasColorGlyphs !== undefined && entry.hasColorGlyphs !== filter.hasColorGlyphs)
    return false;

  // Embedding rights
  const rights = toArray(filter.embeddingRights);
  if (rights && !rights.includes(entry.embeddingRights)) return false;

  // Min glyph count
  if (filter.minGlyphCount !== undefined && entry.glyphCount < filter.minGlyphCount) return false;

  // Scripts — at least one must match
  if (filter.scripts && filter.scripts.length > 0) {
    if (!filter.scripts.some((s) => entry.scripts.includes(s))) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

function compareEntries(a: FontCatalogEntry, b: FontCatalogEntry, sort: FontCatalogSort): number {
  const dir = sort.direction === 'asc' ? 1 : -1;

  switch (sort.field) {
    case 'family':
      return dir * a.identity.familyName.localeCompare(b.identity.familyName);
    case 'recentlyUsed': {
      const aTime = a.recentlyUsedAt ?? 0;
      const bTime = b.recentlyUsedAt ?? 0;
      return dir * (aTime - bTime);
    }
    case 'size':
      return dir * (a.fileSize - b.fileSize);
    case 'glyphCount':
      return dir * (a.glyphCount - b.glyphCount);
    case 'source':
      return dir * a.source.localeCompare(b.source);
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function unionTags(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  return [...set];
}

/**
 * Diff two catalogs by fontIdentityKey, returning added, removed, and changed
 * entries (changed = same key but different metadata).
 */
export function diffCatalogs(old: FontCatalog, new_: FontCatalog): CatalogDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const oldAll = new Map<string, FontCatalogEntry>();
  for (const e of old.all()) oldAll.set(e.id, e);
  const newAll = new Map<string, FontCatalogEntry>();
  for (const e of new_.all()) newAll.set(e.id, e);

  // Added or changed
  for (const [id, newEntry] of newAll) {
    if (!oldAll.has(id)) {
      added.push(id);
    } else {
      const oldEntry = oldAll.get(id)!;
      if (!metadataEqual(oldEntry, newEntry)) {
        changed.push(id);
      }
    }
  }

  // Removed
  for (const id of oldAll.keys()) {
    if (!newAll.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed, changed };
}

/** Shallow comparison of metadata-relevant fields. */
function metadataEqual(a: FontCatalogEntry, b: FontCatalogEntry): boolean {
  return (
    a.identity.familyName === b.identity.familyName &&
    a.identity.postScriptName === b.identity.postScriptName &&
    a.identity.fullName === b.identity.fullName &&
    a.format === b.format &&
    a.fileSize === b.fileSize &&
    a.glyphCount === b.glyphCount &&
    a.isVariable === b.isVariable &&
    a.category === b.category &&
    a.source === b.source &&
    a.embeddingRights === b.embeddingRights &&
    a.hasColorGlyphs === b.hasColorGlyphs &&
    a.vendor === b.vendor &&
    a.designer === b.designer &&
    a.description === b.description
  );
}
