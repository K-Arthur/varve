# ADR-0179: Mixed page sizes

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Per-page `width/height` already exist (`types.ts:1575-1576`) and
`setPageSize` works without touching content (`document-pages.ts:229-242`).
Document-level `physicalWidth/Height` are defaults, not page size (the audit
found no `canvasWidth === page.width` assumption in scene; the editor uses
document dims only as defaults). Mixed sizes are therefore schema-safe; the
work is in every downstream consumer (rendering, spreads, export boxes).

## Decision

D1 — Per-page trim size is authoritative. Document-level dimensions are
defaults for new pages only and never override existing pages.

D2 — All page-bound math (placement, culling, bounds, zoom-to-all, snapping)
consumes per-page resolved size.

D3 — Spreads tolerate mixed sizes: facing pairs may differ in height/width;
spread bounds = union of member page bounds (spine gap configurable).

D4 — Export emits each page's own MediaBox/TrimBox/BleedBox from resolved page
geometry (ADR-0192).

D5 — `setPageSize` keeps three explicit modes: resize page only, scale content
(ratio), reflow layout — surfaced in the Page Tool; never silent scaling.

## Alternatives

- One canvas size per document — rejected: mixed-size workflows are a core
  requirement (foldouts).
- Scaling content on every resize — rejected: destroys layout.

## Consequences

- Page Tool and inspector must present per-page size, orientation, preset.
- Facing spreads of different heights render aligned by top edge.

## Migration impact

None — mixed sizes already valid in schema; downstream consumers land in M5.

## Compatibility impact

None.

## Security considerations

Validate 1 ≤ size ≤ 1e6 px per side; reject zero/negative at load and on
set.

## Rejected shortcuts

- Document-level canvas size overriding pages.
- Auto-uniforming page sizes on spread creation.
