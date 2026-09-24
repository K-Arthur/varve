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
    | 'invalid-row-count'
    | 'margins-exceed-page'
    | 'columns-exceed-usable-width'
    | 'rows-exceed-usable-height';
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

export interface PageRowGuide {
  y: number;
  height: number;
}

export type PageLayoutSource = 'page-override' | 'master' | 'document-default' | 'built-in-default';

export interface ResolvedPageLayout {
  /** Effective settings after document, master, and page precedence. */
  settings: PageLayoutSettings;
  /** Physical margins after inside/outside are mapped to left/right. */
  margins: PageLayoutMargins;
  /** Bounds available to page content after top/bottom margins. */
  usableBounds: { x: number; y: number; width: number; height: number };
  /** Equal-width column guides inside the usable width. */
  columns: PageColumnGuide[];
  /** Independent horizontal row guides. */
  rows: PageRowGuide[];
  /** Finite segments shared by renderer and page snapping. */
  sharedSegments: Array<
    | { axis: 'vertical'; x: number; y1: number; y2: number }
    | { axis: 'horizontal'; y: number; x1: number; x2: number }
  >;
  /** Non-fatal geometry warnings shown by the inspector/preflight. */
  issues: PageLayoutIssue[];
  /** Page side used to resolve inside/outside when facing pages are enabled. */
  pageSide: PageSide;
  source: PageLayoutSource;
}

function cloneSettings(settings: PageLayoutSettings): PageLayoutSettings {
  return {
    margins: { ...settings.margins },
    columns: { ...settings.columns },
    ...(settings.rows ? { rows: { ...settings.rows } } : {}),
    ...(settings.display === undefined ? {} : { display: settings.display }),
    ...(settings.snapEnabled === undefined ? {} : { snapEnabled: settings.snapEnabled }),
    ...(settings.locked === undefined ? {} : { locked: settings.locked }),
    ...(settings.color === undefined ? {} : { color: settings.color }),
    ...(settings.opacity === undefined ? {} : { opacity: settings.opacity }),
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
  const rows = value.rows;
  if (rows !== undefined) {
    if (typeof rows !== 'object' || rows === null) {
      issues.push({ code: 'invalid-value', message: 'Page layout rows are invalid' });
    } else {
      if (
        typeof rows.count !== 'number' ||
        !Number.isInteger(rows.count) ||
        rows.count < 1 ||
        rows.count > MAX_PAGE_LAYOUT_COLUMNS
      ) {
        issues.push({
          code: 'invalid-row-count',
          message: `Page layout row count must be an integer from 1 to ${MAX_PAGE_LAYOUT_COLUMNS}`,
        });
      }
      if (
        typeof rows.gutter !== 'number' ||
        !Number.isFinite(rows.gutter) ||
        rows.gutter < 0 ||
        rows.gutter > MAX_PAGE_LAYOUT_VALUE
      ) {
        issues.push({
          code: 'invalid-value',
          message: 'Page layout row gutter must be finite and non-negative',
        });
      }
    }
  }
  if (
    value.opacity !== undefined &&
    (typeof value.opacity !== 'number' ||
      !Number.isFinite(value.opacity) ||
      value.opacity < 0 ||
      value.opacity > 1)
  ) {
    issues.push({ code: 'invalid-value', message: 'Page layout opacity must be between 0 and 1' });
  }
  return issues;
}

export function isValidPageLayoutSettings(input: unknown): input is PageLayoutSettings {
  return validatePageLayoutSettings(input).length === 0;
}

function effectiveSettings(
  doc: Document,
  pageId: NodeId,
): {
  settings: PageLayoutSettings;
  source: PageLayoutSource;
} {
  const page = doc.pages?.find((candidate) => candidate.id === pageId);
  const master = page?.masterPageId ? doc.masters?.[page.masterPageId] : undefined;
  const source: PageLayoutSource = page?.layout
    ? 'page-override'
    : master?.layout
      ? 'master'
      : doc.pageLayout
        ? 'document-default'
        : 'built-in-default';
  const candidate = page?.layout ?? master?.layout ?? doc.pageLayout ?? DEFAULT_PAGE_LAYOUT;
  // A malformed persisted extension must not make the Page tool crash. The
  // codec may preserve newer fields, but this resolver only consumes a fully
  // valid layout contract and falls back to the safe no-guide default.
  const valid = isValidPageLayoutSettings(candidate);
  return {
    settings: cloneSettings(valid ? candidate : DEFAULT_PAGE_LAYOUT),
    source: valid ? source : 'built-in-default',
  };
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

  const resolved = effectiveSettings(doc, pageId);
  const settings = resolved.settings;
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

  const rowsSettings = settings.rows ?? { count: 1, gutter: 0 };
  const rowCount = Number.isInteger(rowsSettings.count) ? Math.max(1, rowsSettings.count) : 1;
  const rowGutter = Number.isFinite(rowsSettings.gutter) ? Math.max(0, rowsSettings.gutter) : 0;
  const totalRowGutter = Math.max(0, rowCount - 1) * rowGutter;
  if (totalRowGutter > usableHeight) {
    issues.push({
      code: 'rows-exceed-usable-height',
      message: 'Row gutters exceed the usable page height',
    });
  }
  const rowHeight = Math.max(0, (usableHeight - totalRowGutter) / rowCount);
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    y: margins.top + index * (rowHeight + rowGutter),
    height: rowHeight,
  }));
  const sharedSegments = [
    ...columns.flatMap((column) => [
      { axis: 'vertical' as const, x: column.x, y1: margins.top, y2: margins.top + usableHeight },
      {
        axis: 'vertical' as const,
        x: column.x + column.width,
        y1: margins.top,
        y2: margins.top + usableHeight,
      },
    ]),
    ...rows.flatMap((row) => [
      { axis: 'horizontal' as const, y: row.y, x1: margins.left, x2: margins.left + usableWidth },
      {
        axis: 'horizontal' as const,
        y: row.y + row.height,
        x1: margins.left,
        x2: margins.left + usableWidth,
      },
    ]),
  ];

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
    rows,
    sharedSegments,
    issues,
    pageSide,
    source: resolved.source,
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

/** Set the layout defaults on a master page without touching derived pages. */
export function setMasterPageLayout(
  doc: Document,
  masterId: NodeId,
  layout: PageLayoutSettings,
): Document {
  if (!isValidPageLayoutSettings(layout) || !doc.masters?.[masterId]) return doc;
  return {
    ...doc,
    masters: {
      ...doc.masters,
      [masterId]: { ...doc.masters[masterId]!, layout: cloneSettings(layout) },
    },
  };
}

/** Clear a master layout so pages fall back to document defaults. */
export function clearMasterPageLayout(doc: Document, masterId: NodeId): Document {
  const master = doc.masters?.[masterId];
  if (!master?.layout) return doc;
  return {
    ...doc,
    masters: { ...doc.masters, [masterId]: { ...master, layout: undefined } },
  };
}

/** Set document defaults used by pages without a master/page override. */
export function setDocumentPageLayout(doc: Document, layout: PageLayoutSettings): Document {
  if (!isValidPageLayoutSettings(layout)) return doc;
  return { ...doc, pageLayout: cloneSettings(layout) };
}
