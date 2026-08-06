# ADR-0196: Page movement and reordering

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`reorderPages` reorders the pages array (`document-pages.ts:106-121`); there
is no pasteboard movement, no Page Tool, no reorder-with-spread semantics, no
move-between-sections.

## Decision

D1 — Two distinct operations: `page.moveOnPasteboard` (updates placement,
never order) and `page.reorder` (updates order keys, never placement,
ADR-0174). Both are single undo transactions.

D2 — Reordering through the Pages panel drag maps to `page.reorder` with
derived spread re-projection (ADR-0177); reordering within/across sections
updates section anchors when the first page of a section moves.

D3 — The Page Tool manipulates placement with distinct handles (page bounds
vs content transforms, spec §14); resize offers explicit modes (resize only /
scale content / reflow), never silent scaling (ADR-0179 D5).

D4 — Cross-page content drag: preserve world position during the gesture,
convert to destination page-local via the coordinate service, reparent
atomically, update selection/snapping, one undo step (ADR-0175 D5).

D5 — Page navigation (Page Up/Down, zoom-to-page, zoom-to-spread, zoom-to-all)
operates on the placed scene; active page updates on navigation (spec §13).

## Alternatives

- Movement via array splice only — rejected: pasteboard placement is
  orthogonal.
- Reorder that repositions pages on the pasteboard — rejected unless the
  user chose auto-arrange.

## Consequences

- PageNav drag-reorder (currently `reorderPages`, PageNav.tsx:224-233) keeps
  working; Pages panel adds placement controls.
- Demos 1/6 (arrange spreads, safe deletion) exercise both operations.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Placement bounds apply to Page Tool drags; reorder validates id lists.

## Rejected shortcuts

- One op that does both (order + placement).
- Reordering by rewriting array index without order keys.
