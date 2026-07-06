/**
 * Smart Animate layer matching — pairs layers by name across screens.
 */
import type { NodeId, SceneNode } from '@strata/scene';

export interface LayerMatch {
  fromId: NodeId;
  toId: NodeId;
  name: string;
}

/** Match direct children of two frame roots by node name. */
export function matchLayersByName(
  nodes: Record<NodeId, SceneNode>,
  fromRootId: NodeId,
  toRootId: NodeId,
): LayerMatch[] {
  const fromRoot = nodes[fromRootId];
  const toRoot = nodes[toRootId];
  if (!fromRoot || !toRoot || !('children' in fromRoot) || !('children' in toRoot)) {
    return [];
  }

  const toByName = new Map<string, NodeId>();
  for (const id of toRoot.children ?? []) {
    const n = nodes[id];
    if (n) toByName.set(n.name, id);
  }

  const matches: LayerMatch[] = [];
  for (const fromId of fromRoot.children ?? []) {
    const fromNode = nodes[fromId];
    if (!fromNode) continue;
    const toId = toByName.get(fromNode.name);
    if (toId) {
      matches.push({ fromId, toId, name: fromNode.name });
    }
  }
  return matches;
}

/**
 * Build smart-animate value map from opacity/transform deltas for matched layers.
 */
export function buildSmartAnimateValues(
  nodes: Record<NodeId, SceneNode>,
  matches: LayerMatch[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const m of matches) {
    const from = nodes[m.fromId];
    const to = nodes[m.toId];
    if (!from || !to) continue;
    result[m.name] = {
      opacity: { from: from.opacity ?? 1, to: to.opacity ?? 1 },
      transform: { from: from.transform, to: to.transform },
    };
  }
  return result;
}
