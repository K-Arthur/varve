/**
 * v2.16 → v2.17 migration: materialize pasteboard page placement
 * (ADR-0124 / ADR-0148).
 *
 * Before 2.17 pages had no placement field; every content root sat at world
 * origin. This migration assigns each page a deterministic placement from
 * the auto pasteboard layout (vertical stack of spreads, first page at the
 * origin) and defaults the facing-pages binding direction to LTR.
 *
 * The migration is pure and idempotent: pages that already carry a
 * placement (or a document that already ran this migration) are untouched.
 */

import { autoPageLayout } from './pasteboardLayout';

export function migrateV216ToV217(raw: Record<string, unknown>): Record<string, unknown> {
  const pages = raw.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    // Terminal migration: stamp the version even when there is nothing to
    // migrate (flat pre-page documents must not end the chain at 2.15).
    return { ...raw, formatVersion: '2.17' };
  }

  // Build a minimal document-shaped object for the layout engine.
  const docLike = {
    pages,
    facingPages: raw.facingPages,
  } as unknown as import('./document').Document;

  const layout = autoPageLayout(docLike, undefined);

  let changed = false;
  const migratedPages = pages.map((entry) => {
    const p = entry as Record<string, unknown>;
    if (!p || typeof p !== 'object') return entry;
    const pageId = p.id;
    if (typeof pageId !== 'string') return entry;
    if (p.placement && typeof p.placement === 'object') return entry;
    const position = layout.get(pageId);
    if (!position) return entry;
    changed = true;
    return { ...p, placement: { x: position.x, y: position.y } };
  });

  const facingPages =
    raw.facingPages && typeof raw.facingPages === 'object'
      ? (raw.facingPages as Record<string, unknown>)
      : undefined;
  const nextFacing =
    facingPages && facingPages.bindingDirection === undefined
      ? { ...facingPages, bindingDirection: 'ltr' }
      : facingPages;

  if (!changed && nextFacing === facingPages) return raw;
  return {
    ...raw,
    formatVersion: '2.17',
    pages: migratedPages,
    ...(nextFacing ? { facingPages: nextFacing } : {}),
  };
}
