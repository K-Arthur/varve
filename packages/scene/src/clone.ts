/**
 * Deep-clone a subtree rooted at a given node.
 *
 * All descendants get new IDs. Parent-child relationships, slots, masks,
 * and other node-to-node references are remapped.
 */

import { nextNodeId } from './node-id';
import { tableContentNodeIds } from './table';
import { remapTableModelIds } from './tableOps';
import type {
  ContainerNode,
  FrameNode,
  NodeId,
  RasterLayerNode,
  SceneNode,
  TableNode,
} from './types';
import { isContainer } from './types';

export interface CloneResult {
  nodes: Record<NodeId, SceneNode>;
  idMap: Map<NodeId, NodeId>;
  rootId: NodeId;
  /** The next available ID counter after cloning (caller should sync this). */
  nextId: number;
}

export interface CloneOptions {
  /**
   * When true (cross-document paste), mask/scope references that point
   * outside the cloned subtree are dropped instead of being kept verbatim:
   * a pasted clipped item must not reference a matte from the source
   * document, and a pasted adjustment must not target foreign nodes.
   * When false (duplicate within the same document), unmapped references
   * remain valid and are preserved.
   */
  dropForeignReferences?: boolean;
}

/**
 * Remap an explicit-targets scope's target list through the clone idMap.
 * When `dropForeignReferences` is set, targets outside the subtree are
 * dropped; otherwise they are preserved (valid in the same document).
 */
function remapTargetList(
  ids: readonly NodeId[],
  idMap: Map<NodeId, NodeId>,
  dropForeign: boolean,
): NodeId[] {
  const remapped: NodeId[] = [];
  for (const id of ids) {
    const mapped = idMap.get(id);
    if (mapped) {
      remapped.push(mapped);
    } else if (!dropForeign) {
      remapped.push(id);
    }
  }
  return remapped;
}

/**
 * Remap an adjustment's `scope` through the clone idMap.
 *
 * - `image-local`: the single target node is remapped; when it lies outside
 *   the subtree and `dropForeign` is set, the scope is removed (the pasted
 *   adjustment falls back to legacy sibling-below resolution).
 * - `explicit-targets`: targets are remapped individually; an empty result
 *   under `dropForeign` removes the scope.
 * - `container-descendant`: the container is remapped; a foreign container
 *   under `dropForeign` removes the scope.
 * - `document` is invariant.
 */
function remapScope(
  scope: import('./types').AdjustmentScope,
  idMap: Map<NodeId, NodeId>,
  dropForeign: boolean,
): import('./types').AdjustmentScope | undefined {
  if (scope.mode === 'image-local') {
    const mapped = idMap.get(scope.targetNodeId);
    if (mapped) return { ...scope, targetNodeId: mapped };
    return dropForeign ? undefined : scope;
  }
  if (scope.mode === 'explicit-targets') {
    const remapped = remapTargetList(scope.targetNodeIds, idMap, dropForeign);
    if (remapped.length === 0 && dropForeign) return undefined;
    return { ...scope, targetNodeIds: remapped };
  }
  if (scope.mode === 'container-descendant') {
    const mapped = idMap.get(scope.containerId);
    if (mapped) return { ...scope, containerId: mapped };
    return dropForeign ? undefined : scope;
  }
  return scope;
}

/**
 * Deep-clone a subtree rooted at `rootId`.
 *
 * All descendants get new IDs via nextNodeId.
 * Returns the cloned nodes map, a mapping of old→new IDs, and the new root ID.
 *
 * The caller is responsible for adding the cloned nodes to a document
 * and updating any external references.
 */
