import type { NodeId } from '@varve/scene';

/**
 * Selection range input deliberately uses stable IDs rather than indexes.
 * Virtualized layer rows can be mounted, filtered, or collapsed while a
 * gesture is in progress; an index is only meaningful for one render.
 */
export interface SelectionRangeEntry {
  id: NodeId;
}

/** Return the contiguous visible range between an anchor and an extent. */
export function selectionRangeBetween(
  entries: readonly SelectionRangeEntry[],
  anchorId: NodeId | null | undefined,
  extentId: NodeId,
): NodeId[] {
  const extentIndex = entries.findIndex((entry) => entry.id === extentId);
  if (extentIndex < 0) return [];

  const anchorIndex = anchorId ? entries.findIndex((entry) => entry.id === anchorId) : extentIndex;
  if (anchorIndex < 0) return [extentId];

  const start = Math.min(anchorIndex, extentIndex);
  const end = Math.max(anchorIndex, extentIndex);
  return entries.slice(start, end + 1).map((entry) => entry.id);
}
/**
 * Apply a panel range to a selection snapshot without emitting intermediate
 * selection updates. The snapshot is the selection at pointer-down, so
 * reversing direction cannot shrink or otherwise reinterpret the gesture.
 */
export function applySelectionRange(
  current: readonly NodeId[],
  range: readonly NodeId[],
  operation: 'replace' | 'add' | 'subtract',
): NodeId[] {
  const uniqueRange = [...new Set(range)];
  const rangeSet = new Set(uniqueRange);

  switch (operation) {
    case 'replace':
      return uniqueRange;
    case 'add': {
      const result = [...current];
      const selected = new Set(result);
      for (const id of uniqueRange) {
        if (selected.has(id)) continue;
        selected.add(id);
        result.push(id);
      }
      return result;
    }
    case 'subtract':
      return current.filter((id) => !rangeSet.has(id));
  }
}
