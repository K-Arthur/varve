/**
 * Non-destructive geometry-modifier (warp) document operations.
 *
 * Immutable `Document → Document` ops for the node-level `warps` stack and
 * `warpSettings`. The schema itself (types + validation) is owned by
 * @varve/engine; this module owns how modifiers attach to nodes and how the
 * document mutates. Pattern follows `tableOps.ts` / `document-nodes.ts`.
 */

import {
  type BendModifier,
  type EnvelopeModifier,
  MAX_WARPS_PER_NODE,
  type MeshWarpModifier,
  makeIdentityWarpModifier,
  nextWarpModifierId,
  type PerspectiveModifier,
  type SkewModifier,
  validateWarpModifier,
  type WarpModifier,
  type WarpSettings,
} from '@varve/engine';
import type { Document } from './document';
import { groupNodes } from './document-nodes';
import { makeGroupNode } from './document-utils';
import type { NodeId, SceneNode } from './types';

/** Node kinds that can carry a warp modifier stack. */
export function canNodeHaveWarps(node: SceneNode | undefined | null): boolean {
  if (!node) return false;
  return (
    node.kind === 'shape' || node.kind === 'text' || node.kind === 'group' || node.kind === 'frame'
  );
}

export function warpsOnNode(node: SceneNode | undefined | null): WarpModifier[] {
  if (!canNodeHaveWarps(node)) return [];
  return (node as { warps?: WarpModifier[] }).warps ?? [];
}

/** Reason a node cannot accept a warp (for UI explanations). */
export function warpUnsupportedReason(node: SceneNode | undefined | null): string | null {
  if (!node) return 'No selection';
  if (!canNodeHaveWarps(node)) {
    return `Warp is not supported on ${node.kind} nodes in this version`;
  }
  return null;
}

