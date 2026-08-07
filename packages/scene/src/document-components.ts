import { deepCloneSubtree } from './clone';
import type { Document } from './document';
import { removeNode } from './document-nodes';
import { cryptoId, makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import type {
  GroupNode,
  MasterAppliesTo,
  MasterOverride,
  MasterOverrideType,
  MasterPage,
  NodeId,
} from './types';

// ── Master page CRUD ───────────────────────────────────────────────────────

export interface CreateMasterOptions {
  name: string;
  width: number;
  height: number;
  appliesTo?: MasterAppliesTo;
  description?: string;
}

/**
 * Create a new master page. A master is a reusable template that can be
 * applied to one or more pages. Masters are stored in `doc.masters` keyed
 * by their ID and their contentRoot is added to `rootChildren` so it
 * participates in the scene render walk.
 */
export function createMaster(doc: Document, opts: CreateMasterOptions): Document {
  const masterId = cryptoId();
  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: `${opts.name} content`,
    children: [],
  });

  const master: MasterPage = {
    id: masterId,
    name: opts.name,
    width: opts.width,
    height: opts.height,
    contentRoot: contentRootId,
    appliesTo: opts.appliesTo ?? 'all',
    description: opts.description,
  };

  return {
    ...d1,
    masters: {
      ...(d1.masters ?? {}),
      [masterId]: master,
    },
    rootChildren: [...d1.rootChildren, contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

/**
 * Delete a master page. Removes the master's contentRoot and all descendants,
 * clears assignments from any page using this master, and removes overrides.
 */
export function deleteMaster(doc: Document, masterId: NodeId): Document {
  const masters = doc.masters ?? {};
  const master = masters[masterId];
  if (!master) return doc;

  const updatedMasters = { ...masters };
  delete updatedMasters[masterId];
  const remainingKeys = Object.keys(updatedMasters);

  let d: Document = {
    ...doc,
    masters: remainingKeys.length > 0 ? updatedMasters : undefined,
  };

  // Remove contentRoot and all descendants
  d = removeNode(d, master.contentRoot);

  // Clear assignments from pages
  if (d.pages) {
    d = {
      ...d,
      pages: d.pages.map((p) =>
        p.masterPageId === masterId
          ? { ...p, masterPageId: undefined, masterOverrides: undefined }
          : p,
      ),
    };
  }

  return d;
}

/**
 * Rename a master page. No-ops on empty or whitespace-only names.
 */
export function renameMaster(doc: Document, masterId: NodeId, name: string): Document {
  if (!name.trim()) return doc;
  const masters = doc.masters ?? {};
  const master = masters[masterId];
  if (!master) return doc;

  return {
    ...doc,
    masters: {
      ...masters,
      [masterId]: { ...master, name },
    },
  };
}

/**
 * Duplicate a master page with a deep copy of its contentRoot subtree.
 * The duplicate gets new IDs for itself and all content nodes.
 */
export function duplicateMaster(doc: Document, masterId: NodeId): Document {
  const masters = doc.masters ?? {};
  const master = masters[masterId];
  if (!master) return doc;

  const newId = cryptoId();
  const cloneResult = deepCloneSubtree(doc.nodes, doc.nextId, master.contentRoot);

  // Merge cloned nodes into doc
  const d: Document = {
    ...doc,
    nodes: { ...doc.nodes, ...cloneResult.nodes },
    rootChildren: [...doc.rootChildren, cloneResult.rootId],
  };

  const duplicate: MasterPage = {
    ...master,
    id: newId,
    name: `${master.name} Copy`,
    contentRoot: cloneResult.rootId,
  };

  return {
    ...d,
    masters: {
      ...(d.masters ?? {}),
      [newId]: duplicate,
    },
  };
}

/**
 * Reorder masters by the given array of master IDs. No-ops if the array
 * length doesn't match or any ID is not a master.
 */
export function reorderMasters(doc: Document, masterIds: NodeId[]): Document {
  const masters = doc.masters ?? {};
  const entries = Object.entries(masters);
  if (masterIds.length !== entries.length) return doc;
  if (masterIds.some((id) => !masters[id])) return doc;

  const reordered: Record<NodeId, MasterPage> = {};
  for (const id of masterIds) {
    reordered[id] = masters[id]!;
  }

  return {
    ...doc,
    masters: reordered,
  };
}

// ── Master assignment ─────────────────────────────────────────────────────

/**
 * Assign a master page to a page. When masterId is null, clears any existing
 * assignment and overrides. No-ops for unknown master or page IDs.
 */
export function assignMasterToPage(
  doc: Document,
  pageId: NodeId,
  masterId: NodeId | null,
): Document {
  if (!doc.pages) return doc;
  if (masterId !== null) {
    const masters = doc.masters ?? {};
    if (!masters[masterId]) return doc;
  }

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return doc;

  const pages = [...doc.pages];
  const page = pages[pageIndex]!;

  if (masterId === null) {
    pages[pageIndex] = { ...page, masterPageId: undefined, masterOverrides: undefined };
  } else {
    pages[pageIndex] = { ...page, masterPageId: masterId };
  }

  return { ...doc, pages };
}

/**
 * Set the appliesTo field of a master page. No-ops for unknown master ID.
 */
export function setMasterAppliesTo(
  doc: Document,
  masterId: NodeId,
  appliesTo: MasterAppliesTo,
): Document {
  const masters = doc.masters ?? {};
  const master = masters[masterId];
  if (!master) return doc;

  return {
    ...doc,
    masters: {
      ...masters,
      [masterId]: { ...master, appliesTo },
    },
  };
}

// ── Master overrides ──────────────────────────────────────────────────────

/**
 * Add an override for a master node on a page. When type is 'modified',
 * a localNodeId must be provided. No-ops when the page doesn't exist or
 * when modified is used without a localNodeId.
 */
export function addMasterOverride(
  doc: Document,
  pageId: NodeId,
  masterNodeId: NodeId,
  type: MasterOverrideType,
  localNodeId?: NodeId,
): Document {
  if (!doc.pages) return doc;
  if (type === 'modified' && !localNodeId) return doc;

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return doc;

  const pages = [...doc.pages];
  const page = pages[pageIndex]!;
  const override: MasterOverride = {
    masterNodeId,
    type,
    ...(localNodeId ? { localNodeId } : {}),
  };

  pages[pageIndex] = {
    ...page,
    masterOverrides: {
      ...(page.masterOverrides ?? {}),
      [masterNodeId]: override,
    },
  };

  return { ...doc, pages };
}

/**
 * Remove a specific master override from a page. Cleans up the masterOverrides
 * map to undefined when empty.
 */
export function removeMasterOverride(
  doc: Document,
  pageId: NodeId,
  masterNodeId: NodeId,
): Document {
  if (!doc.pages) return doc;

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return doc;

  const page = doc.pages[pageIndex]!;
  const overrides = page.masterOverrides ?? {};
  if (!overrides[masterNodeId]) {
    // No override to remove — return doc unchanged only if overrides was already empty
    if (Object.keys(overrides).length === 0 && !page.masterOverrides) return doc;
    return { ...doc, pages: doc.pages };
  }

  const pages = [...doc.pages];
  const remaining = { ...overrides };
  delete remaining[masterNodeId];

  pages[pageIndex] = {
    ...page,
    masterOverrides: Object.keys(remaining).length > 0 ? remaining : undefined,
  };

  return { ...doc, pages };
}

/**
 * Clear all master overrides for a page.
 */
export function resetMasterOverrides(doc: Document, pageId: NodeId): Document {
  if (!doc.pages) return doc;

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return doc;

  const pages = [...doc.pages];
  pages[pageIndex] = { ...pages[pageIndex]!, masterOverrides: undefined };

  return { ...doc, pages };
}

/**
 * Detach a single override, restoring the master version. Removes the
 * override entry. If a localNodeId was used for a 'modified' override,
 * the local copy node is not removed (caller must remove it separately).
 */
export function detachMasterOverride(
  doc: Document,
  pageId: NodeId,
  masterNodeId: NodeId,
): Document {
  return removeMasterOverride(doc, pageId, masterNodeId);
}

// ── Master content propagation ────────────────────────────────────────────

/**
 * Get all visible nodes for a page, including propagated master content.
 * Returns the flat list of node IDs in paint order:
 * 1. Global shared nodes
 * 2. Master content nodes (if a master is applied, filtering overridden/hidden ones)
 * 3. Page-local content nodes
 * 4. Override replacement nodes (for 'modified' overrides)
 */
export function activePageNodesWithMaster(doc: Document, pageId: NodeId): NodeId[] {
  const globals = doc.globalChildren ?? [];

  if (!doc.pages) return globals;
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return globals;

  const contentRootNode = doc.nodes[page.contentRoot] as GroupNode | undefined;
  const pageChildren = contentRootNode?.children ?? [];

  if (!page.masterPageId) {
    return [...globals, ...pageChildren];
  }

  const master = doc.masters?.[page.masterPageId];
  if (!master) return [...globals, ...pageChildren];

  const masterRoot = doc.nodes[master.contentRoot] as GroupNode | undefined;
  const masterChildren = masterRoot?.children ?? [];

  const overrides = page.masterOverrides ?? {};
  const result: NodeId[] = [...globals];

  for (const mChildId of masterChildren) {
    const override = overrides[mChildId];
    // B3 (ADR-0132 D2): hidden/deleted overrides REMOVE the master item
    // from the projection — a hidden master node must not render on the
    // page, and a deleted one must not either. Only 'modified' overrides
    // substitute the local replacement node.
    if (override && (override.type === 'hidden' || override.type === 'deleted')) {
      continue;
    }
    if (override && override.type === 'modified' && override.localNodeId) {
      result.push(override.localNodeId);
      continue;
    }
    result.push(mChildId);
  }

  result.push(...pageChildren);

  return result;
}

/**
 * Check whether a page has any active master overrides.
 */
export function pageHasOverrides(doc: Document, pageId: NodeId): boolean {
  if (!doc.pages) return false;
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return false;
  return !!page.masterOverrides && Object.keys(page.masterOverrides).length > 0;
}

/**
 * Resolve whether a specific node is inherited from a master or page-local.
 * Returns 'master', 'override', or 'local'.
 */
export function resolveNodeOrigin(
  doc: Document,
  pageId: NodeId,
  nodeId: NodeId,
): 'master' | 'override' | 'local' {
  if (!doc.pages) return 'local';
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return 'local';
  if (!page.masterPageId) return 'local';

  const overrides = page.masterOverrides ?? {};
  for (const override of Object.values(overrides)) {
    if (override.localNodeId === nodeId) return 'override';
  }

  const master = doc.masters?.[page.masterPageId];
  if (master) {
    const masterRoot = doc.nodes[master.contentRoot] as GroupNode | undefined;
    if (masterRoot?.children.includes(nodeId)) return 'master';
  }

  return 'local';
}
