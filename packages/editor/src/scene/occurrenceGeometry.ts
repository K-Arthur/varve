/**
 * Bounded world-geometry snapshots shared by canvas labels, accessibility,
 * and the minimap. Transform-only edits update affected occurrence branches;
 * structural, font, or surface changes rebuild the snapshot.
 */

import {
  classifyNodeChanges,
  type Document,
  documentsDifferOnlyInTransforms,
  isLiveBooleanNode,
  type NodeId,
  type ResolvedEditorSceneScope,
} from '@varve/scene';
import type { Rect } from '@varve/shared';
import { committedParentIndex } from './parentIndexCache';
import { nodeWorldBounds } from './world';

type BoundsResolver = (doc: Document, id: NodeId, parentIndex?: Map<NodeId, NodeId>) => Rect | null;

export interface OccurrenceGeometryOptions {
  /** Font/placement/dependency revision. A change makes incremental reuse unsafe. */
  revision?: string | number;
  /** Test seam; application callers use the canonical placed-world bounds resolver. */
  boundsForNode?: BoundsResolver;
}

export interface OccurrenceGeometrySnapshot {
  document: Document;
  scope: ResolvedEditorSceneScope;
  boundsByInstanceId: ReadonlyMap<string, Rect | null>;
  recalculatedOccurrenceCount: number;
  incremental: boolean;
}

interface ScopeTopology {
  byNodeId: Map<NodeId, string[]>;
  byInstanceId: Map<string, ResolvedEditorSceneScope['occurrences'][number]>;
  parentByInstance: Map<string, string | null>;
  childrenByInstance: Map<string, string[]>;
  pathTextDependents: Map<NodeId, Set<NodeId>>;
  containsLiveBoolean: boolean;
}

const MAX_REVISIONS_PER_SCOPE = 3;
const snapshotsByScope = new WeakMap<
  ResolvedEditorSceneScope,
  Map<string, OccurrenceGeometrySnapshot>
>();
const boundsResolverBySnapshot = new WeakMap<OccurrenceGeometrySnapshot, BoundsResolver>();
const topologyByScope = new WeakMap<ResolvedEditorSceneScope, ScopeTopology>();

function revisionKey(revision: string | number): string {
  return `${typeof revision}:${String(revision)}`;
}

function occurrenceParentId(entry: ResolvedEditorSceneScope['occurrences'][number]): string | null {
  if (!entry.parentId) return null;
  return entry.instancePrefix ? `${entry.instancePrefix}:${entry.parentId}` : entry.parentId;
}

function buildScopeTopology(doc: Document, scope: ResolvedEditorSceneScope): ScopeTopology {
  const byNodeId = new Map<NodeId, string[]>();
  const byInstanceId = new Map<string, ResolvedEditorSceneScope['occurrences'][number]>();
  const parentByInstance = new Map<string, string | null>();
  const childrenByInstance = new Map<string, string[]>();
  const pathTextDependents = new Map<NodeId, Set<NodeId>>();
  let containsLiveBoolean = false;

  for (const entry of scope.occurrences) {
    byInstanceId.set(entry.instanceId, entry);
    const instances = byNodeId.get(entry.nodeId) ?? [];
    instances.push(entry.instanceId);
    byNodeId.set(entry.nodeId, instances);

    const parentId = occurrenceParentId(entry);
    parentByInstance.set(entry.instanceId, parentId);
    if (parentId) {
      const children = childrenByInstance.get(parentId) ?? [];
      children.push(entry.instanceId);
      childrenByInstance.set(parentId, children);
    }

    const node = doc.nodes[entry.nodeId];
    if (!node) continue;
    if (isLiveBooleanNode(node)) containsLiveBoolean = true;
    if (node.kind === 'text' && node.textMode === 'path' && node.pathTextSettings) {
      const dependents = pathTextDependents.get(node.pathTextSettings.pathNodeId) ?? new Set();
      dependents.add(entry.nodeId);
      pathTextDependents.set(node.pathTextSettings.pathNodeId, dependents);
    }
  }

  return {
    byNodeId,
    byInstanceId,
    parentByInstance,
    childrenByInstance,
    pathTextDependents,
    containsLiveBoolean,
  };
}

function addPlacement(bounds: Rect | null, placement?: { x: number; y: number }): Rect | null {
  if (!bounds || !placement) return bounds;
  return { ...bounds, x: bounds.x + placement.x, y: bounds.y + placement.y };
}

