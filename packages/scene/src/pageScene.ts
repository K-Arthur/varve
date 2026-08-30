/**
 * Placed page scene (ADR-0144/0145) — the scene-side contract the editor
 * renderer consumes for the shared multipage canvas.
 *
 * Pure functions only: no editor imports, no mutation. The renderer walks
 * `placedPages` once per frame, culls at the page level, and resolves node
 * lists per page. Placement comes from `pasteboardLayout`.
 *
 * `buildPlacedScene` is the single-pass entry point: placement, numbering,
 * spread membership and bounds are resolved exactly once per document, so
 * per-page consumers never re-run the auto layout (O(pages²) if called
 * per page).
 */

import type { Rect } from '@varve/shared';
import { groupWorldBounds } from './coordinateService';
import { designCanvasChildren, getActiveDesignCanvas, getDesignCanvas } from './designCanvas';
import type { Document, NodeEntry } from './document';
import { computePageNumbering } from './pageNumbering';
import { autoPageLayout } from './pasteboardLayout';
import type { GroupNode, NodeId, Page, PagePlacement } from './types';
import { isContainer } from './types';

export interface PlacedPage {
  page: Page;
  /** Resolved placement (explicit or auto). */
  placement: PagePlacement;
  /** Placed trim bounds in world coordinates. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Page-owned content node ids (contentRoot children, in paint order). */
  contentNodes: NodeId[];
  /** Background layer node ids (painted behind content). */
  backgroundNodes: NodeId[];
  /**
   * Master content node ids projected onto this page (painted behind
   * page content, after backgrounds), with hidden/deleted overrides
   * removed and 'modified' overrides substituted (ADR-0132). Master
   * nodes render at the page's placement — the renderer applies the
   * placement translation because master roots sit at the pasteboard
   * origin (one master serves many pages).
   */
  masterNodes: NodeId[];
  /** Display number ('' when hidden). */
  pageNumber: string;
  /** Resolved spread origin for this page, when a spread exists. */
  spreadPlacement?: PagePlacement;
  /** Whether the page participates in export. */
  exportEnabled: boolean;
}

export interface PlacedScene {
  /** Placed pages in document order. */
  pages: PlacedPage[];
  /** Resolved placement per page id (explicit or auto). */
  placements: Map<NodeId, PagePlacement>;
}

/**
 * Build the placed scene in one pass. Deterministic: the same document
 * revision produces the same scene, and the same placement map.
 *
 * Resolution rule (matches `pasteboardLayout`): explicit `Page.placement`
 * wins; otherwise the deterministic auto layout. Spread origin: explicit
 * `Spread.placement` wins; otherwise the first member page's resolved
 * placement.
 */
export function buildPlacedScene(doc: Document): PlacedScene {
  const pages = doc.pages ?? [];
  if (pages.length === 0) return { pages: [], placements: new Map() };

  const numbering = computePageNumbering(doc);
  const auto = autoPageLayout(doc);
  const placements = new Map<NodeId, PagePlacement>();
  for (const page of pages) {
    const placement = page.placement ?? auto.get(page.id);
    if (placement) placements.set(page.id, placement);
  }

  const spreadByPage = new Map<NodeId, NonNullable<Document['spreads']>[number]>();
  for (const spread of doc.spreads ?? []) {
    for (const pageId of spread.pageIds) spreadByPage.set(pageId, spread);
  }

  const result: PlacedPage[] = [];
  for (const page of pages) {
    const placement = placements.get(page.id);
    if (!placement) continue;

    const contentRoot = doc.nodes[page.contentRoot] as GroupNode | undefined;
    const numberEntry = numbering.get(page.id);
    const spread = spreadByPage.get(page.id);
    let spreadPlacement: PagePlacement | undefined;
    if (spread) {
      const firstPage = spread.pageIds[0];
      spreadPlacement = spread.placement ?? (firstPage ? placements.get(firstPage) : undefined);
    }

    result.push({
      page,
      placement,
      bounds: { x: placement.x, y: placement.y, w: page.width, h: page.height },
      contentNodes: contentRoot?.children ?? [],
      backgroundNodes: page.backgrounds.filter((bgId) => Boolean(doc.nodes[bgId])),
      masterNodes: projectMasterNodes(doc, page),
      pageNumber: numberEntry?.formatted ?? '',
      ...(spreadPlacement ? { spreadPlacement } : {}),
      exportEnabled: !page.printSettings?.excludeFromExport,
    });
  }

  return { pages: result, placements };
}

