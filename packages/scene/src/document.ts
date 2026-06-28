/**
 * Immutable scene Document + operations (Strata plan §3.1, §9).
 *
 * Operations return a new Document (structural sharing where practical). The
 * root is an ordered list of node ids; nodes live in a map. Paint order within
 * siblings is the array order; reorder via `moveNode` / `moveChild`.
 *
 * Task 1.1 extends the model for nested FrameNode children: `addChild`,
 * `removeChild`, `moveChild`, and the `walkNodes` helper. Existing root-level
 * ops (`addNode`, `removeNode`, `moveNode`) are updated to handle nested nodes.
 *
 * Ordering is array-index for the local-first editor (sufficient without sync).
 * CRDT-safe fractional ordering replaces it when sync lands (Phase 2, plan §1.1).
 */
import type { Affine, Color, Shape } from '@strata/engine';
import type {
  ComponentDefinition,
  FrameNode,
  NodeId,
  SceneNode,
  ShapeNode,
  TextNode,
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

export function makeShapeNode(
  id: NodeId,
  shape: Shape,
  opts: Partial<Pick<ShapeNode, 'name' | 'transform' | 'fill' | 'visible' | 'locked'>> & {
    index?: number;
  } = {},
): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Shape',
    index: opts.index ?? 0,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    shape,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([57, 208, 198, 255] as Color),
  };
}

export function makeTextNode(
  id: NodeId,
  text: string,
  opts: Partial<Pick<TextNode, 'name' | 'transform' | 'fill' | 'fontSize'>> & {
    index?: number;
  } = {},
): TextNode {
  return {
    id,
    kind: 'text',
    name: opts.name ?? 'Text',
    index: opts.index ?? 0,
    visible: true,
    locked: false,
    text,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([16, 21, 31, 255] as Color),
    fontSize: opts.fontSize ?? 16,
  };
}

export function makeFrameNode(
  id: NodeId,
  opts: Partial<
    Pick<
      FrameNode,
      'name' | 'transform' | 'fill' | 'visible' | 'locked' | 'children' | 'componentId' | 'slots'
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
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? ([200, 200, 200, 255] as Color),
    children: opts.children ?? [],
    componentId: opts.componentId,
    slots: opts.slots,
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
      if (node.kind === 'frame' && node.children.length > 0) {
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
    if (node.kind === 'frame' && node.children.includes(id)) return nid as NodeId;
  }
  return null;
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

/** Add a child to a FrameNode. Optionally fills a slot. */
export function addChild(
  doc: Document,
  parentId: NodeId,
  child: SceneNode,
  slotId?: string,
): Document {
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame') return doc;
  const parentFrame = parent as FrameNode;
  const childIndex = parentFrame.children.length;
  const indexed = { ...child, index: childIndex };
  const newChildren = [...parentFrame.children, child.id];
  const newSlots = slotId
    ? { ...(parentFrame.slots ?? {}), [slotId]: child.id }
    : parentFrame.slots;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [parentId]: { ...parentFrame, children: newChildren, slots: newSlots } as FrameNode,
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
    if (n && n.kind === 'frame') {
      for (const cId of n.children) collect(cId);
    }
  }
  collect(id);

  // Remove from parent's children list
  const parentId = getParent(doc, id);
  let rootChildren = doc.rootChildren;
  if (parentId) {
    const parent = nodes[parentId] as FrameNode | undefined;
    if (parent && parent.kind === 'frame') {
      const newParentChildren = parent.children.filter((c) => !toRemove.has(c));
      const newParentSlots = parent.slots
        ? Object.fromEntries(Object.entries(parent.slots).filter(([_, v]) => !toRemove.has(v)))
        : undefined;
      const cleanedSlots =
        newParentSlots && Object.keys(newParentSlots).length > 0 ? newParentSlots : undefined;
      nodes[parentId] = {
        ...parent,
        children: newParentChildren,
        slots: cleanedSlots,
      } as FrameNode;
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

/** Move a root-level node to a new paint-order index. */
export function moveNode(doc: Document, id: NodeId, toIndex: number): Document {
  const from = doc.rootChildren.indexOf(id);
  if (from < 0) return doc;
  const next = [...doc.rootChildren];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  return { ...doc, rootChildren: next };
}

/** Move a nested child within its parent's children array. */
export function moveChild(doc: Document, parentId: NodeId, id: NodeId, toIndex: number): Document {
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame') return doc;
  const frame = parent as FrameNode;
  const from = frame.children.indexOf(id);
  if (from < 0) return doc;
  const newChildren = [...frame.children];
  newChildren.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, newChildren.length));
  newChildren.splice(clamped, 0, id);
  return {
    ...doc,
    nodes: { ...doc.nodes, [parentId]: { ...frame, children: newChildren } as FrameNode },
  };
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
