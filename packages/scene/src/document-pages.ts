import type { Affine } from '@varve/engine';
import { generateKeyBetween } from '@varve/shared';
import type { Document } from './document';
import { removeNode } from './document-nodes';
import { cryptoId, devValidate, makeGroupNode } from './document-utils';
import { nextNodeId } from './node-id';
import type {
  FacingPagesConfig,
  GroupNode,
  NodeId,
  Page,
  PageNumberStyle,
  PageSection,
  PageSide,
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
 */
export function removePage(doc: Document, pageId: NodeId): Document {
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

  return {
    ...d,
    pages: [...(d.pages ?? []), newPage],
    rootChildren: [...d.rootChildren, newContentRootId],
  };
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
 * Rebuild spread assignments based on facing pages configuration.
 * Assigns each page to a spread: single-page spreads when facing pages
 * are disabled, or two-page spreads with proper left/right ordering
 * when enabled.
 */
export function rebuildSpreads(doc: Document, facingPages?: FacingPagesConfig): Document {
  if (!doc.pages) return doc;

  const config = facingPages ?? doc.facingPages ?? { enabled: false, startOnRight: true };
  const spreads: Spread[] = [];

  if (!config.enabled) {
    // Single-page spreads
    for (const page of doc.pages) {
      spreads.push({
        id: cryptoId(),
        pageIds: [page.id],
      });
    }
  } else {
    // Facing-page spreads
    let i = 0;
    const startOnRight = config.startOnRight ?? true;

    // If first page should be on the right, put it alone
    if (startOnRight && doc.pages.length > 0) {
      spreads.push({
        id: cryptoId(),
        pageIds: [doc.pages[0]!.id],
      });
      i = 1;
    }

    // Process remaining pages in pairs
    while (i < doc.pages.length) {
      if (i + 1 < doc.pages.length) {
        spreads.push({
          id: cryptoId(),
          pageIds: [doc.pages[i]!.id, doc.pages[i + 1]!.id],
        });
        i += 2;
      } else {
        // Single page at end
        spreads.push({
          id: cryptoId(),
          pageIds: [doc.pages[i]!.id],
        });
        i += 1;
      }
    }
  }

  return { ...doc, spreads, facingPages: config };
}

/**
 * Get the spread containing a given page.
 */
export function getSpreadForPage(doc: Document, pageId: NodeId): Spread | undefined {
  if (!doc.spreads) return undefined;
  return doc.spreads.find((s) => s.pageIds.includes(pageId));
}

/**
 * Determine whether a page is left, right, or neither within facing-page spreads.
 * When facing pages are disabled, always returns 'none'.
 */
export function getPageSide(
  doc: Document,
  pageId: NodeId,
  facingPages?: FacingPagesConfig,
): PageSide {
  const config = facingPages ?? doc.facingPages ?? { enabled: false, startOnRight: true };
  if (!config.enabled) return 'none';

  const spreads = doc.spreads;
  if (!spreads) return 'none';

  for (const spread of spreads) {
    const idx = spread.pageIds.indexOf(pageId);
    if (idx === -1) continue;
    if (spread.pageIds.length === 1) {
      // Single-page spread: side depends on whether first page should be right
      return config.startOnRight ? 'right' : 'left';
    }
    if (idx === 0) return 'left';
    if (idx === 1) return 'right';
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
  if (!doc.pages) return 0;

  const pageIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (pageIndex === -1) return 0;

  // Check for section-based numbering
  const sections = doc.sections ?? [];
  if (sections.length === 0) return pageIndex + 1;

  // Find which section this page belongs to
  let owningSection: PageSection | undefined;
  let sectionStartIndex = 0;

  for (const section of sections) {
    const sectionStartPageIdx = doc.pages.findIndex((p) => p.order === section.startPageOrder);
    if (sectionStartPageIdx !== -1 && sectionStartPageIdx <= pageIndex) {
      owningSection = section;
      sectionStartIndex = sectionStartPageIdx;
    }
  }

  if (owningSection) {
    const offset = pageIndex - sectionStartIndex;
    return owningSection.startNumber + offset;
  }

  return pageIndex + 1;
}

/** Roman numeral mapping tables. */
const ROMAN_NUMERALS: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function toRoman(num: number): string {
  if (num <= 0) return '';
  let result = '';
  let n = num;
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

/**
 * Get the formatted page number string (e.g. "1", "iii", "A-5") for a page.
 */
export function getFormattedPageNumber(doc: Document, pageId: NodeId): string {
  const num = getPageNumber(doc, pageId);

  if (num === 0) return '';

  if (!doc.pages) return String(num);

  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return '';

  // Find the section for this page's numbering style
  const sections = doc.sections ?? [];
  let style: PageNumberStyle = 'decimal';
  let prefix = '';

  for (const section of sections) {
    const sectionStartPageIdx = doc.pages.findIndex((p) => p.order === section.startPageOrder);
    if (sectionStartPageIdx !== -1) {
      const pageIdx = doc.pages.indexOf(page);
      if (pageIdx >= sectionStartPageIdx) {
        if (!section.showPageNumber) return '';
        style = section.numberStyle;
        prefix = section.prefix ?? '';
      }
    }
  }

  let formatted: string;
  switch (style) {
    case 'upperRoman':
      formatted = toRoman(num);
      break;
    case 'lowerRoman':
      formatted = toRoman(num).toLowerCase();
      break;
    case 'upperAlpha':
      formatted = numToAlpha(num).toUpperCase();
      break;
    case 'lowerAlpha':
      formatted = numToAlpha(num);
      break;
    default:
      formatted = String(num);
  }

  return prefix ? `${prefix}${formatted}` : formatted;
}

/** Convert a number to an alphabetic string (1=a, 2=b, ..., 27=aa). */
function numToAlpha(num: number): string {
  let result = '';
  let n = num;
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
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
