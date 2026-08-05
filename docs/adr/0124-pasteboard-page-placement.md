# ADR-0124: Pasteboard page placement

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Pages have no placement: every contentRoot renders at world origin, so
simultaneous multi-page rendering is impossible. There is no pasteboard
layout engine (zero placement references in the editor).

## Decision

D1 — Add optional `placement?: { x: number; y: number }` to `Page` and
`Spread` (world/pasteboard coordinates of the top-left of the trim box; spread
placement overrides per-page when present).

D2 — Placement is **layout metadata, not content**: moving a page updates only
`Page.placement`; child transforms never change.

D3 — A deterministic pasteboard layout engine (`@varve/scene` pure function)
provides modes: vertical stack, horizontal row, grid, facing-spread stack,
manual. Auto-arrange never rewrites authored placement when a manual placement
exists, and never touches semantic page order.

D4 — Placement is optional: absent placement is resolved by the layout engine
(deterministic default: vertical stack, page gap 96px, spread gap 144px,
first page at origin). Migration materializes placement once, then user edits
become manual.

## Alternatives

- Derive placement always (no persistence) — rejected: user arrangements must
  survive reload; manual mode needs an authored flag.
- Store placement on content roots as transforms — rejected: ADR-0123.

## Consequences

- Bounds computation, zoom-to-all, minimap, thumbnails, culling all consume
  resolved placement.
- Cache keys for world-space IR must include placement revision.

## Migration impact

v2.17 migration materializes placement for existing docs via the layout engine
(no content transform changes).

## Compatibility impact

Unknown fields pass through the codec; older versions ignore placement.

## Security considerations

Bounded coordinates; a malformed page position cannot create infinite bounds.

## Rejected shortcuts

- Placing pages by mutating each page's content-root transform.
- A single document-level grid that forbids manual placement.