function patchNode(doc: Document, nodeId: NodeId, patch: Partial<SceneNode>): Document {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  const updated = { ...node, ...patch } as SceneNode;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

function patchWarps(doc: Document, nodeId: NodeId, warps: WarpModifier[]): Document {
  return patchNode(doc, nodeId, { warps });
}

/**
 * Append a modifier to the stack (or insert at `index`). Returns the
 * document unchanged when the node cannot hold warps or the stack is full.
 */
export function addWarp(
  doc: Document,
  nodeId: NodeId,
  modifier: WarpModifier,
  index?: number,
): Document {
  const node = doc.nodes[nodeId];
  if (!canNodeHaveWarps(node)) return doc;
  const validated = validateWarpModifier(modifier);
  if (!validated) return doc;
  const current = warpsOnNode(node);
  if (current.length >= MAX_WARPS_PER_NODE) return doc;
  const next = [...current];
  const at = index === undefined ? next.length : Math.max(0, Math.min(next.length, index));
  next.splice(at, 0, validated);
  return patchWarps(doc, nodeId, next);
}

export function removeWarp(doc: Document, nodeId: NodeId, warpId: string): Document {
  const current = warpsOnNode(doc.nodes[nodeId]);
  if (current.length === 0) return doc;
  const next = current.filter((w) => w.id !== warpId);
  if (next.length === current.length) return doc;
  return patchWarps(doc, nodeId, next);
}

export function setWarpEnabled(
  doc: Document,
  nodeId: NodeId,
  warpId: string,
  enabled: boolean,
): Document {
  return updateWarp(doc, nodeId, warpId, { enabled });
}

/**
 * Editable parameters of one modifier kind (never id/kind). Explicitly
 * distributed over the union — `Partial<Omit<Union, K>>` collapses to the
 * common keys and would silently reject kind-specific fields.
 */
export type WarpParameterPatch =
  | Partial<Omit<SkewModifier, 'id' | 'kind'>>
  | Partial<Omit<PerspectiveModifier, 'id' | 'kind'>>
  | Partial<Omit<EnvelopeModifier, 'id' | 'kind'>>
  | Partial<Omit<MeshWarpModifier, 'id' | 'kind'>>
  | Partial<Omit<BendModifier, 'id' | 'kind'>>;

/**
 * Patch a modifier's editable parameters (never its kind or id). The
 * patched modifier is re-validated; invalid patches are rejected.
 */
export function updateWarp(
  doc: Document,
  nodeId: NodeId,
  warpId: string,
  patch: WarpParameterPatch,
): Document {
  const current = warpsOnNode(doc.nodes[nodeId]);
  const index = current.findIndex((w) => w.id === warpId);
  if (index < 0) return doc;
  const merged = { ...current[index], ...patch } as WarpModifier;
  const validated = validateWarpModifier(merged);
  if (!validated) return doc;
  const next = [...current];
  next[index] = validated;
  return patchWarps(doc, nodeId, next);
}

export function reorderWarps(
  doc: Document,
  nodeId: NodeId,
  warpId: string,
  toIndex: number,
): Document {
  const current = warpsOnNode(doc.nodes[nodeId]);
  if (current.length < 2) return doc;
  const fromIndex = current.findIndex((w) => w.id === warpId);
  if (fromIndex < 0) return doc;
  const next = [...current];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return doc;
  const at = Math.max(0, Math.min(next.length, toIndex));
  next.splice(at, 0, moved);
  return patchWarps(doc, nodeId, next);
}

/** Duplicate a modifier with a fresh stable id (undoable, collab-safe). */
export function duplicateWarp(doc: Document, nodeId: NodeId, warpId: string): Document {
  const current = warpsOnNode(doc.nodes[nodeId]);
  const index = current.findIndex((w) => w.id === warpId);
  if (index < 0 || current.length >= MAX_WARPS_PER_NODE) return doc;
  const source = current[index]!;
  const copy = { ...source, id: nextWarpModifierId(`${source.kind}-copy`) } as WarpModifier;
  const next = [...current];
  next.splice(index + 1, 0, copy);
  return patchWarps(doc, nodeId, next);
}

/** Reset a modifier to its kind's identity configuration. */
export function resetWarp(doc: Document, nodeId: NodeId, warpId: string): Document {
  const current = warpsOnNode(doc.nodes[nodeId]);
  const index = current.findIndex((w) => w.id === warpId);
  if (index < 0) return doc;
  const reset = makeIdentityWarpModifier(current[index]!.kind);
  const next = [...current];
  next[index] = { ...reset, id: warpId };
  return patchWarps(doc, nodeId, next);
}

/** Rename a modifier (display name only). */
export function renameWarp(doc: Document, nodeId: NodeId, warpId: string, name: string): Document {
  return updateWarp(doc, nodeId, warpId, { name: name.trim() === '' ? undefined : name.trim() });
}

export function clearWarps(doc: Document, nodeId: NodeId): Document {
  if (warpsOnNode(doc.nodes[nodeId]).length === 0) return doc;
  return patchNode(doc, nodeId, { warps: undefined });
}

export function setWarpSettings(doc: Document, nodeId: NodeId, settings: WarpSettings): Document {
  const node = doc.nodes[nodeId];
  if (!canNodeHaveWarps(node)) return doc;
  return patchNode(doc, nodeId, { warpSettings: settings });
}

/** Warp a selection of nodes: group them, then add the modifier to the group. */
export function warpSelectionAsGroup(
  doc: Document,
  nodeIds: NodeId[],
  modifier: WarpModifier,
  groupName = 'Warp group',
): Document {
  if (nodeIds.length === 0) return doc;
  let next = doc;
  if (nodeIds.length > 1) {
    const groupId = `warp-group-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    // Note: pass an empty-children group — groupNodes appends each child
    // itself; pre-declared children would be duplicated.
    const group = makeGroupNode(groupId, { name: groupName });
    next = groupNodes(next, nodeIds, group);
    return addWarp(next, groupId, modifier);
  }
  return addWarp(next, nodeIds[0]!, modifier);
}

/** Remove warps from every node in the document (migration/repair). */
export function stripAllWarps(doc: Document): Document {
  let changed = false;
  const nodes: Record<NodeId, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (warpsOnNode(node).length > 0 || node.warpSettings) {
      changed = true;
      const {
        warps: _w,
        warpSettings: _s,
        ...rest
      } = node as SceneNode & {
        warps?: WarpModifier[];
        warpSettings?: WarpSettings;
      };
      nodes[id] = rest as SceneNode;
    } else {
      nodes[id] = node;
    }
  }
  return changed ? { ...doc, nodes } : doc;
}
