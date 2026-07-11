/**
 * HitTestEngine — efficient scene hit-testing with spatial indexing.
 *
 * Provides hit-test queries for a Document, using a spatial index for
 * O(1) candidate lookup. Returns the topmost node at a point, or all nodes
 * at a point in paint order (topmost last). Respects isolation mode, locked
 * state, and visibility.
 *
 * Research basis: Excalidraw two-phase hit-test (rotated-AABB reject, then
 * precise shape/path test); spatial grid for O(1) candidate filtering.
 */

import { applyAffine, invertAffine, rectContains, shapeContains } from '@strata/engine';
import type { Document, NodeId, SceneNode } from '@strata/scene';
import { activePageNodes, walkNodes } from '@strata/scene';
import { getOrCreateSpatialIndex, queryPoint } from '../scene/spatialIndex';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

export interface HitTestOptions {
  /** Isolation/focus view: when set, only nodes in this subtree are selectable. */
  isolatedNodeId?: NodeId | null;
}

export interface HitResult {
  nodeId: NodeId;
  node: SceneNode;
}

export class HitTestEngine {
  private readonly doc: Document;
  private readonly options: HitTestOptions;
  private spatialIndex: ReturnType<typeof getOrCreateSpatialIndex>;

  constructor(doc: Document, options: HitTestOptions = {}) {
    this.doc = doc;
    this.options = options;
    this.spatialIndex = getOrCreateSpatialIndex(doc, null);
  }

  /**
   * Topmost node (highest index) whose geometry contains `world`.
   * Returns null if no node is hit.
   */
  hitTest(world: { x: number; y: number }): HitResult | null {
    const candidates = queryPoint(this.spatialIndex, world.x, world.y);

    // Walk the active page's nodes in paint order (DFS) and reverse so
    // that children are tested before parents and later siblings before
    // earlier ones — the correct topmost-first hit order.
    const entries = walkNodes(this.doc, activePageNodes(this.doc));
    const ordered = [...entries.values()].reverse();

    for (const entry of ordered) {
      const n = entry.node;
      if (n.locked || !n.visible) continue;
      // Only test nodes that overlap the query point's cell.
      if (!candidates.has(entry.nodeId)) continue;

      // Filter by isolation mode
      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId);
        const wInv = invertAffine(worldMat);
        const local = applyAffine(wInv, [world.x, world.y]);
        if (shapeContains(n.shape, local)) {
          return { nodeId: entry.nodeId, node: n };
        }
      }
      if (n.kind === 'text' || n.kind === 'frame') {
        const bbox = nodeWorldBounds(this.doc, entry.nodeId);
        if (bbox && rectContains(bbox, [world.x, world.y])) {
          return { nodeId: entry.nodeId, node: n };
        }
      }
      if (n.kind === 'group') {
        // Groups use precise child geometry rather than AABB, avoiding
        // false positives on empty corners of the group's bounding box.
        const groupNode = n as import('@strata/scene').GroupNode;
        if (groupNode.children) {
          for (const childId of groupNode.children) {
            const child = this.doc.nodes[childId];
            if (!child || child.locked || child.visible === false) continue;
            if (child.kind === 'shape') {
              const childWorld = nodeWorldTransform(this.doc, childId);
              const childInv = invertAffine(childWorld);
              const childLocal = applyAffine(childInv, [world.x, world.y]);
              if (shapeContains((child as import('@strata/scene').ShapeNode).shape, childLocal)) {
                return { nodeId: entry.nodeId, node: n };
              }
            } else {
              const childBounds = nodeWorldBounds(this.doc, childId);
              if (childBounds && rectContains(childBounds, [world.x, world.y])) {
                return { nodeId: entry.nodeId, node: n };
              }
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Find all visible unlocked nodes at a world point, in paint order
   * (topmost last). Respects isolation mode.
   */
  findNodesAtPoint(world: { x: number; y: number }): HitResult[] {
    const candidates = queryPoint(this.spatialIndex, world.x, world.y);
    const entries = walkNodes(this.doc, activePageNodes(this.doc));
    const ordered = [...entries.values()].reverse();
    const results: HitResult[] = [];

    for (const entry of ordered) {
      const n = entry.node;
      if (n.locked || !n.visible) continue;
      if (!candidates.has(entry.nodeId)) continue;

      // Filter by isolation mode
      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId);
        const wInv = invertAffine(worldMat);
        const local = applyAffine(wInv, [world.x, world.y]);
        if (shapeContains(n.shape, local)) {
          results.push({ nodeId: entry.nodeId, node: n });
        }
      } else if (n.kind === 'text' || n.kind === 'frame') {
        const bbox = nodeWorldBounds(this.doc, entry.nodeId);
        if (bbox && rectContains(bbox, [world.x, world.y])) {
          results.push({ nodeId: entry.nodeId, node: n });
        }
      } else if (n.kind === 'group') {
        const groupNode = n as import('@strata/scene').GroupNode;
        if (groupNode.children) {
          for (const childId of groupNode.children) {
            const child = this.doc.nodes[childId];
            if (!child || child.locked || child.visible === false) continue;
            if (child.kind === 'shape') {
              const childWorld = nodeWorldTransform(this.doc, childId);
              const childInv = invertAffine(childWorld);
              const childLocal = applyAffine(childInv, [world.x, world.y]);
              if (shapeContains((child as import('@strata/scene').ShapeNode).shape, childLocal)) {
                results.push({ nodeId: entry.nodeId, node: n });
                break;
              }
            } else {
              const childBounds = nodeWorldBounds(this.doc, childId);
              if (childBounds && rectContains(childBounds, [world.x, world.y])) {
                results.push({ nodeId: entry.nodeId, node: n });
                break;
              }
            }
          }
        }
      }
    }
    return results;
  }

  /**
   * Check if a node is in the subtree rooted at `rootId`.
   */
  private isInSubtree(nodeId: NodeId, rootId: NodeId): boolean {
    if (nodeId === rootId) return true;
    const node = this.doc.nodes[rootId];
    if (!node) return false;
    if (node.kind === 'frame' || node.kind === 'group') {
      const container = node as import('@strata/scene').ContainerNode;
      if (container.children) {
        for (const childId of container.children) {
          if (this.isInSubtree(nodeId, childId)) return true;
        }
      }
    }
    return false;
  }
}