/**
 * Master content projected onto a page (ADR-0132 D2): the master's content
 * root children with sparse overrides applied — 'hidden' and 'deleted'
 * overrides remove the item (B3), 'modified' substitutes the page-local
 * replacement node, and unoverridden items inherit. Returns the flat node
 * id list in master paint order.
 */
export function projectMasterNodes(doc: Document, page: Page): NodeId[] {
  if (!page.masterPageId) return [];
  const master = doc.masters?.[page.masterPageId];
  if (!master) return [];
  const masterRoot = doc.nodes[master.contentRoot] as GroupNode | undefined;
  const masterChildren = masterRoot?.children ?? [];
  const overrides = page.masterOverrides ?? {};
  const result: NodeId[] = [];
  for (const mChildId of masterChildren) {
    const override = overrides[mChildId];
    if (override && (override.type === 'hidden' || override.type === 'deleted')) continue;
    if (override && override.type === 'modified' && override.localNodeId) {
      result.push(override.localNodeId);
      continue;
    }
    result.push(mChildId);
  }
  return result;
}

/**
 * Build the placed scene for every page in order. Deterministic: same
 * document revision produces the same scene.
 */
export function placedPages(doc: Document): PlacedPage[] {
  return buildPlacedScene(doc).pages;
}

/**
 * Page-level culling: pages whose placed bounds intersect the given world
 * rect (viewport). Returns the placed pages in paint order.
 */
export function pagesVisibleInWorldRect(
  doc: Document,
  rect: { x: number; y: number; w: number; h: number },
): PlacedPage[] {
  return placedPages(doc).filter((p) => {
    const b = p.bounds;
    const overlapX = b.x < rect.x + rect.w && rect.x < b.x + b.w;
    const overlapY = b.y < rect.y + rect.h && rect.y < b.y + b.h;
    return overlapX && overlapY;
  });
}

/**
 * Resolve which page contains a world-space point and its page-local
 * coordinates. Null on the pasteboard or outside every page.
 */
export function worldToPageAtPoint(
  doc: Document,
  point: { x: number; y: number },
): { pageId: NodeId; local: { x: number; y: number } } | null {
  for (const placed of placedPages(doc)) {
    const b = placed.bounds;
    if (point.x < b.x || point.x >= b.x + b.w) continue;
    if (point.y < b.y || point.y >= b.y + b.h) continue;
    return {
      pageId: placed.page.id,
      local: { x: point.x - b.x, y: point.y - b.y },
    };
  }
  return null;
}

export interface MultipageSceneOptions {
  /**
   * Viewport in world coordinates. When provided, pages whose placed trim
   * bounds do not intersect it are culled from the scene root list (they
   * never reach the renderer's per-node loop).
   */
  viewportWorldRect?: { x: number; y: number; w: number; h: number } | null;
  /** Render one master source in editing context instead of the page scene. */
  masterEditId?: NodeId | null;
  /**
   * Isolate one Design Canvas. Omit this to use the active Design Canvas when
   * a document has one; pass null to deliberately render the publishing/page
   * scene instead (used by Print workspace and export).
   */
  designCanvasId?: NodeId | null;
}

/**
 * A node occurrence in the placed multipage scene.
 *
 * `walkNodes` intentionally returns a map keyed by node id, which is the
 * right contract for document-wide operations but cannot represent a master
 * node projected onto two pages. This occurrence form preserves paint order
 * and gives each master projection a stable instance key while keeping the
 * authored node id available for selection, effects, and history.
 */
