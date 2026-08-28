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
 *
 * COMPLEXITY: 32 (well under 50 ceiling)
 */

import {
  applyAffine,
  hasLiveWarps,
  invertAffine,
  rectContains,
  shapeContains,
  warpShapeToPath,
} from '@varve/engine';
import type { Document, NodeId, SceneNode, ShapeNode } from '@varve/scene';
import {
  buildParentIndexMap,
  deriveGeometryFromPaints,
  isLiveBooleanNode,
  isWarpedContainer,
  multipageRootNodes,
  nodeLocalBoundsSource,
  resolveNodePaints,
  walkNodes,
  warpsOnNode,
} from '@varve/scene';
import {
  cubicBezierClosestPoint,
  managedColorToRgba,
  pathPointToBezier,
  pointToSegmentDistSq,
  tryInvertAffine,
} from '@varve/shared';
import { resolvePlacedLiveBoolean } from '../scene/liveBooleanGeometry';
import { getOrCreateSpatialIndex, queryPoint } from '../scene/spatialIndex';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';
import { evaluateWarpedContainerItems } from '../warp/warpContainerRender';
import {
  HIT_TEST_POLICIES,
  type HitTestPolicy,
  mergePolicy,
  screenToWorldTolerance,
} from './HitTestPolicy';

const CELL_SIZE = 64;

