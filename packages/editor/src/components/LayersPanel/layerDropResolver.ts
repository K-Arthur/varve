/**
 * The canonical Layers drag-and-drop target resolver.
 *
 * One drag has exactly one semantic answer to "where does this land?", and
 * this module is the only place that computes it. The drop indicator, the
 * auto-expand timer, the accessibility announcement and the final hierarchy
 * mutation all consume the *same* `LayerDropTarget` value, so the panel can
 * never preview one destination and commit another.
 *
 * Two deliberate design choices make that invariant hold under
 * virtualization:
 *
 * 1. **The pointer is authoritative, never dnd-kit's `over`.** dnd-kit's
 *    default `rectIntersection` collision can hand back the huge
 *    `canvas-drop-zone` droppable instead of a 28px row, and it only
 *    re-fires when the winner *changes* — which happens as the pointer
 *    crosses a row edge, never in a row's middle band. Resolving from raw
 *    pointer coordinates fixes both.
 *
 * 2. **Row geometry comes from the virtualizer's measurements, not from
 *    `getBoundingClientRect()`.** Only ~20 of N rows are mounted at a time,
 *    so DOM rects can address only those; measurements cover every row,
 *    mounted or not, cost no layout reads, and stay correct while
 *    auto-scroll mounts and unmounts rows under the pointer.
 */

import type { ContainerNode, Document, NodeId } from '@varve/scene';
import { getParent, isContainer } from '@varve/scene';
import type { FlatEntry } from './useFlatTree';

export type LayerDropZone = 'before' | 'after' | 'into';

/** Why a resolved target cannot be committed. */
export type LayerDropInvalidReason = 'cycle' | 'locked';

/**
 * A row's extent inside the tree's scrollable content, in the virtualizer's
 * coordinate space (0 = top of the scrollable content, not of the viewport).
 * Indexed identically to the flattened `entries` array.
 */
export interface RowGeometry {
  start: number;
  end: number;
}

export interface LayerDropTarget {
  /**
   * The row the pointer is over. `null` means the pointer is in the empty
   * space below the last row, which drops at the active page's root level.
   */
  targetId: NodeId | null;
  zone: LayerDropZone;
  /** Container to reparent into. `null` = the active page's content root. */
  targetParentId: NodeId | null;
  /**
   * Insertion position in `targetParentId`'s raw `children` array — already
   * converted out of visual order (the panel lists front-most first, the
   * array stores back-to-front).
   */
  insertionIndex: number;
  /** True when the drop clips the moved layers to a mask source. */
  clipInto: boolean;
  valid: boolean;
  reason?: LayerDropInvalidReason;
}

/**
 * The sibling list for "top level of the active page" — NOT doc.rootChildren,
 * which holds each page's contentRoot group id, not page content. Must match
 * what reparentNode resolves a null parentId to, or drop/reorder indices are
 * computed against the wrong list.
 */
export function resolveRootLevelSiblings(doc: Document): NodeId[] {
  const activePage = doc.pages?.find((p) => p.id === doc.activePageId);
  const contentRootId = activePage?.contentRoot;
  const contentRoot = contentRootId ? doc.nodes[contentRootId] : undefined;
  return contentRoot && isContainer(contentRoot) ? contentRoot.children : doc.rootChildren;
}

/** The raw `children` array a row's siblings live in, for a row's parentId. */
export function siblingsOf(doc: Document, parentId: NodeId | null): NodeId[] {
  if (!parentId) return resolveRootLevelSiblings(doc);
  const parent = doc.nodes[parentId];
  return parent && isContainer(parent) ? (parent as ContainerNode).children : [];
}

/**
 * Compute the drop zone for a drag-over row from the pointer's relative
 * vertical position within that row (0 = top edge, 1 = bottom edge).
 *
 * A container row reserves its middle band for "into"; the top and bottom
 * bands stay before/after so a reorder never becomes an accidental reparent.
 * A leaf row is split cleanly in half — there is no "into" zone for a
 * non-container, because there is no coherent thing that would mean.
 *
 * The 0.3/0.7 split (rather than exact thirds) widens the reorder bands to
 * ~8px each on a 28px row while leaving the "into" band the largest single
 * region, which is what makes reparenting reachable without making a
 * sibling reorder feel like a coin toss.
 */
