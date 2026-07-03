/**
 * Immutable scene Document + operations (Strata plan §3.1, §9).
 *
 * Operations return a new Document (structural sharing where practical). The
 * root is an ordered list of node ids; nodes live in a map. Paint order within
 * siblings is the array order; reorder via `moveNode` / `moveChild`.
 *
 * Container types: FrameNode + GroupNode (via `isContainer`/`getChildren`).
 * Reparent, group/ungroup, and detach-instance ops are available.
 * `walkNodes` recurses into both frame and group children.
 *
 * Ordering is array-index for the local-first editor (sufficient without sync).
 * CRDT-safe fractional ordering replaces it when sync lands (Phase 2, plan §1.1).
 */
import type { Affine, Color, Shape } from '@strata/engine';
import { generateKeyBetween } from '@strata/shared';
import type { ExportSettings } from './export-types';
import type {
  ColorStyle,
  ComponentDefinition,
  ContainerNode,
  EffectStyle,
  FrameNode,
  GroupNode,
  ImageNode,
  LayoutStyleDef,
  NodeId,
  SceneNode,
  ShapeNode,
  Style,
  TextNode,
  TextStyle,
} from './types';

export interface Document {
  id: string;
  name: string;
  /** Root-level node ids in paint order. */
  rootChildren: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  /** Registered component definitions keyed by component id (task 1.1). */
  components: Record<NodeId, ComponentDefinition>;
  /** Monotonic counter for id generation. */
  nextId: number;
  /** Canvas width in px (artboard/frame size). */
  canvasWidth?: number;
  /** Canvas height in px (artboard/frame size). */
  canvasHeight?: number;
  /** Canvas background color (RGBA). */
  canvasBackground?: Color;
  /** Per-document export defaults (optional — falls back to ExportSettings globals). */
  exportDefaults?: Partial<ExportSettings>;
  /** Reusable styles keyed by style id (color, text, effect, layout). */
  styles?: Record<string, Style>;
  /** Persisted variable store with collections and modes. */
  variableStore?: import('./variables').VariableStore;
  /** References to installed libraries. */
  installedLibraries?: import('./library').InstalledLibraryRef[];
}

export interface NodeEntry {
  nodeId: NodeId;
  node: SceneNode;
  parentId: NodeId | null;
  /** Recursive depth (0 for root-level). */
  depth: number;
}

