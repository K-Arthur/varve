/**
 * Append the non-candidate replay dependencies (ancestors of dirty nodes and
 * full subtrees of included flatten groups) to the IR list.
 *
 * These nodes are not dirty themselves, but the replay needs their engine IR:
 * ancestors re-establish clip/mask/blend contexts, and the children of a
 * flatten group are re-rendered wholesale into the group surface. The
 * conversion mirrors the candidate loop exactly (effective nodes, bindings,
 * style overrides, text-on-path handling, memoization), so the appended IR
 * is indistinguishable from loop-built IR.
 */

import { applyStyleOverrides, type SceneNode as EngineNode } from '@varve/engine';
import {
  applyBindingsToNode,
  type Document,
  getEffectiveNode,
  type NodeId,
  type SceneNode,
  type VariableStore,
} from '@varve/scene';
import { pathShapeInTextSpace } from '../render/pathTextGeometry';
import { sceneNodeToEngineNode } from '../render/sceneToEngine';
import { getWorldTransform, type TransformCache } from '../scene/transformCache';
import { expandReplayDependencies } from './dirtyQuery';
import type { EngineNodeMemo } from './engineNodeMemo';

export interface AppendReplayDependenciesArgs {
  doc: Document;
  appendIds: readonly NodeId[];
  cache: TransformCache;
  variantCaches: Map<NodeId, Map<NodeId, SceneNode>>;
  variableStore: VariableStore;
  resolvedStyles: Map<NodeId, Record<string, unknown>>;
  engineMemo: EngineNodeMemo;
  canMemoEngineNodes: boolean;
  showOriginalBgNodeId: string;
}

export function appendReplayDependencies(args: AppendReplayDependenciesArgs): {
  nodeIds: string[];
  flatNodes: EngineNode[];
} {
  const { doc, appendIds, cache, variantCaches, variableStore, resolvedStyles, engineMemo } = args;
  const nodeIds: string[] = [];
  const flatNodes: EngineNode[] = [];
  for (const id of appendIds) {
    const raw = doc.nodes[id];
    if (!raw) continue;
    const n = getEffectiveNode(doc, id, variantCaches) ?? raw;
    if (!n.visible) continue;
    if (n.kind === 'group') continue;
    const bound = applyBindingsToNode(n, variableStore);
    const world = getWorldTransform(cache, doc, id);
    const styleOverrides = resolvedStyles.get(id);
    let built = sceneNodeToEngineNode(
      bound,
      {
        showOriginalBackgroundNodeId: args.showOriginalBgNodeId,
        useMaskRenderProxy: true,
      },
      doc,
    );
    if (styleOverrides) built = applyStyleOverrides(built, styleOverrides);
    const pathNodeId = built.pathTextSettings?.pathNodeId;
    const isPathText =
      !!pathNodeId && (built as { shape?: { kind?: string } }).shape?.kind === 'text';
    if (isPathText) {
      const pathNode = doc.nodes[pathNodeId] as (SceneNode & { shape?: unknown }) | undefined;
      if (pathNode?.shape) {
        const pathWorld = getWorldTransform(args.cache, doc, pathNodeId);
        (built.shape as Record<string, unknown>).pathShape = pathShapeInTextSpace(
          pathNode.shape as import('@varve/engine').Shape,
          pathWorld,
          world,
        );
      }
    }
    const engineNode: EngineNode = { ...built, transform: world };
    if (args.canMemoEngineNodes && !isPathText) {
      engineMemo.set(id, n, world, engineNode);
    }
    nodeIds.push(id);
    flatNodes.push(engineNode);
  }
  return { nodeIds, flatNodes };
}

export interface ExpandReplayListArgs extends AppendReplayDependenciesArgs {
  parentIndex?: Map<NodeId, NodeId>;
}

export interface ExpandReplayListResult {
  /** Every node that may paint inside the dirty region, or null when unpruned. */
  replaySet: Set<NodeId> | null;
  nodeIds: string[];
  flatNodes: EngineNode[];
  ancestorsIncluded: number;
  compositingDependencies: number;
}

/**
 * One-call replay-set expansion: candidates → ancestors → mask sources →
 * full subtrees of included flatten groups, with their IR appended. Returns
 * no replay set when there are no accepted candidates.
 */
export function expandReplayList(args: ExpandReplayListArgs): ExpandReplayListResult {
  const empty: ExpandReplayListResult = {
    replaySet: null,
    nodeIds: [],
    flatNodes: [],
    ancestorsIncluded: 0,
    compositingDependencies: 0,
  };
  if (args.appendIds.length === 0) return empty;
  const { doc, parentIndex } = args;
  const expansion = expandReplayDependencies({
    doc,
    accepted: args.appendIds,
    parentIndex,
  });
  const appended =
    expansion.appendIds.length > 0
      ? appendReplayDependencies(args)
      : { nodeIds: [] as string[], flatNodes: [] as EngineNode[] };
  return {
    replaySet: expansion.replaySet,
    nodeIds: appended.nodeIds,
    flatNodes: appended.flatNodes,
    ancestorsIncluded: expansion.ancestorsIncluded,
    compositingDependencies: expansion.compositingDependencies,
  };
}
