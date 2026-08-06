/**
 * Placed page scene (ADR-0144/0145) — the scene-side contract the editor
 * renderer consumes for the shared multipage canvas.
 *
 * Pure functions only: no editor imports, no mutation. The renderer walks
 * `placedPages` once per frame, culls at the page level, and resolves node
 * lists per page. Placement comes from `pasteboardLayout`.
 */

import type { Document } from './document';
import { computePageNumbering } from './pageNumbering';
import {
  pageBoundsInWorld,
  resolvePagePlacement,
  resolveSpreadPlacement,
} from './pasteboardLayout';
import type { GroupNode, NodeId, Page, PagePlacement } from './types';

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
  /** Display number ('' when hidden). */
  pageNumber: string;
  /** Resolved spread origin for this page, when a spread exists. */
  spreadPlacement?: PagePlacement;
  /** Whether the page participates in export. */
  exportEnabled: boolean;
}

/**
 * Build the placed scene for every page in order. Deterministic: same
 * document revision produces the same scene.
 */
export function placedPages(doc: Document): PlacedPage[] {
  const pages = doc.pages ?? [];
  if (pages.length === 0) return [];

  const numbering = computePageNumbering(doc);
  const result: PlacedPage[] = [];

  for (const page of pages) {
    const bounds = pageBoundsInWorld(doc, page.id);
    if (!bounds) continue;
    const placement = resolvePagePlacement(doc, page.id);
    if (!placement) continue;

    const contentRoot = doc.nodes[page.contentRoot] as GroupNode | undefined;
    const numberEntry = numbering.get(page.id);
    const spread = doc.spreads?.find((s) => s.pageIds.includes(page.id));
    const spreadPlacement = spread
      ? (resolveSpreadPlacement(doc, spread.id) ?? undefined)
      : undefined;

    result.push({
      page,
      placement,
      bounds,
      contentNodes: contentRoot?.children ?? [],
      backgroundNodes: page.backgrounds.filter((bgId) => Boolean(doc.nodes[bgId])),
      pageNumber: numberEntry?.formatted ?? '',
      ...(spreadPlacement ? { spreadPlacement } : {}),
      exportEnabled: !page.printSettings?.excludeFromExport,
    });
  }

  return result;
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
