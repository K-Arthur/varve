/**
 * Pasteboard layout engine — deterministic placement resolution for pages
 * and spreads (ADR-0124).
 *
 * Placement is layout metadata, never content: every function here operates
 * on `Page.placement` / `Spread.placement` and never on node transforms.
 *
 * Resolution rule: explicit placement wins; absent placement is resolved by
 * the deterministic auto layout (vertical stack of spreads, pages within a
 * spread side by side, first spread at the pasteboard origin).
 */

import type { Document } from './document';
import type { FacingPagesConfig, NodeId, PagePlacement } from './types';

// ── Layout constants (ADR-0124 D3 defaults) ────────────────────────────────────

/** Gap between pages within one spread (px). */
export const PAGE_GAP = 96;
/** Gap between spreads on the pasteboard (px). */
export const SPREAD_GAP = 144;

// ── Derived spread grouping (projection, ADR-0128 D1) ─────────────────────────

interface SpreadSlot {
  pageId: NodeId;
  width: number;
  height: number;
}

/**
 * Deterministic projection of pages into spreads from document order,
 * mirroring `rebuildSpreads` semantics without mutating the document:
 * single-page spreads when facing pages are disabled; a leading single-page
 * spread when `startOnRight`, then pairs; a trailing singleton on odd
 * counts.
 */
export function projectSpreads(doc: Document, facingPages?: FacingPagesConfig): SpreadSlot[][] {
  if (!doc.pages || doc.pages.length === 0) return [];
  const config = facingPages ?? doc.facingPages ?? { enabled: false, startOnRight: true };
  const pages = doc.pages.map((p) => ({
    pageId: p.id,
    width: p.width,
    height: p.height,
  }));

  const spreads: SpreadSlot[][] = [];
  if (!config.enabled) {
    for (const page of pages) spreads.push([page]);
    return spreads;
  }

  let i = 0;
  if (config.startOnRight) {
    spreads.push([pages[0]!]);
    i = 1;
  }
  while (i < pages.length) {
    if (i + 1 < pages.length) {
      spreads.push([pages[i]!, pages[i + 1]!]);
      i += 2;
    } else {
      spreads.push([pages[i]!]);
      i += 1;
    }
  }
  return spreads;
}

// ── Auto layout ────────────────────────────────────────────────────────────────

/**
 * Deterministic auto layout: assign each page a pasteboard origin from
 * spread grouping. Spreads stack vertically from the pasteboard origin;
 * pages within a spread sit side by side with {@link PAGE_GAP}.
 *
 * Pure function of (pages, facingPages): identical inputs produce identical
 * output. Never reads or writes node transforms.
 */
export function autoPageLayout(
  doc: Document,
  facingPages?: FacingPagesConfig,
): Map<NodeId, PagePlacement> {
  const result = new Map<NodeId, PagePlacement>();
  const spreads = projectSpreads(doc, facingPages);
  let y = 0;
  for (const spread of spreads) {
    let x = 0;
    let spreadHeight = 0;
    for (const slot of spread) {
      result.set(slot.pageId, { x, y });
      x += slot.width + PAGE_GAP;
      if (slot.height > spreadHeight) spreadHeight = slot.height;
    }
    y += spreadHeight + SPREAD_GAP;
  }
  return result;
}

/**
 * Resolve a page's placement: explicit `Page.placement` wins; otherwise the
 * deterministic auto layout position. Never mutates the document.
 */
export function resolvePagePlacement(doc: Document, pageId: NodeId): PagePlacement | null {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) return null;
  if (page.placement) return page.placement;
  return autoPageLayout(doc).get(pageId) ?? null;
}

/**
 * Resolve a spread's origin: explicit `Spread.placement` wins; otherwise the
 * first member page's resolved placement; otherwise null.
 */
export function resolveSpreadPlacement(doc: Document, spreadId: NodeId): PagePlacement | null {
  const spread = doc.spreads?.find((s) => s.id === spreadId);
  if (!spread) return null;
  if (spread.placement) return spread.placement;
  const firstPage = spread.pageIds[0];
  if (firstPage === undefined) return null;
  return resolvePagePlacement(doc, firstPage);
}

/**
 * Placed trim bounds of a page in world coordinates (top-left = placement,
 * size = page trim). Null when the page does not exist.
 */
export function pageBoundsInWorld(
  doc: Document,
  pageId: NodeId,
): { x: number; y: number; w: number; h: number } | null {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) return null;
  const placement = resolvePagePlacement(doc, pageId);
  if (!placement) return null;
  return { x: placement.x, y: placement.y, w: page.width, h: page.height };
}

/**
 * Placed bounds of a spread in world coordinates — union of member page
 * placed trim bounds. Null when the spread does not exist.
 */
export function spreadBoundsInWorld(
  doc: Document,
  spreadId: NodeId,
): { x: number; y: number; w: number; h: number } | null {
  const spread = doc.spreads?.find((s) => s.id === spreadId);
  if (!spread) return null;
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const pageId of spread.pageIds) {
    const bounds = pageBoundsInWorld(doc, pageId);
    if (!bounds) continue;
    if (!union) {
      union = { ...bounds };
    } else {
      const minX = Math.min(union.x, bounds.x);
      const minY = Math.min(union.y, bounds.y);
      const maxX = Math.max(union.x + union.w, bounds.x + bounds.w);
      const maxY = Math.max(union.y + union.h, bounds.y + bounds.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return union;
}

/**
 * Pasteboard bounds — union of every page's placed trim bounds (with or
 * without the pages' auto layout). Null when there are no pages.
 */
export function pasteboardBounds(
  doc: Document,
): { x: number; y: number; w: number; h: number } | null {
  if (!doc.pages || doc.pages.length === 0) return null;
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const page of doc.pages) {
    const bounds = pageBoundsInWorld(doc, page.id);
    if (!bounds) continue;
    if (!union) {
      union = { ...bounds };
    } else {
      const minX = Math.min(union.x, bounds.x);
      const minY = Math.min(union.y, bounds.y);
      const maxX = Math.max(union.x + union.w, bounds.x + bounds.w);
      const maxY = Math.max(union.y + union.h, bounds.y + bounds.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return union;
}
