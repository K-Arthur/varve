/**
 * Page placement for editor world space (ADR-0123).
 *
 * Page placement is layout metadata, never part of node transforms. The
 * editor's world space is the pasteboard, so every world-space consumer
 * (render transform cache, spatial index, selection overlays, snapping,
 * dirty regions) resolves the containing page's placement and appends its
 * translation to composed node transforms.
 *
 * Placement resolution mirrors `pasteboardLayout` (explicit `Page.placement`
 * wins, otherwise the deterministic auto layout); this module additionally
 * precomputes the node-id -> placement map so per-node lookups stay O(1).
 */

import type { Document, NodeId } from '@varve/scene';
import { buildPlacedScene } from '@varve/scene';

export interface PagePlacementOffset {
  x: number;
  y: number;
}

export interface PagePlacementMap {
  /** Every page-owned node id (content roots, backgrounds, descendants). */
  nodes: Map<NodeId, PagePlacementOffset>;
  /** Page content root ids. */
  contentRoots: Set<NodeId>;
}

const EMPTY_MAP: PagePlacementMap = { nodes: new Map(), contentRoots: new Set() };

/**
 * Build the node -> page-placement map for a document. O(n) over the
 * content-root subtrees plus one placement-resolution pass; callers cache
 * this per `doc.pages` identity and reuse it across node lookups.
 */
export function buildPagePlacementMap(doc: Document): PagePlacementMap {
  const pages = doc.pages ?? [];
  if (pages.length === 0) return EMPTY_MAP;
  const { placements } = buildPlacedScene(doc);
  const nodes = new Map<NodeId, PagePlacementOffset>();
  const contentRoots = new Set<NodeId>();

  for (const page of pages) {
    const placement = placements.get(page.id);
    if (!placement) continue;
    contentRoots.add(page.contentRoot);
    nodes.set(page.contentRoot, placement);
    const contentRoot = doc.nodes[page.contentRoot];
    if (!contentRoot || !('children' in contentRoot)) continue;
    const queue = [...contentRoot.children];
    while (queue.length > 0) {
      const id = queue.pop()!;
      nodes.set(id, placement);
      const node = doc.nodes[id];
      if (node && 'children' in node && node.children) {
        queue.push(...node.children);
      }
    }
  }
  return { nodes, contentRoots };
}

/**
 * Placement translation to append to a node's composed world transform, or
 * null when the node is not page-owned (pasteboard/global items).
 */
export function pagePlacementForNode(
  map: PagePlacementMap,
  nodeId: NodeId,
): PagePlacementOffset | null {
  return map.nodes.get(nodeId) ?? null;
}
