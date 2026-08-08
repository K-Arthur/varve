import type { Affine } from '@varve/engine';
import { generateKeyBetween } from '@varve/shared';
import { deepCloneSubtree } from './clone';
import { captureSyncBaseline, detectOverrides } from './component-sync';
import type { Document } from './document';
import { devValidate, getParent } from './document-utils';
import type {
  ArrangeOp,
  ContainerNode,
  FrameNode,
  GroupNode,
  LayerColor,
  NodeId,
  SceneNode,
} from './types';
import { isContainer } from './types';

/** Append a node to the root paint order. */
export function addNode(doc: Document, node: SceneNode): Document {
  const index = doc.rootChildren.length;
  const prev = index > 0 ? doc.nodes[doc.rootChildren[index - 1]!] : null;
  const order = generateKeyBetween(prev?.order ?? null, null);
  const indexed = { ...node, index, order };
  return {
    ...doc,
    rootChildren: [...doc.rootChildren, node.id],
    nodes: { ...doc.nodes, [node.id]: indexed },
  };
}

/** Insert a node at a specific paint-order index in the root. */
export function insertNode(doc: Document, node: SceneNode, atIndex: number): Document {
  const next = [...doc.rootChildren];
  const clamped = Math.max(0, Math.min(atIndex, next.length));
  next.splice(clamped, 0, node.id);
  const prev = clamped > 0 ? doc.nodes[next[clamped - 1]!] : null;
  const succ = clamped < next.length - 1 ? doc.nodes[next[clamped + 1]!] : null;
  const order = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  const nodes = { ...doc.nodes, [node.id]: { ...node, order } };
  return { ...doc, rootChildren: next, nodes };
}

/** Add a child to a container (FrameNode or GroupNode). Optionally fills a slot (frame only). */
export function addChild(
  doc: Document,
  parentId: NodeId,
  child: SceneNode,
  slotId?: string,
): Document {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return doc;
  const children = parent.children;
  const lastChildId = children.length > 0 ? children[children.length - 1]! : null;
  const lastChild = lastChildId ? doc.nodes[lastChildId] : null;
  const order = generateKeyBetween(lastChild?.order ?? null, null);
  const indexed = { ...child, order };
  const newChildren = [...children, child.id];
  const updated = { ...parent, children: newChildren } as SceneNode;
  if ('slots' in parent && slotId) {
    (updated as FrameNode).slots = { ...(parent.slots ?? {}), [slotId]: child.id };
  } else if ('slots' in parent && slotId === undefined) {
    (updated as FrameNode).slots = parent.slots;
  }
  const result = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [parentId]: updated,
      [child.id]: indexed,
    },
  };
  devValidate(result);
  return result;
}

