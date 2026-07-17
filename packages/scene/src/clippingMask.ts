/**
 * Non-destructive clipping mask helpers.
 *
 * A clipping group is a {@link GroupNode} (or FrameNode) whose `mask` points
 * at one child (the mask shape) and clips every other child. The mask shape
 * remains a regular editable node and is hidden from direct rendering so the
 * user sees the masked content only.
 *
 * These helpers are intentionally thin: they reuse the existing `Mask` model
 * and the `addMask`/`removeMask` primitives in `masks.ts`. They add:
 *   - create/repair/release helpers
 *   - safe grouping with preserved world transforms
 *   - content replacement
 *   - validation and recovery for dangling references
 */
import type { Affine } from '@strata/engine';
import { applyAffine, identity, invertAffine, multiplyAffine, rotateDeg } from '@strata/shared';
import type { Document } from './document';
import {
  buildParentIndexMap,
  getParent,
  makeGroupNode,
  nextNodeId,
  reparentNode,
} from './document';
import { addMask, removeMask } from './masks';
import type { FrameNode, GroupNode, MaskFillRule, MaskType, NodeId, SceneNode } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClippingMaskOptions {
  /** Mask type. 'clip' is the default for vector clipping masks. */
  type?: MaskType;
  /** Fill rule for clip/vector masks. */
  fillRule?: MaskFillRule;
  /** Hide the mask source from direct rendering. Default true for clip. */
  hideMaskSource?: boolean;
  /** Transform the mask with the content. Default true. */
  linked?: boolean;
  /** Name for the new group. */
  name?: string;
}

export interface ClippingMaskResult {
  doc: Document;
  groupId: NodeId;
}

// ── Helpers: transforms ────────────────────────────────────────────────────

function composeNodeLocalTransform(node: SceneNode): Affine {
  const t = node.transform;
  const rot = node.rotation ?? 0;
  return rot !== 0 ? multiplyAffine(t, rotateDeg(rot)) : t;
}

function nodeWorldTransform(doc: Document, id: NodeId, parentIndex?: Map<NodeId, NodeId>): Affine {
  const node = doc.nodes[id];
  if (!node) return identity;

  const chain: Affine[] = [composeNodeLocalTransform(node)];
  const getParentFn = parentIndex
    ? (cid: NodeId) => parentIndex.get(cid) ?? null
    : (cid: NodeId) => getParent(doc, cid);

  let parentId = getParentFn(id);
  while (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) break;
    chain.push(composeNodeLocalTransform(parent));
    parentId = getParentFn(parentId);
  }

  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }
  return world;
}

// ── Predicates ─────────────────────────────────────────────────────────────

/** True if the node can be used as a vector clipping mask source. */
export function canBeClipMaskSource(node: SceneNode): boolean {
  if (node.kind === 'shape') {
    const k = node.shape.kind;
    if (k === 'line' || k === 'arrow') return false;
    return true;
  }
  if (node.kind === 'group' || node.kind === 'frame' || node.kind === 'text') {
    // Groups/frames/text are accepted as sources, but the renderer may
    // rasterize them if it cannot trace an outline. Callers can warn.
    return true;
  }
  return false;
}

/** True if the node is a container with a clip-style mask. */
export function isClippingMaskGroup(node: SceneNode): node is GroupNode | FrameNode {
  return (
    (node.kind === 'group' || node.kind === 'frame') &&
    node.mask?.type === 'clip' &&
    node.mask.visible !== false
  );
}

/** Return the mask source node id for a clipping group, or null. */
export function getClippingMaskSourceId(node: SceneNode): NodeId | null {
  const mask = node.mask;
  if (!mask || mask.type !== 'clip' || mask.visible === false) return null;
  return mask.sourceNodeId ?? null;
}

/** Return the content node ids for a clipping group (all children except the mask source). */
export function getClippingContentIds(node: SceneNode): NodeId[] {
  const sourceId = getClippingMaskSourceId(node);
  if (!('children' in node) || !node.children) return [];
  return node.children.filter((id) => id !== sourceId);
}

// ── Creation ───────────────────────────────────────────────────────────────

