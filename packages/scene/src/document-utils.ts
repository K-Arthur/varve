import type { Affine } from '@varve/engine';
import { type FrameNode, type GroupNode, isContainer, type NodeId, type SceneNode } from './types';

/**
 * Minimal Document interface — only properties needed by validation/utility
 * functions extracted from document.ts. Structural subtype of the full
 * Document type, so callers passing the real Document always satisfy this.
 */
export interface DocumentLike {
  rootChildren: NodeId[];
  globalChildren?: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  pages?: Array<{ id: NodeId; name: string; contentRoot: NodeId; backgrounds: NodeId[] }>;
  activePageId?: NodeId;
}

export interface DocValidationResult {
  valid: boolean;
  errors: string[];
}

export function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc-${Math.random().toString(36).slice(2)}`;
}

export function makeGroupNode(
  id: NodeId,
  opts: Partial<
    Pick<
      GroupNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'order'
      | 'isolated'
      | 'effects'
    >
  > = {},
): GroupNode {
  return {
    id,
    kind: 'group',
    name: opts.name ?? 'Group',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    children: opts.children ?? [],
    isolated: opts.isolated,
    effects: opts.effects ?? [],
  };
}

export function getParent(doc: DocumentLike, id: NodeId): NodeId | null {
  if (doc.rootChildren.includes(id)) return null;
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return nid as NodeId;
  }
  return null;
}

/**
 * Detect cycles in the children graph. Iterative DFS with explicit stack so
 * even pathological graphs terminate; returns the first cycle found as an
 * ordered id chain (cycle start repeated at the end), or null when acyclic.
 *
 * Used by load-time validation: world-transform composition and render walks
 * must never loop forever on a corrupt document.
 */
export function findParentCycle(doc: DocumentLike): NodeId[] | null {
  const nodeIds = Object.keys(doc.nodes) as NodeId[];
  const state = new Map<NodeId, 0 | 1 | 2>();

  for (const start of nodeIds) {
    if (state.get(start) === 2) continue;
    const stack: Array<{ nid: NodeId; childIndex: number }> = [{ nid: start, childIndex: 0 }];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const node = doc.nodes[frame.nid];
      if (!node || !isContainer(node) || frame.childIndex >= node.children.length) {
        state.set(frame.nid, 2);
        stack.pop();
        continue;
      }
      const childId = node.children[frame.childIndex]!;
      frame.childIndex++;
      const childState = state.get(childId) ?? 0;
      if (childState === 1) {
        // Back edge: reconstruct the cycle path.
        const cycleStart = stack.findIndex((f) => f.nid === childId);
        const cycle = stack.slice(cycleStart).map((f) => f.nid);
        cycle.push(childId);
        return cycle;
      }
      if (childState === 0) {
        state.set(childId, 1);
        stack.push({ nid: childId, childIndex: 0 });
      }
    }
  }
  return null;
}

export function validateDocument(doc: DocumentLike): DocValidationResult {
  const errors: string[] = [];

  const reachable = new Set<NodeId>();
  function markReachable(ids: NodeId[]) {
    for (const nid of ids) {
      if (reachable.has(nid)) continue;
      const node = doc.nodes[nid];
      if (!node) continue;
      reachable.add(nid);
      if (isContainer(node) && node.children.length > 0) {
        markReachable(node.children);
      }
    }
  }

  const roots = [...doc.rootChildren, ...(doc.globalChildren ?? [])];
  markReachable(roots);

  for (const nid of Object.keys(doc.nodes)) {
    if (!reachable.has(nid as NodeId)) {
      errors.push(`Orphan node: ${nid} is not reachable from rootChildren or globalChildren`);
    }
  }

  if (doc.pages) {
    if (doc.activePageId && !doc.pages.some((page) => page.id === doc.activePageId)) {
      errors.push(`activePageId ${doc.activePageId} does not reference an existing page`);
    }
    for (const page of doc.pages) {
      if (!reachable.has(page.contentRoot)) {
        errors.push(`Page "${page.name}" contentRoot ${page.contentRoot} is not reachable`);
      }
      for (const bgId of page.backgrounds) {
        if (!reachable.has(bgId)) {
          errors.push(`Page "${page.name}" background ${bgId} is not reachable`);
        }
      }
    }
  }

  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node)) {
      for (const childId of node.children) {
        if (!doc.nodes[childId]) {
          errors.push(`Container ${nid} references non-existent child ${childId}`);
        }
      }
    }
  }

  const childToParent = new Map<NodeId, NodeId[]>();
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node)) {
      for (const childId of node.children) {
        const existing = childToParent.get(childId) ?? [];
        existing.push(nid as NodeId);
        childToParent.set(childId, existing);
      }
    }
  }
  for (const [childId, parents] of childToParent) {
    if (parents.length > 1) {
      errors.push(`Node ${childId} is a child of multiple containers: ${parents.join(', ')}`);
    }
  }

  const rootSet = new Set(doc.rootChildren);
  for (const gid of doc.globalChildren ?? []) {
    if (rootSet.has(gid)) {
      errors.push(`Node ${gid} appears in both rootChildren and globalChildren`);
    }
  }

  const visited = new Set<NodeId>();
  const inStack = new Set<NodeId>();
  function detectCycle(nodeId: NodeId): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    const node = doc.nodes[nodeId];
    if (!node || !isContainer(node)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const childId of node.children) {
      if (detectCycle(childId)) {
        inStack.delete(nodeId);
        return true;
      }
    }
    inStack.delete(nodeId);
    return false;
  }
  for (const nid of Object.keys(doc.nodes)) {
    if (detectCycle(nid as NodeId)) {
      errors.push(`Cycle detected in subtree containing node ${nid}`);
      break;
    }
  }

  for (const [nid, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: { sourceNodeId?: NodeId } };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      errors.push(`Node ${nid} has mask referencing non-existent node ${n.mask.sourceNodeId}`);
    }
  }

  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'frame' || node.kind === 'group') {
      const frame = node as FrameNode & { slots?: Record<string, NodeId> };
      if (frame.slots) {
        for (const [slotId, slotChildId] of Object.entries(frame.slots)) {
          if (!doc.nodes[slotChildId as NodeId]) {
            errors.push(
              `Node ${nid} has slot "${slotId}" referencing non-existent node ${slotChildId}`,
            );
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function devValidate(doc: DocumentLike): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    const result = validateDocument(doc);
    if (!result.valid) {
      console.warn('[Strata] Document validation failed:', result.errors);
    }
  }
}