/** Remove a node from the document (nested-aware). Recursively removes descendants. */
export function removeNode(doc: Document, id: NodeId): Document {
  if (!doc.nodes[id]) return doc;

  let nodes = { ...doc.nodes };

  // Collect all descendants to remove
  const toRemove = new Set<NodeId>();
  function collect(nid: NodeId) {
    if (toRemove.has(nid)) return;
    toRemove.add(nid);
    const n = nodes[nid];
    if (n && isContainer(n)) {
      for (const cId of n.children) collect(cId);
    }
  }
  collect(id);
  const removedRasterAssetIds = new Set(
    [...toRemove]
      .map((nodeId) => nodes[nodeId]?.mask?.rasterMask?.assetId)
      .filter((assetId): assetId is string => Boolean(assetId)),
  );
  const removedImageAssetIds = new Set(
    [...toRemove].flatMap((nodeId) =>
      (nodes[nodeId]?.fills ?? [])
        .filter((f) => f.type === 'image' && f.image?.assetId)
        .map((f) => f.image!.assetId as string),
    ),
  );

  // Remove from parent's children list
  const parentId = getParent(doc, id);
  let rootChildren = doc.rootChildren;
  if (parentId) {
    const parent = nodes[parentId] as SceneNode | undefined;
    if (parent && isContainer(parent)) {
      const newParentChildren = parent.children.filter((c) => !toRemove.has(c));
      const updated = { ...parent, children: newParentChildren } as SceneNode;
      if ('slots' in parent && parent.slots) {
        const filteredSlots = Object.fromEntries(
          Object.entries(parent.slots).filter(([_, v]) => !toRemove.has(v)),
        );
        (updated as FrameNode).slots =
          Object.keys(filteredSlots).length > 0 ? filteredSlots : undefined;
      }
      nodes[parentId] = updated;
    }
  } else {
    rootChildren = doc.rootChildren.filter((x) => !toRemove.has(x));
  }

  // Clear mask references that point to any removed node
  for (const removedId of toRemove) {
    for (const [id, nodeEntry] of Object.entries(nodes)) {
      const n = nodeEntry as SceneNode & { mask?: import('./types').Mask };
      if (n.mask?.sourceNodeId === removedId) {
        const { mask: _unused, ...rest } = n;
        nodes = { ...nodes, [id]: rest as SceneNode };
      }
    }
  }

  // Delete all collected nodes
  for (const nid of toRemove) {
    delete nodes[nid];
  }

  const rasterMaskAssets = { ...doc.rasterMaskAssets };
  for (const assetId of removedRasterAssetIds) {
    const stillReferenced = Object.values(nodes).some(
      (node) => node.mask?.rasterMask?.assetId === assetId,
    );
    if (!stillReferenced) delete rasterMaskAssets[assetId];
  }
  const assets = { ...doc.assets };
  for (const assetId of removedImageAssetIds) {
    const stillReferenced =
      Object.values(nodes).some((node) =>
        node.fills?.some((f) => f.type === 'image' && f.image?.assetId === assetId),
      ) ||
      Object.values(doc.paints ?? {}).some(
        (paint) => paint.fill.type === 'image' && paint.fill.image?.assetId === assetId,
      );
    if (!stillReferenced) delete assets[assetId];
  }
  const result = {
    ...doc,
    rootChildren,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
  };
  devValidate(result);
  return result;
}

/** Move a root-level node to a new paint-order index. Also updates `order` field. */
export function moveNode(doc: Document, id: NodeId, toIndex: number): Document {
  const from = doc.rootChildren.indexOf(id);
  if (from < 0) return doc;
  const next = [...doc.rootChildren];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  if (clamped === from) return doc;
  next.splice(clamped, 0, id);
  const node = doc.nodes[id];
  if (!node) return doc;
  const nodes = { ...doc.nodes };
  const prev = clamped > 0 ? doc.nodes[next[clamped - 1]!] : null;
  const succ = clamped < next.length - 1 ? doc.nodes[next[clamped + 1]!] : null;
  const newOrder = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  nodes[id] = { ...node, order: newOrder } as SceneNode;
  return { ...doc, rootChildren: next, nodes };
}

/**
 * Arrange a node within its current parent's sibling list.
 * 'front'/'back' move to the end/start (highest/lowest paint order).
 * 'forward'/'backward' step one position toward the end/start.
 * No-op when the node is already at the boundary or not found.
 */
export function arrangeNode(doc: Document, id: NodeId, op: ArrangeOp): Document {
  const parentId = getParent(doc, id);
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent || !isContainer(parent)) return doc;
    const siblings = parent.children;
    const from = siblings.indexOf(id);
    if (from < 0) return doc;
    let to = 0;
    switch (op) {
      case 'front':
        to = siblings.length - 1;
        break;
      case 'back':
        to = 0;
        break;
      case 'forward':
        to = from + 1;
        break;
      case 'backward':
        to = from - 1;
        break;
    }
    if (to === from || to < 0 || to >= siblings.length) return doc;
    return moveChild(doc, parentId, id, to);
  } else {
    const siblings = doc.rootChildren;
    const from = siblings.indexOf(id);
    if (from < 0) return doc;
    let to = 0;
    switch (op) {
      case 'front':
        to = siblings.length - 1;
        break;
      case 'back':
        to = 0;
        break;
      case 'forward':
        to = from + 1;
        break;
      case 'backward':
        to = from - 1;
        break;
    }
    if (to === from || to < 0 || to >= siblings.length) return doc;
    return moveNode(doc, id, to);
  }
}

