/**
 * useFlatTree — walks the scene Document and returns a flat array of visible
 * rows in paint order, respecting expanded/collapsed state and an optional
 * filter specification with search-index support.
 *
 * Research basis: APG Tree View pattern requires that only visible nodes
 * participate in the tab sequence. The flat walk produces the "virtual" order
 * that ArrowUp/ArrowDown navigate through.
 *
 * — Optimization —
 * Uses structural diffing to avoid O(N) re-flatten on property-only changes
 * (rename, visibility toggle, etc.). When only node properties change, entries
 * are updated in-place via an O(N) map (cheap) instead of a full tree walk
 * (expensive, recursive, with filter logic).
 */

import type { Document, NodeId, Page, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { useMemo, useRef } from 'react';
import {
  DEFAULT_FILTER,
  isFiltering,
  nodeMatchesFilter,
  type LayerFilterSpec,
} from './layerFilterTypes';

export interface FlatEntry {
  node: SceneNode;
  depth: number;
  parentId: NodeId | null;
}

// ── Diff utilities ─────────────────────────────────────────────────────────

/**
 * Compare two Sets of NodeId by value.
 * Returns true when both sets contain exactly the same elements.
 */
export function setsEqual(a: Set<NodeId> | undefined, b: Set<NodeId> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export interface DocumentDiff {
  structureChanged: boolean;
  changedNodeIds: NodeId[];
}

/**
 * Efficiently detect what changed between two documents.
 * Uses reference equality for fast comparison — returns early on structural changes.
 * Property-only changes (rename, visibility toggle, etc.) are reported as changedNodeIds.
 *
 * Structural changes: rootChildren replaced, node added/removed, children arrays changed.
 * Property-only changes: node object reference changed but children array reference unchanged.
 */
export function computeDocumentDiff(prevDoc: Document | null, doc: Document): DocumentDiff {
  if (!prevDoc) return { structureChanged: true, changedNodeIds: [] };

  // Same nodes map reference → no node-level changes
  if (prevDoc.nodes === doc.nodes) {
    return { structureChanged: false, changedNodeIds: [] };
  }

  // Structural: rootChildren reference changed (addition/removal/reorder at root)
  if (prevDoc.rootChildren !== doc.rootChildren) {
    return { structureChanged: true, changedNodeIds: [] };
  }

  const prevKeys = Object.keys(prevDoc.nodes);
  const currKeys = Object.keys(doc.nodes);

  // Different key count → node added or removed
  if (prevKeys.length !== currKeys.length) {
    return { structureChanged: true, changedNodeIds: [] };
  }

  const changedNodeIds: NodeId[] = [];

  for (let i = 0; i < currKeys.length; i++) {
    const key = currKeys[i];
    const prevNode = prevDoc.nodes[key];
    const currNode = doc.nodes[key];

    // Node doesn't exist in prev doc → structural change (added)
    if (!prevNode) {
      return { structureChanged: true, changedNodeIds: [] };
    }

    // Same reference → no change
    if (prevNode === currNode) continue;

    // Different reference: check if children array changed (structural)
    const prevChildren =
      'children' in prevNode ? (prevNode as { children?: NodeId[] }).children : undefined;
    const currChildren =
      'children' in currNode ? (currNode as { children?: NodeId[] }).children : undefined;

    if (prevChildren !== currChildren) {
      return { structureChanged: true, changedNodeIds: [] };
    }

    changedNodeIds.push(key);
  }

  return {
    structureChanged:
      changedNodeIds.length === 0 &&
      Object.keys(prevDoc.nodes).length === Object.keys(doc.nodes).length
        ? false
        : false,
    changedNodeIds,
  };
}

/**
 * Check if any of the changed properties could affect filter visibility.
 * When false, in-place entry update is safe (no entries added/removed).
 * When true, a full rebuild is required because nodes may appear/disappear.
 */
function propsAffectFilter(
  changedIds: NodeId[],
  prevDoc: Document,
  doc: Document,
  filterSpec: LayerFilterSpec,
): boolean {
  if (!isFiltering(filterSpec)) return false;

  for (const id of changedIds) {
    const prev = prevDoc.nodes[id];
    const curr = doc.nodes[id];
    if (!prev || !curr) return true;
    if (prev.kind !== curr.kind) return true;
    if (prev.locked !== curr.locked) return true;
    if (prev.visible !== curr.visible) return true;
    if (prev.blendMode !== curr.blendMode) return true;
    if (
      (prev as Record<string, unknown>).componentId !==
      (curr as Record<string, unknown>).componentId
    )
      return true;

    if (filterSpec.attributes.hasChildren !== undefined) {
      const prevCh =
        'children' in prev ? ((prev as { children?: unknown[] }).children?.length ?? 0) : 0;
      const currCh =
        'children' in curr ? ((curr as { children?: unknown[] }).children?.length ?? 0) : 0;
      if (prevCh > 0 !== currCh > 0) return true;
    }
    if (filterSpec.attributes.hasEffects !== undefined) {
      const prevFx =
        'effects' in prev ? ((prev as { effects?: unknown[] }).effects?.length ?? 0) : 0;
      const currFx =
        'effects' in curr ? ((curr as { effects?: unknown[] }).effects?.length ?? 0) : 0;
      if (prevFx > 0 !== currFx > 0) return true;
    }
    if (filterSpec.attributes.isMasked !== undefined) {
      const prevM = 'mask' in prev ? ((prev as { mask?: unknown }).mask ?? null) : null;
      const currM = 'mask' in curr ? ((curr as { mask?: unknown }).mask ?? null) : null;
      if ((prevM != null) !== (currM != null)) return true;
    }
    if (filterSpec.search && prev.name !== curr.name) return true;
  }

  return false;
}

// ── Flatten ─────────────────────────────────────────────────────────────────

/**
 * Flatten a document into visible paint-order rows.
 *
 * @param doc - The scene document
 * @param expanded - Set of expanded container ids
 * @param filterSpec - Optional filter specification (default: no filtering)
 * @param matchedIds - Optional pre-computed set of node IDs matching the search
 *   query. When provided, the search term check uses this set (O(1)) instead of
 *   a linear name scan. Other filter dimensions still apply normally.
 * @param activePageId - When provided, only show content rooted at this page's
 *   content-root node (hides other pages' content from the tree).
 * @returns Flat array of entries, each with node, depth, parentId
 */
export function flattenTree(
  doc: Document,
  expanded: Set<NodeId>,
  filterSpec: LayerFilterSpec = DEFAULT_FILTER,
  matchedIds?: Set<NodeId>,
  activePageId?: NodeId,
): FlatEntry[] {
  const filtering = isFiltering(filterSpec);
  const hasSearchIndex = matchedIds !== undefined && filterSpec.search !== '';

  function matchesAllExceptSearch(node: SceneNode, spec: LayerFilterSpec): boolean {
    if (spec.kinds.length > 0) {
      const effectiveKind =
        node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null
          ? 'component'
          : node.kind;
      if (!spec.kinds.includes(effectiveKind as any) && !spec.kinds.includes(node.kind))
        return false;
    }

    const attr = spec.attributes;
    if (attr.locked !== undefined && node.locked !== attr.locked) return false;
    if (attr.visible !== undefined && node.visible !== attr.visible) return false;
    if (attr.hasChildren !== undefined) {
      const hasCh = 'children' in node && (node as any).children?.length > 0;
      if (hasCh !== attr.hasChildren) return false;
    }
    if (attr.isComponent !== undefined) {
      const isComp =
        node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null;
      if (isComp !== attr.isComponent) return false;
    }
    if (attr.isInstance !== undefined) {
      const isInst =
        node.kind === 'frame' && 'componentId' in node && (node as any).componentId != null;
      if (isInst !== attr.isInstance) return false;
    }
    if (attr.hasEffects !== undefined) {
      const hasFx = 'effects' in node && (node as any).effects?.length > 0;
      if (hasFx !== attr.hasEffects) return false;
    }
    if (attr.isMasked !== undefined) {
      const isMasked = 'mask' in node && (node as any).mask != null;
      if (isMasked !== attr.isMasked) return false;
    }

    if (spec.blendModes.length > 0) {
      if (!spec.blendModes.includes(node.blendMode!)) return false;
    }

    return true;
  }

  function walk(parentId: NodeId | null, ids: NodeId[], depth: number): FlatEntry[] {
    const entries: FlatEntry[] = [];
    for (let i = ids.length - 1; i >= 0; i--) {
      const nid = ids[i];
      if (!nid) continue;
      const node = doc.nodes[nid];
      if (!node) continue;
      if (parentId && !expanded.has(parentId)) continue;

      const hasChildren = isContainer(node) && node.children.length > 0 && expanded.has(nid);
      const childEntries = hasChildren ? walk(nid, node.children, depth + 1) : [];

      let nodeMatches = true;
      if (filtering) {
        if (hasSearchIndex) {
          nodeMatches = matchedIds!.has(nid) && matchesAllExceptSearch(node, filterSpec);
        } else {
          nodeMatches = nodeMatchesFilter(node, filterSpec);
        }
      }
      const hasMatchingChildren = childEntries.length > 0;

      if (!filtering) {
        entries.push({ node, depth, parentId });
        entries.push(...childEntries);
      } else if (nodeMatches || hasMatchingChildren) {
        entries.push({ node, depth, parentId });
        entries.push(...childEntries);
      }
    }
    return entries;
  }

  // When a page content root is active, show that page's direct children as
  // top-level entries (transparent root). Also surface any nodes that sit
  // directly in rootChildren but aren't page content roots — these are
  // "orphans" created by the pre-fix addNode path and must remain visible
  // for backward compatibility with existing documents.
  if (activePageId) {
    // Resolve activePageId (Page.id) to the contentRoot (GroupNode.id)
    const page: Page | undefined = doc.pages?.find((p) => p.id === activePageId);
    const contentRootId: string | undefined = page?.contentRoot;
    const pageRoot = contentRootId ? doc.nodes[contentRootId] : undefined;
    const pageChildren: NodeId[] =
      pageRoot && 'children' in pageRoot && Array.isArray((pageRoot as any).children)
        ? ((pageRoot as any).children as NodeId[])
        : [];

    // GroupNodes in rootChildren are page content roots (for other pages).
    // Non-group rootChildren items are orphaned shapes — show them too.
    const orphans = doc.rootChildren.filter((id) => {
      if (id === contentRootId) return false;
      const n = doc.nodes[id];
      return n && n.kind !== 'group';
    });

    return walk(null, [...pageChildren, ...orphans], 0);
  }

  return walk(null, doc.rootChildren, 0);
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * React hook wrapping flattenTree with incremental update optimization.
 *
 * On property-only changes (rename, visibility toggle, etc.), entries are
 * updated in-place via a flat array map — avoiding O(N) tree walk + filter
 * recursion. Structural changes (add/remove/reparent) still do a full rebuild.
 *
 * Dev-mode timing: logs when flatten takes > 50ms.
 */
export function useFlatTree(
  doc: Document,
  expanded: Set<NodeId>,
  filterSpec: LayerFilterSpec = DEFAULT_FILTER,
  matchedIds?: Set<NodeId>,
  activePageId?: NodeId,
): FlatEntry[] {
  const prevDocRef = useRef<Document | null>(null);
  const prevEntriesRef = useRef<FlatEntry[]>([]);
  const prevExpandedRef = useRef<Set<NodeId> | null>(null);
  const prevFilterSpecRef = useRef<LayerFilterSpec | undefined>(undefined);
  const prevMatchedIdsRef = useRef<Set<NodeId> | undefined>(undefined);

  return useMemo(() => {
    const prevDoc = prevDocRef.current;
    const prevExpanded = prevExpandedRef.current;

    // Fast path: nothing relevant changed (same doc, expanded, filter, matchedIds)
    if (prevDoc === doc && prevExpanded === expanded) {
      return prevEntriesRef.current;
    }

    // Doc changed — detect structural vs property-only
    if (prevDoc !== doc) {
      const diff = computeDocumentDiff(prevDoc, doc);

      // Same nodes map (top-level properties changed, e.g., name, canvasWidth)
      if (!diff.structureChanged && prevDoc.nodes === doc.nodes) {
        // No node changes at all — return cached entries
        prevDocRef.current = doc;
        prevExpandedRef.current = expanded;
        prevFilterSpecRef.current = filterSpec;
        prevMatchedIdsRef.current = matchedIds;
        return prevEntriesRef.current;
      }

      // Property-only change: update entries in-place (no tree walk)
      if (
        !diff.structureChanged &&
        diff.changedNodeIds.length > 0 &&
        !propsAffectFilter(diff.changedNodeIds, prevDoc, doc, filterSpec)
      ) {
        const changedSet = new Set(diff.changedNodeIds);
        const prev = prevEntriesRef.current;
        const next = new Array<FlatEntry>(prev.length);
        for (let i = 0; i < prev.length; i++) {
          const entry = prev[i];
          next[i] = changedSet.has(entry.node.id)
            ? { ...entry, node: doc.nodes[entry.node.id]! }
            : entry;
        }
        prevDocRef.current = doc;
        prevExpandedRef.current = expanded;
        prevFilterSpecRef.current = filterSpec;
        prevMatchedIdsRef.current = matchedIds;
        prevEntriesRef.current = next;
        return next;
      }
    }

    // Structural change or expanded/filter change: full rebuild
    const start = performance.now();
    const entries = flattenTree(doc, expanded, filterSpec, matchedIds, activePageId);
    const elapsed = performance.now() - start;
    if (process.env.NODE_ENV === 'development' && elapsed > 50) {
      console.warn(`[useFlatTree] flatten took ${elapsed.toFixed(1)}ms`);
    }

    prevDocRef.current = doc;
    prevExpandedRef.current = expanded;
    prevFilterSpecRef.current = filterSpec;
    prevMatchedIdsRef.current = matchedIds;
    prevEntriesRef.current = entries;
    return entries;
  }, [doc, expanded, filterSpec, matchedIds, activePageId]);
}
