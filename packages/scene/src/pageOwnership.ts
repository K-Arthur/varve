/**
 * Page ownership of scene nodes (ADR-0126).
 *
 * Every non-global scene node resolves to exactly one owner derived from
 * roots: a page content root, a master content root, the pasteboard
 * (unreferenced rootChildren entries), or global (globalChildren). Ownership
 * is derived, never stored — but it must be unambiguous, so this module also
 * validates the invariants on load and in dev.
 */

import type { Document } from './document';
import { getParent } from './document';
import type { NodeId } from './types';

export type SceneOwnership =
  | { kind: 'page'; pageId: NodeId }
  | { kind: 'master'; masterId: NodeId }
  | { kind: 'pasteboard' }
  | { kind: 'global' };

/**
 * Resolve the owner of a node by walking its ancestor chain to the root.
 * The root is either a page content root, a master content root, a
 * globalChildren entry, or pasteboard (plain rootChildren entry).
 *
 * Returns `{ kind: 'pasteboard' }` for unknown nodes (defensive).
 */
export function resolveOwnership(doc: Document, nodeId: NodeId): SceneOwnership {
  let current: NodeId | null = nodeId;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    visited.add(current);

    if (doc.globalChildren?.includes(current)) {
      return { kind: 'global' };
    }
    if (doc.pages) {
      const page = doc.pages.find((p) => p.contentRoot === current);
      if (page) return { kind: 'page', pageId: page.id };
    }
    if (doc.masters) {
      const masterId = Object.entries(doc.masters).find(([, m]) => m.contentRoot === current)?.[0];
      if (masterId) return { kind: 'master', masterId };
    }

    current = getParent(doc, current);
  }
  return { kind: 'pasteboard' };
}

/** The page owning a node, when the node is page-owned (ADR-0126). */
export function owningPage(doc: Document, nodeId: NodeId): NodeId | null {
  const ownership = resolveOwnership(doc, nodeId);
  return ownership.kind === 'page' ? ownership.pageId : null;
}

/** The master owning a node, when the node is master-owned. */
export function owningMaster(doc: Document, nodeId: NodeId): NodeId | null {
  const ownership = resolveOwnership(doc, nodeId);
  return ownership.kind === 'master' ? ownership.masterId : null;
}

/**
 * Whether `nodeId` descends from `ancestorId` (or equals it).
 */
export function nodeDescendsFrom(doc: Document, nodeId: NodeId, ancestorId: NodeId): boolean {
  let current: NodeId | null = nodeId;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = getParent(doc, current);
  }
  return false;
}

/**
 * Validate ownership invariants across the whole document. Returns a list of
 * human-readable violations; an empty list means the document is sound.
 *
 * Checks (ADR-0126 D2):
 * - No two pages share one content root.
 * - No page/master content root is nested inside another content root.
 * - Page content roots exist, are groups, and are rootChildren entries.
 * - Master content roots exist and are groups.
 * - Page background nodes exist and are page-owned (descend from the page).
 * - The active page exists.
 * - Master content roots are not also page content roots.
 */
export function validatePageOwnership(doc: Document): string[] {
  const errors: string[] = [];

  const pages = doc.pages ?? [];
  const masters = doc.masters ?? {};

  // Shared roots.
  const rootToPage = new Map<NodeId, NodeId>();
  for (const page of pages) {
    const existing = rootToPage.get(page.contentRoot);
    if (existing) {
      errors.push(
        `pages ${existing} and ${page.id} share contentRoot ${page.contentRoot} (ADR-0126)`,
      );
    } else {
      rootToPage.set(page.contentRoot, page.id);
    }
  }

  // Content roots are groups in rootChildren.
  const rootChildren = new Set(doc.rootChildren);
  for (const page of pages) {
    const node = doc.nodes[page.contentRoot];
    if (!node) {
      errors.push(`page ${page.id} contentRoot ${page.contentRoot} missing`);
      continue;
    }
    if (node.kind !== 'group') {
      errors.push(`page ${page.id} contentRoot ${page.contentRoot} is not a group`);
    }
    if (!rootChildren.has(page.contentRoot)) {
      errors.push(`page ${page.id} contentRoot ${page.contentRoot} is not a root child`);
    }
  }
  for (const [masterId, master] of Object.entries(masters)) {
    const node = doc.nodes[master.contentRoot];
    if (!node) {
      errors.push(`master ${masterId} contentRoot ${master.contentRoot} missing`);
      continue;
    }
    if (node.kind !== 'group') {
      errors.push(`master ${masterId} contentRoot ${master.contentRoot} is not a group`);
    }
    if (rootToPage.has(master.contentRoot)) {
      errors.push(`master ${masterId} contentRoot is also a page content root`);
    }
  }

  // Backgrounds descend from their page.
  for (const page of pages) {
    for (const bgId of page.backgrounds) {
      if (!doc.nodes[bgId]) {
        errors.push(`page ${page.id} background ${bgId} missing`);
        continue;
      }
      if (!nodeDescendsFrom(doc, bgId, page.contentRoot)) {
        errors.push(`page ${page.id} background ${bgId} is not page-owned`);
      }
    }
  }

  // Active page exists.
  if (doc.activePageId !== undefined && !pages.some((p) => p.id === doc.activePageId)) {
    errors.push(`activePageId ${doc.activePageId} does not name a page`);
  }

  return errors;
}
