import type { Affine } from '@varve/engine';
import { generateKeyBetween } from '@varve/shared';
import type { Document } from './document';
import { removeNode } from './document-nodes';
import { cryptoId, devValidate, makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import { getPageNumbering } from './pageNumbering';
import { projectSpreads } from './pasteboardLayout';
import type {
  FacingPagesConfig,
  GroupNode,
  NodeId,
  Page,
  PageSide,
  SceneNode,
  Spread,
} from './types';
import { isContainer } from './types';

// ── Helper ─────────────────────────────────────────────────────────────────

/** Count existing pages to generate the next page name. */
function nextPageName(doc: Document): string {
  const count = doc.pages?.length ?? 0;
  return `Page ${count + 1}`;
}

// ── Page CRUD ──────────────────────────────────────────────────────────────

/**
 * Add a new page to the document.
 * Creates a contentRoot group node for page content.
 */
export function addPage(
  doc: Document,
  opts?: { width?: number; height?: number; name?: string },
): Document {
  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: `${opts?.name ?? nextPageName(doc)} content`,
    children: [],
  });

  const existingPages = doc.pages ?? [];
  const lastOrder =
    existingPages.length > 0 ? existingPages[existingPages.length - 1]!.order : null;

  const page: Page = {
    id: cryptoId(),
    name: opts?.name ?? nextPageName(doc),
    order: generateKeyBetween(lastOrder, null),
    width: opts?.width ?? 1920,
    height: opts?.height ?? 1080,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  // Inherit print config from document if page-level not set
  if (doc.bleed) page.bleed = doc.bleed;
  if (doc.safeArea) page.safeArea = doc.safeArea;
  if (doc.slug) page.slug = doc.slug;

  return {
    ...d1,
    pages: [...(d1.pages ?? []), page],
    rootChildren: [...d1.rootChildren, contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

/**
 * Remove a page from the document.
 * Removes the contentRoot node (and all descendants) and any background nodes.
 * Guards against removing the last page.
 * Equivalent to `deletePageWithPolicy(doc, pageId, 'delete-content')`.
 */
export function removePage(doc: Document, pageId: NodeId): Document {
  return deletePageWithPolicy(doc, pageId, 'delete-content');
}

/**
 * Page deletion policy (ADR-0126 D3). Explicit choice of what happens to the
 * page's content instead of silent removal:
 * - `delete-content`: remove the content subtree with the page (status quo).
 * - `move-to-pasteboard`: reparent content children to the pasteboard
 *   (rootChildren) before removing the page.
 * - `move-to-page`: reparent content children to another page's content root
 *   (transforms are preserved because page roots sit at identity).
 */
export type DeletePagePolicy = 'delete-content' | 'move-to-pasteboard' | 'move-to-page';

/**
 * Delete a page under an explicit content policy. Guards against removing
 * the last page. When `policy` is `move-to-page`, `targetPageId` must name
 * a surviving page (other than the deleted page); the policy falls back to
 * `delete-content` when the target is missing.
 */
export function deletePageWithPolicy(
  doc: Document,
  pageId: NodeId,
  policy: DeletePagePolicy,
  targetPageId?: NodeId,
): Document {
  if (!doc.pages || doc.pages.length <= 1) return doc;
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;

  const page = doc.pages[idx]!;
  const nextPages = doc.pages.filter((p) => p.id !== pageId);
  const activePageStillExists =
    doc.activePageId !== undefined && nextPages.some((p) => p.id === doc.activePageId);
  const fallbackPage = nextPages[Math.min(idx, nextPages.length - 1)] ?? nextPages[0];
  let d: Document = {
    ...doc,
    pages: nextPages,
    activePageId: activePageStillExists ? doc.activePageId : fallbackPage?.id,
  };

  // Resolve content destination before the page entry is gone.
  const contentRoot = d.nodes[page.contentRoot] as GroupNode | undefined;
  let targetRoot: NodeId | null = null;
  if (policy === 'move-to-page' && targetPageId) {
    const target = d.pages?.find((p) => p.id === targetPageId);
    if (target && target.id !== pageId) targetRoot = target.contentRoot;
  }
  const moveToPasteboard =
    policy === 'move-to-pasteboard' || (policy === 'move-to-page' && !targetRoot);

  if (moveToPasteboard || targetRoot) {
    const children = contentRoot?.children ?? [];
    if (targetRoot) {
      const targetNode = d.nodes[targetRoot] as GroupNode | undefined;
      if (targetNode) {
        d = {
          ...d,
          nodes: {
            ...d.nodes,
            [targetRoot]: { ...targetNode, children: [...targetNode.children, ...children] },
          },
        };
      }
    } else {
      d = { ...d, rootChildren: [...d.rootChildren, ...children] };
    }
    // Sever the parent link so removeNode below does not cascade into the
    // reparented children (they must survive the page deletion).
    if (contentRoot) {
      d = {
        ...d,
        nodes: { ...d.nodes, [page.contentRoot]: { ...contentRoot, children: [] } },
      };
    }
  }

  // Remove background nodes
  for (const bgId of page.backgrounds) {
    d = removeNode(d, bgId);
  }

  // Remove contentRoot and all its descendants
  d = removeNode(d, page.contentRoot);
  devValidate(d);
  return d;
}

/**
 * Reorder pages to match the given array of page IDs.
 * Validates that all page IDs exist and the input length matches.
 */
export function reorderPages(doc: Document, pageIds: NodeId[]): Document {
  if (!doc.pages) return doc;
  if (pageIds.length !== doc.pages.length) return doc;

  // Validate all IDs exist
  const existingIds = new Set(doc.pages.map((p) => p.id));
  for (const pid of pageIds) {
    if (!existingIds.has(pid)) return doc;
  }

  // Build reordered pages
  const idToPage = new Map(doc.pages.map((p) => [p.id, p]));
  const reordered = pageIds.map((pid) => idToPage.get(pid)!);

  return { ...doc, pages: reordered };
}

/**
 * Deep-copy a page and all its content nodes.
 * Assigns new IDs to all duplicated nodes.
 * Auto-names the copy ("Page X Copy").
 */
export function duplicatePage(doc: Document, pageId: NodeId): Document {
  if (!doc.pages) return doc;
  const sourcePage = doc.pages.find((p) => p.id === pageId);
  if (!sourcePage) return doc;

  // Clone the contentRoot subtree with new IDs
  let d = doc;
  const idMap = new Map<NodeId, NodeId>();

  function cloneNode(nid: NodeId): NodeId | null {
    const node = d.nodes[nid];
    if (!node) return null;
    if (idMap.has(nid)) return idMap.get(nid)!;

    const { id: newId, doc: d2 } = nextNodeId(d);
    d = d2;
    idMap.set(nid, newId);

    // Recursively clone children if this is a container
    let cloned: import('./types').SceneNode;
    if (isContainer(node)) {
      const clonedChildren = node.children
        .map((c) => cloneNode(c))
        .filter((c): c is NodeId => c !== null);
      cloned = { ...node, id: newId, children: clonedChildren } as import('./types').SceneNode;
    } else {
      cloned = { ...node, id: newId } as import('./types').SceneNode;
    }

    d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
    return newId;
  }

  const newContentRootId = cloneNode(sourcePage.contentRoot);
  if (!newContentRootId) return doc;

  // Clone background nodes
  const newBackgrounds: NodeId[] = [];
  for (const bgId of sourcePage.backgrounds) {
    const newBgId = cloneNode(bgId);
    if (newBgId) newBackgrounds.push(newBgId);
  }

  // Recursion cannot safely remap a container reference until all of its
  // descendants have IDs. Repair internal references in one deterministic
  // pass once the complete old→new map is available.
  for (const [oldId, newId] of idMap) {
    const oldNode = doc.nodes[oldId];
    const clonedNode = d.nodes[newId];
    if (!oldNode || !clonedNode || !isContainer(oldNode) || !isContainer(clonedNode)) continue;

    let updated: import('./types').SceneNode = clonedNode;
    if (oldNode.mask?.sourceNodeId) {
      updated = {
        ...updated,
        mask: {
          ...oldNode.mask,
          sourceNodeId: idMap.get(oldNode.mask.sourceNodeId) ?? oldNode.mask.sourceNodeId,
        },
      } as import('./types').SceneNode;
    }
    if ('slots' in oldNode && oldNode.slots && 'slots' in updated) {
      const slots = Object.fromEntries(
        Object.entries(oldNode.slots)
          .map(([slotId, childId]) => [slotId, idMap.get(childId)] as const)
          .filter((entry): entry is readonly [string, NodeId] => Boolean(entry[1])),
      );
      updated = { ...updated, slots: Object.keys(slots).length > 0 ? slots : undefined };
    }
    d = { ...d, nodes: { ...d.nodes, [newId]: updated } };
  }

  const copyName = `${sourcePage.name} Copy`;

  const existingPages = d.pages ?? [];
  const lastOrder =
    existingPages.length > 0 ? existingPages[existingPages.length - 1]!.order : null;

  const newPage: Page = {
    id: cryptoId(),
    name: copyName,
    order: generateKeyBetween(lastOrder, null),
    width: sourcePage.width,
    height: sourcePage.height,
    bleed: sourcePage.bleed,
    safeArea: sourcePage.safeArea,
    slug: sourcePage.slug,
    backgrounds: newBackgrounds,
    contentRoot: newContentRootId,
  };

  let result: Document = {
    ...d,
    pages: [...(d.pages ?? []), newPage],
    rootChildren: [...d.rootChildren, newContentRootId],
  };

  // Text chains (legacy): frames of the duplicated page get fresh chain
  // entries so the copied story stays linked within the copy and never
  // silently joins the source story (ADR-0126 D4). The source chains keep
  // their frame ids.

  // v2.18 stories (ADR-0159): duplicate each story thread restricted to the
  // cloned frames — a story spanning pages inside the duplicated page is
  // preserved; frames outside the page drop out of the copy's thread. Frame
  // bindings on the clones point at the fresh story.
  const stories = result.stories as
    | Record<
        string,
        { id: string; name?: string; content: import('./types').RichText; thread: NodeId[] }
      >
    | undefined;
  if (stories && Object.keys(stories).length > 0) {
    const mappedStories: Record<string, import('./types').TextStory> = {};
    for (const story of Object.values(stories)) {
      if (!Array.isArray(story?.thread)) continue;
      const mapped = story.thread
        .map((fid) => (idMap.get(fid) ?? null) as NodeId | null)
        .filter((fid): fid is NodeId => fid !== null);
      if (mapped.length === 0) continue;
      const storyId = cryptoId();
      mappedStories[storyId] = {
        ...story,
        id: storyId,
        name: story.name ? `${story.name} Copy` : 'Story',
        thread: mapped,
      };
      for (let i = 0; i < mapped.length; i++) {
        const frameId = mapped[i]!;
        const frame = result.nodes[frameId] as Record<string, unknown> | undefined;
        if (frame && frame.kind === 'text') {
          result = {
            ...result,
            nodes: {
              ...result.nodes,
              [frameId]: { ...frame, storyBinding: { storyId, threadIndex: i } } as SceneNode,
            },
          };
        }
      }
    }
    if (Object.keys(mappedStories).length > 0) {
      result = { ...result, stories: { ...result.stories, ...mappedStories } };
    }
  }
  const chains = result.textChains as
    | Record<string, { id: string; name?: string; frameIds: NodeId[] }>
    | undefined;
  if (chains && Object.keys(chains).length > 0) {
    const mappedChains: typeof chains = {};
    for (const chain of Object.values(chains)) {
      if (!Array.isArray(chain?.frameIds)) continue;
      const mapped = chain.frameIds
        .map((fid) => (idMap.get(fid) ?? null) as NodeId | null)
        .filter((fid): fid is NodeId => fid !== null);
      if (mapped.length === 0) continue;
      const chainId = cryptoId();
      mappedChains[chainId] = {
        id: chainId,
        name: chain.name ? `${chain.name} Copy` : undefined,
        frameIds: mapped,
      };
    }
    if (Object.keys(mappedChains).length > 0) {
      result = { ...result, textChains: { ...result.textChains, ...mappedChains } };
    }
  }

  devValidate(result);
  return result;
}

/**
 * Update page dimensions without scaling content.
 */
export function setPageSize(
  doc: Document,
  pageId: NodeId,
  width: number,
  height: number,
): Document {
  if (!doc.pages) return doc;
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;

  const updatedPages = doc.pages.map((p, i) => (i === idx ? { ...p, width, height } : p));

  return { ...doc, pages: updatedPages };
}

/**
 * Set a page's pasteboard placement (world coordinates of the trim top-left).
 * Placement is layout metadata only: no node transforms change (ADR-0124).
 * Rejects non-finite or out-of-bounds coordinates; no-ops for unknown page
 * ids.
 */
export function setPagePlacement(
  doc: Document,
  pageId: NodeId,
  placement: import('./types').PagePlacement,
): Document {
  if (!doc.pages) return doc;
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return doc;

  const x = Number(placement.x);
  const y = Number(placement.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return doc;
  if (Math.abs(x) > 1e7 || Math.abs(y) > 1e7) return doc;

  const updatedPages = doc.pages.map((p, i) => (i === idx ? { ...p, placement: { x, y } } : p));

  return { ...doc, pages: updatedPages };
}

/**
 * Update page dimensions and scale all content node transforms proportionally.
 * Computes the scale factor from old to new dimensions and multiplies each
 * node's affine transform in the page's content tree by that factor.
 */
export function setPageSizeWithContentScale(
  doc: Document,
  pageId: NodeId,
  width: number,
  height: number,
): Document {
  if (!doc.pages) return doc;

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex < 0) return doc;

  const page = doc.pages[pageIndex]!;
  if (page.width === width && page.height === height) return doc;

  const scaleX = width / page.width;
  const scaleY = height / page.height;

  // Walk all descendant nodes of the page's contentRoot and scale their transforms
  const contentRoot = doc.nodes[page.contentRoot] as GroupNode | undefined;
  if (!contentRoot)
    return {
      ...doc,
      pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, width, height } : p)),
    };

  const nodes = { ...doc.nodes };
  const walk = (nodeId: NodeId) => {
    const node = nodes[nodeId];
    if (!node) return;
    const t = (node as import('./types').SceneNode & { transform?: number[] }).transform;
    if (t && t.length >= 6) {
      nodes[nodeId] = {
        ...node,
        transform: [
          t[0]! * scaleX,
          t[1]! * scaleX,
          t[2]! * scaleY,
          t[3]! * scaleY,
          t[4]! * scaleX,
          t[5]! * scaleY,
        ] as unknown as Affine,
      } as import('./types').SceneNode;
    }
    if (isContainer(node)) {
      for (const childId of node.children) {
        walk(childId);
      }
    }
  };

  walk(page.contentRoot);

  const pages = doc.pages.map((p, i) => (i === pageIndex ? { ...p, width, height } : p));

  return { ...doc, nodes, pages };
}

