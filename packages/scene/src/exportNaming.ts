/**
 * Export filename generation (M13, ADR-0167): token-based file naming for
 * separate-page output with cross-platform sanitization.
 *
 * Tokens: {document}, {section}, {pageName}, {pageNumber}, {pageIndex},
 * {spread}. Unsupported tokens are left literal; filenames are sanitized
 * for every OS (reserved characters, reserved device names, length caps)
 * and collisions are the caller's concern (they suffix).
 */

import type { Document, NodeId } from '@varve/scene';
import { computePageNumbering } from '@varve/scene';

export interface PageExportNameContext {
  documentName: string;
  pageId: NodeId;
  pageName: string;
  pageNumber: string;
  pageIndex: number;
  spreadName: string;
  sectionName: string;
}

/** Expand filename tokens for one page. */
export function expandExportFilename(template: string, ctx: PageExportNameContext): string {
  return template
    .replaceAll('{document}', sanitizeFilenameSegment(ctx.documentName))
    .replaceAll('{section}', sanitizeFilenameSegment(ctx.sectionName || 'unsectioned'))
    .replaceAll('{pageName}', sanitizeFilenameSegment(ctx.pageName))
    .replaceAll(
      '{pageNumber}',
      sanitizeFilenameSegment(ctx.pageNumber || String(ctx.pageIndex + 1)),
    )
    .replaceAll('{pageIndex}', String(ctx.pageIndex + 1))
    .replaceAll('{spread}', sanitizeFilenameSegment(ctx.spreadName));
}

/** Build the naming context for a page. */
export function pageExportNameContext(doc: Document, pageId: NodeId): PageExportNameContext {
  const pages = doc.pages ?? [];
  const pageIndex = pages.findIndex((p) => p.id === pageId);
  const page = pages[pageIndex];
  const numbering = computePageNumbering(doc);
  const entry = numbering.get(pageId);
  const spread = doc.spreads?.find((s) => s.pageIds.includes(pageId));
  const sections = [...(doc.sections ?? [])].sort((a, b) =>
    a.startPageOrder < b.startPageOrder ? -1 : 1,
  );
  let sectionName = '';
  if (page) {
    for (const s of sections) {
      if (s.startPageOrder <= page.order) sectionName = s.name;
      else break;
    }
  }
  return {
    documentName: doc.name ?? 'document',
    pageId,
    pageName: page?.name ?? `page-${pageIndex + 1}`,
    pageNumber: entry?.formatted ?? '',
    pageIndex: Math.max(0, pageIndex),
    spreadName: spread ? `spread-${spread.id}` : '',
    sectionName,
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: Windows forbids control chars (U+0000-U+001F) in filenames — intentional range.
const WINDOWS_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;
const TRAILING_DOTS = /[. ]+$/g;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Sanitize a single filename segment (cross-platform). */
export function sanitizeFilenameSegment(segment: string): string {
  let out = segment.replace(WINDOWS_RESERVED, '_').trim();
  out = out.replace(TRAILING_DOTS, '');
  if (RESERVED_DEVICE.test(out)) out = `_${out}`;
  if (out === '') out = '_';
  // Length cap (ext4/APFS ~255 bytes; keep room for extensions and suffixes).
  return out.slice(0, 180);
}

/** Sanitize a full filename (path separators and reserved names applied). */
export function sanitizeExportFilename(filename: string): string {
  const trimmed = filename.replace(TRAILING_DOTS, '');
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : '';
  return `${sanitizeFilenameSegment(base)}${ext}`;
}