export function computeDropZone(
  relativeY: number,
  overIsContainer: boolean,
  isDescendant: boolean,
): LayerDropZone {
  if (overIsContainer && !isDescendant && relativeY > 0.3 && relativeY < 0.7) {
    return 'into';
  }
  return relativeY < 0.5 ? 'before' : 'after';
}

export interface DropClipTarget {
  /** True when the drop clips the dragged layer(s) to the mask source. */
  clipInto: boolean;
  /** The container to reparent into when clipInto (the matte's parent). */
  parentId: NodeId | null;
  /** The insertion index inside parentId (immediately after the matte). */
  index: number;
}

/**
 * Resolve the semantic target of a drop whose zone is 'into':
 *
 * - Dropping into the middle band of a clipping **mask source** row clips
 *   the dragged layer(s) to that matte: they become siblings of the matte,
 *   ordered immediately after it (the matte must stay at the head of the
 *   run). The mask already applies to every other child, so no mask mutation
 *   is needed — only a reparent/reorder.
 * - Any other 'into' drop is a plain container drop (reparent into the
 *   container itself).
 *
 * Returns null when the target cannot be resolved (dangling node).
 */
export function resolveDropClipTarget(
  doc: Document,
  overId: NodeId,
  zone: LayerDropZone,
): DropClipTarget | null {
  const overNode = doc.nodes[overId];
  if (!overNode) return null;
  if (zone !== 'into') return { clipInto: false, parentId: null, index: 0 };

  const overParentId = getParent(doc, overId);
  const overParent = overParentId ? doc.nodes[overParentId] : undefined;
  const overParentMask = overParent
    ? (overParent as { mask?: { visible?: boolean; sourceNodeId?: NodeId } }).mask
    : undefined;
  const isMatteRow = overParentMask?.visible !== false && overParentMask?.sourceNodeId === overId;
  if (isMatteRow && overParentId && overParent && isContainer(overParent)) {
    const siblings = (overParent as ContainerNode).children;
    const sourceIdx = siblings.indexOf(overId);
    return { clipInto: true, parentId: overParentId, index: sourceIdx + 1 };
  }
  return { clipInto: false, parentId: null, index: 0 };
}

/**
 * Binary-search row geometry for the row containing `offset`. Returns -1 when
 * the offset falls above the first row or below the last one.
 *
 * Geometry is contiguous and ascending (the virtualizer lays rows out
 * end-to-end), so this is a plain predecessor search.
 */
