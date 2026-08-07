/**
 * Page-level print geometry resolution (M12, ADR-0166): bleed, slug and
 * safe area resolve from document defaults to page overrides. Resolution
 * order: application default -> document default -> page override (per
 * edge, per config). All values resolve to document pixels.
 *
 * The resolved geometry drives canvas previews, snapping, preflight and
 * export boxes — one resolution path, never per-consumer ad hoc reads.
 */

import { type DocumentUnit, physicalToPx } from '@varve/shared';
import type { BleedConfig, SafeAreaConfig, SlugConfig } from './colorManagement';
import { DEFAULT_BLEED, DEFAULT_SAFE_AREA } from './colorManagement';
import type { Document } from './document';
import type { NodeId } from './types';

export interface ResolvedPagePrintGeometry {
  bleed: BleedConfig & { linked: boolean };
  safeArea: SafeAreaConfig;
  slug: SlugConfig;
}

const EMPTY_BLEED: BleedConfig = { top: 0, right: 0, bottom: 0, left: 0, linked: true, unit: 'px' };

function resolveBleed(doc: Document, page?: { bleed?: Partial<BleedConfig> }): BleedConfig {
  const base = doc.bleed ?? DEFAULT_BLEED;
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
 * unit; missing pages fall back to document defaults.
 */
export function resolvePagePrintGeometry(doc: Document, pageId: NodeId): ResolvedPagePrintGeometry {
  const page = doc.pages?.find((p) => p.id === pageId);
  const bleed = resolveBleed(doc, page);
  const safeArea = resolveSafeArea(doc, page);
  const slug = resolveSlug(doc, page);

  return {
    bleed: {
      top: toPixels(bleed.top, bleed.unit, doc),
      right: toPixels(bleed.right, bleed.unit, doc),
      bottom: toPixels(bleed.bottom, bleed.unit, doc),
      left: toPixels(bleed.left, bleed.unit, doc),
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

/**
 * Document-level print geometry defaults in pixels (no page override).
 * Used by export jobs and preflight before page resolution.
 */
export function documentPrintGeometry(doc: Document): ResolvedPagePrintGeometry {
  return resolvePagePrintGeometry(doc, doc.pages?.[0]?.id ?? '');
}

export { EMPTY_BLEED };
