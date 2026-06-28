/**
 * Immutable scene Document + operations (Strata plan §3.1, §9).
 *
 * Operations return a new Document (structural sharing where practical). The
 * root is an ordered list of node ids; nodes live in a map. Paint order within
 * siblings is the array order; reorder via `moveNode`.
 *
 * Ordering is array-index for the local-first editor (sufficient without sync).
 * CRDT-safe fractional ordering replaces it when sync lands (Phase 2, plan §1.1).
 */
import type { Affine, Color, Shape } from '@strata/engine';
import type { NodeId, SceneNode, ShapeNode, TextNode } from './types';

export interface Document {
  id: string;
  name: string;
  /** Root-level node ids in paint order. */
  rootChildren: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  /** Monotonic counter for id generation. */
  nextId: number;
}

export function createDocument(name = 'Untitled'): Document {
  return { id: cryptoId(), name, rootChildren: [], nodes: {}, nextId: 1 };
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

/** Remove a node (root-level for now; nested in task 1.1). */
export function removeNode(doc: Document, id: NodeId): Document {
  if (!doc.nodes[id]) return doc;
  const rootChildren = doc.rootChildren.filter((x) => x !== id);
  const nodes = { ...doc.nodes };
  delete nodes[id];
  return { ...doc, rootChildren, nodes };
}

/** Move a root node to a new paint-order index. */
export function moveNode(doc: Document, id: NodeId, toIndex: number): Document {
  const from = doc.rootChildren.indexOf(id);
  if (from < 0) return doc;
  const next = [...doc.rootChildren];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  return { ...doc, rootChildren: next };
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
