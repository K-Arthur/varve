/**
 * Publishing-page layout geometry (ADR-0227).
 *
 * This is intentionally not the same thing as a frame's auto-layout. A page
 * layout describes authoring guides and usable composition geometry; it does
 * not move, resize, or reparent authored nodes. The renderer and inspector
 * can therefore share this contract without making screen-design frames act
 * like print pages.
 */

import type { Document } from './document';
import { getPageSide } from './document-pages';
import type { NodeId, PageLayoutSettings, PageSide } from './types';

export const MAX_PAGE_LAYOUT_VALUE = 10_000_000;
export const MAX_PAGE_LAYOUT_COLUMNS = 100;

export const DEFAULT_PAGE_LAYOUT: PageLayoutSettings = {
  margins: { top: 0, bottom: 0, inside: 0, outside: 0 },
  columns: { count: 1, gutter: 0 },
};

export interface PageLayoutIssue {
  code:
    | 'invalid-value'
    | 'invalid-column-count'
    | 'margins-exceed-page'
    | 'columns-exceed-usable-width';
  message: string;
}

export interface PageLayoutMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageColumnGuide {
  x: number;
  width: number;
}

export interface ResolvedPageLayout {
  /** Effective settings after document, master, and page precedence. */
  settings: PageLayoutSettings;
  /** Physical margins after inside/outside are mapped to left/right. */
  margins: PageLayoutMargins;
  /** Bounds available to page content after top/bottom margins. */
  usableBounds: { x: number; y: number; width: number; height: number };
  /** Equal-width column guides inside the usable width. */
  columns: PageColumnGuide[];
  /** Non-fatal geometry warnings shown by the inspector/preflight. */
  issues: PageLayoutIssue[];
  /** Page side used to resolve inside/outside when facing pages are enabled. */
  pageSide: PageSide;
}

function cloneSettings(settings: PageLayoutSettings): PageLayoutSettings {
  return {
    margins: { ...settings.margins },
    columns: { ...settings.columns },
  };
}

/** Return structural validation errors without changing user-authored values. */
export function validatePageLayoutSettings(input: unknown): PageLayoutIssue[] {
  if (typeof input !== 'object' || input === null) {
    return [{ code: 'invalid-value', message: 'Page layout must be an object' }];
  }
  const value = input as Partial<PageLayoutSettings>;
  const margins = value.margins;
  const columns = value.columns;
  if (typeof margins !== 'object' || margins === null) {
    return [{ code: 'invalid-value', message: 'Page layout margins are required' }];
  }
  if (typeof columns !== 'object' || columns === null) {
    return [{ code: 'invalid-value', message: 'Page layout columns are required' }];
  }

  const issues: PageLayoutIssue[] = [];
  for (const name of ['top', 'bottom', 'inside', 'outside'] as const) {
    const raw = margins[name];
    if (
      typeof raw !== 'number' ||
      !Number.isFinite(raw) ||
      raw < 0 ||
      raw > MAX_PAGE_LAYOUT_VALUE
    ) {
      issues.push({
        code: 'invalid-value',
        message: `Page layout margin ${name} must be finite and non-negative`,
      });
    }
  }
  if (
    typeof columns.count !== 'number' ||
    !Number.isInteger(columns.count) ||
    columns.count < 1 ||
    columns.count > MAX_PAGE_LAYOUT_COLUMNS
  ) {
    issues.push({
      code: 'invalid-column-count',
      message: `Page layout column count must be an integer from 1 to ${MAX_PAGE_LAYOUT_COLUMNS}`,
    });
  }
  if (
    typeof columns.gutter !== 'number' ||
    !Number.isFinite(columns.gutter) ||
    columns.gutter < 0 ||
    columns.gutter > MAX_PAGE_LAYOUT_VALUE
  ) {
    issues.push({
      code: 'invalid-value',
      message: 'Page layout gutter must be finite and non-negative',
    });
  }
  return issues;
}

export function isValidPageLayoutSettings(input: unknown): input is PageLayoutSettings {
  return validatePageLayoutSettings(input).length === 0;
}