/**
 * Create a clipping group from a mask shape and one or more content nodes.
 *
 * All nodes must be siblings (share the same parent, or all be root-level).
 * The mask shape is placed as the first child and the group's `mask` is set
 * to use it as the source. World positions are preserved by moving the group
 * to the mask shape's world transform and re-computing child local transforms.
 */
export function createClippingMask(
  doc: Document,
  maskNodeId: NodeId,
  contentNodeIds: NodeId[],
  opts: ClippingMaskOptions = {},
): ClippingMaskResult {
  if (!contentNodeIds.length) {
    throw new Error('Clipping mask requires at least one content node');
  }

  const maskNode = doc.nodes[maskNodeId];
  if (!maskNode) throw new Error('Mask node not found');
  if (!canBeClipMaskSource(maskNode)) {
    throw new Error('Mask node is not a supported clipping shape');
  }

  const parentIndex = buildParentIndexMap(doc);
  const parentId = parentIndex.get(maskNodeId) ?? null;

  for (const contentId of contentNodeIds) {
    const content = doc.nodes[contentId];
    if (!content) throw new Error(`Content node not found: ${contentId}`);
    if (parentIndex.get(contentId) !== parentId) {
      throw new Error('Mask and content nodes must be siblings');
    }
    if (contentId === maskNodeId) throw new Error('Mask node cannot also be content');
    if (isAncestor(doc, contentId, maskNodeId)) {
      throw new Error('Mask node cannot be a descendant of a content node');
    }
  }

  const maskWorld = nodeWorldTransform(doc, maskNodeId, parentIndex);
  const groupInverse = invertAffine(maskWorld);

  const { id: groupId, doc: docAfterGroupId } = nextNodeId(doc);
  const group = makeGroupNode(groupId, {
    name: opts.name ?? `${maskNode.name} clip`,
    transform: maskWorld,
    children: [],
  });

  // Place the group where the mask used to be in the parent's children list.
  let result = insertGroupAtMaskIndex(docAfterGroupId, parentId, maskNodeId, group);

  // Reparent mask shape into group with identity local transform (relative to mask's original world).
  const maskLocal = groupInverse ? applyAffine(groupInverse, [maskWorld[4], maskWorld[5]]) : [0, 0];
  const maskLocalTransform: Affine = groupInverse
    ? [1, 0, 0, 1, maskLocal[0], maskLocal[1]]
    : [1, 0, 0, 1, 0, 0];
  result = reparentNode(result, maskNodeId, groupId, 0, maskLocalTransform);

  // Reparent content nodes into group, preserving their world transforms.
  for (let i = 0; i < contentNodeIds.length; i++) {
    const contentId = contentNodeIds[i]!;
    const contentLocalTransform: Affine = groupInverse
      ? multiplyAffine(
          groupInverse,
          composeNodeLocalTransform(result.nodes[contentId] as SceneNode),
        )
      : composeNodeLocalTransform(result.nodes[contentId] as SceneNode);
    result = reparentNode(result, contentId, groupId, i + 1, contentLocalTransform);
  }

  // Determine fill rule from mask shape if it is a path with holes.
  const fillRule = opts.fillRule ?? inferFillRule(maskNode);

  result = addMask(result, groupId, maskNodeId, opts.type ?? 'clip', {
    hideMaskSource: opts.hideMaskSource ?? true,
    linked: opts.linked ?? true,
    fillRule,
  });

  return { doc: result, groupId };
}

function insertGroupAtMaskIndex(
  doc: Document,
  parentId: NodeId | null,
  maskNodeId: NodeId,
  group: GroupNode,
): Document {
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && (parent.kind === 'group' || parent.kind === 'frame')) {
      const index = parent.children.indexOf(maskNodeId);
      let d = { ...doc, nodes: { ...doc.nodes, [group.id]: group } };
      const parentWithGroup = { ...parent, children: [...parent.children, group.id] } as SceneNode;
      d = { ...d, nodes: { ...d.nodes, [parentId]: parentWithGroup } };
      // Move the group from the appended position to the mask's old position.
      if (index >= 0) {
        d = moveChildInPlace(d, parentId, group.id, index);
      }
      return d;
    }
  }
  // Root-level fallback.
  const index = doc.rootChildren.indexOf(maskNodeId);
  let d = { ...doc, nodes: { ...doc.nodes, [group.id]: group } };
  d = { ...d, rootChildren: [...d.rootChildren, group.id] };
  if (index >= 0) {
    d = moveRootInPlace(d, group.id, index);
  }
  return d;
}

