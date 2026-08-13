/**
 * Page-level print geometry resolution (M12, ADR-0190): bleed, slug and
 * safe area resolve from document defaults to page overrides. Resolution
 * order: application default -> document default -> page override (per
 * edge, per config). All values resolve to document pixels.
 *
 * The resolved geometry drives canvas previews, snapping, preflight and
 * export boxes — one resolution path, never per-consumer ad hoc reads.
 *
 * Application default: unconfigured documents resolve to zero bleed. Print
 * presets provide real bleed values at document creation; documents that
 * never configured bleed keep exporting trim-only (legacy behaviour).
 */

import { type DocumentUnit, physicalToPx } from '@varve/shared';
import type { BleedConfig, SafeAreaConfig, SlugConfig } from './colorManagement';
import { DEFAULT_SAFE_AREA } from './colorManagement';
import type { Document } from './document';
import type { NodeId } from './types';

export interface ResolvedPagePrintGeometry {
  bleed: BleedConfig & { linked: boolean };
  safeArea: SafeAreaConfig;
  slug: SlugConfig;
}

export const EMPTY_BLEED: BleedConfig = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  linked: true,
  unit: 'px',
};

function resolveBleed(doc: Document, page?: { bleed?: Partial<BleedConfig> }): BleedConfig {
  const base = doc.bleed ?? EMPTY_BLEED;
  const pageBleed = page?.bleed;
  if (!pageBleed) return base;
  return {
    ...base,
    ...pageBleed,
    // Partial overrides keep the document's unit unless overridden.
    unit: pageBleed.unit ?? base.unit,
  };
}

function resolveSafeArea(
  doc: Document,
  page?: { safeArea?: Partial<SafeAreaConfig> },
): SafeAreaConfig {
  const base = doc.safeArea ?? DEFAULT_SAFE_AREA;
  const pageArea = page?.safeArea;
  if (!pageArea) return base;
  return { ...base, ...pageArea };
}

function resolveSlug(doc: Document, page?: { slug?: Partial<SlugConfig> }): SlugConfig {
  const base = doc.slug;
  const pageSlug = page?.slug;
  if (!base && !pageSlug) {
    return { top: 0, right: 0, bottom: 0, left: 0, unit: 'px', enabled: false };
  }
  const merged = { ...(base ?? {}), ...(pageSlug ?? {}) } as SlugConfig;
  return merged;
}

/**
 * Resolve a page's effective print geometry (document defaults + page
 * overrides). Values are converted to document pixels via the document
 * unit; missing pages fall back to document defaults. Bleed edges clamp
 * to zero (D5: no negative bleed).
 */
export function resolvePagePrintGeometry(doc: Document, pageId: NodeId): ResolvedPagePrintGeometry {
  const page = doc.pages?.find((p) => p.id === pageId);
  const bleed = resolveBleed(doc, page);
  const safeArea = resolveSafeArea(doc, page);
  const slug = resolveSlug(doc, page);

  return {
    bleed: {
      top: Math.max(0, toPixels(bleed.top, bleed.unit, doc)),
      right: Math.max(0, toPixels(bleed.right, bleed.unit, doc)),
      bottom: Math.max(0, toPixels(bleed.bottom, bleed.unit, doc)),
      left: Math.max(0, toPixels(bleed.left, bleed.unit, doc)),
      unit: bleed.unit,
      linked: bleed.linked,
    },
    safeArea: {
      ...safeArea,
      top: toPixels(safeArea.top, safeArea.unit, doc),
      right: toPixels(safeArea.right, safeArea.unit, doc),
      bottom: toPixels(safeArea.bottom, safeArea.unit, doc),
      left: toPixels(safeArea.left, safeArea.unit, doc),
    },
    slug: {
      ...slug,
      top: toPixels(slug.top, slug.unit, doc),
      right: toPixels(slug.right, slug.unit, doc),
      bottom: toPixels(slug.bottom, slug.unit, doc),
      left: toPixels(slug.left, slug.unit, doc),
    },
  };
}

/** Convert a document-unit value to document pixels. */
export function toPixels(value: number, unit: DocumentUnit, _doc: Document): number {
  return physicalToPx(value, unit);
}

export interface RectInWorld {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Canonical bleed bounds for a page: the trim rect expanded outward by the
 * resolved per-edge bleed (in document pixels), placed at the given origin
 * (usually the page's placed position on the pasteboard).
 *
 * This is the single source of trim+bleed geometry shared by the canvas
 * overlay, preflight and the export plan — canvas preview and export must
 * never expand bleed through independent arithmetic.
 *
 * Trim:      { x: o.x,         y: o.y,         w: page.width,        h: page.height }
 * Bleed:     { x: o.x - left,  y: o.y - top,   w: w + left + right,  h: h + top + bottom }
 */
export function pageBleedBoundsInWorld(
  doc: Document,
  pageId: NodeId,
  origin: { x: number; y: number },
): RectInWorld | null {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) return null;
  const bleed = resolvePagePrintGeometry(doc, pageId).bleed;
  return {
    x: origin.x - bleed.left,
    y: origin.y - bleed.top,
    width: page.width + bleed.left + bleed.right,
    height: page.height + bleed.top + bleed.bottom,
  };
}

/** Per-edge resolved bleed insets in document pixels for a page. */
export function pageBleedInsetsPx(
  doc: Document,
  pageId: NodeId,
): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const bleed = resolvePagePrintGeometry(doc, pageId).bleed;
  return { top: bleed.top, right: bleed.right, bottom: bleed.bottom, left: bleed.left };
}

/** Uniform resolved bleed in millimetres (document default, no page override). */
export function documentBleedMm(doc: Document): number {
  const bleed = documentPrintGeometry(doc).bleed;
  return pxToMm(bleed.top, doc);
}

/** Resolved top-edge bleed in millimetres for a specific page (override-aware). */
export function pageBleedMm(doc: Document, pageId: NodeId): number {
  return pxToMm(resolvePagePrintGeometry(doc, pageId).bleed.top, doc);
}

/** Convert document pixels back to millimetres via the fixed 96dpi world scale. */
export function pxToMm(px: number, _doc: Document): number {
  return (px * 25.4) / 96;
}

/**
 * Document-level print geometry defaults in pixels (no page override).
 * Used by export jobs and preflight before page resolution.
 */
export function documentPrintGeometry(doc: Document): ResolvedPagePrintGeometry {
  return resolvePagePrintGeometry(doc, doc.pages?.[0]?.id ?? '');
}