export interface MultipageNodeInstance extends NodeEntry {
  /** Unique within this placed scene, including repeated master projections. */
  instanceId: string;
  /** Prefix shared by all descendants of one master occurrence. */
  instancePrefix?: string;
  /** Page placement used when the occurrence is a projected master node. */
  masterPlacement?: PagePlacement;
}

/**
 * Master source roots are metadata-owned scene roots, not pasteboard items.
 * Older documents may still contain them in `rootChildren` because the first
 * master implementation used the ordinary root list. Keep those documents
 * renderable without exposing the source tree as a second visible copy.
 */
function masterContentRootIds(doc: Document): Set<NodeId> {
  return new Set(Object.values(doc.masters ?? {}).map((master) => master.contentRoot));
}

/** Design Canvas roots are metadata-owned, never pasteboard artwork. */
function designCanvasContentRootIds(doc: Document): Set<NodeId> {
  return new Set((doc.designCanvases ?? []).map((canvas) => canvas.contentRoot));
}

function canvasForScene(
  doc: Document,
  requestedCanvasId: NodeId | null | undefined,
): import('./types').DesignCanvas | null {
  if (requestedCanvasId === null) return null;
  return requestedCanvasId === undefined
    ? getActiveDesignCanvas(doc)
    : getDesignCanvas(doc, requestedCanvasId);
}

/** Direct source children for a master-editing canvas or layer tree. */
export function masterSourceNodes(doc: Document, masterId: NodeId): NodeId[] {
  const master = doc.masters?.[masterId];
  if (!master) return [];
  const root = doc.nodes[master.contentRoot];
  return root && 'children' in root ? [...root.children] : [];
}

/**
 * Paint-order root node ids for the shared multipage canvas (ADR-0144):
 *
 *   1. global children (world-space, painted first — behind everything)
 *   2. pasteboard items (rootChildren not owned by a page content root)
 *   3. per visible page: background layer nodes, then projected master
 *      content (ADR-0132), then content-root children
 *
 * Pages are painted in document order (later pages on top). Deterministic:
 * the same document revision and viewport produce the same list. A document
 * without pages falls back to globals + rootChildren — identical to
 * `activePageNodes` on flat documents, so pre-page documents render
 * unchanged.
 */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * World bounds of a page's content, memoized per document revision.
 *
 * Keyed on the Document, not on the content-root node. Keying on the node
 * looks cheaper — untouched pages would keep their entry across edits — but
 * it is wrong: moving a *descendant* produces a new node for that descendant
 * while the content root keeps the same object identity (its `children` array
 * is unchanged), so the cached bounds would go stale and the page could be
 * culled against a position its content has left. That is the same class of
 * bug this function exists to fix.
 *
 * The document key is exact: documents are immutable, so a new revision means
 * a genuinely different scene. Cost is bounded — the walk runs only for pages
 * that already failed the trim test, and at most once per revision per page.
 */
const pageContentBoundsCache = new WeakMap<Document, Map<NodeId, Rect | null>>();

function pageContentWorldBounds(doc: Document, page: Page): Rect | null {
  let perDoc = pageContentBoundsCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    pageContentBoundsCache.set(doc, perDoc);
  }
  const cached = perDoc.get(page.id);
  if (cached !== undefined) return cached;
  const bounds = groupWorldBounds(doc, page.contentRoot);
  perDoc.set(page.id, bounds);
  return bounds;
}

/**
 * Whether a page contributes anything to this viewport.
 *
 * The trim box is NOT sufficient. Page content is free to sit outside the
 * trim — dragged onto the pasteboard, placed for a bleed, or simply moved
 * away — and culling the page by its trim dropped every one of its content
 * nodes with it. Scrolling to such an object showed nothing while the
 * selection overlay (which resolves world bounds independently of this walk)
 * still drew its handles: content silently absent, not clipped.
 *
 * Backgrounds and masters are bounded by the trim by construction, so only
 * content extends the test.
 */