/** Move a nested child within its parent's children array. Also updates `order` field. */
export function moveChild(doc: Document, parentId: NodeId, id: NodeId, toIndex: number): Document {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return doc;
  const from = parent.children.indexOf(id);
  if (from < 0) return doc;
  const newChildren = [...parent.children];
  newChildren.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, newChildren.length));
  newChildren.splice(clamped, 0, id);
  const node = doc.nodes[id];
  if (!node) return doc;
  const nodes = { ...doc.nodes };
  const prev = clamped > 0 ? doc.nodes[newChildren[clamped - 1]!] : null;
  const succ = clamped < newChildren.length - 1 ? doc.nodes[newChildren[clamped + 1]!] : null;
  const newOrder = generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  nodes[id] = { ...node, order: newOrder } as SceneNode;
  nodes[parentId] = { ...parent, children: newChildren } as SceneNode;
  return { ...doc, nodes };
}

export function setSnapExcluded(doc: Document, id: NodeId, excluded: boolean): Document {
  const n = doc.nodes[id];
  if (!n) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...n, snapExcluded: excluded } } };
}

export function setLayerColor(doc: Document, id: NodeId, color: LayerColor | null): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, layerColor: color } } };
}

export function setBackgroundRemoval(
  doc: Document,
  id: NodeId,
  state: import('./types').BackgroundRemovalState | undefined,
): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  if (node.kind !== 'shape') return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, backgroundRemoval: state } } };
}

export function renameNode(doc: Document, id: NodeId, name: string): Document {
  const node = doc.nodes[id];
  if (!node) return doc;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } };
}

export function getById(doc: Document, id: NodeId): SceneNode | undefined {
  return doc.nodes[id];
}

/** Convenience: list root nodes in paint order. */
export function rootNodes(doc: Document): SceneNode[] {
  return doc.rootChildren.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
}

/**
 * Reparent a node from its current parent to a new parent (or root).
 * Validates: newParent is a container, node is not its own ancestor.
 * Removes from old parent, inserts into new parent — all in one atomic op.
 *
 * If `localTransform` is provided, it replaces the node's transform in the
 * new position (used by the editor to preserve world position when the old
 * and new parents have different transforms). Otherwise the node's current
 * transform is kept verbatim (legacy behaviour that causes a world-position
 * jump when parents differ).
 */
