/**
 * Page-range parsing for multi-page export (M13, ADR-0167).
 *
 * Supported syntax:
 *   "1-5"                contiguous range (display numbers)
 *   "1,3,7"              individual pages
 *   "1-5,8,10-12"        mixed
 *   "A-1–A-8"            prefixed display numbers (en/em dash or hyphen)
 *   "current"            the active page
 *   "selected"           currently selected pages (node selection)
 *   "section:Name"       all pages in the named section
 *   "odd" / "even"       parity filter applied to the resolved set
 *   "*" or ""            every page
 *
 * Display numbers are resolved through the document's numbering (prefix +
 * formatted number), so "A-3" targets the page whose display number is
 * A-3 regardless of its array position. Unambiguous syntax: ranges are
 * inclusive; a single number targets one page; whitespace is trimmed.
 */

import type { Document, NodeId } from '@varve/scene';
import { computePageNumbering } from '@varve/scene';

export type PageRangeToken =
  | 'all'
  | 'current'
  | 'selected'
  | { kind: 'section'; name: string }
  | { kind: 'numbers'; values: string[]; parity?: 'odd' | 'even' }
  | { kind: 'prefixes'; prefix: string; values: string[] };

export type PageRangeSpec =
  | { kind: 'all' }
  | { kind: 'current' }
  | { kind: 'selected' }
  | { kind: 'section'; name: string }
  | { kind: 'explicit'; pageIds: NodeId[] };

const MAX_RANGE_TOKENS = 512;

export class PageRangeError extends Error {}

/**
 * Parse a page-range expression into a structured spec. Throws
 * PageRangeError on malformed input.
 */
export function parsePageRange(expression: string): PageRangeSpec {
  const trimmed = expression.trim();
  if (trimmed === '' || trimmed === '*') return { kind: 'all' };
  const lower = trimmed.toLowerCase();
  if (lower === 'current') return { kind: 'current' };
  if (lower === 'selected') return { kind: 'selected' };
  if (lower === 'odd' || lower === 'even') {
    throw new PageRangeError('odd/even must follow a page list (e.g. "1-12 odd")');
  }
  if (trimmed.startsWith('section:')) {
    const name = trimmed.slice('section:'.length).trim();
    if (!name) throw new PageRangeError('section: requires a name');
    return { kind: 'section', name };
  }

  const parts = trimmed.split(/\s+/);
  let parity: 'odd' | 'even' | undefined;
  if (
    parts.length > 1 &&
    (parts[parts.length - 1] === 'odd' || parts[parts.length - 1] === 'even')
  ) {
    parity = parts.pop() as 'odd' | 'even';
  }
  const list = parts.join('').split(',');
  if (list.length > MAX_RANGE_TOKENS) {
    throw new PageRangeError(`page range exceeds ${MAX_RANGE_TOKENS} tokens`);
  }

  const values: string[] = [];
  let prefix: string | undefined;
  for (const rawToken of list) {
    const token = rawToken.trim();
    if (!token) continue;
    const match = /^([A-Za-z-]*)?(\d+)(?:[-–—]([A-Za-z-]*)(\d+))?$/.exec(token);
    if (!match) {
      throw new PageRangeError(`unparseable page token "${token}"`);
    }
    const tokenPrefix = match[1] ?? '';
    if (prefix === undefined) prefix = tokenPrefix;
    if (tokenPrefix !== prefix) {
      throw new PageRangeError(`mixed prefixes in range (${prefix} vs ${tokenPrefix})`);
    }
    const start = Number(match[2]);
    if (match[3] !== undefined) {
      const secondPrefix = match[3] ?? '';
      if (secondPrefix !== tokenPrefix) {
        throw new PageRangeError(`mixed prefixes in range (${tokenPrefix} vs ${secondPrefix})`);
      }
    }
    const end = match[4] !== undefined ? Number(match[4]) : start;
    if (end < start) throw new PageRangeError(`range "${token}" is descending`);
    for (let n = start; n <= end; n++) values.push(String(n));
  }
  if (values.length === 0) throw new PageRangeError('page range is empty');

  if (prefix) {
    return { kind: 'prefixes', prefix, values };
  }
  return { kind: 'numbers', values, parity };
}

/** Resolve a parsed spec against a document into concrete page ids. */
export function resolvePageRange(
  doc: Document,
  spec: PageRangeSpec,
  context: { activePageId?: NodeId | null; selectedNodeIds?: readonly NodeId[] } = {},
): NodeId[] {
  const pages = doc.pages ?? [];
  switch (spec.kind) {
    case 'all':
      return pages.map((p) => p.id);
    case 'current': {
      const id = context.activePageId ?? doc.activePageId;
      return id && pages.some((p) => p.id === id) ? [id] : [];
    }
    case 'selected': {
      const selected = new Set(context.selectedNodeIds ?? []);
      return pages.filter((p) => selected.has(p.contentRoot)).map((p) => p.id);
    }
    case 'section': {
      const sections = [...(doc.sections ?? [])].sort((a, b) =>
        a.startPageOrder < b.startPageOrder ? -1 : 1,
      );
      const section = sections.find((s) => s.name === spec.name);
      if (!section) return [];
      return pages.filter((p) => p.order >= section.startPageOrder).map((p) => p.id);
    }
    case 'explicit':
      return spec.pageIds;
    case 'numbers': {
      const numbering = computePageNumbering(doc);
      const wanted = new Set(spec.values);
      return pages
        .filter((p) => {
          const entry = numbering.get(p.id);
          if (!entry) return false;
          const num = entry.number;
          if (!wanted.has(String(num))) return false;
          if (spec.parity === 'odd') return num % 2 === 1;
          if (spec.parity === 'even') return num % 2 === 0;
          return true;
        })
        .map((p) => p.id);
    }
    case 'prefixes': {
      const numbering = computePageNumbering(doc);
      const wanted = new Set(spec.values);
      return pages
        .filter((p) => {
          const entry = numbering.get(p.id);
          if (!entry) return false;
          const formatted = entry.formatted;
          if (!formatted.startsWith(spec.prefix)) return false;
          const numPart = formatted.slice(spec.prefix.length).trim();
          return wanted.has(numPart);
        })
        .map((p) => p.id);
    }
  }
}

/** One-call convenience: parse + resolve. */
export function resolvePageRangeExpression(
  doc: Document,
  expression: string,
  context: { activePageId?: NodeId | null; selectedNodeIds?: readonly NodeId[] } = {},
): NodeId[] {
  return resolvePageRange(doc, parsePageRange(expression), context);
}
