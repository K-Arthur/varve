/**
 * Spot-color library operations.
 *
 * Spot inks have stable identity INDEPENDENT of their display names: a ref
 * carries `spotId` + `library`; resolution matches by id first and falls
 * back to name only for legacy documents (and synthesizes an id on first
 * resolution so the document self-heals).
 *
 * Libraries:
 * - `builtin`: read-only catalog bundled with the app.
 * - `user-global`: shared across documents on this machine (desktop).
 * - `project`: embedded in the document and travels with it.
 * - `imported`: came in via import; the external source may be missing.
 *
 * Documents must retain embedded spot definitions even when the original
 * external library is unavailable: artwork never becomes invisible and is
 * never silently converted to process color.
 */

import type { SpotColorDef, SpotColorRef, SpotLibrary } from './colorManagement';
import { clampSpotTint, SPOT_TINT_MAX } from './colorValidation';
import type { Document } from './document';

/** Generate a stable library id (project scope). */
export function newSpotLibraryId(): string {
  return `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a stable spot id. */
export function newSpotId(): string {
  return `spot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function librariesOf(doc: Document): SpotLibrary[] {
  return doc.spotLibraries ?? [];
}

/** Add a new spot library to the document (project-local by default). */
export function createSpotLibrary(
  doc: Document,
  name: string,
  kind: SpotLibrary['kind'] = 'project',
): { doc: Document; library: SpotLibrary } {
  const library: SpotLibrary = {
    id: newSpotLibraryId(),
    name,
    kind,
    spots: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  return { doc: { ...doc, spotLibraries: [...librariesOf(doc), library] }, library };
}

/** Find a library by id (or first library with the given name). */
export function findSpotLibrary(doc: Document, libraryId: string): SpotLibrary | undefined {
  return librariesOf(doc).find((l) => l.id === libraryId);
}

/** Find a spot definition by stable id across all libraries. */
export function findSpotDef(doc: Document, spotId: string): SpotColorDef | undefined {
  for (const lib of librariesOf(doc)) {
    const def = lib.spots.find((s) => s.id === spotId);
    if (def) return def;
  }
  return undefined;
}

/**
 * Resolve a spot reference to its definition. Matches by `spotId` first;
 * falls back to `name` within the reference's library (legacy refs). When a
 * definition exists under a different id but the same name in the same
 * library, the ref is treated as pointing at it (name-based legacy links).
 */
export function resolveSpotRef(doc: Document, ref: SpotColorRef): SpotColorDef | undefined {
  if (ref.spotId) {
    const byId = findSpotDef(doc, ref.spotId);
    if (byId) return byId;
  }
  // Legacy/fallback: match by name within the referenced library, then any.
  const lib = ref.library ? findSpotLibrary(doc, ref.library) : undefined;
  if (lib) {
    const inLib = lib.spots.find((s) => s.name === ref.name);
    if (inLib) return inLib;
  }
  for (const candidate of librariesOf(doc)) {
    const match = candidate.spots.find((s) => s.name === ref.name);
    if (match) return match;
  }
  return undefined;
}

/**
 * Build a SpotColorRef for a definition at the given tint. The ref carries
 * the stable ids so name-only identity is never relied on.
 */
export function spotDefToRef(def: SpotColorDef, tint: number, alpha = 255): SpotColorRef {
  return {
    space: 'spot',
    spotId: def.id,
    library: def.library || undefined,
    name: def.name,
    tint: clampSpotTint(tint),
    a: alpha,
    processFallback: def.processFallback,
  };
}

/**
 * Add a spot definition to a library. Deterministic conflict policy:
 * - same id already present → replace in place (definitions are keyed by id).
 * - same name, different definition → keep both; the new spot keeps its id
 *   and callers are informed via the returned notice.
 */
export function addSpotToLibrary(
  doc: Document,
  libraryId: string,
  def: SpotColorDef,
): { doc: Document; notice?: string } {
  const libraries = librariesOf(doc);
  const libIndex = libraries.findIndex((l) => l.id === libraryId);
  if (libIndex === -1) {
    return { doc, notice: `spot library "${libraryId}" not found` };
  }
  const lib = libraries[libIndex]!;
  const existing = lib.spots.find((s) => s.id === def.id);
  let notice: string | undefined;
  if (existing) {
    notice = `spot "${existing.name}" updated`;
  } else {
    const nameClash = lib.spots.find((s) => s.name === def.name && s.id !== def.id);
    if (nameClash) {
      notice = `spot name "${def.name}" already exists in this library; keeping both inks with distinct ids`;
    }
  }
  const spots = existing ? lib.spots.map((s) => (s.id === def.id ? def : s)) : [...lib.spots, def];
  const nextLibraries = libraries.map((l, i) =>
    i === libIndex ? { ...l, spots, modifiedAt: new Date().toISOString() } : l,
  );
  return { doc: { ...doc, spotLibraries: nextLibraries }, notice };
}

/** Update a spot definition in place (id is immutable). */
export function updateSpotDef(
  doc: Document,
  libraryId: string,
  spotId: string,
  patch: Partial<Omit<SpotColorDef, 'id'>>,
): { doc: Document; found: boolean } {
  const libraries = librariesOf(doc);
  let found = false;
  const nextLibraries = libraries.map((l) => {
    if (l.id !== libraryId) return l;
    const spots = l.spots.map((s) => {
      if (s.id !== spotId) return s;
      found = true;
      return { ...s, ...patch, modifiedAt: new Date().toISOString() };
    });
    return { ...l, spots, modifiedAt: new Date().toISOString() };
  });
  return { doc: { ...doc, spotLibraries: nextLibraries }, found };
}

/** Remove a spot definition from a library. */
export function removeSpotFromLibrary(
  doc: Document,
  libraryId: string,
  spotId: string,
): { doc: Document; removed: boolean } {
  const libraries = librariesOf(doc);
  let removed = false;
  const nextLibraries = libraries.map((l) => {
    if (l.id !== libraryId) return l;
    const spots = l.spots.filter((s) => s.id !== spotId);
    if (spots.length !== l.spots.length) removed = true;
    return { ...l, spots, modifiedAt: new Date().toISOString() };
  });
  return { doc: { ...doc, spotLibraries: nextLibraries }, removed };
}

/** Rename a library (spot ids are untouched). */
export function renameSpotLibrary(
  doc: Document,
  libraryId: string,
  name: string,
): { doc: Document; found: boolean } {
  const libraries = librariesOf(doc);
  let found = false;
  const nextLibraries = libraries.map((l) =>
    l.id === libraryId ? { ...l, name, modifiedAt: new Date().toISOString() } : l,
  );
  found = nextLibraries.some((l) => l.id === libraryId);
  return { doc: { ...doc, spotLibraries: nextLibraries }, found };
}

/** Duplicate a library under a fresh id (spots keep their own ids). */
export function duplicateSpotLibrary(
  doc: Document,
  libraryId: string,
): { doc: Document; library?: SpotLibrary } {
  const source = findSpotLibrary(doc, libraryId);
  if (!source) return { doc };
  const copy: SpotLibrary = {
    ...source,
    id: newSpotLibraryId(),
    name: `${source.name} Copy`,
    spots: source.spots.map((s) => ({ ...s })),
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  return { doc: { ...doc, spotLibraries: [...librariesOf(doc), copy] }, library: copy };
}

/** Delete a library (spot refs to its inks become unresolved, never black). */
export function deleteSpotLibrary(
  doc: Document,
  libraryId: string,
): { doc: Document; removed: boolean } {
  const before = librariesOf(doc).length;
  const nextLibraries = librariesOf(doc).filter((l) => l.id !== libraryId);
  return {
    doc: { ...doc, spotLibraries: nextLibraries },
    removed: nextLibraries.length !== before,
  };
}

/** All spot definitions in the document (any library). */
export function allSpotDefs(doc: Document): SpotColorDef[] {
  return librariesOf(doc).flatMap((l) => l.spots);
}

/** Search spots across libraries by name/code/manufacturer. */
export function searchSpots(
  doc: Document,
  query: string,
): Array<{ library: SpotLibrary; spot: SpotColorDef }> {
  const q = query.trim().toLowerCase();
  if (!q) return librariesOf(doc).flatMap((l) => l.spots.map((spot) => ({ library: l, spot })));
  return librariesOf(doc).flatMap((l) =>
    l.spots
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.code?.toLowerCase().includes(q) ||
          s.manufacturer?.toLowerCase().includes(q) ||
          s.aliases?.some((a) => a.toLowerCase().includes(q)),
      )
      .map((spot) => ({ library: l, spot })),
  );
}

/** Import a library into the document, resolving id collisions deterministically. */
export function importSpotLibrary(
  doc: Document,
  incoming: SpotLibrary,
): { doc: Document; warnings: string[] } {
  const warnings: string[] = [];
  const existing = findSpotLibrary(doc, incoming.id);
  if (existing) {
    // Same id, different definition: destination wins; source spots that
    // are not already present are added under their own ids.
    warnings.push(`library "${incoming.name}" already exists; merging definitions`);
    const existingIds = new Set(existing.spots.map((s) => s.id));
    const merged: SpotLibrary = {
      ...existing,
      spots: [...existing.spots, ...incoming.spots.filter((s) => !existingIds.has(s.id))],
      modifiedAt: new Date().toISOString(),
    };
    return {
      doc: {
        ...doc,
        spotLibraries: librariesOf(doc).map((l) => (l.id === incoming.id ? merged : l)),
      },
      warnings,
    };
  }
  const nameClash = librariesOf(doc).find((l) => l.name === incoming.name);
  if (nameClash) {
    warnings.push(`library name "${incoming.name}" already in use; importing under a new id`);
  }
  return {
    doc: {
      ...doc,
      spotLibraries: [...librariesOf(doc), { ...incoming, id: newSpotLibraryId() }],
    },
    warnings,
  };
}

/** Total ink coverage of a spot tint (percent), for preflight and warnings. */
export function spotTintCoverage(tint: number): number {
  return clampSpotTint(tint);
}

/** Tint bounds helper (0 and 100 are both valid and meaningful). */
export const SPOT_TINT_FULL = SPOT_TINT_MAX;

/** Preview interpolation for a tinted spot (alternate process color, %). */
export function spotTintPreview(
  def: SpotColorDef,
  tint: number,
): {
  r: number;
  g: number;
  b: number;
} {
  const t = clampSpotTint(tint) / 100;
  const { c, m, y, k } = def.processFallback;
  // Ink coverage scales linearly with tint; white paper at 0%.
  const r = Math.round(255 * (1 - (c / 255) * t) * (1 - (k / 255) * t));
  const g = Math.round(255 * (1 - (m / 255) * t) * (1 - (k / 255) * t));
  const b = Math.round(255 * (1 - (y / 255) * t) * (1 - (k / 255) * t));
  return { r, g, b };
}

/** Coerce a legacy/name-only ref into a stable-id ref, creating a def when needed. */
export function stabilizeSpotRef(
  doc: Document,
  ref: SpotColorRef,
): {
  doc: Document;
  ref: SpotColorRef;
} {
  if (ref.spotId) return { doc, ref };
  const resolved = resolveSpotRef(doc, ref);
  if (resolved) {
    return { doc, ref: spotDefToRef(resolved, ref.tint, ref.a) };
  }
  // Unknown ink: embed a project-local definition so the artwork stays
  // visible and identifiable without an external library.
  const library = findSpotLibrary(doc, ref.library ?? '') ?? findProjectLibrary(doc);
  if (!library) {
    const created = createSpotLibrary(doc, 'Project Spots', 'project');
    const def: SpotColorDef = {
      id: newSpotId(),
      name: ref.name,
      library: '',
      processFallback: ref.processFallback ?? { c: 0, m: 0, y: 0, k: 0 },
      provenance: 'migration',
    };
    const added = addSpotToLibrary(created.doc, created.library.id, def);
    return { doc: added.doc, ref: spotDefToRef(def, ref.tint, ref.a) };
  }
  const def: SpotColorDef = {
    id: newSpotId(),
    name: ref.name,
    library: library.id,
    processFallback: ref.processFallback ?? { c: 0, m: 0, y: 0, k: 0 },
    provenance: 'migration',
  };
  const added = addSpotToLibrary(doc, library.id, def);
  return { doc: added.doc, ref: spotDefToRef(def, ref.tint, ref.a) };
}

/** First project-scoped library (created lazily by callers). */
function findProjectLibrary(doc: Document): SpotLibrary | undefined {
  return librariesOf(doc).find((l) => l.kind === 'project');
}

/** Validate a spot definition; returns issue strings. */
export function validateSpotDef(def: SpotColorDef): string[] {
  const issues: string[] = [];
  if (!def.id) issues.push('spot id is required');
  if (!def.name || def.name.trim().length === 0) issues.push('spot name is required');
  if (!def.processFallback) issues.push('spot process fallback is required');
  else {
    for (const [name, v] of Object.entries(def.processFallback)) {
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 255) {
        issues.push(`spot fallback channel ${name} must be in [0, 255]`);
      }
    }
  }
  return issues;
}