function boundsForOccurrence(
  doc: Document,
  entry: ResolvedEditorSceneScope['occurrences'][number],
  parentIndex: Map<NodeId, NodeId>,
  resolveBounds: BoundsResolver,
): Rect | null {
  return addPlacement(resolveBounds(doc, entry.nodeId, parentIndex), entry.masterPlacement);
}

function collectAffectedInstances(
  topology: ScopeTopology,
  changedNodeIds: readonly NodeId[],
): Set<string> {
  const affected = new Set<string>();
  const affectedAuthoredIds = new Set<NodeId>(changedNodeIds);
  for (const nodeId of changedNodeIds) {
    for (const dependent of topology.pathTextDependents.get(nodeId) ?? []) {
      affectedAuthoredIds.add(dependent);
    }
  }

  for (const nodeId of affectedAuthoredIds) {
    for (const instanceId of topology.byNodeId.get(nodeId) ?? []) {
      // A moved container changes every descendant's world bounds.
      const stack = [instanceId];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || affected.has(current)) continue;
        affected.add(current);
        for (const child of topology.childrenByInstance.get(current) ?? []) stack.push(child);
      }

      // A moved child can change the union bounds of every container above it.
      let parent = topology.parentByInstance.get(instanceId) ?? null;
      while (parent) {
        affected.add(parent);
        parent = topology.parentByInstance.get(parent) ?? null;
      }
    }
  }

  return affected;
}

/**
 * Return current placed-world bounds for each qualified occurrence. One
 * immutable node-pair classification is shared with scene-scope reuse; only
 * moved subtrees, their ancestor unions, and path-text dependents are
 * recalculated. Live-boolean geometry falls back to a full pass because its
 * bounds derive from an operand graph rather than only the parent tree.
 */
export function occurrenceGeometry(
  doc: Document,
  scope: ResolvedEditorSceneScope,
  options: OccurrenceGeometryOptions = {},
): OccurrenceGeometrySnapshot {
  const revision = revisionKey(options.revision ?? 0);
  let revisions = snapshotsByScope.get(scope);
  const existing = revisions?.get(revision);
  if (existing?.document === doc) return existing;

  const resolveBounds = options.boundsForNode ?? nodeWorldBounds;
  let topology = topologyByScope.get(scope);
  if (!topology) {
    topology = buildScopeTopology(doc, scope);
    topologyByScope.set(scope, topology);
  }

  const previous = existing;
  const classification = previous ? classifyNodeChanges(previous.document.nodes, doc.nodes) : null;
  const incremental = Boolean(
    previous &&
      previous.scope === scope &&
      boundsResolverBySnapshot.get(previous) === resolveBounds &&
      !topology.containsLiveBoolean &&
      documentsDifferOnlyInTransforms(previous.document, doc) &&
      classification?.transformsOnly,
  );

  const parentIndex = committedParentIndex(doc);
  let boundsByInstanceId: Map<string, Rect | null>;
  let recalculatedOccurrenceCount: number;
  if (incremental && previous && classification) {
    boundsByInstanceId = new Map(previous.boundsByInstanceId);
    const affected = collectAffectedInstances(topology, classification.changedNodeIds);
    for (const instanceId of affected) {
      const entry = topology.byInstanceId.get(instanceId);
      if (entry) {
        boundsByInstanceId.set(
          instanceId,
          boundsForOccurrence(doc, entry, parentIndex, resolveBounds),
        );
      }
    }
    recalculatedOccurrenceCount = affected.size;
  } else {
    boundsByInstanceId = new Map();
    for (const entry of scope.occurrences) {
      boundsByInstanceId.set(
        entry.instanceId,
        boundsForOccurrence(doc, entry, parentIndex, resolveBounds),
      );
    }
    recalculatedOccurrenceCount = scope.occurrences.length;
  }

  const snapshot: OccurrenceGeometrySnapshot = {
    document: doc,
    scope,
    boundsByInstanceId,
    recalculatedOccurrenceCount,
    incremental,
  };
  boundsResolverBySnapshot.set(snapshot, resolveBounds);
  if (!revisions) {
    revisions = new Map();
    snapshotsByScope.set(scope, revisions);
  }
  revisions.delete(revision);
  revisions.set(revision, snapshot);
  while (revisions.size > MAX_REVISIONS_PER_SCOPE) {
    const first = revisions.keys().next().value;
    if (first === undefined) break;
    revisions.delete(first);
  }
  return snapshot;
}