function pageIntersectsViewport(
  doc: Document,
  placed: PlacedPage,
  viewport: { x: number; y: number; w: number; h: number },
): boolean {
  if (rectsOverlap(placed.bounds, viewport)) return true;
  const content = pageContentWorldBounds(doc, placed.page);
  return content !== null && rectsOverlap(content, viewport);
}

export function multipageRootNodes(doc: Document, options: MultipageSceneOptions = {}): NodeId[] {
  // A master source is edited as its own logical surface. Keep document-wide
  // globals visible, but do not mix page content into the source-edit view.
  // The editor renderer applies the active page placement separately so the
  // source remains visible in the same pasteboard coordinate system.
  if (options.masterEditId) {
    return [...(doc.globalChildren ?? []), ...masterSourceNodes(doc, options.masterEditId)];
  }

  const canvas = canvasForScene(doc, options.designCanvasId);
  if (canvas) return designCanvasChildren(doc, canvas.id);

  const ids: NodeId[] = [];
  for (const gid of doc.globalChildren ?? []) ids.push(gid);

  const masterRoots = masterContentRootIds(doc);
  const canvasRoots = designCanvasContentRootIds(doc);

  const pages = doc.pages ?? [];
  if (pages.length === 0) {
    for (const rid of doc.rootChildren) {
      if (!masterRoots.has(rid) && !canvasRoots.has(rid)) ids.push(rid);
    }
    return ids;
  }

  // Paint in document order. Pasteboard items and pages are interleaved by
  // their position in `rootChildren`, so a pasteboard item created after a
  // page paints in front of it and the layer tree the user sees is the
  // z-order they get. Previously every pasteboard item was emitted before
  // every page, which pinned pasteboard content behind all page content
  // regardless of stacking — an item dragged off a page onto the pasteboard
  // silently jumped behind it.
  const placedByContentRoot = new Map<NodeId, PlacedPage>();
  for (const placed of buildPlacedScene(doc).pages) {
    placedByContentRoot.set(placed.page.contentRoot, placed);
  }

  const viewport = options.viewportWorldRect ?? null;
  for (const rid of doc.rootChildren) {
    if (masterRoots.has(rid) || canvasRoots.has(rid)) continue;
    const placed = placedByContentRoot.get(rid);
    if (!placed) {
      // A pasteboard item: an ordinary world-space root node.
      ids.push(rid);
      continue;
    }
    if (viewport && !pageIntersectsViewport(doc, placed, viewport)) continue;
    for (const bgId of placed.backgroundNodes) ids.push(bgId);
    for (const masterId of placed.masterNodes) ids.push(masterId);
    for (const childId of placed.contentNodes) ids.push(childId);
  }

  // A page whose content root is missing from `rootChildren` would otherwise
  // vanish. Emit any such page after the ordered pass so a malformed document
  // degrades to "painted last" rather than "not painted".
  for (const placed of placedByContentRoot.values()) {
    if (doc.rootChildren.includes(placed.page.contentRoot)) continue;
    if (viewport && !pageIntersectsViewport(doc, placed, viewport)) continue;
    for (const bgId of placed.backgroundNodes) ids.push(bgId);
    for (const masterId of placed.masterNodes) ids.push(masterId);
    for (const childId of placed.contentNodes) ids.push(childId);
  }
  return ids;
}