export function reparentNode(
  doc: Document,
  id: NodeId,
  newParentId: NodeId | null,
  toIndex: number,
  localTransform?: Affine,
): Document {
  const node = doc.nodes[id];
  if (!node) return doc;

  if (newParentId) {
    const newParent = doc.nodes[newParentId];
    if (!newParent || !isContainer(newParent)) return doc;
    if (isAncestor(doc, newParentId, id)) return doc;
  }

  const nodes = { ...doc.nodes };

  const oldParentId = getParent(doc, id);
  let rootChildren = [...doc.rootChildren];
  if (oldParentId) {
    const oldParent = nodes[oldParentId] as SceneNode | undefined;
    if (oldParent && isContainer(oldParent)) {
      const updated = {
        ...oldParent,
        children: oldParent.children.filter((c) => c !== id),
      } as SceneNode;
      if ('slots' in oldParent && oldParent.slots) {
        const filteredSlots = Object.fromEntries(
          Object.entries(oldParent.slots).filter(([_, v]) => v !== id),
        );
        (updated as FrameNode).slots =
          Object.keys(filteredSlots).length > 0 ? filteredSlots : undefined;
      }
      // A mask source leaving its container leaves the container with a
      // dangling source reference (the relationship only holds while the
      // matte is a direct child). Release the container's mask so a plain
      // reorder/drag can never corrupt the clipping graph. Reorders within
      // the same container keep the mask.
      if (oldParentId !== newParentId && updated.mask?.sourceNodeId === id) {
        (updated as SceneNode & { mask?: undefined }).mask = undefined;
      }
      nodes[oldParentId] = updated;
    }
  } else {
    rootChildren = rootChildren.filter((x) => x !== id);
  }

  const generateOrder = (siblings: NodeId[], pos: number): string => {
    const prev = pos > 0 ? doc.nodes[siblings[pos - 1]!] : null;
    const succ = pos < siblings.length - 1 ? doc.nodes[siblings[pos + 1]!] : null;
    return generateKeyBetween(prev?.order ?? null, succ?.order ?? null);
  };

  if (newParentId) {
    const newParent = nodes[newParentId];
    if (!newParent || !isContainer(newParent)) return { ...doc, rootChildren, nodes };
    const children = [...newParent.children];
    const clamped = Math.max(0, Math.min(toIndex, children.length));
    children.splice(clamped, 0, id);
    const newOrder = generateOrder(children, clamped);
    nodes[newParentId] = { ...newParent, children } as SceneNode;
    nodes[id] = {
      ...node,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  } else {
    const clamped = Math.max(0, Math.min(toIndex, rootChildren.length));
    rootChildren.splice(clamped, 0, id);
    const newOrder = generateOrder(rootChildren, clamped);
    nodes[id] = {
      ...node,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  }

  const result = { ...doc, rootChildren, nodes };
  devValidate(result);
  return result;
}

function isAncestor(doc: Document, parent: NodeId, child: NodeId): boolean {
  if (parent === child) return true;
  const node = doc.nodes[child];
  if (!node || !isContainer(node)) return false;
  for (const c of node.children) {
    if (isAncestor(doc, parent, c)) return true;
  }
  return false;
}

/**
 * Group a set of sibling nodes into a new GroupNode.
 * All nodes must share the same parent (or be root-level).
 */
export function groupNodes(doc: Document, ids: NodeId[], groupNode: GroupNode): Document {
  if (ids.length < 2) return doc;

  const firstId = ids[0];
  if (!firstId) return doc;
  const first = doc.nodes[firstId];
  if (!first) return doc;
  const parentId: NodeId | null = getParent(doc, firstId);

  for (let i = 1; i < ids.length; i++) {
    const nid = ids[i];
    if (!nid) return doc;
    const n = doc.nodes[nid];
    if (!n) return doc;
    if (getParent(doc, nid) !== parentId) return doc;
  }

  const children = [...groupNode.children];
  let d = addNode(doc, groupNode);

  const parentIdNonNull = parentId as NodeId;
  const sorted = [...ids].sort((a, b) => {
    const idxA = parentId
      ? d.nodes[parentIdNonNull] && isContainer(d.nodes[parentIdNonNull])
        ? (d.nodes[parentIdNonNull] as ContainerNode).children.indexOf(a)
        : -1
      : d.rootChildren.indexOf(a);
    const idxB = parentId
      ? d.nodes[parentIdNonNull] && isContainer(d.nodes[parentIdNonNull])
        ? (d.nodes[parentIdNonNull] as ContainerNode).children.indexOf(b)
        : -1
      : d.rootChildren.indexOf(b);
    return idxA - idxB;
  });

  let groupInsertIdx = -1;
  if (parentId) {
    const parentNode = d.nodes[parentIdNonNull];
    const firstSorted = sorted[0];
    if (firstSorted && parentNode && isContainer(parentNode)) {
      groupInsertIdx = parentNode.children.indexOf(firstSorted);
    }
  }

  for (const sid of sorted) {
    d = reparentNode(d, sid, groupNode.id, children.length);
    children.push(sid);
  }

  if (parentId === null) {
    const firstSorted = sorted[0];
    if (!firstSorted) return d;
    const firstIdxInRoot = d.rootChildren.indexOf(firstSorted);
    if (firstIdxInRoot >= 0) {
      d = moveNode(d, groupNode.id, Math.min(firstIdxInRoot, d.rootChildren.length - 1));
    }
  } else {
    d = reparentNode(d, groupNode.id, parentId, groupInsertIdx >= 0 ? groupInsertIdx : 0);
  }

  const groupInDoc = d.nodes[groupNode.id];
  if (!groupInDoc) {
    devValidate(d);
    return d;
  }
  d = {
    ...d,
    nodes: { ...d.nodes, [groupNode.id]: { ...groupInDoc, children } as GroupNode },
  };

  devValidate(d);
  return d;
}

/**
 * Ungroup a GroupNode: move all children to the group's parent and remove the group.
 */
export function ungroupNode(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'group') return doc;
  const group = node as GroupNode;
  const parentId: NodeId | null = getParent(doc, id);
  const children = [...group.children];

  let d = doc;
  for (let i = 0; i < children.length; i++) {
    const childId = children[i];
    if (!childId) continue;
    const toIndex = parentId
      ? (d.nodes[parentId] && isContainer(d.nodes[parentId])
          ? (d.nodes[parentId] as ContainerNode).children.indexOf(id)
          : -1) + i
      : d.rootChildren.indexOf(id) + i;
    d = reparentNode(d, childId, parentId, toIndex);
  }

  d = removeNode(d, id);
  devValidate(d);
  return d;
}

/**
 * Detach a component instance: clear its componentId so it becomes a plain frame.
 */
export function detachInstance(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  if (!frame.componentId) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: { ...frame, componentId: undefined } as FrameNode,
    },
  };
}

