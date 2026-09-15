import type { FileEntry } from '@varve/platform';
import { generateKeyBetween, generateNKeysBetween } from '@varve/shared';

export interface FileOrderWrite {
  id: string;
  ordering: string;
}

/**
 * Plan one manual file-order move without mutating the rendered collection.
 *
 * Legacy and in-memory entries may have empty ordering keys. When that is the
 * case, seed a valid fractional key for every existing position in the same
 * write batch so the first drag has a meaningful destination as well as later
 * drags. The caller owns persistence and refresh timing.
 */
export function planFileReorder(
  files: readonly FileEntry[],
  activeId: string,
  overId: string,
): FileOrderWrite[] | null {
  const activeIndex = files.findIndex((file) => file.id === activeId);
  if (activeIndex < 0 || activeId === overId) return null;

  const remaining = files.filter((file) => file.id !== activeId);
  const overIndex = remaining.findIndex((file) => file.id === overId);
  if (overIndex < 0) return null;

  const needsBackfill = files.some((file) => !file.ordering);
  const baselineKeys = needsBackfill
    ? generateNKeysBetween(null, null, files.length)
    : files.map((file) => file.ordering);
  const keyById = new Map(files.map((file, index) => [file.id, baselineKeys[index]!])) as Map<
    string,
    string
  >;
  // dnd-kit's arrayMove inserts at the destination's original index. Once
  // the active file is removed, moving downward means inserting *after* the
  // over file; moving upward means inserting before it.
  const movingDown = activeIndex < files.findIndex((file) => file.id === overId);
  const previousKey = movingDown
    ? (keyById.get(remaining[overIndex]!.id) ?? null)
    : overIndex > 0
      ? (keyById.get(remaining[overIndex - 1]!.id) ?? null)
      : null;
  const nextKey = movingDown
    ? (keyById.get(remaining[overIndex + 1]?.id ?? '') ?? null)
    : (keyById.get(remaining[overIndex]!.id) ?? null);
  const newKey = generateKeyBetween(previousKey ?? null, nextKey);

  return files.map((file, index) => ({
    id: file.id,
    ordering: file.id === activeId ? newKey : needsBackfill ? baselineKeys[index]! : file.ordering,
  }));
}