function moveChildInPlace(doc: Document, parentId: NodeId, id: NodeId, toIndex: number): Document {
  const parent = doc.nodes[parentId];
  if (!parent || (parent.kind !== 'group' && parent.kind !== 'frame')) return doc;
  const children = [...parent.children];
  const from = children.indexOf(id);
  if (from < 0) return doc;
  children.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, children.length));
  children.splice(clamped, 0, id);
  return { ...doc, nodes: { ...doc.nodes, [parentId]: { ...parent, children } as SceneNode } };
}

function moveRootInPlace(doc: Document, id: NodeId, toIndex: number): Document {
  const roots = [...doc.rootChildren];
  const from = roots.indexOf(id);
  if (from < 0) return doc;
  roots.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, roots.length));
  roots.splice(clamped, 0, id);
  return { ...doc, rootChildren: roots };
}

function inferFillRule(node: SceneNode): MaskFillRule | undefined {
  if (node.kind === 'shape' && node.shape.kind === 'path') {
    const s = node.shape;
    if (s.holes && s.holes.length > 0) return s.fillRule ?? 'evenodd';
    return s.fillRule ?? 'nonzero';
  }
  return undefined;
}

function isAncestor(doc: Document, parent: NodeId, child: NodeId): boolean {
  if (parent === child) return true;
  const node = doc.nodes[child];
  if (!node || !('children' in node)) return false;
  for (const c of node.children) {
    if (isAncestor(doc, parent, c)) return true;
  }
  return false;
}

// ── Release / replace ──────────────────────────────────────────────────────

/**
 * Release a clipping group: remove the mask and ungroup the children into
 * their original parent. World transforms are preserved. The mask source node
 * becomes visible again.
 */
export function releaseClippingMask(doc: Document, groupId: NodeId): Document {
  const group = doc.nodes[groupId];
  if (!group || !isClippingMaskGroup(group)) return doc;

  const parentIndex = buildParentIndexMap(doc);
  const parentId = parentIndex.get(groupId) ?? null;
  const groupWorld = nodeWorldTransform(doc, groupId, parentIndex);
  const children = [...group.children];

  let result = removeMask(doc, groupId);
  // Make the mask source visible again if it was hidden.
  const maskSourceId = children[0];
  if (maskSourceId) {
    const maskSource = result.nodes[maskSourceId];
    if (maskSource && maskSource.visible === false) {
      result = {
        ...result,
        nodes: { ...result.nodes, [maskSourceId]: { ...maskSource, visible: true } as SceneNode },
      };
    }
  }

  // Reparent children to the group's parent, preserving world transforms.
  for (let i = 0; i < children.length; i++) {
    const childId = children[i]!;
    const child = result.nodes[childId];
    if (!child) continue;
    const childWorld = multiplyAffine(groupWorld, composeNodeLocalTransform(child));
    const childLocal = parentId
      ? multiplyAffine(invertAffine(nodeWorldTransform(result, parentId, parentIndex)), childWorld)
      : childWorld;
    const index = parentId
      ? (result.nodes[parentId] as GroupNode | import('./types').FrameNode).children.indexOf(
          groupId,
        ) + i
      : result.rootChildren.indexOf(groupId) + i;
    result = reparentNode(result, childId, parentId, index, childLocal);
  }

  // Remove the now-empty group.
  result = removeGroupOnly(result, groupId);
  return result;
}

