import type { Affine } from '@varve/engine';
import {
  type AdjustmentNode,
  type FrameNode,
  type GroupNode,
  isContainer,
  type NodeId,
  type SceneNode,
} from './types';

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
  /** Component master definitions, keyed by component id. */
  components?: Record<NodeId, { masterRootId: NodeId }>;
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
    if (childrenOf(node).includes(id)) return nid as NodeId;
  }
  return null;
}

function childrenOf(node: SceneNode | undefined): NodeId[] {
  if (!node || !isContainer(node)) return [];
  return Array.isArray(node.children) ? node.children : [];
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
      const children = childrenOf(node);
      if (children.length === 0 || frame.childIndex >= children.length) {
        state.set(frame.nid, 2);
        stack.pop();
        continue;
      }
      const childId = children[frame.childIndex]!;
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
    const pending = [...ids];
    while (pending.length > 0) {
      const nid = pending.pop()!;
      if (reachable.has(nid)) continue;
      const node = doc.nodes[nid];
      if (!node) continue;
      reachable.add(nid);
      pending.push(...childrenOf(node));
    }
  }

  const roots = [...doc.rootChildren, ...(doc.globalChildren ?? [])];
  const seenRoots = new Set<NodeId>();
  for (const rootId of roots) {
    if (seenRoots.has(rootId)) errors.push(`Duplicate root reference: ${rootId}`);
    seenRoots.add(rootId);
    if (!doc.nodes[rootId]) errors.push(`Root references non-existent node: ${rootId}`);
  }
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
    for (const childId of childrenOf(node)) {
        if (!doc.nodes[childId]) {
          errors.push(`Container ${nid} references non-existent child ${childId}`);
        }
    }
  }

  const childToParent = new Map<NodeId, NodeId[]>();
  for (const [nid, node] of Object.entries(doc.nodes)) {
    for (const childId of childrenOf(node)) {
        const existing = childToParent.get(childId) ?? [];
        existing.push(nid as NodeId);
        childToParent.set(childId, existing);
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

  const cycle = findParentCycle(doc);
  if (cycle) {
    errors.push(`Cycle detected in subtree containing node ${cycle[0]}`);
  }

  for (const [nid, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: { sourceNodeId?: NodeId } };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      errors.push(`Node ${nid} has mask referencing non-existent node ${n.mask.sourceNodeId}`);
    }
    if (n.mask?.sourceNodeId && doc.nodes[n.mask.sourceNodeId]) {
      const sourceParent = getParent(doc, n.mask.sourceNodeId);
      if ((node.kind === 'frame' || node.kind === 'group') && sourceParent !== nid) {
        errors.push(`Node ${nid} mask source ${n.mask.sourceNodeId} is not a direct child`);
      }
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

  // ── Reference-integrity checks (adjacency of "strong" references) ─────────
  // A corrupt document can carry references to nodes that no longer exist.
  // These are surfaced here and neutralised by `repairDocument` at load time.

  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'adjustment') {
      const adj = node as AdjustmentNode;
      if (adj.scope) {
        if (adj.scope.mode === 'explicit-targets') {
          for (const targetId of adj.scope.targetNodeIds ?? []) {
            if (!doc.nodes[targetId]) {
              errors.push(`Adjustment ${nid} references non-existent scope target ${targetId}`);
            }
          }
        } else if (adj.scope.mode === 'image-local') {
          if (!doc.nodes[adj.scope.targetNodeId]) {
            errors.push(
              `Adjustment ${nid} references non-existent image-local target ${adj.scope.targetNodeId}`,
            );
          }
        }
      }
    }
  }

  for (const [nid, node] of Object.entries(doc.nodes)) {
    const effects = (
      node as {
        effects?: Array<{ mask?: { source?: { kind: string; nodeId?: NodeId } } }>;
      }
    ).effects;
    if (!effects) continue;
    effects.forEach((effect, i) => {
      const src = effect.mask?.source;
      if (src && src.kind === 'scene-node' && src.nodeId && !doc.nodes[src.nodeId]) {
        errors.push(`Node ${nid} effect[${i}] references non-existent mask source ${src.nodeId}`);
      }
    });
  }

  const components = doc.components ?? {};
  for (const [nid, node] of Object.entries(doc.nodes)) {
    const compId = (node as { componentId?: NodeId }).componentId;
    if (compId && !components[compId]) {
      errors.push(`Node ${nid} is a component instance referencing missing master ${compId}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface RepairResult {
  doc: DocumentLike;
  changed: boolean;
}

/**
 * Produce a document with dangling strong references neutralised. Never
 * mutates the input — returns a clone. Each repair maps a flagged condition
 * onto the safest reversible default:
 *  - explicit-targets adjustment scope with a missing target → document scope
 *  - effect mask bound to a missing scene-node source → mask binding dropped
 *  - component instance whose master is missing → instance link cleared
 *  - mask (structural or live-matte) with a missing source → mask dropped
 */
export function repairDocument(doc: DocumentLike): RepairResult {
  const next: DocumentLike = structuredClone(doc);
  const components = next.components ?? {};
  let changed = false;

  for (const nid of Object.keys(next.nodes)) {
    let current = next.nodes[nid]!;

    if (current.kind === 'adjustment') {
      const adj = current as AdjustmentNode;
      if (adj.scope) {
        const dangling =
          adj.scope.mode === 'explicit-targets'
            ? (adj.scope.targetNodeIds ?? []).some((t) => !next.nodes[t])
            : adj.scope.mode === 'image-local'
              ? !next.nodes[adj.scope.targetNodeId]
              : false;
        if (dangling) {
          current = { ...adj, scope: { mode: 'document' } } as SceneNode;
          changed = true;
        }
      }
    }

    const effects = (
      current as {
        effects?: Array<{ mask?: { source?: { kind: string; nodeId?: NodeId } } }>;
      }
    ).effects;
    if (effects) {
      let nodeChanged = false;
      const fixedEffects = effects.map((effect) => {
        const src = effect.mask?.source;
        if (src && src.kind === 'scene-node' && src.nodeId && !next.nodes[src.nodeId]) {
          nodeChanged = true;
          return { ...effect, mask: undefined };
        }
        return effect;
      });
      if (nodeChanged) {
        current = { ...current, effects: fixedEffects } as SceneNode;
        changed = true;
      }
    }

    const compId = (current as { componentId?: NodeId }).componentId;
    if (compId && !components[compId]) {
      const { componentId: _drop, ...rest } = current as { componentId?: NodeId };
      current = rest as SceneNode;
      changed = true;
    }

    const mask = (
      current as {
        mask?: { sourceNodeId?: NodeId; matteSource?: { kind: string; nodeId?: NodeId } };
      }
    ).mask;
    if (mask) {
      const matte = mask.matteSource;
      const danglingMatte =
        matte && matte.kind === 'scene-node' && matte.nodeId && !next.nodes[matte.nodeId];
      const danglingSrc = mask.sourceNodeId != null && !next.nodes[mask.sourceNodeId];
      if (danglingMatte || danglingSrc) {
        const { mask: _m, ...rest } = current as { mask?: unknown };
        current = rest as SceneNode;
        changed = true;
      }
    }

    next.nodes[nid] = current;
  }

  return { doc: next, changed };
}

/**
 * Validate, then repair if needed. Returns the original validation result and
 * the (possibly unchanged) repaired document. Load paths call this to recover
 * gracefully from corrupt documents instead of hard-failing decode.
 */
export function validateAndRepairDocument(doc: DocumentLike): {
  result: DocValidationResult;
  repaired: RepairResult;
} {
  const result = validateDocument(doc);
  const repaired = repairDocument(doc);
  return { result, repaired };
}

export function devValidate(doc: DocumentLike): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    const result = validateDocument(doc);
    if (!result.valid) {
      console.warn('[Varve] Document validation failed:', result.errors);
    }
  }
}