function appendNodeInstances(
  doc: Document,
  ids: NodeId[],
  result: MultipageNodeInstance[],
  options: {
    instancePrefix?: string;
    masterPlacement?: PagePlacement;
    visited: Set<NodeId>;
  },
): void {
  function walk(nodeIds: NodeId[], parentId: NodeId | null, depth: number): void {
    for (const nodeId of nodeIds) {
      if (options.visited.has(nodeId)) continue;
      const node = doc.nodes[nodeId];
      if (!node) continue;
      options.visited.add(nodeId);
      const instanceId = options.instancePrefix ? `${options.instancePrefix}:${nodeId}` : nodeId;
      result.push({
        nodeId,
        node,
        parentId,
        depth,
        instanceId,
        ...(options.instancePrefix ? { instancePrefix: options.instancePrefix } : {}),
        ...(options.masterPlacement ? { masterPlacement: options.masterPlacement } : {}),
      });
      if (isContainer(node) && node.children.length > 0) {
        walk(node.children, nodeId, depth + 1);
      }
    }
  }

  walk(ids, null, 0);
}

/**
 * Walk the visible placed scene while preserving repeated master instances.
 *
 * Ordinary document nodes retain their authored node id as `instanceId`.
 * Master projections use `master:<pageId>:<nodeId>` so a single source can
 * be rendered once for every assigned publishing page. This is deliberately
 * separate from `walkNodes`: callers that need a node-id map should keep the
 * existing deduplicating API.
 */
export function multipageNodeInstances(
  doc: Document,
  options: MultipageSceneOptions = {},
): MultipageNodeInstance[] {
  const result: MultipageNodeInstance[] = [];
  const ordinaryVisited = new Set<NodeId>();
  const appendOrdinary = (ids: NodeId[]) =>
    appendNodeInstances(doc, ids, result, { visited: ordinaryVisited });

  if (options.masterEditId) {
    appendOrdinary(doc.globalChildren ?? []);
    const placement = buildPlacedScene(doc).placements.get(doc.activePageId ?? '');
    const master = doc.masters?.[options.masterEditId];
    if (master) {
      const masterRoot = doc.nodes[master.contentRoot];
      const children = masterRoot && 'children' in masterRoot ? masterRoot.children : [];
      appendNodeInstances(doc, children, result, {
        instancePrefix: `master-edit:${options.masterEditId}`,
        ...(placement ? { masterPlacement: placement } : {}),
        visited: new Set<NodeId>(),
      });
    }
    return result;
  }

  const canvas = canvasForScene(doc, options.designCanvasId);
  if (canvas) {
    appendOrdinary(designCanvasChildren(doc, canvas.id));
    return result;
  }

  appendOrdinary(doc.globalChildren ?? []);

  const masterRoots = masterContentRootIds(doc);
  const canvasRoots = designCanvasContentRootIds(doc);
  const pages = doc.pages ?? [];
  if (pages.length === 0) {
    appendOrdinary(doc.rootChildren.filter((id) => !masterRoots.has(id) && !canvasRoots.has(id)));
    return result;
  }

  const placedScene = buildPlacedScene(doc);
  const placedByContentRoot = new Map<NodeId, PlacedPage>();
  for (const placed of placedScene.pages) {
    placedByContentRoot.set(placed.page.contentRoot, placed);
  }

  const appendPlacedPage = (placed: PlacedPage) => {
    const viewport = options.viewportWorldRect ?? null;
    if (viewport && !pageIntersectsViewport(doc, placed, viewport)) return;
    appendOrdinary(placed.backgroundNodes);
    appendNodeInstances(doc, placed.masterNodes, result, {
      instancePrefix: `master:${placed.page.id}`,
      masterPlacement: placed.placement,
      visited: new Set<NodeId>(),
    });
    appendOrdinary(placed.contentNodes);
  };

  for (const rootId of doc.rootChildren) {
    if (masterRoots.has(rootId) || canvasRoots.has(rootId)) continue;
    const placed = placedByContentRoot.get(rootId);
    if (placed) appendPlacedPage(placed);
    else appendOrdinary([rootId]);
  }

  // Preserve the malformed-document fallback from multipageRootNodes: a
  // page whose content root is missing from rootChildren still contributes a
  // deterministic occurrence at the end of the scene.
  for (const placed of placedByContentRoot.values()) {
    if (!doc.rootChildren.includes(placed.page.contentRoot)) appendPlacedPage(placed);
  }
  return result;
}
