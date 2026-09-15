import type { Document } from './document';
import type { Effect, EffectMaskBinding, NodeId, SceneNode } from './types';
import { isContainer } from './types';

export interface CompositingDependency {
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  kind: 'node-mask' | 'effect-mask';
  effectId?: string;
}

function effectList(node: SceneNode): Effect[] {
  return 'effects' in node && Array.isArray(node.effects) ? node.effects : [];
}

function isDescendant(doc: Document, ancestorId: NodeId, candidateId: NodeId): boolean {
  const ancestor = doc.nodes[ancestorId];
  if (!ancestor || !isContainer(ancestor)) return false;
  const seen = new Set<NodeId>();
  const visit = (id: NodeId): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (id === candidateId) return true;
    const node = doc.nodes[id];
    return !!node && isContainer(node) && node.children.some(visit);
  };
  return ancestor.children.some(visit);
}

/** Build the indexed source → dependent edges used by invalidation/export. */
export function buildCompositingDependencyGraph(doc: Document): CompositingDependency[] {
  const edges: CompositingDependency[] = [];
  for (const node of Object.values(doc.nodes)) {
    const nodeMaskSource =
      node.mask?.sourceNodeId ??
      (node.mask?.matteSource?.kind === 'scene-node' ? node.mask.matteSource.nodeId : undefined);
    if (nodeMaskSource) {
      edges.push({
        sourceNodeId: nodeMaskSource,
        targetNodeId: node.id,
        kind: 'node-mask',
      });
    }
    for (const effect of effectList(node)) {
      const source = effect.mask?.source;
      if (source?.kind === 'scene-node') {
        edges.push({
          sourceNodeId: source.nodeId,
          targetNodeId: node.id,
          ...(effect.id ? { effectId: effect.id } : {}),
          kind: 'effect-mask',
        });
      }
    }
  }
  return edges;
}

export function findCompositingDependents(doc: Document, sourceNodeId: NodeId): NodeId[] {
  return [
    ...new Set(
      buildCompositingDependencyGraph(doc)
        .filter((edge) => edge.sourceNodeId === sourceNodeId)
        .map((edge) => edge.targetNodeId),
    ),
  ];
}

/** Find every transitive repaint dependent of a changed matte source. */
export function findAllCompositingDependents(
  doc: Document,
  sourceNodeIds: Iterable<NodeId>,
): NodeId[] {
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const edge of buildCompositingDependencyGraph(doc)) {
    const targets = adjacency.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, targets);
  }
  const pending = [...sourceNodeIds];
  const seenSources = new Set<NodeId>();
  const dependents = new Set<NodeId>();
  while (pending.length > 0) {
    const sourceNodeId = pending.shift()!;
    if (seenSources.has(sourceNodeId)) continue;
    seenSources.add(sourceNodeId);
    for (const dependent of adjacency.get(sourceNodeId) ?? []) {
      if (dependents.has(dependent)) continue;
      dependents.add(dependent);
      pending.push(dependent);
    }
  }
  return [...dependents];
}

/** Return explicit compositing cycles as repeated node-id paths. */
export function detectCompositingCycles(doc: Document): NodeId[][] {
  const edges = buildCompositingDependencyGraph(doc);
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, targets);
  }
  const cycles: NodeId[][] = [];
  const visited = new Set<NodeId>();
  const active = new Set<NodeId>();
  const path: NodeId[] = [];
  const visit = (id: NodeId): void => {
    if (active.has(id)) {
      const start = path.indexOf(id);
      if (start >= 0) cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    path.pop();
    active.delete(id);
  };
  for (const id of Object.keys(doc.nodes)) visit(id);
  return cycles;
}

export function validateEffectMaskBinding(
  doc: Document,
  targetNodeId: NodeId,
  binding: EffectMaskBinding,
): string | null {
  if (!binding.coordinateSpace) return 'Effect masks require a coordinate space';
  if (
    binding.density !== undefined &&
    (!Number.isFinite(binding.density) || binding.density < 0 || binding.density > 1)
  ) {
    return 'Effect mask density must be between 0 and 1';
  }
  if (binding.feather !== undefined && (!Number.isFinite(binding.feather) || binding.feather < 0)) {
    return 'Effect mask feather must be non-negative';
  }
  if (binding.source.kind === 'scene-node') {
    const source = doc.nodes[binding.source.nodeId];
    if (!source) return 'Effect mask source node is missing';
    if (binding.source.nodeId === targetNodeId) return 'Effect mask cannot reference its owner';
    // A group/frame's rendered output includes its descendants. Referencing
    // that group from one of those descendants would make the render graph
    // recursive even when the explicit mask edges are acyclic.
    if (isDescendant(doc, binding.source.nodeId, targetNodeId)) {
      return 'Effect mask source contains its owner';
    }
  } else if (binding.source.kind === 'raster-asset') {
    if (!doc.rasterMaskAssets?.[binding.source.assetId])
      return 'Effect mask raster asset is missing';
  } else if (binding.source.vectorMask.points.length === 0) {
    return 'Effect mask vector source is empty';
  }
  return null;
}

function updateEffect(
  doc: Document,
  nodeId: NodeId,
  effectId: string,
  update: (effect: Effect) => Effect,
): Document {
  const node = doc.nodes[nodeId];
  if (!node || !('effects' in node) || !Array.isArray(node.effects)) return doc;
  let changed = false;
  const effects = node.effects.map((effect) => {
    if (effect.id !== effectId) return effect;
    changed = true;
    return update(effect);
  });
  return changed
    ? { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, effects } as SceneNode } }
    : doc;
}

export function setEffectMask(
  doc: Document,
  nodeId: NodeId,
  effectId: string,
  binding: EffectMaskBinding,
): Document {
  const node = doc.nodes[nodeId];
  const effect = effectList(node ?? ({} as SceneNode)).find(
    (candidate) => candidate.id === effectId,
  );
  if (!effect || validateEffectMaskBinding(doc, nodeId, binding)) return doc;
  const candidate = updateEffect(doc, nodeId, effectId, (current) => ({
    ...current,
    mask: binding,
  }));
  return detectCompositingCycles(candidate).length > 0 ? doc : candidate;
}

export function removeEffectMask(doc: Document, nodeId: NodeId, effectId: string): Document {
  return updateEffect(doc, nodeId, effectId, (effect) => {
    const { mask: _mask, ...withoutMask } = effect;
    return withoutMask as Effect;
  });
}
