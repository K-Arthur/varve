# ADR-0144: Shared canvas rendering

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The render loop walks `activePageNodes(doc)` (`CanvasArea.tsx:1447`) — one
page; every page's content sits at world origin, so multi-page rendering
requires placement (ADR-0124) and a page-aware scene walk.

## Decision

D1 — The canvas scene becomes: pasteboard layer + [placed pages
(shadow → slug → bleed → background → master projection → page content)] +
globals + overlays. Layer order pinned and documented (spec §12).

D2 — The scene walk resolves per-page placement once per frame into a
page-revision key; world-space IR and the subtree caches key on
(page placement revision, doc revision) to avoid stale world geometry.

D3 — Culling is page-first: pages outside the viewport are skipped entirely;
inside a page, existing container/node culling applies. Page bounds come from
resolved placement + trim (+ bleed when preview enabled).

D4 — Dirty regions understand page placement changes, page resize, master
changes (invalidate assigned pages only), text reflow (frame-forward),
cross-page moves, and guide changes; page shadows are batched draws.

D5 — Page backgrounds/labels/shadows are cheap batched fills per page (no
scene nodes); the existing worker renderer consumes the same placed scene
(worker parity).

D6 — The active page remains a first-class concept for commands/insertion
targets but never restricts rendering, hit testing, or selection (spec §13).

## Alternatives

- Render all pages through one flat rootChildren walk — rejected: breaks
  placement/ownership, culling, and cache keys.
- Per-page offscreen canvases composited in DOM — rejected: memory cost on
  4 GB machines and blurry zoom.

## Consequences

- Hit testing, marquee, snapping, guides, minimap, thumbnails move to the
  placed scene (Milestones 5-6).
- Page labels render for all visible pages (currently active-only,
  CanvasArea.tsx:3235-3237).

## Migration impact

None (renderer-internal).

## Compatibility impact

None.

## Security considerations

Placement bounds (ADR-0124) keep culling math finite; hidden pages never
compose.

## Rejected shortcuts

- Removing the active-page filter without placement (all pages overlap).
- DOM compositing per page.
