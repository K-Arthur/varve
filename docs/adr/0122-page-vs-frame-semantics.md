# ADR-0122: Page versus frame semantics

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The scene has `Page` (semantic print entity, `types.ts:1573`) and `frame`
(artboard-capable container, `coordinateService.ts:299-319` — a frame that is a
direct child of a page content root is an artboard). Today pages are the only
multi-document carrier and frames are content containers, but nothing enforces
the distinction beyond convention.

## Decision

D1 — A page is a semantic print/layout entity (identity, trim size, numbering,
master assignment, print geometry), never a scene node. Frames are content
containers inside pages.

D2 — Page geometry (trim) is declared on `Page.width/height`; frame geometry is
declared on `FrameNode`. The renderer draws the page background from page
geometry, never from a synthesized frame.

D3 — Artboards remain a *capability* of frames (a frame may span a page), but a
page never requires an artboard and an artboard never implies a page.

## Alternatives

- Page as a hidden frame in the scene — rejected: conflates print semantics
  with authored content; page deletion/export/selection would be frame
  operations.
- One artboard per page enforced — rejected: legacy flat documents and
  pasteboard workflows (Demo 2) need content directly on the page.

## Consequences

- Page geometry changes never touch node transforms.
- New UI (Page Tool, Pages panel) operates on `Page`, never on frames.

## Migration impact

None — schema unchanged; this pins interpretation of existing fields.

## Compatibility impact

None.

## Security considerations

Validation must reject pages whose contentRoot is also used as a frame or
another page's root (shared-root detection on load).

## Rejected shortcuts

- Adding page fields to FrameNode.
- Auto-creating an artboard per page.
