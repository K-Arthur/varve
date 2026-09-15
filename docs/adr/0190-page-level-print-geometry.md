# ADR-0190: Page-level print geometry

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Bleed/safeArea/slug are per-page optional overrides of document defaults
(`types.ts:1580-1585`), but the canvas never draws them (PrintOverlays is
orphaned) and export sends dialog bleed, not document bleed (ADR-0192). There
are no margins/columns on pages, no inside/outside semantics, no slug
consumption.

## Decision

D1 — Resolved print geometry per page comes from a single resolver with
precedence: application default → document default → section default
(sections gain `printGeometryDefaults`) → master default (ADR-0181 layer
defaults) → page override → export-job override. The resolver is pure and
unit-tested for every precedence case.

D2 — `PagePrintGeometry` unifies bleed, slug, safeArea (as edge sets with
`inside/outside` resolution for facing pages) plus margins and columns
(count, gap, unequal columns where supported). Existing `Page.bleed` etc.
remain as the page-override layer of this structure.

D3 — Inside/outside terms resolve from spread topology + binding direction
(ADR-0178): LTR left page → inside = right edge; RTL mirrors. Resolved edge
values are what render, snap, and export.

D4 — Canvas preview (bleed/slug/safe-area/margins/columns) is one
page-aware overlay (reviving PrintOverlays under the shared coordinate
service), toggled per workspace; it never participates in selection or export
unless enabled.

D5 — Validation: no negative bleed/slug, bleed ≤ min(page)/2, slug ≤ min/4,
marks fit within slug or warn, safe-area violations are warnings (never
auto-move content).

## Alternatives

- Overloading one padding object — rejected (explicitly banned by spec §8.7).
- Export-only geometry — rejected: canvas preview, snapping, and preflight
  must agree.

## Consequences

- Preflight and export read the same resolver — dialog bleed disappears from
  the pipeline (replaced by export-job override).
- Facing-page docs with inside/outside bleed flip correctly under RTL.

## Migration impact

v2.22: section defaults additive; existing page overrides keep semantics.

## Compatibility impact

Old readers ignore new fields.

## Security considerations

Bounds per D5; foldouts get per-page validation (no cross-page bleed
overlap check required but warned).

## Rejected shortcuts

- Reusing `Page.bleed` as the only bleed representation (needed for
  section/master layers).
- Treating safe-area violations as errors.

## Clarification (2026-08-13)

The "application default" layer of D1 resolves to **zero bleed**
(`EMPTY_BLEED` in `printGeometry.ts`), not to a conventional 3 mm. Print
presets carry bleed into documents at creation; documents that never
configured bleed (including legacy files) resolve to trim-only, so old
exports keep their original dimensions. 3 mm must never be silently injected
into an existing document. The export dialog's bleed field is the
export-job override layer of D1: it seeds from the active page's resolved
bleed and overrides only that job.