function hitGeometry(node: ShapeNode, doc: Document): ShapeNode['shape'] {
  // V2.16+: live warps evaluate the visible (warped) geometry for hit
  // testing — selection follows what the user sees, not the source.
  const warps = warpsOnNode(node);
  if (hasLiveWarps(warps)) {
    const sourceBounds = nodeLocalBoundsSource(node, doc);
    if (sourceBounds) {
      const evaluated = warpShapeToPath(node.shape, warps, sourceBounds, {
        quality: { profile: 'draft' },
      });
      return evaluated.shape;
    }
  }
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
  private readonly strokeToleranceWorld: number;
  private readonly policy: HitTestPolicy;
  /**
   * O(1) parent lookup, built once per instance. Every nodeWorldTransform/
   * nodeWorldBounds call below MUST pass this — omitting it silently falls
   * back to an O(n) linear scan per call (getParent), which made hitTest()/
   * findNodesAtPoint() O(candidates * n) instead of O(candidates). This was
   * built but left unused in several call sites until a 2026-07-27 audit
   * found the O(n^2) pattern in a document-open hang and swept the codebase.
   */
  private readonly parentIndex: Map<NodeId, NodeId>;
  private spatialIndex: ReturnType<typeof getOrCreateSpatialIndex>;

  constructor(doc: Document, options: HitTestOptions = {}, policy?: HitTestPolicy) {
    this.doc = doc;
    this.options = options;
    const zoom = options.zoom ?? 1;
    this.policy = policy ?? HIT_TEST_POLICIES.click;
    this.toleranceWorld = screenToWorldTolerance(this.policy.tolerancePx, zoom);
    this.strokeToleranceWorld = screenToWorldTolerance(this.policy.strokeTolerancePx, zoom);
    this.parentIndex = buildParentIndexMap(doc);
    this.spatialIndex = getOrCreateSpatialIndex(doc, null);
  }

  /** Create an engine with a specific named policy. */
  static withPolicy(
    doc: Document,
    policyName: keyof typeof HIT_TEST_POLICIES,
    options?: HitTestOptions,
  ): HitTestEngine {
    return new HitTestEngine(doc, options, HIT_TEST_POLICIES[policyName]);
  }

  /** Create an engine with a merged policy override. */
  static withMergedPolicy(
    doc: Document,
    base: keyof typeof HIT_TEST_POLICIES,
    overrides: Partial<HitTestPolicy>,
    options?: HitTestOptions,
  ): HitTestEngine {
    return new HitTestEngine(doc, options, mergePolicy(HIT_TEST_POLICIES[base], overrides));
  }

  /**
   * Topmost node (highest index) whose geometry contains `world`.
   * Returns null if no node is hit.
   * When `deepSelect` is true, returns the deepest matching non-container child
   * instead of the topmost parent.
   */
  hitTest(world: { x: number; y: number }): HitResult | null {
    const candidates = this.queryWithTolerance(world.x, world.y);

    const entries = walkNodes(this.doc, multipageRootNodes(this.doc));
    const ordered = [...entries.values()].reverse();
    let bestHit: HitResult | null = null;
    let bestDepth = -1;

    for (const entry of ordered) {
      const n = entry.node;
      if (!this.policy.includeLocked && n.locked) continue;
      if (!this.policy.includeHidden && !n.visible) continue;
      if (!candidates.has(entry.nodeId)) continue;
      if (this.isLiveBooleanOperand(entry.nodeId)) continue;
      if (this.policy.respectClips && !this.isPointVisibleThroughClipMasks(entry.nodeId, world))
        continue;

      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      let isHit = false;

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId, this.parentIndex);
        const wInv = invertAffine(worldMat);
        const local = [...applyAffine(wInv, [world.x, world.y])] as [number, number];
        const shape = hitGeometry(n, this.doc);

        if (n.shape?.kind === 'path' && this.strokeToleranceWorld > 0) {
          if (isPointNearPath(local, entry.nodeId, this.doc, this.strokeToleranceWorld)) {
            isHit = true;
          }
        }

        if (!isHit && shapeContains(shape, local)) {
          isHit = true;
        }

        if (!isHit && this.toleranceWorld > 0) {
          const bbox = nodeWorldBounds(this.doc, entry.nodeId, this.parentIndex);
          if (bbox) {
            const expanded = {
              x: bbox.x - this.toleranceWorld,
              y: bbox.y - this.toleranceWorld,
              w: bbox.w + 2 * this.toleranceWorld,
              h: bbox.h + 2 * this.toleranceWorld,
            };
            if (rectContains(expanded, [world.x, world.y])) {
              if (!this.policy.includeTransparentFill && isTransparentFill(n)) {
                continue;
              }
              isHit = true;
            }
          }
        }
      }

      if (isLiveBooleanNode(n)) {
        isHit = this.hitTestLiveBoolean(entry.nodeId, world);
      } else if (n.kind === 'group') {
        // V2.16+: warped containers hit-test against their evaluated items.
        if (isWarpedContainer(n)) {
          const evaluated = evaluateWarpedContainerItems(this.doc, entry.nodeId, {
            quality: { profile: 'draft' },
          });
          for (const { item } of evaluated.items) {
            const prim = item.primitive;
            if (prim?.kind !== 'path') continue;
            const wInv = invertAffine([
              ...item.transform,
            ] as unknown as import('@varve/shared').Affine);
            const local = [...applyAffine(wInv, [world.x, world.y])] as [number, number];
            if (shapeContains(prim, local)) {
              isHit = true;
              break;
            }
          }
        }
      }

      if (n.kind === 'text' || n.kind === 'frame' || n.kind === 'table') {
        if (!this.policy.includeContainers && n.kind === 'frame') {
          continue;
        }
        const bbox = nodeWorldBounds(this.doc, entry.nodeId, this.parentIndex);
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

      if (n.kind === 'group' && !isLiveBooleanNode(n)) {
        if (!this.policy.includeContainers) {
          continue;
        }
        const groupNode = n as import('@varve/scene').GroupNode;
        if (groupNode.children) {
          for (const childId of groupNode.children) {
            const child = this.doc.nodes[childId];
            if (
              !child ||
              (!this.policy.includeLocked && child.locked) ||
              (!this.policy.includeHidden && child.visible === false)
            )
              continue;
            if (this.hitTestSingleChild(childId, child, world)) {
              isHit = true;
              break;
            }
          }
        }
      }

      if (isHit) {
        if (this.options.deepSelect || this.policy.preferLeaves) {
          if (n.kind !== 'frame' && n.kind !== 'group') {
            const depth = entry.depth;
            if (!bestHit || depth > bestDepth) {
              bestHit = { nodeId: entry.nodeId, node: n };
              bestDepth = depth;
            }
          } else if (!bestHit) {
            bestHit = { nodeId: entry.nodeId, node: n };
            bestDepth = entry.depth;
          }
        } else {
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
  findNodesAtPoint(world: { x: number; y: number }, policy?: HitTestPolicy): HitResult[] {
    const activePolicy = policy ?? this.policy;
    const candidates = this.queryWithTolerance(world.x, world.y);
    const entries = walkNodes(this.doc, multipageRootNodes(this.doc));
    const ordered = [...entries.values()].reverse();
    const results: HitResult[] = [];
    const maxCandidates = activePolicy.maxCandidates;

    for (const entry of ordered) {
      if (maxCandidates > 0 && results.length >= maxCandidates) break;

      const n = entry.node;
      if (!activePolicy.includeLocked && n.locked) continue;
      if (!activePolicy.includeHidden && !n.visible) continue;
      if (!candidates.has(entry.nodeId)) continue;
      if (this.isLiveBooleanOperand(entry.nodeId)) continue;
      if (activePolicy.respectClips && !this.isPointVisibleThroughClipMasks(entry.nodeId, world))
        continue;

      if (this.options.isolatedNodeId !== undefined && this.options.isolatedNodeId !== null) {
        const isInIsolatedSubtree = this.isInSubtree(entry.nodeId, this.options.isolatedNodeId);
        if (!isInIsolatedSubtree) continue;
      }

      const toleranceWorld = screenToWorldTolerance(
        activePolicy.tolerancePx,
        this.options.zoom ?? 1,
      );
      const strokeToleranceWorld = screenToWorldTolerance(
        activePolicy.strokeTolerancePx,
        this.options.zoom ?? 1,
      );

      let isHit = false;

      if (n.kind === 'shape') {
        const worldMat = nodeWorldTransform(this.doc, entry.nodeId, this.parentIndex);
        const wInv = invertAffine(worldMat);
        const local = [...applyAffine(wInv, [world.x, world.y])] as [number, number];
        const shape = hitGeometry(n, this.doc);

        if (n.shape?.kind === 'path' && strokeToleranceWorld > 0) {
          if (isPointNearPath(local, entry.nodeId, this.doc, strokeToleranceWorld)) {
            isHit = true;
          }
        }

        if (!isHit && shapeContains(shape, local)) {
          if (!activePolicy.includeTransparentFill && isTransparentFill(n)) {
            continue;
          }
          isHit = true;
        }

        if (!isHit && toleranceWorld > 0) {
          const bbox = nodeWorldBounds(this.doc, entry.nodeId, this.parentIndex);
          if (bbox) {
            const expanded = {
              x: bbox.x - toleranceWorld,
              y: bbox.y - toleranceWorld,
              w: bbox.w + 2 * toleranceWorld,
              h: bbox.h + 2 * toleranceWorld,
            };
            if (rectContains(expanded, [world.x, world.y])) {
              if (!activePolicy.includeTransparentFill && isTransparentFill(n)) {
                continue;
              }
              isHit = true;
            }
          }
        }
      } else if (n.kind === 'text' || n.kind === 'frame' || n.kind === 'table') {
        const bbox = nodeWorldBounds(this.doc, entry.nodeId, this.parentIndex);
        if (bbox) {
          const expanded = {
            x: bbox.x - toleranceWorld,
            y: bbox.y - toleranceWorld,
            w: bbox.w + 2 * toleranceWorld,
            h: bbox.h + 2 * toleranceWorld,
          };
          if (rectContains(expanded, [world.x, world.y])) {
            isHit = true;
          }
        }
      } else if (isLiveBooleanNode(n)) {
        if (activePolicy.includeContainers && this.hitTestLiveBoolean(entry.nodeId, world)) {
          results.push({ nodeId: entry.nodeId, node: n });
        }
        continue;
      } else if (n.kind === 'group') {
        if (activePolicy.includeContainers) {
          const groupNode = n as import('@varve/scene').GroupNode;
          if (groupNode.children) {
            for (const childId of groupNode.children) {
              const child = this.doc.nodes[childId];
              if (
                !child ||
                (!activePolicy.includeLocked && child.locked) ||
                (!activePolicy.includeHidden && child.visible === false)
              )
                continue;
              if (this.hitTestSingleChild(childId, child, world)) {
                results.push({ nodeId: entry.nodeId, node: n });
                break;
              }
            }
          }
        }
        continue;
      }

      if (isHit) {
        results.push({ nodeId: entry.nodeId, node: n });
      }
    }
    return results;
  }

  private hitTestSingleChild(
    childId: NodeId,
    child: SceneNode,
    world: { x: number; y: number },
  ): boolean {
    if (child.kind === 'shape') {
      const childWorld = nodeWorldTransform(this.doc, childId, this.parentIndex);
      const childInv = invertAffine(childWorld);
      const childLocal = applyAffine(childInv, [world.x, world.y]);
      const childShape = hitGeometry(child, this.doc);
      if (shapeContains(childShape, childLocal)) return true;

      if (this.toleranceWorld > 0) {
        const childBounds = nodeWorldBounds(this.doc, childId, this.parentIndex);
        if (childBounds) {
          const expanded = {
            x: childBounds.x - this.toleranceWorld,
            y: childBounds.y - this.toleranceWorld,
            w: childBounds.w + 2 * this.toleranceWorld,
            h: childBounds.h + 2 * this.toleranceWorld,
          };
          if (rectContains(expanded, [world.x, world.y])) return true;
        }
      }
    } else {
      const childBounds = nodeWorldBounds(this.doc, childId, this.parentIndex);
      if (childBounds) {
        const expanded = {
          x: childBounds.x - this.toleranceWorld,
          y: childBounds.y - this.toleranceWorld,
          w: childBounds.w + 2 * this.toleranceWorld,
          h: childBounds.h + 2 * this.toleranceWorld,
        };
        if (rectContains(expanded, [world.x, world.y])) return true;
      }
    }
    return false;
  }

  /** Source operands are structurally present but not independently visible. */
  private isLiveBooleanOperand(nodeId: NodeId): boolean {
    const visited = new Set<NodeId>([nodeId]);
    let parentId = this.parentIndex.get(nodeId);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = this.doc.nodes[parentId];
      if (parent && isLiveBooleanNode(parent)) return true;
      parentId = this.parentIndex.get(parentId);
    }
    return false;
  }

  private hitTestLiveBoolean(nodeId: NodeId, world: { x: number; y: number }): boolean {
    const placed = resolvePlacedLiveBoolean(
      this.doc,
      nodeId,
      nodeWorldTransform(this.doc, nodeId, this.parentIndex),
      this.parentIndex,
    );
    if (!placed) return false;
    const inverse = tryInvertAffine(placed.transform);
    if (!inverse) return false;
    const local = applyAffine(inverse, [world.x, world.y]);
    return shapeContains(placed.shape.shape, local);
  }

  private queryWithTolerance(x: number, y: number): Set<NodeId> {
    const toleranceWorld = screenToWorldTolerance(this.policy.tolerancePx, this.options.zoom ?? 1);
    const radiusCells = Math.ceil(toleranceWorld / CELL_SIZE);
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

  private isInSubtree(nodeId: NodeId, rootId: NodeId): boolean {
    if (nodeId === rootId) return true;
    const node = this.doc.nodes[rootId];
    if (!node) return false;
    if (node.kind === 'frame' || node.kind === 'group') {
      const container = node as import('@varve/scene').ContainerNode;
      if (container.children) {
        for (const childId of container.children) {
          if (this.isInSubtree(nodeId, childId)) return true;
        }
      }
    }
    return false;
  }

  /** Get the current active policy */
  getPolicy(): HitTestPolicy {
    return this.policy;
  }

  /** Create a new engine with a different policy for the same document. */
  withPolicy(policy: HitTestPolicy): HitTestEngine {
    return new HitTestEngine(this.doc, this.options, policy);
  }
}

/** Check if a world-space point is near any segment of a path node. */
function isPointNearPath(
  localPt: [number, number],
  nodeId: string,
  doc: Document,
  threshold: number,
): boolean {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !node.shape || node.shape.kind !== 'path') return false;
  const points = node.shape.points;
  if (!points || points.length < 2) return false;

  for (let i = 0; i < points.length; i++) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;

    if (from.handleOut || to.handleIn) {
      const bez = pathPointToBezier(from, to);
      const closest = cubicBezierClosestPoint(bez, { x: localPt[0], y: localPt[1] });
      if (closest.dist <= threshold * threshold) return true;
    } else {
      const distSq = pointToSegmentDistSq([from.x, from.y], [to.x, to.y], [localPt[0], localPt[1]]);
      if (distSq <= threshold * threshold) return true;
    }
  }
  return false;
}

function isTransparentFill(node: SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  if (node.fills && node.fills.length > 0) {
    return node.fills.every((f: import('@varve/scene').Fill) => {
      if (f.type === 'solid' && f.color) {
        const [, , , a] = managedColorToRgba(f.color);
        return a === 0;
      }
      return false;
    });
  }
  if (node.fill) {
    if (typeof node.fill === 'object' && !Array.isArray(node.fill)) {
      const [, , , a] = managedColorToRgba(node.fill);
      return a === 0;
    }
    const alpha = Array.isArray(node.fill) ? (node.fill[3] ?? 255) : 255;
    return alpha === 0;
  }
  return true;
}
