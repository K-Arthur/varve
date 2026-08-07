/**
 * Merge conflict resolution (M12, ADR-0034/0035).
 *
 * `applyMergeResolutions` applies the user's per-conflict choices to the
 * merged document produced by `mergeDocuments`. The merged document keeps
 * the OURS value at every conflict position by construction, so:
 * - 'ours'   → no-op (already applied)
 * - 'theirs' → deep-set the theirs value
 * - 'base'   → deep-set the base value
 *
 * Entity-level conflicts (edit-vs-delete restores, add-vs-add) resolve
 * through the entity's owning collection: map-backed collections set the
 * entity by id; array-backed collections append-or-replace by id. When the
 * resolution cannot be applied safely, it is skipped with a warning — the
 * resolver never fabricates entities or guesses containers.
 *
 * The function is pure and deterministic: the same inputs always produce
 * the same document and warnings.
 */
import type { Document } from '@varve/scene';
import { canonicalHash } from '@varve/scene';
import type { MergeConflict } from './merge';

export type MergeResolutionChoice = 'ours' | 'theirs' | 'base';

export interface MergeResolution {
  conflictId: string;
  choice: MergeResolutionChoice;
}

export interface MergeResolutionResult {
  document: Document;
  warnings: string[];
  /** Conflicts still unresolved after this application pass. */
  unresolvedConflictIds: string[];
}

/** Map-backed entity kinds and their top-level collection. */
const MAP_BACKED_COLLECTIONS: Record<string, string> = {
  node: 'nodes',
  style: 'styles',
  paint: 'paints',
  component: 'components',
  master: 'masters',
  asset: 'assets',
  iconAsset: 'iconAssets',
  stateMachine: 'stateMachines',
};

/** Array-backed entity kinds and their top-level collection. */
const ARRAY_BACKED_COLLECTIONS: Record<string, string> = {
  page: 'pages',
  guide: 'guides',
  swatch: 'swatches',
  spotColor: 'spotColors',
  spotLibrary: 'spotLibraries',
  library: 'installedLibraries',
};

export function applyMergeResolutions(
  mergedDocument: Document,
  conflicts: MergeConflict[],
  resolutions: MergeResolution[],
): MergeResolutionResult {
  const next = structuredClone(mergedDocument) as unknown as Record<string, unknown>;
  const byId = new Map(resolutions.map((r) => [r.conflictId, r.choice]));
  const warnings: string[] = [];
  const unresolved: string[] = [];

  for (const conflict of conflicts) {
    const choice = byId.get(conflict.conflictId);
    if (!choice || choice === 'ours') {
      // No resolution or 'ours': the merged document already holds ours.
      if (choice === undefined) unresolved.push(conflict.conflictId);
      continue;
    }
    const value = choice === 'theirs' ? conflict.theirsValue : conflict.baseValue;

    if (conflict.propertyPath) {
      // Entity-level container conflicts (add-vs-add) carry the container
      // path; scalar/text/rename/reorder conflicts carry the property path.
      if (conflict.conflictKind === 'add-vs-add' || conflict.conflictKind === 'edit-vs-delete') {
        const applied = setEntityInContainer(next, conflict, value, choice, warnings);
        if (!applied) unresolved.push(conflict.conflictId);
      } else {
        const applied = setAtPath(next, conflict.propertyPath, value);
        if (!applied) {
          warnings.push(
            `merge: cannot apply ${choice} resolution for ${conflict.conflictId} at ${conflict.propertyPath}`,
          );
          unresolved.push(conflict.conflictId);
        }
      }
      continue;
    }

    // Entity-level conflict without a property path: restore or remove the
    // entity in its owning collection.
    const applied = setEntityInContainer(next, conflict, value, choice, warnings);
    if (!applied) unresolved.push(conflict.conflictId);
  }

  return {
    document: next as unknown as Document,
    warnings,
    unresolvedConflictIds: unresolved,
  };
}

/**
 * Apply an entity-level resolution in the entity's owning collection.
 * Returns false when the container cannot be determined or the value is
 * unusable (the resolution is skipped with a warning, never guessed).
 */