export function deepCloneSubtree(
  nodes: Record<NodeId, SceneNode>,
  nextIdCounter: number,
  rootId: NodeId,
  options?: CloneOptions,
): CloneResult {
  const dropForeign = options?.dropForeignReferences === true;
  const idMap = new Map<NodeId, NodeId>();
  const newNodes: Record<NodeId, SceneNode> = {};
  let currentDoc = { nextId: nextIdCounter };

  function walkNode(nid: NodeId): NodeId | null {
    const node = nodes[nid];
    if (!node) return null;
    if (idMap.has(nid)) return idMap.get(nid)!;

    const { id: newId, doc: d2 } = nextNodeId(currentDoc);
    currentDoc = d2;
    idMap.set(nid, newId);

    let cloned: SceneNode;

    if (isContainer(node)) {
      const container = node as ContainerNode;
      const clonedChildren = container.children
        .map((c) => walkNode(c))
        .filter((c): c is NodeId => c !== null);

      // Clone the container with remapped children
      cloned = { ...node, id: newId, children: clonedChildren } as SceneNode;

      // Remap slots on frames
      if ('slots' in container && container.slots) {
        const remappedSlots: Record<string, NodeId> = {};
        for (const [slotId, childId] of Object.entries(container.slots)) {
          const newChildId = idMap.get(childId);
          if (newChildId) {
            remappedSlots[slotId] = newChildId;
          }
        }
        (cloned as FrameNode).slots =
          Object.keys(remappedSlots).length > 0 ? remappedSlots : undefined;
      }
    } else if (node.kind === 'adjustment') {
      // Adjustment nodes are not ContainerNodes; the container branch above
      // does not visit them. Their spatial mask and scope carry node IDs
      // remapped in the post-pass below.
      cloned = { ...node, id: newId } as SceneNode;
    } else if (node.kind === 'rasterLayer') {
      const rl = node as RasterLayerNode;
      const newTiles = new Map<string, import('./types').RasterTile>();
      for (const [key, tile] of rl.tiles) {
        newTiles.set(key, {
          pixels: new Uint8ClampedArray(tile.pixels),
          version: tile.version,
        });
      }
      cloned = { ...rl, id: newId, tiles: newTiles } as SceneNode;
    } else if (node.kind === 'table') {
      // Tables carry their own stable row/column/cell ids; remap them so a
      // pasted table never collides with the source document's identities.
      // Rich scene-content cells reference nodes by id — those referenced
      // nodes are cloned too (recursively) and the cell references remapped.
      const tableNode = node as TableNode;
      const remapped = remapTableModelIds(tableNode.table, currentDoc.nextId);
      currentDoc = { ...currentDoc, nextId: remapped.nextId };
      let tableModel = remapped.model;
      // Remap scene-content references: each referenced node is walked
      // (cloned into newNodes) and the cell content points at the clone.
      const contentIds = tableContentNodeIds(tableModel);
      if (contentIds.length > 0) {
        const remap = new Map<string, string>();
        for (const contentId of contentIds) {
          if (idMap.has(contentId)) {
            remap.set(contentId, idMap.get(contentId)!);
          } else {
            const clonedId = walkNode(contentId);
            if (clonedId) remap.set(contentId, clonedId);
          }
        }
        if (remap.size > 0) {
          const cells = { ...tableModel.cells };
          let changed = false;
          for (const [cellId, cell] of Object.entries(cells)) {
            if (cell.content.kind === 'scene') {
              const mapped = remap.get(cell.content.nodeId);
              if (mapped) {
                cells[cellId] = { ...cell, content: { kind: 'scene', nodeId: mapped } };
                changed = true;
              }
            }
          }
          if (changed) tableModel = { ...tableModel, cells };
        }
      }
      cloned = { ...tableNode, id: newId, table: tableModel } as SceneNode;
    } else {
      // Leaf node: simple id replacement
      cloned = { ...node, id: newId } as SceneNode;
    }

    newNodes[newId] = cloned;
    return newId;
  }

  const newRootId = walkNode(rootId);

  if (!newRootId) {
    return { nodes: {}, idMap, rootId, nextId: currentDoc.nextId };
  }

  // Post-pass: remap node-to-node references once the whole subtree has been
  // walked and the idMap is complete. Mask sources and scope targets may live
  // anywhere in the subtree (an adjustment's spatial mask may reference any
  // node, and scopes may target arbitrary nodes), so remapping during the
  // walk could observe an incomplete idMap.
  //
  // A mask whose source lies outside the subtree is only legal for
  // adjustment containers: under `dropForeign` (cross-document paste) such a
  // mask must not leak a source-document ID — the reference is dropped, and
  // when the mask would lose its only geometry source the mask is removed
  // entirely (the pasted item is released from clipping). Without
  // `dropForeign` (in-document duplicate) unmapped references stay valid.
  const remapMaskReference = (clonedNode: SceneNode, srcId: NodeId): SceneNode => {
    const mask = (clonedNode as { mask?: import('./types').Mask }).mask;
    if (!mask) return clonedNode;
    const mapped = idMap.get(srcId);
    if (mapped) {
      return { ...clonedNode, mask: { ...mask, sourceNodeId: mapped } } as SceneNode;
    }
    if (!dropForeign) return clonedNode;
    if (mask.vectorMask && mask.vectorMask.points.length > 0 && mask.rasterMask === undefined) {
      // Keep the vector geometry; only the visual source is foreign.
      return { ...clonedNode, mask: { ...mask, sourceNodeId: undefined } } as SceneNode;
    }
    return { ...clonedNode, mask: undefined } as SceneNode;
  };

  // Reverse map (newId → originalId) so the reference-remap post-pass below
  // is O(n) instead of scanning idMap per node (O(n²) on large subtrees).
  const newToOriginal = new Map<NodeId, NodeId>();
  for (const [originalId, newId] of idMap) newToOriginal.set(newId, originalId);

  for (const [newId, node] of Object.entries(newNodes)) {
    const originalId = newToOriginal.get(newId as NodeId);
    if (!originalId) continue;
    const original = nodes[originalId];
    if (!original) continue;
    const originalMask = (original as { mask?: { sourceNodeId?: NodeId } }).mask;
    if (originalMask?.sourceNodeId) {
      newNodes[newId] = remapMaskReference(node, originalMask.sourceNodeId);
    }
    const originalMatteSource = original.mask?.matteSource;
    if (originalMatteSource?.kind === 'scene-node') {
      const mappedSource = idMap.get(originalMatteSource.nodeId);
      if (mappedSource) {
        newNodes[newId] = {
          ...newNodes[newId],
          mask: {
            ...newNodes[newId]!.mask!,
            matteSource: { ...originalMatteSource, nodeId: mappedSource },
          },
        } as SceneNode;
      } else if (dropForeign) {
        const { mask: _mask, ...withoutMask } = newNodes[newId]!;
        newNodes[newId] = withoutMask as SceneNode;
      }
    }
    if (original && 'effects' in original && Array.isArray(original.effects)) {
      const nextEffects = original.effects.map((effect) => {
        const source = effect.mask?.source;
        if (source?.kind !== 'scene-node') return effect;
        const mappedSource = idMap.get(source.nodeId);
        if (mappedSource)
          return {
            ...effect,
            mask: { ...effect.mask!, source: { ...source, nodeId: mappedSource } },
          };
        if (dropForeign) {
          const { mask: _mask, ...withoutMask } = effect;
          return withoutMask;
        }
        return effect;
      });
      newNodes[newId] = { ...newNodes[newId], effects: nextEffects } as SceneNode;
    }
    if (original.kind === 'adjustment') {
      const originalScope = (original as { scope?: import('./types').AdjustmentScope }).scope;
      if (originalScope) {
        const remapped = remapScope(originalScope, idMap, dropForeign);
        (newNodes[newId] as import('./types').AdjustmentNode).scope = remapped;
      }
    }
  }

  return { nodes: newNodes, idMap, rootId: newRootId, nextId: currentDoc.nextId };
}
