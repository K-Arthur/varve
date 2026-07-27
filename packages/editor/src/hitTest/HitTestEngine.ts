/**
 * HitTestEngine — efficient scene hit-testing with spatial indexing.
 *
 * Provides hit-test queries for a Document, using a spatial index for
 * O(1) candidate lookup. Returns the topmost node at a point, or all nodes
 * at a point in paint order (topmost last). Respects isolation mode, locked
 * state, and visibility.
 *
 * Zoom-aware: at low zoom levels (e.g. 1%), a screen-space tolerance is
 * applied so that clicks land on visually-small objects. The tolerance is
 * SNAP_THRESHOLD_PX / zoom world units, matching the snap threshold.
 *
 * Research basis: Excalidraw two-phase hit-test (rotated-AABB reject, then
 * precise shape/path test); spatial grid for O(1) candidate filtering.
 */

import { applyAffine, invertAffine, rectContains, shapeContains } from '@strata/engine';
import type { Document, NodeId, SceneNode, ShapeNode } from '@strata/scene';
import {
  activePageNodes,
  buildParentIndexMap,
  deriveGeometryFromPaints,
  resolveNodePaints,
  walkNodes,
} from '@strata/scene';
import { getOrCreateSpatialIndex, queryPoint } from '../scene/spatialIndex';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

/** Screen-pixel snap acquire threshold — same as viewport.ts but not
 *  re-exported from @strata/shared barrel to avoid circular deps. */
const HIT_TOLERANCE_PX = 8;

const CELL_SIZE = 64;

function hitGeometry(node: ShapeNode, doc: Document): ShapeNode['shape'] {
  return node.shapeless === true
    ? deriveGeometryFromPaints(
        resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc),
      )
    : node.shape;
}

export interface HitTestOptions {
  /** Isolation/focus view: when set, only nodes in this subtree are selectable. */
  isolatedNodeId?: NodeId | null;
  /** Current zoom level — used to compute screen-space hit tolerance. */
  zoom?: number;
  /** When true, select the deepest matching child rather than topmost.
   *  Used for Ctrl+click deep selection through containers. */
  deepSelect?: boolean;
}

export interface HitResult {
  nodeId: NodeId;
  node: SceneNode;
}

export class HitTestEngine {
  private readonly doc: Document;
  private readonly options: HitTestOptions;
  private readonly toleranceWorld: number;
  private readonly parentIndex: Map<NodeId, NodeId>;
  private spatialIndex: ReturnType<typeof getOrCreateSpatialIndex>;

  constructor(doc: Document, options: HitTestOptions = {}) {
    this.doc = doc;
    this.options = options;
    const zoom = options.zoom ?? 1;
    this.toleranceWorld = HIT_TOLERANCE_PX / Math.max(0.001, zoom);
    this.parentIndex = buildParentIndexMap(doc);
    this.spatialIndex = getOrCreateSpatialIndex(doc, null);
  }