export function findRowIndexAtOffset(geometry: RowGeometry[], offset: number): number {
  if (geometry.length === 0) return -1;
  const first = geometry[0]!;
  const last = geometry[geometry.length - 1]!;
  if (offset < first.start || offset >= last.end) return -1;

  let lo = 0;
  let hi = geometry.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = geometry[mid]!;
    if (offset < row.start) hi = mid - 1;
    else if (offset >= row.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export interface ResolveLayerDropTargetArgs {
  doc: Document;
  /** The flattened, currently-visible tree rows, in panel order. */
  entries: FlatEntry[];
  /** Row extents from the virtualizer, indexed identically to `entries`. */
  geometry: RowGeometry[];
  /** Pointer position in client coordinates. */
  pointerY: number;
  /** The tree's visible clip bounds, in client coordinates. */
  viewport: { top: number; bottom: number };
  /**
   * Client Y of the top edge of the tree's scrollable *content*. Because that
   * element scrolls with the list, reading its rect folds the scroll offset in
   * for free — one constant-cost layout read per pointer sample instead of one
   * per mounted row.
   */
  contentTop: number;
  /** Every id the drag would move (the whole multi-selection). */
  activeIds: NodeId[];
  /** True when `nodeId` is `ancestorId` itself or sits beneath it. */
  isDescendant: (ancestorId: NodeId, nodeId: NodeId) => boolean;
  /** True when a node may not be restructured. */
  isLocked?: (nodeId: NodeId) => boolean;
}

/**
 * Resolve where the pointer currently says the drag will land.
 *
 * Returns `null` when the pointer is outside the tree viewport entirely —
 * the drag is over the canvas or another panel and the Layers panel must not
 * claim it. That is a meaningfully different answer from an invalid target,
 * which *is* over a row but cannot be committed.
 */
export function resolveLayerDropTarget(args: ResolveLayerDropTargetArgs): LayerDropTarget | null {
  const {
    doc,
    entries,
    geometry,
    pointerY,
    viewport,
    contentTop,
    activeIds,
    isDescendant,
    isLocked,
  } = args;

  // Outside the panel: not our drop. Falling back to dnd-kit's `over` here is
  // exactly how a drag released over the canvas used to land on whichever row
  // the collision detector happened to be holding.
  if (pointerY < viewport.top || pointerY > viewport.bottom) return null;
  if (entries.length === 0 || geometry.length === 0) return null;

  const offset = pointerY - contentTop;
  const rowIndex = findRowIndexAtOffset(geometry, offset);

  // Empty space below the last row drops at the active page's root level,
  // visually at the bottom of the list. Without this the only way out of a
  // container was to find a root-level row to aim at, which does not exist
  // when the container holds everything.
  if (rowIndex === -1) {
    const last = geometry[geometry.length - 1]!;
    if (offset < last.end) return null;
    return rootEndTarget(isLocked);
  }

  const entry = entries[rowIndex];
  if (!entry) return null;
  const overId = entry.node.id;

  // The dragged row itself is never a target. Its own subtree rows are
  // resolved as targets so the invalid state can be *shown* rather than the
  // drag silently doing nothing on release.
  if (activeIds.includes(overId)) {
    return {
      targetId: overId,
      zone: 'into',
      targetParentId: null,
      insertionIndex: 0,
      clipInto: false,
      valid: false,
      reason: 'cycle',
    };
  }

  const row = geometry[rowIndex]!;
  const size = row.end - row.start;
  const relativeY = size > 0 ? (offset - row.start) / size : 0;

  const overNode = doc.nodes[overId];
  const overIsContainer = !!overNode && isContainer(overNode);
  const cycles = activeIds.some((id) => isDescendant(id, overId));
  const zone = computeDropZone(relativeY, overIsContainer, cycles);

  if (cycles) {
    return {
      targetId: overId,
      zone,
      targetParentId: null,
      insertionIndex: 0,
      clipInto: false,
      valid: false,
      reason: 'cycle',
    };
  }

  if (zone === 'into') {
    const clip = resolveDropClipTarget(doc, overId, zone);
    if (clip?.clipInto && clip.parentId) {
      return withLockValidation(
        {
          targetId: overId,
          zone,
          targetParentId: clip.parentId,
          insertionIndex: clip.index,
          clipInto: true,
          valid: true,
        },
        isLocked,
      );
    }
    const children = overIsContainer ? (overNode as ContainerNode).children : [];
    return withLockValidation(
      {
        targetId: overId,
        zone,
        targetParentId: overId,
        // Visual top of a container's children is the end of the raw array.
        insertionIndex: children.length,
        clipInto: false,
        valid: true,
      },
      isLocked,
    );
  }

  const targetParentId = entry.parentId ?? null;
  const targetSiblings = siblingsOf(doc, targetParentId);
  let overIdx = targetSiblings.indexOf(overId);
  if (overIdx < 0) overIdx = targetSiblings.length;

  // Visual before/after is inverted vs raw array order (the panel is
  // front-most-first, the array is back-to-front). Dropping "before" a row
  // visually (above it) means inserting *after* it in the raw array.
  //
  // This stays correct under a search/filter: `indexOf` addresses the full
  // sibling array, so "immediately above the row you can see" resolves to the
  // right slot even when the rows between are filtered out of view.
  const insertionIndex = zone === 'before' ? overIdx + 1 : overIdx;

  return withLockValidation(
    {
      targetId: overId,
      zone,
      targetParentId,
      insertionIndex,
      clipInto: false,
      valid: true,
    },
    isLocked,
  );
}

/**
 * Empty space below the last row: the active page's root level, at the visual
 * bottom of the list — which is index 0 of the raw children array.
 */
function rootEndTarget(isLocked?: (nodeId: NodeId) => boolean): LayerDropTarget {
  return withLockValidation(
    {
      targetId: null,
      zone: 'after',
      targetParentId: null,
      insertionIndex: 0,
      clipInto: false,
      valid: true,
    },
    isLocked,
  );
}

function withLockValidation(
  target: LayerDropTarget,
  isLocked?: (nodeId: NodeId) => boolean,
): LayerDropTarget {
  if (isLocked && target.targetParentId && isLocked(target.targetParentId)) {
    return { ...target, valid: false, reason: 'locked' };
  }
  return target;
}