function removeGroupOnly(doc: Document, groupId: NodeId): Document {
  const group = doc.nodes[groupId];
  if (!group || (group.kind !== 'group' && group.kind !== 'frame')) return doc;
  const parentId = getParent(doc, groupId);
  const nodes = { ...doc.nodes };
  delete nodes[groupId];
  let rootChildren = [...doc.rootChildren];
  if (parentId) {
    const parent = nodes[parentId];
    if (parent && (parent.kind === 'group' || parent.kind === 'frame')) {
      nodes[parentId] = {
        ...parent,
        children: parent.children.filter((c) => c !== groupId),
      } as SceneNode;
    }
  } else {
    rootChildren = rootChildren.filter((c) => c !== groupId);
  }
  return { ...doc, nodes, rootChildren };
}

/**
 * Replace the content of a clipping group. The old content nodes are removed
 * from the group but not deleted from the document. The new nodes are
 * reparented into the group and their world transforms preserved.
 */
export function replaceClippingMaskContent(
  doc: Document,
  groupId: NodeId,
  newContentNodeIds: NodeId[],
): Document {
  const group = doc.nodes[groupId];
  if (!group || !isClippingMaskGroup(group)) throw new Error('Not a clipping group');
  if (!group.children.length) throw new Error('Clipping group has no mask source');

  const parentIndex = buildParentIndexMap(doc);
  const groupWorld = nodeWorldTransform(doc, groupId, parentIndex);
  const groupInverse = invertAffine(groupWorld);

  let result = doc;
  // Remove old content nodes from the group (but keep them in the document as siblings of the group).
  const oldContentIds = group.children.slice(1);
  for (const contentId of oldContentIds) {
    const parentId = parentIndex.get(groupId) ?? null;
    const content = result.nodes[contentId];
    if (!content) continue;
    const contentWorld = multiplyAffine(groupWorld, composeNodeLocalTransform(content));
    const contentLocal = parentId
      ? multiplyAffine(
          invertAffine(nodeWorldTransform(result, parentId, parentIndex)),
          contentWorld,
        )
      : contentWorld;
    const index = parentId
      ? (result.nodes[parentId] as GroupNode | import('./types').FrameNode).children.indexOf(
          groupId,
        ) + 1
      : result.rootChildren.indexOf(groupId) + 1;
    result = reparentNode(result, contentId, parentId, index, contentLocal);
  }

  // Add new content nodes.
  for (let i = 0; i < newContentNodeIds.length; i++) {
    const contentId = newContentNodeIds[i]!;
    const content = result.nodes[contentId];
    if (!content) continue;
    if (getParent(result, contentId) === groupId) {
      // Already in group; just move to correct index.
      result = moveChildInPlace(result, groupId, contentId, i + 1);
      continue;
    }
    const contentLocal = groupInverse
      ? multiplyAffine(groupInverse, composeNodeLocalTransform(content))
      : composeNodeLocalTransform(content);
    result = reparentNode(result, contentId, groupId, i + 1, contentLocal);
  }

  return result;
}

// ── Validation / repair ────────────────────────────────────────────────────

/**
 * Verify that every clipping mask group has a valid mask source and that
 * source is a child of the group. Returns ids of corrupt groups.
 */
export function validateClippingMasks(doc: Document): NodeId[] {
  const corrupt: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isClippingMaskGroup(node)) continue;
    const sourceId = node.mask?.sourceNodeId;
    if (!sourceId || !node.children.includes(sourceId) || !doc.nodes[sourceId]) {
      corrupt.push(id as NodeId);
    }
  }
  return corrupt;
}

/**
 * Repair a corrupt clipping group by removing the broken mask. If the group
 * still has children it becomes a regular group; if it is empty it is removed.
 */
export function repairClippingMask(doc: Document, groupId: NodeId): Document {
  const group = doc.nodes[groupId];
  if (!group || !isClippingMaskGroup(group)) return doc;
  let result = removeMask(doc, groupId);
  const children = (result.nodes[groupId] as GroupNode | undefined)?.children;
  if (!children || children.length === 0) {
    result = removeGroupOnly(result, groupId);
  }
  return result;
}

// ── Serialization helpers ──────────────────────────────────────────────────

/** True if the node is or contains a clipping mask that should be preserved. */
export function hasClippingMask(node: SceneNode): boolean {
  return isClippingMaskGroup(node);
}