/**
 * Migrate a flat (pre-page) document to the page model.
 * Wraps existing rootChildren into a single default page's contentRoot.
 * If the document already has pages, returns as-is.
 * Uses A4 dimensions (210×297mm) if the document is print-oriented (dpi > 0),
 * or 1920×1080px for screen documents.
 */
export function migrateToPages(doc: Document): Document {
  if (doc.pages && doc.pages.length > 0) return doc;

  const isPrint = (doc.dpi ?? 0) > 0;
  const pageWidth = isPrint && doc.physicalWidth ? doc.physicalWidth : 1920;
  const pageHeight = isPrint && doc.physicalHeight ? doc.physicalHeight : 1080;

  const { id: contentRootId, doc: d1 } = nextNodeId(doc);
  const contentRoot = makeGroupNode(contentRootId, {
    name: 'Page 1 content',
    children: [...doc.rootChildren],
  });

  const page: Page = {
    id: cryptoId(),
    name: 'Page 1',
    order: generateKeyBetween(null, null),
    width: pageWidth,
    height: pageHeight,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  // Inherit print config
  if (d1.bleed) page.bleed = d1.bleed;
  if (d1.safeArea) page.safeArea = d1.safeArea;
  if (d1.slug) page.slug = d1.slug;

  return {
    ...d1,
    activePageId: page.id,
    pages: [page],
    rootChildren: [contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  };
}

// ── Active page & global children operations ───────────────────────────────

/** Set the active page. */
export function setActivePage(doc: Document, pageId: NodeId): Document {
  if (!doc.pages?.some((p) => p.id === pageId)) return doc;
  return { ...doc, activePageId: pageId };
}

/** Add a node to global children (visible on all pages). */
export function addGlobalChild(doc: Document, nodeId: NodeId): Document {
  const current = doc.globalChildren ?? [];
  if (current.includes(nodeId)) return doc;
  return { ...doc, globalChildren: [...current, nodeId] };
}

/** Remove a node from global children. */
export function removeGlobalChild(doc: Document, nodeId: NodeId): Document {
  const current = doc.globalChildren ?? [];
  return { ...doc, globalChildren: current.filter((id) => id !== nodeId) };
}

/** Get all nodes visible on the active page (page content + global children). */
export function activePageNodes(doc: Document): NodeId[] {
  const globals = doc.globalChildren ?? [];
  if (!doc.activePageId || !doc.pages || doc.pages.length === 0) {
    return [...globals, ...doc.rootChildren];
  }
  const page = doc.pages?.find((p) => p.id === doc.activePageId);
  if (!page) return [...globals, ...doc.rootChildren];
  const contentRootNode = doc.nodes[page.contentRoot] as GroupNode | undefined;
  const pageChildren = contentRootNode?.children ?? [];
  return [...globals, ...pageChildren];
}

// ── Editorial spreads ─────────────────────────────────────────────────────

/**
 * Build the derived spread projection with stable ids (ADR-0128 D3).
 * Spread ids are deterministic (`spread-<index>`), never regenerated per
 * rebuild — spread-level guides and identity survive toggles and reorders.
 * The projection is a pure function of (pages, facing config).
 */
export function spreadsFromProjection(doc: Document, facingPages?: FacingPagesConfig): Spread[] {
  const slots = projectSpreads(doc, facingPages);
  return slots.map((spread, i) => ({
    id: `spread-${i}`,
    kind: spread.length === 1 ? ('single' as const) : ('facing' as const),
    pageIds: spread.map((s) => s.pageId) as [NodeId] | [NodeId, NodeId],
  }));
}

/**
 * Rebuild spread assignments based on facing pages configuration.
 * Assigns each page to a spread: single-page spreads when facing pages
 * are disabled, or two-page spreads with proper left/right ordering
 * when enabled.
 *
 * Derived projection with stable ids (ADR-0128). No-op when the document
 * uses the `custom` spread model — user-authored spreads are never
 * clobbered by the projection.
 */
export function rebuildSpreads(doc: Document, facingPages?: FacingPagesConfig): Document {
  if (!doc.pages) return doc;
  if (doc.spreadModel === 'custom') return doc;

  const config = facingPages ?? doc.facingPages ?? { enabled: false, startOnRight: true };
  return { ...doc, spreads: spreadsFromProjection(doc, config), facingPages: config };
}

/**
 * Get the spread containing a given page.
 */
export function getSpreadForPage(doc: Document, pageId: NodeId): Spread | undefined {
  if (!doc.spreads) return undefined;
  return doc.spreads.find((s) => s.pageIds.includes(pageId));
}

/**
 * Determine whether a page is left, right, or neither within facing-page
 * spreads (ADR-0129 D2). Side classification honors the binding direction:
 * in RTL, the first slot of a pair is the right page and a leading
 * single-page spread is a left page. When facing pages are disabled,
 * always returns 'none'.
 */
export function getPageSide(
  doc: Document,
  pageId: NodeId,
  facingPages?: FacingPagesConfig,
): PageSide {
  const config = facingPages ?? doc.facingPages ?? { enabled: false, startOnRight: true };
  if (!config.enabled) return 'none';

  const rtl = config.bindingDirection === 'rtl';
  const spreads = doc.spreads;
  if (!spreads) return 'none';

  for (const spread of spreads) {
    const idx = spread.pageIds.indexOf(pageId);
    if (idx === -1) continue;
    if (spread.pageIds.length === 1) {
      // Single-page spread: side depends on whether first page starts right
      // (LTR) or left (RTL mirror).
      return config.startOnRight ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left';
    }
    if (idx === 0) return rtl ? 'right' : 'left';
    if (idx === 1) return rtl ? 'left' : 'right';
  }

  return 'none';
}

/**
 * Check whether a page is on the left side (helper for UI).
 */
export function isPageOnLeftSide(
  doc: Document,
  pageId: NodeId,
  facingPages?: FacingPagesConfig,
): boolean {
  return getPageSide(doc, pageId, facingPages) === 'left';
}

// ── Page numbering ────────────────────────────────────────────────────────

/**
 * Get the 1-indexed page number for a page, respecting section numbering.
 */
export function getPageNumber(doc: Document, pageId: NodeId): number {
  return getPageNumbering(doc, pageId)?.number ?? 0;
}

/**
 * Get the formatted page number string (e.g. "1", "iii", "A-5") for a page.
 */
export function getFormattedPageNumber(doc: Document, pageId: NodeId): string {
  return getPageNumbering(doc, pageId)?.formatted ?? '';
}

// ── Toggle facing pages ───────────────────────────────────────────────────

/**
 * Enable or disable facing pages. When toggling on, rebuilds spreads.
 */
export function toggleFacingPages(doc: Document): Document {
  const current = doc.facingPages ?? { enabled: false, startOnRight: true };
  return rebuildSpreads(doc, { ...current, enabled: !current.enabled });
}

/**
 * Set facing pages enabled state.
 */
export function setFacingPagesEnabled(doc: Document, enabled: boolean): Document {
  const current = doc.facingPages ?? { enabled: false, startOnRight: true };
  return rebuildSpreads(doc, { ...current, enabled });
}