export function createDocument(name = 'Untitled'): Document {
  return { id: cryptoId(), name, rootChildren: [], nodes: {}, components: {}, nextId: 1 };
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc-${Math.random().toString(36).slice(2)}`;
}

/** Allocate the next stable node id from the document's counter. */
export function nextNodeId(doc: Document): { id: NodeId; doc: Document } {
  const id = `n${doc.nextId}`;
  return { id, doc: { ...doc, nextId: doc.nextId + 1 } };
}

export function makeAdjustmentNode(
  id: NodeId,
  adjustmentType: import('./types').AdjustmentType,
  params: import('./types').AdjustmentParams,
  opts: Partial<
    Pick<
      import('./types').AdjustmentNode,
      | 'name' | 'transform' | 'fill' | 'visible' | 'locked'
      | 'opacity' | 'blendMode' | 'rotation' | 'clipping' | 'effects' | 'order'
    >
  > & { index?: number } = {},
): import('./types').AdjustmentNode {
  return {
    id,
    kind: 'adjustment',
    name: opts.name ?? adjustmentType.charAt(0).toUpperCase() + adjustmentType.slice(1),
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    fill: opts.fill ?? ([0, 0, 0, 0] as Color),
    adjustmentType,
    params,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    clipping: opts.clipping ?? false,
    effects: opts.effects ?? [],
  };
}

export function makeShapeNode(
  id: NodeId,
  shape: Shape,
  opts: Partial<
    Pick<
      ShapeNode,
      | 'name'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'cornerRadius'
      | 'order'
    >
  > & {
    index?: number;
  } = {},
): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Shape',
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    shape,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([57, 208, 198, 255] as Color),
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    cornerRadius: opts.cornerRadius,
  };
}

export function makeTextNode(
  id: NodeId,
  text: string,
  opts: Partial<
    Pick<
      TextNode,
      | 'name'
      | 'transform'
      | 'fill'
      | 'fontSize'
      | 'fontFamily'
      | 'fontWeight'
      | 'fontStyle'
      | 'lineHeight'
      | 'letterSpacing'
      | 'textAlign'
      | 'textCase'
      | 'textDecoration'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
    >
  > & {
    index?: number;
  } = {},
): TextNode {
  return {
    id,
    kind: 'text',
    name: opts.name ?? 'Text',
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: true,
    locked: false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    text,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([16, 21, 31, 255] as Color),
    fontSize: opts.fontSize ?? 16,
    fontFamily: opts.fontFamily ?? 'Inter',
    fontWeight: opts.fontWeight ?? 400,
    fontStyle: opts.fontStyle ?? 'normal',
    lineHeight: opts.lineHeight ?? 1.2,
    letterSpacing: opts.letterSpacing ?? 0,
    textAlign: opts.textAlign ?? 'left',
    textCase: opts.textCase,
    textDecoration: opts.textDecoration,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

export function makeGroupNode(
  id: NodeId,
  opts: Partial<
    Pick<
      GroupNode,
      | 'name'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'order'
    >
  > & {
    index?: number;
  } = {},
): GroupNode {
  return {
    id,
    kind: 'group',
    name: opts.name ?? 'Group',
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([0, 0, 0, 0] as Color),
    children: opts.children ?? [],
  };
}

export function makeFrameNode(
  id: NodeId,
  opts: Partial<
    Pick<
      FrameNode,
      | 'name'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'componentId'
      | 'slots'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'w'
      | 'h'
      | 'clipContent'
    >
  > & {
    index?: number;
  } = {},
): FrameNode {
  return {
    id,
    kind: 'frame',
    name: opts.name ?? 'Frame',
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([200, 200, 200, 255] as Color),
    w: opts.w ?? 200,
    h: opts.h ?? 160,
    children: opts.children ?? [],
    componentId: opts.componentId,
    slots: opts.slots,
    clipContent: opts.clipContent,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

export function makeImageNode(
  id: NodeId,
  opts: Partial<
    Pick<
      ImageNode,
      | 'name'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'src'
      | 'w'
      | 'h'
      | 'imageFit'
    >
  > & {
    index?: number;
  } = {},
): ImageNode {
  return {
    id,
    kind: 'image',
    name: opts.name ?? 'Image',
    index: opts.index ?? 0,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([0, 0, 0, 0] as Color),
    src: opts.src ?? '',
    w: opts.w ?? 100,
    h: opts.h ?? 100,
    imageFit: opts.imageFit ?? 'fill',
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

/** Walk all nodes in paint order (DFS), yielding each with its parent info. */
export function walkNodes(doc: Document): Map<NodeId, NodeEntry> {
  const entries = new Map<NodeId, NodeEntry>();
  function walk(parentId: NodeId | null, ids: NodeId[], depth: number) {
    for (const nid of ids) {
      const node = doc.nodes[nid];
      if (!node) continue;
      entries.set(nid, { nodeId: nid, node, parentId, depth });
      if (isContainer(node) && node.children.length > 0) {
        walk(nid, node.children, depth + 1);
      }
    }
  }
  walk(null, doc.rootChildren, 0);
  return entries;
}

/** Find the parent that contains the given node id. O(n) — fine for editor scale. */
export function getParent(doc: Document, id: NodeId): NodeId | null {
  if (doc.rootChildren.includes(id)) return null;
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node) && node.children.includes(id)) return nid as NodeId;
  }
  return null;
}

/** True if the node is a container (has a children array). */
export function isContainer(node: SceneNode): node is ContainerNode {
  return node.kind === 'frame' || node.kind === 'group';
}

/** Get the children array of a container node, or null if not a container. */
export function getChildren(doc: Document, id: NodeId): NodeId[] | null {
  const node = doc.nodes[id];
  if (!node || !isContainer(node)) return null;
  return node.children;
}

/** Append a node to the root paint order. */
export function addNode(doc: Document, node: SceneNode): Document {
  const index = doc.rootChildren.length;
  const indexed = { ...node, index };
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
  const nodes = { ...doc.nodes, [node.id]: { ...node, index: clamped } };
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
  const childIndex = parent.children.length;
  const indexed = { ...child, index: childIndex };
  const newChildren = [...parent.children, child.id];
  const updated = { ...parent, children: newChildren } as SceneNode;
  if ('slots' in parent && slotId) {
    (updated as FrameNode).slots = { ...(parent.slots ?? {}), [slotId]: child.id };
  } else if ('slots' in parent && slotId === undefined) {
    (updated as FrameNode).slots = parent.slots;
  }
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [parentId]: updated,
      [child.id]: indexed,
    },
  };
}

/** Remove a node from the document (nested-aware). Recursively removes descendants. */
export function removeNode(doc: Document, id: NodeId): Document {
  if (!doc.nodes[id]) return doc;

  const nodes = { ...doc.nodes };

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

  // Delete all collected nodes
  for (const nid of toRemove) {
    delete nodes[nid];
  }

  return { ...doc, rootChildren, nodes };
}

/** Move a root-level node to a new paint-order index. Also updates `order` field. */
export function moveNode(doc: Document, id: NodeId, toIndex: number): Document {
  const from = doc.rootChildren.indexOf(id);
  if (from < 0) return doc;
  const next = [...doc.rootChildren];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
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

export type ArrangeOp = 'front' | 'back' | 'forward' | 'backward';

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
    let to: number;
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
    let to: number;
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

  // Validate new parent
  if (newParentId) {
    const newParent = doc.nodes[newParentId];
    if (!newParent || !isContainer(newParent)) return doc;
    if (isAncestor(doc, id, newParentId)) return doc;
  }

  const nodes = { ...doc.nodes };

  // Remove from old parent
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
      nodes[oldParentId] = updated;
    }
  } else {
    rootChildren = rootChildren.filter((x) => x !== id);
  }

  // Generate order key at the insertion position.
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
      index: clamped,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  } else {
    const clamped = Math.max(0, Math.min(toIndex, rootChildren.length));
    rootChildren.splice(clamped, 0, id);
    const newOrder = generateOrder(rootChildren, clamped);
    nodes[id] = {
      ...node,
      index: clamped,
      order: newOrder,
      transform: (localTransform ?? node.transform) as Affine,
    } as SceneNode;
  }

  return { ...doc, rootChildren, nodes };
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
  }

  const groupInDoc = d.nodes[groupNode.id];
  if (!groupInDoc) return d;
  d = {
    ...d,
    nodes: { ...d.nodes, [groupNode.id]: { ...groupInDoc, children } as GroupNode },
  };

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
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [id]: {
        ...frame,
        componentId: newComponentId,
        // Inherit appearance/layout from the new master, keep transform/position
        fill: masterFrame.fill,
        fills: masterFrame.fills,
        strokes: masterFrame.strokes,
        effects: masterFrame.effects,
        opacity: masterFrame.opacity,
        blendMode: masterFrame.blendMode,
        rotation: masterFrame.rotation,
        layoutStyle: masterFrame.layoutStyle,
        // Reset slots — caller re-fills via fillSlot
        slots: {},
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
  const node = doc.nodes[id];
  if (node?.kind !== 'frame') return [];
  const frame = node as FrameNode;
  if (!frame.componentId) return [];
  const component = doc.components[frame.componentId];
  if (!component) return [];
  const master = doc.nodes[component.masterRootId];
  if (master?.kind !== 'frame') return [];
  const masterFrame = master as FrameNode;
  const overrides: string[] = [];
  // Compare fill by value (RGBA array) since each makeFrameNode creates a new array
  if (JSON.stringify(frame.fill) !== JSON.stringify(masterFrame.fill)) overrides.push('fill');
  if (frame.opacity !== masterFrame.opacity) overrides.push('opacity');
  if (frame.blendMode !== masterFrame.blendMode) overrides.push('blendMode');
  if (frame.rotation !== masterFrame.rotation) overrides.push('rotation');
  if (JSON.stringify(frame.layoutStyle) !== JSON.stringify(masterFrame.layoutStyle))
    overrides.push('layout');
  if (JSON.stringify(frame.strokes) !== JSON.stringify(masterFrame.strokes))
    overrides.push('strokes');
  if (JSON.stringify(frame.effects) !== JSON.stringify(masterFrame.effects))
    overrides.push('effects');
  return overrides;
}