function setEntityInContainer(
  doc: Record<string, unknown>,
  conflict: MergeConflict,
  value: unknown,
  choice: MergeResolutionChoice,
  warnings: string[],
): boolean {
  const collection = MAP_BACKED_COLLECTIONS[conflict.entityType];
  if (collection) {
    const container = doc[collection];
    if (typeof container !== 'object' || container === null) {
      warnings.push(
        `merge: collection ${collection} not found; cannot resolve ${conflict.conflictId}`,
      );
      return false;
    }
    if (choice === 'theirs' && conflict.conflictKind === 'edit-vs-delete' && value === undefined) {
      warnings.push(`merge: edit-vs-delete on ${conflict.entityId} has no incoming value`);
      return false;
    }
    // edit-vs-delete with 'theirs' on a deleted entity restores it; with
    // 'base' the entity returns to its pre-conflict state.
    (container as Record<string, unknown>)[conflict.entityId] = structuredClone(value);
    return true;
  }

  const arrayCollection = ARRAY_BACKED_COLLECTIONS[conflict.entityType];
  if (arrayCollection) {
    const container = doc[arrayCollection];
    if (!Array.isArray(container)) {
      warnings.push(
        `merge: collection ${arrayCollection} not found; cannot resolve ${conflict.conflictId}`,
      );
      return false;
    }
    const list = container as Array<Record<string, unknown>>;
    const index = list.findIndex((item) => item?.id === conflict.entityId);
    if (index >= 0) {
      list[index] = structuredClone(value) as Record<string, unknown>;
    } else {
      list.push(structuredClone(value) as Record<string, unknown>);
    }
    return true;
  }

  // Nested collections (variables, modes) resolve through their property
  // path when one exists; otherwise the resolution is skipped.
  if (conflict.propertyPath) {
    return setAtPath(doc, conflict.propertyPath, value);
  }
  warnings.push(
    `merge: no container known for entity type ${conflict.entityType}; cannot resolve ${conflict.conflictId}`,
  );
  return false;
}

/**
 * Path-safe deep-set. Mirrors the merge engine's setter semantics: array
 * segments resolve by `id`, map segments by key. Returns false when a path
 * segment cannot be resolved (the document is left untouched).
 */
function setAtPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const segments = path.split('.');
  if (segments.length === 0) return false;
  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    if (Array.isArray(current)) {
      const found = (current as Array<Record<string, unknown>>).find(
        (item) => item?.id === segment,
      );
      if (!found) return false;
      current = found;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return false;
    }
  }
  const last = segments[segments.length - 1]!;
  if (Array.isArray(current)) {
    const index = (current as Array<Record<string, unknown>>).findIndex(
      (item) => item?.id === last,
    );
    if (index < 0) return false;
    (current as unknown[])[index] = structuredClone(value);
    return true;
  }
  if (typeof current !== 'object' || current === null) return false;
  (current as Record<string, unknown>)[last] = structuredClone(value);
  return true;
}

/** Validate a resolution list against the conflict set (ADR-0035). */
export function validateMergeResolutions(
  conflicts: MergeConflict[],
  resolutions: MergeResolution[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const conflictIds = new Set(conflicts.map((c) => c.conflictId));
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    if (!conflictIds.has(resolution.conflictId)) {
      errors.push(`resolution references unknown conflict ${resolution.conflictId}`);
    }
    if (seen.has(resolution.conflictId)) {
      errors.push(`duplicate resolution for conflict ${resolution.conflictId}`);
    }
    seen.add(resolution.conflictId);
    const conflict = conflicts.find((c) => c.conflictId === resolution.conflictId);
    if (conflict && !conflict.candidateResolutions.includes(resolution.choice)) {
      errors.push(
        `resolution ${resolution.choice} not offered for conflict ${resolution.conflictId}`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Resolve every conflict with a single uniform choice (bulk apply). */
export function bulkResolve(
  conflicts: MergeConflict[],
  choice: MergeResolutionChoice,
): MergeResolution[] {
  return conflicts.map((c) => ({ conflictId: c.conflictId, choice }));
}

/** Sanity-check that the resolved document still canonicalizes. */
export function verifyResolvedDocument(document: Document): boolean {
  try {
    canonicalHash(document);
    return true;
  } catch {
    return false;
  }
}