/**
 * Swap a component instance to a different component definition.
 * Preserves the instance's transform/position but resets slot fills and
 * inherited properties to the new master's defaults.
 */
export function swapInstance(doc: Document, id: NodeId, newComponentId: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  const newComponent = doc.components[newComponentId];
  if (!newComponent) return doc;
  const master = doc.nodes[newComponent.masterRootId];
  if (master?.kind !== 'frame') return doc;
  const masterFrame = master as FrameNode;

  let workingDoc = doc;
  const oldChildIds = [...frame.children];
  for (const childId of oldChildIds) {
    workingDoc = removeNode(workingDoc, childId);
  }

  const newChildren: NodeId[] = [];
  const newNodes: Record<NodeId, SceneNode> = {};
  const slots: Record<string, NodeId> = {};

  for (const childId of masterFrame.children) {
    const slotDef = newComponent.slots.find((s) => s.defaultContentId === childId);
    const cloneResult = deepCloneSubtree(workingDoc.nodes, workingDoc.nextId, childId);
    workingDoc = { ...workingDoc, nextId: cloneResult.nextId };
    Object.assign(newNodes, cloneResult.nodes);
    newChildren.push(cloneResult.rootId);
    if (slotDef) {
      slots[slotDef.id] = cloneResult.rootId;
    }
  }

  return {
    ...workingDoc,
    nodes: {
      ...workingDoc.nodes,
      ...newNodes,
      [id]: {
        ...frame,
        componentId: newComponentId,
        children: newChildren,
        fill: masterFrame.fill,
        fills: masterFrame.fills,
        strokes: masterFrame.strokes,
        effects: masterFrame.effects,
        opacity: masterFrame.opacity,
        blendMode: masterFrame.blendMode,
        rotation: masterFrame.rotation,
        layoutStyle: masterFrame.layoutStyle,
        w: masterFrame.w,
        h: masterFrame.h,
        clipContent: masterFrame.clipContent,
        slots: Object.keys(slots).length > 0 ? slots : undefined,
        syncBaseline: captureSyncBaseline(masterFrame),
        variant: undefined,
        propertyOverrides: undefined,
      } as FrameNode,
    },
  };
}

/**
 * Reset overrides on a component instance: restore inherited properties from
 * the master definition. Preserves the instance's transform, name, and slot
 * fills (those are intentional local content, not overrides).
 */
export function resetInstanceOverrides(doc: Document, id: NodeId): Document {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return doc;
  const frame = node as FrameNode;
  if (!frame.componentId) return doc;
  const component = doc.components[frame.componentId];
  if (!component) return doc;
  const master = doc.nodes[component.masterRootId];
  if (master?.kind !== 'frame') return doc;
  const masterFrame = master as FrameNode;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: {
        ...frame,
        fill: masterFrame.fill,
        fills: masterFrame.fills,
        strokes: masterFrame.strokes,
        effects: masterFrame.effects,
        opacity: masterFrame.opacity,
        blendMode: masterFrame.blendMode,
        layoutStyle: masterFrame.layoutStyle,
      } as FrameNode,
    },
  };
}

/**
 * Detect which properties of an instance differ from its master (overrides).
 * Returns a list of property names that have been locally overridden.
 */
export function instanceOverrides(doc: Document, id: NodeId): string[] {
  return detectOverrides(doc, id);
}
