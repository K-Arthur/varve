/**
 * useFlatTree — walks the scene Document and returns a flat array of visible
 * rows in paint order, respecting expanded/collapsed state and an optional
 * filter specification with search-index support.
 *
 * Research basis: APG Tree View pattern requires that only visible nodes
 * participate in the tab sequence. The flat walk produces the "virtual" order
 * that ArrowUp/ArrowDown navigate through.
 */

import type { Document, NodeId, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { useMemo } from 'react';
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

/**
 * Flatten a document into visible paint-order rows.
 *
 * @param doc - The scene document
 * @param expanded - Set of expanded container ids
 * @param filterSpec - Optional filter specification (default: no filtering)
 * @param matchedIds - Optional pre-computed set of node IDs matching the search
 *   query. When provided, the search term check uses this set (O(1)) instead of
 *   a linear name scan. Other filter dimensions still apply normally.
 * @returns Flat array of entries, each with node, depth, parentId
 */
export function flattenTree(
  doc: Document,
  expanded: Set<NodeId>,
  filterSpec: LayerFilterSpec = DEFAULT_FILTER,
  matchedIds?: Set<NodeId>,
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

  return walk(null, doc.rootChildren, 0);
}

/**
 * React hook wrapping flattenTree with memoization.
 */
export function useFlatTree(
  doc: Document,
  expanded: Set<NodeId>,
  filterSpec: LayerFilterSpec = DEFAULT_FILTER,
  matchedIds?: Set<NodeId>,
): FlatEntry[] {
  return useMemo(
    () => flattenTree(doc, expanded, filterSpec, matchedIds),
    [doc, expanded, filterSpec, matchedIds],
  );
}
