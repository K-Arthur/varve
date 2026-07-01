/**
 * useFlatTree — walks the scene Document and returns a flat array of visible
 * rows in paint order, respecting expanded/collapsed state and an optional
 * name filter.
 *
 * Research basis: APG Tree View pattern requires that only visible nodes
 * participate in the tab sequence. The flat walk produces the "virtual" order
 * that ArrowUp/ArrowDown navigate through.
 */

import type { Document, NodeId, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { useMemo } from 'react';

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
 * @param filter - Optional name filter (prefix/substring match, case-insensitive)
 * @returns Flat array of entries, each with node, depth, parentId
 */
export function flattenTree(doc: Document, expanded: Set<NodeId>, filter = ''): FlatEntry[] {
  const lowerFilter = filter.toLowerCase();

  function walk(parentId: NodeId | null, ids: NodeId[], depth: number): FlatEntry[] {
    const entries: FlatEntry[] = [];
    for (const nid of ids) {
      const node = doc.nodes[nid];
      if (!node) continue;
      if (parentId && !expanded.has(parentId)) continue;

      const nameMatch = !lowerFilter || node.name.toLowerCase().includes(lowerFilter);
      const hasChildren = isContainer(node) && node.children.length > 0 && expanded.has(nid);
      const childEntries = hasChildren ? walk(nid, node.children, depth + 1) : [];

      // Push parent first (paint-order), then children — matches APG tree semantics
      // where each parent precedes its subtree in the flat tab sequence.
      if (nameMatch || childEntries.length > 0) {
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
export function useFlatTree(doc: Document, expanded: Set<NodeId>, filter = ''): FlatEntry[] {
  return useMemo(() => flattenTree(doc, expanded, filter), [doc, expanded, filter]);
}
