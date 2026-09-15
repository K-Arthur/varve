/**
 * Validation for live mockup source links.
 *
 * A live surface is a dependency edge from a mockup frame to a scene node.
 * Keeping the graph checks here gives binding actions, codec validation, and
 * the renderer one bounded rule for rejecting self/ancestor/descendant and
 * indirect A -> B -> A capture loops.
 */

import type { Document } from '../document';
import type { NodeId } from '../types';
import type { MockupSourceBinding } from './types';

const MAX_BINDING_GRAPH_DEPTH = 128;

export type MockupBindingErrorCode =
  | 'missing-frame'
  | 'missing-source'
  | 'self-reference'
  | 'ancestor-reference'
  | 'descendant-reference'
  | 'indirect-cycle'
  | 'malformed-cycle'
  | 'depth-limit';

export interface MockupBindingCheck {
  ok: boolean;
  code?: MockupBindingErrorCode;
  message?: string;
}

function parentIndex(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const [parentId, node] of Object.entries(doc.nodes)) {
    const children = node && 'children' in node ? node.children : undefined;
    if (!Array.isArray(children)) continue;
    for (const childId of children) {
      if (!parents.has(childId)) parents.set(childId, parentId);
    }
  }
  return parents;
}

function isAncestor(
  ancestorId: NodeId,
  descendantId: NodeId,
  parents: Map<NodeId, NodeId>,
): boolean {
  const visited = new Set<NodeId>();
  let current = parents.get(descendantId);
  let depth = 0;
  while (current && depth < MAX_BINDING_GRAPH_DEPTH) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parents.get(current);
    depth++;
  }
  return false;
}

function liveBindings(node: unknown): MockupSourceBinding[] {
  if (!node || typeof node !== 'object') return [];
  const record = node as { kind?: string; mockup?: { surfaceBindings?: unknown } };
  if (record.kind !== 'frame' || !record.mockup?.surfaceBindings) return [];
  if (typeof record.mockup.surfaceBindings !== 'object') return [];
  return Object.values(record.mockup.surfaceBindings as Record<string, MockupSourceBinding>).filter(
    (binding) => binding?.mode === 'live' && typeof binding.nodeId === 'string',
  );
}

/**
 * Check whether `sourceId` can be used as a live source for `frameId`.
 * Snapshot bindings do not create scene-graph dependency edges and are
 * intentionally validated by the asset/instance validators instead.
 */
export function canBindMockupSource(
  doc: Document,
  frameId: NodeId,
  sourceId: NodeId,
): MockupBindingCheck {
  if (!doc.nodes[frameId]) {
    return { ok: false, code: 'missing-frame', message: 'The mockup frame no longer exists.' };
  }
  if (!doc.nodes[sourceId]) {
    return { ok: false, code: 'missing-source', message: 'The selected source no longer exists.' };
  }
  if (frameId === sourceId) {
    return {
      ok: false,
      code: 'self-reference',
      message: 'A mockup cannot use itself as its source.',
    };
  }

  const parents = parentIndex(doc);
  if (isAncestor(frameId, sourceId, parents)) {
    return {
      ok: false,
      code: 'descendant-reference',
      message: 'A mockup cannot capture one of its own descendants.',
    };
  }
  if (isAncestor(sourceId, frameId, parents)) {
    return {
      ok: false,
      code: 'ancestor-reference',
      message: 'A mockup cannot capture an ancestor that contains it.',
    };
  }

  const completed = new Set<NodeId>();
  const visit = (currentId: NodeId, depth: number, path: Set<NodeId>): MockupBindingCheck => {
    if (currentId === frameId) {
      return {
        ok: false,
        code: 'indirect-cycle',
        message: 'This link would create a recursive mockup source chain.',
      };
    }
    if (path.has(currentId)) {
      return {
        ok: false,
        code: 'malformed-cycle',
        message: 'The selected source contains a recursive mockup source chain.',
      };
    }
    if (completed.has(currentId)) return { ok: true };
    if (depth >= MAX_BINDING_GRAPH_DEPTH) {
      return {
        ok: false,
        code: 'depth-limit',
        message: `The mockup source chain exceeds the ${MAX_BINDING_GRAPH_DEPTH}-level safety limit.`,
      };
    }
    const nextPath = new Set(path);
    nextPath.add(currentId);
    for (const binding of liveBindings(doc.nodes[currentId])) {
      if (!binding.nodeId) continue;
      const result = visit(binding.nodeId, depth + 1, nextPath);
      if (!result.ok) return result;
    }
    completed.add(currentId);
    return { ok: true };
  };

  const result = visit(sourceId, 0, new Set<NodeId>());
  if (!result.ok) return result;
  return { ok: true };
}
