import type { Document } from './document';
import { isContainer, type SceneNode } from './types';

/**
 * Solo View — a reversible, undo-friendly focus mode.
 *
 * When at least one node in the document is soloed, only soloed nodes are
 * effectively visible; every other node is hidden for display. `solo` is a
 * plain boolean on each node (see `NodeBase.solo`), so it integrates with the
 * normal undo/redo and document-update machinery without a separate overlay
 * state. The helpers here centralise the "is anything soloed?" and
 * "is this node effectively visible under solo?" computations so the Layers
 * panel and (eventually) the renderer agree on a single source of truth.
 */

/**
 * Committed documents are immutable, so both answers below are cached per
 * `nodes` record. Layers rows, the canvas renderer, hit testing, and scene
 * scope all ask on every render or frame; an uncached answer is a full node
 * scan each time (measured at 15-30% of main-thread time while dragging a
 * 10k-node document). A record that is edited in place after it was queried
 * would be served stale, which the immutable document contract rules out.
 */
const soloByNodes = new WeakMap<Document['nodes'], boolean>();
// One entry, not a WeakMap: history retains old documents, and a derived
// document per retained revision would hold O(nodes) of copies for each.
let soloAppliedSource: Document | null = null;
let soloAppliedResult: Document | null = null;

/** True when any node in the document is soloed. */
export function documentHasSolo(doc: Document): boolean {
  const cached = soloByNodes.get(doc.nodes);
  if (cached !== undefined) return cached;
  let hasSolo = false;
  for (const node of Object.values(doc.nodes)) {
    if (node && (node as SceneNode).solo) {
      hasSolo = true;
      break;
    }
  }
  soloByNodes.set(doc.nodes, hasSolo);
  return hasSolo;
}

/**
 * Effective visibility of a node under a solo context.
 *
 * A node is effectively visible only if it is explicitly `visible` AND
 * (nothing is soloed OR this node is the soloed one).
 */
export function nodeSoloVisible(node: SceneNode, hasSolo: boolean): boolean {
  if (!node.visible) return false;
  if (!hasSolo) return true;
  return node.solo === true;
}

/**
 * Return a shallow-cloned document whose `visible` flags reflect the solo
 * state, suitable for feeding the renderer without mutating the source
 * document. When nothing is soloed, the original document reference is
 * returned untouched.
 */
export function applySoloToDocument(doc: Document): Document {
  if (!documentHasSolo(doc)) return doc;
  // A stable derived document keeps per-document render memos effective
  // while solo is active, instead of presenting a new document every frame.
  if (soloAppliedSource === doc && soloAppliedResult) return soloAppliedResult;
  const applied = buildSoloAppliedDocument(doc);
  soloAppliedSource = doc;
  soloAppliedResult = applied;
  return applied;
}

function buildSoloAppliedDocument(doc: Document): Document {
  const parentByChild = new Map<string, string>();
  for (const node of Object.values(doc.nodes)) {
    if (!node || !isContainer(node)) continue;
    for (const childId of node.children) parentByChild.set(childId, node.id);
  }

  // Keep soloed containers' descendants and every soloed node's ancestor
  // chain visible. Otherwise soloing a child would hide its group before the
  // renderer can reach it, and soloing a group would render an empty shell.
  const renderable = new Set<string>();
  const addSubtree = (rootId: string): void => {
    const pending = [rootId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (renderable.has(id)) continue;
      renderable.add(id);
      const node = doc.nodes[id];
      if (!node || !isContainer(node)) continue;
      for (const childId of node.children) pending.push(childId);
    }
  };
  for (const node of Object.values(doc.nodes)) {
    if (!node?.solo) continue;
    addSubtree(node.id);
    let parentId = parentByChild.get(node.id);
    while (parentId) {
      renderable.add(parentId);
      parentId = parentByChild.get(parentId);
    }
  }

  const nodes = { ...doc.nodes };
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]!;
    if (!node.visible || !renderable.has(id)) {
      nodes[id] = { ...node, visible: false } as SceneNode;
    }
  }
  return { ...doc, nodes };
}
