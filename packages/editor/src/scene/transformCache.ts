import type { Document, NodeId } from '@strata/scene';
import { getParent } from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';
import { identity, multiplyAffine, rotateDeg, transformRect } from '@strata/shared';
import { nodeLocalBounds } from './nodeBounds';

export interface TransformCache {
  worldTransform: Map<NodeId, Affine>;
  worldBounds: Map<NodeId, Rect>;
  dirty: Set<NodeId>;
  generation: number;
}

export function createTransformCache(): TransformCache {
  return {
    worldTransform: new Map(),
    worldBounds: new Map(),
    dirty: new Set(),
    generation: 0,
  };
}

function computeWorldTransform(doc: Document, id: NodeId): Affine {
  const node = doc.nodes[id];
  if (!node) return identity;

  const nodeTransform = node.transform as Affine;
  const rot = node.rotation ?? 0;
  const combined = rot !== 0 ? multiplyAffine(nodeTransform, rotateDeg(rot)) : nodeTransform;
  const chain: Affine[] = [combined];

  let parentId = getParent(doc, id);
  while (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) break;
    const parentRot = parent.rotation ?? 0;
    const parentTransform = parent.transform as Affine;
    chain.push(
      parentRot !== 0 ? multiplyAffine(parentTransform, rotateDeg(parentRot)) : parentTransform,
    );
    parentId = getParent(doc, parentId);
  }

  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }
  return world;
}

export function getWorldTransform(cache: TransformCache, doc: Document, nodeId: NodeId): Affine {
  const cached = cache.worldTransform.get(nodeId);
  if (cached !== undefined && !cache.dirty.has(nodeId)) {
    return cached;
  }

  const result = computeWorldTransform(doc, nodeId);
  cache.worldTransform.set(nodeId, result);
  cache.dirty.delete(nodeId);
  return result;
}

export function getWorldBounds(cache: TransformCache, doc: Document, nodeId: NodeId): Rect | null {
  const cached = cache.worldBounds.get(nodeId);
  if (cached !== undefined && !cache.dirty.has(nodeId)) {
    return cached;
  }

  const node = doc.nodes[nodeId];
  if (!node) return null;

  const local = nodeLocalBounds(node, doc);
  if (!local) return null;

  const worldMat = getWorldTransform(cache, doc, nodeId);
  const result = transformRect(worldMat, local);
  cache.worldBounds.set(nodeId, result);
  cache.dirty.delete(nodeId);
  return result;
}

export function invalidateAll(cache: TransformCache): void {
  cache.worldTransform.clear();
  cache.worldBounds.clear();
  cache.dirty.clear();
  cache.generation++;
}

export function invalidateSubtree(cache: TransformCache, doc: Document, nodeId: NodeId): void {
  cache.dirty.add(nodeId);

  const node = doc.nodes[nodeId];
  if (node && 'children' in node && node.children) {
    for (const childId of node.children) {
      invalidateSubtree(cache, doc, childId);
    }
  }

  cache.generation++;
}

export function invalidateNodes(cache: TransformCache, nodeIds: NodeId[]): void {
  for (const id of nodeIds) {
    cache.dirty.add(id);
  }
  cache.generation++;
}