function effectiveSettings(doc: Document, pageId: NodeId): PageLayoutSettings {
  const page = doc.pages?.find((candidate) => candidate.id === pageId);
  const master = page?.masterPageId ? doc.masters?.[page.masterPageId] : undefined;
  const candidate = page?.layout ?? master?.layout ?? doc.pageLayout ?? DEFAULT_PAGE_LAYOUT;
  // A malformed persisted extension must not make the Page tool crash. The
  // codec may preserve newer fields, but this resolver only consumes a fully
  // valid layout contract and falls back to the safe no-guide default.
  return isValidPageLayoutSettings(candidate)
    ? cloneSettings(candidate)
    : cloneSettings(DEFAULT_PAGE_LAYOUT);
}

function physicalMargins(
  settings: PageLayoutSettings,
  side: PageSide,
  rtl: boolean,
): PageLayoutMargins {
  // In LTR, a right-hand page has the binding edge on its left. RTL mirrors
  // that relationship. With no facing-page side, inside is the left edge so
  // single-page documents remain deterministic.
  const insideIsLeft = side === 'none' ? true : rtl ? side === 'left' : side === 'right';
  return {
    top: settings.margins.top,
    bottom: settings.margins.bottom,
    left: insideIsLeft ? settings.margins.inside : settings.margins.outside,
    right: insideIsLeft ? settings.margins.outside : settings.margins.inside,
  };
}

/** Resolve page layout without mutating the document or authored objects. */
export function resolvePageLayout(doc: Document, pageId: NodeId): ResolvedPageLayout | null {
  const page = doc.pages?.find((candidate) => candidate.id === pageId);
  if (!page) return null;

  const settings = effectiveSettings(doc, pageId);
  const structuralIssues = validatePageLayoutSettings(settings);
  const pageSide = getPageSide(doc, pageId);
  const margins = physicalMargins(settings, pageSide, doc.facingPages?.bindingDirection === 'rtl');
  const issues = [...structuralIssues];
  const usableWidth = Math.max(0, page.width - margins.left - margins.right);
  const usableHeight = Math.max(0, page.height - margins.top - margins.bottom);
  if (margins.left + margins.right > page.width) {
    issues.push({
      code: 'margins-exceed-page',
      message: 'Left and right margins leave no usable page width',
    });
  }
  if (margins.top + margins.bottom > page.height) {
    issues.push({
      code: 'margins-exceed-page',
      message: 'Top and bottom margins leave no usable page height',
    });
  }

  const count = Number.isInteger(settings.columns.count) ? Math.max(1, settings.columns.count) : 1;
  const gutter = Number.isFinite(settings.columns.gutter)
    ? Math.max(0, settings.columns.gutter)
    : 0;
  const totalGutter = Math.max(0, count - 1) * gutter;
  if (totalGutter > usableWidth) {
    issues.push({
      code: 'columns-exceed-usable-width',
      message: 'Column gutters exceed the usable page width',
    });
  }
  const columnWidth = Math.max(0, (usableWidth - totalGutter) / count);
  const columns = Array.from({ length: count }, (_, index) => ({
    x: margins.left + index * (columnWidth + gutter),
    width: columnWidth,
  }));

  return {
    settings,
    margins,
    usableBounds: {
      x: margins.left,
      y: margins.top,
      width: usableWidth,
      height: usableHeight,
    },
    columns,
    issues,
    pageSide,
  };
}

/** Set a page-local layout override. Invalid structural input is a no-op. */
export function setPageLayout(doc: Document, pageId: NodeId, layout: PageLayoutSettings): Document {
  if (!isValidPageLayoutSettings(layout)) return doc;
  if (!doc.pages?.some((page) => page.id === pageId)) return doc;
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.id === pageId ? { ...page, layout: cloneSettings(layout) } : page,
    ),
  };
}

/** Remove a page-local override so the page inherits its master/document layout. */
export function clearPageLayout(doc: Document, pageId: NodeId): Document {
  if (!doc.pages?.some((page) => page.id === pageId)) return doc;
  return {
    ...doc,
    pages: doc.pages.map((page) => (page.id === pageId ? { ...page, layout: undefined } : page)),
  };
}

/** Set document defaults used by pages without a master/page override. */
export function setDocumentPageLayout(doc: Document, layout: PageLayoutSettings): Document {
  if (!isValidPageLayoutSettings(layout)) return doc;
  return { ...doc, pageLayout: cloneSettings(layout) };
}
