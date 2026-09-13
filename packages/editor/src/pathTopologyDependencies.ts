import type { Document, NodeId, SceneNode } from '@varve/scene';

/**
 * A topology edit changes the correspondence between path positions and
 * dependent features.  Keep this check deliberately conservative: an edit
 * that is safe for a plain path must not silently invalidate text-on-path,
 * masks, motion data, or interaction targets.
 */
export interface PathTopologyDependency {
  ownerId?: NodeId;
  reason: string;
}

const REFERENCE_KEYS = new Set([
  'nodeId',
  'nodeIds',
  'targetNodeId',
  'targetNodeIds',
  'pathNodeId',
  'pathId',
  'sourceNodeId',
  'sourcePathId',
  'targetPathId',
  'maskPathId',
  'overlayId',
  'containerId',
  'matteSource',
]);

interface ScanState {
  budget: number;
  visited: Set<object>;
}

function containsReference(value: unknown, sourceId: NodeId, state: ScanState, depth = 0): boolean {
  if (state.budget-- <= 0 || depth > 12 || value === null || typeof value !== 'object')
    return false;
  const object = value as object;
  if (state.visited.has(object)) return false;
  state.visited.add(object);
  if (Array.isArray(value)) {
    return value.some((entry) => containsReference(entry, sourceId, state, depth + 1));
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (REFERENCE_KEYS.has(key)) {
      if (child === sourceId) return true;
      if (Array.isArray(child) && child.some((entry) => entry === sourceId)) return true;
    }
    if (containsReference(child, sourceId, state, depth + 1)) return true;
  }
  return false;
}

function dependencyFromNode(node: SceneNode, sourceId: NodeId): PathTopologyDependency | null {
  if (node.id === sourceId) return null;
  if (node.kind === 'text') {
    if (node.pathTextSettings?.pathNodeId === sourceId || node.pathId === sourceId) {
      return { ownerId: node.id, reason: 'text-on-path' };
    }
  }
  if (
    node.mask?.sourceNodeId === sourceId ||
    (node.mask?.matteSource?.kind === 'scene-node' && node.mask.matteSource.nodeId === sourceId)
  ) {
    return { ownerId: node.id, reason: 'mask or clipping relationship' };
  }
  const state: ScanState = { budget: 10_000, visited: new Set() };
  if ('effects' in node && containsReference(node.effects, sourceId, state)) {
    return { ownerId: node.id, reason: 'effect reference' };
  }
  if (node.kind === 'adjustment' && containsReference(node.scope, sourceId, state)) {
    return { ownerId: node.id, reason: 'adjustment scope' };
  }
  if ('slots' in node && containsReference(node.slots, sourceId, state)) {
    return { ownerId: node.id, reason: 'component slot relationship' };
  }
  return null;
}

/** Return the first dependent feature that requires an explicit policy. */
export function findPathTopologyDependency(
  document: Document,
  sourceId: NodeId,
): PathTopologyDependency | null {
  if (document.interactions?.[sourceId]?.length) {
    return { reason: 'interaction target' };
  }
  for (const node of Object.values(document.nodes ?? {})) {
    const dependency = dependencyFromNode(node, sourceId);
    if (dependency) return dependency;
  }
  if (containsReference(document.timelines, sourceId, { budget: 25_000, visited: new Set() })) {
    return { reason: 'timeline or motion-path data' };
  }
  if (
    containsReference(document.motionExtensions, sourceId, { budget: 25_000, visited: new Set() })
  ) {
    return { reason: 'motion extension data' };
  }
  if (containsReference(document.interactions, sourceId, { budget: 25_000, visited: new Set() })) {
    return { reason: 'interaction data' };
  }
  for (const component of Object.values(document.components ?? {})) {
    if (component.masterRootId === sourceId) return { reason: 'component master relationship' };
  }
  return null;
}

export function pathTopologyBlockMessage(dependency: PathTopologyDependency): string {
  const owner = dependency.ownerId ? ` (${dependency.ownerId})` : '';
  return `Topology editing is unavailable while this path has a ${dependency.reason}${owner}. Detach or convert the dependent feature first.`;
}