  /**
   * Topmost node (highest index) whose geometry contains `world`.
   * Returns null if no node is hit.
   * When `deepSelect` is true, returns the deepest matching non-container child
   * instead of the topmost parent.
   */
  hitTest(world: { x: number; y: number }): HitResult | null {
    const candidates = this.queryWithTolerance(world.x, world.y);

    // Walk the active page's nodes in paint order (DFS) and reverse so
    // that children are tested before parents and later siblings before
    // earlier ones — the correct topmost-first hit order.
    const entries = walkNodes(this.doc, activePageNodes(this.doc));
    const ordered = [...entries.values()].reverse();
    let bestHit: HitResult | null = null;
    let bestDepth = -1;

    for (const entry of ordered) {
      const n = entry.node;
      if (n.locked || !n.visible) continue;
      // Only test nodes that overlap the query point's tolerance cell(s).
      if (!candidates.has(entry.nodeId)) continue;
      if (!this.isPointVisibleThroughClipMasks(entry.nodeId, world)) continue;

      // Filter by isolation mode
      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      let isHit = false;

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId);
        const wInv = invertAffine(worldMat);
        const local = applyAffine(wInv, [world.x, world.y]);
        const shape = hitGeometry(n, this.doc);
        if (shapeContains(shape, local)) {
          isHit = true;
        }
        // Zoom tolerance: for visually-small objects, test whether the
        // world point is within `toleranceWorld` of the shape's world AABB.
        if (!isHit && this.toleranceWorld > 0) {
          const bbox = nodeWorldBounds(this.doc, entry.nodeId);
          if (bbox) {
            const expanded = {
              x: bbox.x - this.toleranceWorld,
              y: bbox.y - this.toleranceWorld,
              w: bbox.w + 2 * this.toleranceWorld,
              h: bbox.h + 2 * this.toleranceWorld,
            };
            if (rectContains(expanded, [world.x, world.y])) {
              isHit = true;
            }
          }
        }
      }
      if (n.kind === 'text' || n.kind === 'frame') {
        const bbox = nodeWorldBounds(this.doc, entry.nodeId);
        if (bbox) {
          // Always apply tolerance for text/frame (AABB-only test).
          const expanded = {
            x: bbox.x - this.toleranceWorld,
            y: bbox.y - this.toleranceWorld,
            w: bbox.w + 2 * this.toleranceWorld,
            h: bbox.h + 2 * this.toleranceWorld,
          };
          if (rectContains(expanded, [world.x, world.y])) {
            isHit = true;
          }
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
              const childShape = hitGeometry(child, this.doc);
              if (shapeContains(childShape, childLocal)) {
                isHit = true;
                break;
              }
              // Zoom tolerance for group children
              if (!isHit && this.toleranceWorld > 0) {
                const childBounds = nodeWorldBounds(this.doc, childId);
                if (childBounds) {
                  const expanded = {
                    x: childBounds.x - this.toleranceWorld,
                    y: childBounds.y - this.toleranceWorld,
                    w: childBounds.w + 2 * this.toleranceWorld,
                    h: childBounds.h + 2 * this.toleranceWorld,
                  };
                  if (rectContains(expanded, [world.x, world.y])) {
                    isHit = true;
                    break;
                  }
                }
              }
            } else {
              const childBounds = nodeWorldBounds(this.doc, childId);
              if (childBounds) {
                const expanded = {
                  x: childBounds.x - this.toleranceWorld,
                  y: childBounds.y - this.toleranceWorld,
                  w: childBounds.w + 2 * this.toleranceWorld,
                  h: childBounds.h + 2 * this.toleranceWorld,
                };
                if (rectContains(expanded, [world.x, world.y])) {
                  isHit = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (isHit) {
        if (this.options.deepSelect) {
          // In deep-select mode, prefer non-container children over containers.
          // Track depth to find the deepest match.
          if (n.kind !== 'frame' && n.kind !== 'group') {
            // Prefer non-container nodes; deeper is better
            const depth = entry.depth;
            if (!bestHit || depth > bestDepth) {
              bestHit = { nodeId: entry.nodeId, node: n };
              bestDepth = depth;
            }
          } else if (!bestHit) {
            // Only use a container if no non-container child was found
            bestHit = { nodeId: entry.nodeId, node: n };
            bestDepth = entry.depth;
          }
        } else {
          // Normal mode: return the topmost hit immediately
          return { nodeId: entry.nodeId, node: n };
        }
      }
    }
    return bestHit;
  }

  /**
   * Find all visible unlocked nodes at a world point, in paint order
   * (topmost last). Respects isolation mode.
   */
  findNodesAtPoint(world: { x: number; y: number }): HitResult[] {
    const candidates = this.queryWithTolerance(world.x, world.y);
    const entries = walkNodes(this.doc, activePageNodes(this.doc));
    const ordered = [...entries.values()].reverse();
    const results: HitResult[] = [];

    for (const entry of ordered) {
      const n = entry.node;
      if (n.locked || !n.visible) continue;
      if (!candidates.has(entry.nodeId)) continue;
      if (!this.isPointVisibleThroughClipMasks(entry.nodeId, world)) continue;

      // Filter by isolation mode
      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId);
        const wInv = invertAffine(worldMat);
        const local = applyAffine(wInv, [world.x, world.y]);
        const shape = hitGeometry(n, this.doc);
        if (shapeContains(shape, local)) {
          results.push({ nodeId: entry.nodeId, node: n });
          continue;
        }
        // Zoom tolerance fallback
        if (this.toleranceWorld > 0) {
          const bbox = nodeWorldBounds(this.doc, entry.nodeId);
          if (bbox) {
            const expanded = {
              x: bbox.x - this.toleranceWorld,
              y: bbox.y - this.toleranceWorld,
              w: bbox.w + 2 * this.toleranceWorld,
              h: bbox.h + 2 * this.toleranceWorld,
            };
            if (rectContains(expanded, [world.x, world.y])) {
              results.push({ nodeId: entry.nodeId, node: n });
            }
          }
        }
      } else if (n.kind === 'text' || n.kind === 'frame') {
        const bbox = nodeWorldBounds(this.doc, entry.nodeId);
        if (bbox) {
          const expanded = {
            x: bbox.x - this.toleranceWorld,
            y: bbox.y - this.toleranceWorld,
            w: bbox.w + 2 * this.toleranceWorld,
            h: bbox.h + 2 * this.toleranceWorld,
          };
          if (rectContains(expanded, [world.x, world.y])) {
            results.push({ nodeId: entry.nodeId, node: n });
          }
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
              const childShape = hitGeometry(child, this.doc);
              if (shapeContains(childShape, childLocal)) {
                results.push({ nodeId: entry.nodeId, node: n });
                break;
              }
              if (this.toleranceWorld > 0) {
                const childBounds = nodeWorldBounds(this.doc, childId);
                if (childBounds) {
                  const expanded = {
                    x: childBounds.x - this.toleranceWorld,
                    y: childBounds.y - this.toleranceWorld,
                    w: childBounds.w + 2 * this.toleranceWorld,
                    h: childBounds.h + 2 * this.toleranceWorld,
                  };
                  if (rectContains(expanded, [world.x, world.y])) {
                    results.push({ nodeId: entry.nodeId, node: n });
                    break;
                  }
                }
              }
            } else {
              const childBounds = nodeWorldBounds(this.doc, childId);
              if (childBounds) {
                const expanded = {
                  x: childBounds.x - this.toleranceWorld,
                  y: childBounds.y - this.toleranceWorld,
                  w: childBounds.w + 2 * this.toleranceWorld,
                  h: childBounds.h + 2 * this.toleranceWorld,
                };
                if (rectContains(expanded, [world.x, world.y])) {
                  results.push({ nodeId: entry.nodeId, node: n });
                  break;
                }
              }
            }
          }
        }
      }
    }
    return results;
  }

  /**
   * Query the spatial index with a zoom-aware tolerance radius.
   * At low zoom the tolerance in world space is large, so we query
   * multiple nearby cells.
   */
  private queryWithTolerance(x: number, y: number): Set<NodeId> {
    const radiusCells = Math.ceil(this.toleranceWorld / CELL_SIZE);
    if (radiusCells <= 0) {
      return queryPoint(this.spatialIndex, x, y);
    }
    const result = new Set<NodeId>();
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const ids = this.spatialIndex.grid.get(key);
        if (ids) {
          for (const id of ids) result.add(id);
        }
      }
    }
    return result;
  }

  /**
   * A descendant cannot be selected through pixels removed by an active
   * vector clipping ancestor. This deliberately uses the exact same source
   * transform and fill geometry as Canvas replay, rather than the clipped
   * group's (potentially much larger) child bounds.
   */
  private isPointVisibleThroughClipMasks(nodeId: NodeId, world: { x: number; y: number }): boolean {
    let currentId: NodeId | undefined = nodeId;
    const visited = new Set<NodeId>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const container = this.doc.nodes[currentId];
      const mask = container?.mask;
      if (mask?.visible !== false && mask?.type === 'clip') {
        const sourceId = mask.sourceNodeId;
        const source = sourceId ? this.doc.nodes[sourceId] : undefined;
        const maskTransform =
          mask.linked === false && mask.transform
            ? mask.transform
            : sourceId
              ? nodeWorldTransform(this.doc, sourceId, this.parentIndex)
              : mask.transform;

        if (maskTransform) {
          const local = applyAffine(invertAffine(maskTransform), [world.x, world.y]);
          let inside = false;
          if (mask.vectorMask?.closed && mask.vectorMask.points.length >= 3) {
            inside = shapeContains(
              {
                kind: 'path',
                points: mask.vectorMask.points,
                closed: true,
                tolerance: 0,
                fillRule: mask.vectorMask.fillRule,
              },
              local,
            );
          } else if (source?.kind === 'shape') {
            const shape = hitGeometry(source, this.doc);
            inside = shapeContains(shape, local);
          } else if (source?.kind === 'frame') {
            inside = rectContains({ x: 0, y: 0, w: source.w, h: source.h }, local);
          }
          if (inside === (mask.inverted === true)) return false;
        }
      }
      currentId = this.parentIndex.get(currentId);
    }
    return true;
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
