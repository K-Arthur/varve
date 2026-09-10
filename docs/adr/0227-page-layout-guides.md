# ADR-0227: Publishing page layout guides are derived geometry

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Varve supports both open-ended screen/design work and publishing pages. A
frame's auto-layout controls authored children; publishing margins and columns
are composition guides associated with a page. Treating the two as one system
would make a Figma-style design frame unexpectedly paginate or move its
content.

The existing page model already owns trim size, placement, print geometry,
spreads, and master projection, but it had no canonical margin/column contract.

## Decision

1. Add `PageLayoutSettings` with top/bottom/inside/outside margins and equal
   columns plus gutter. Values are stored in canonical document pixels.
2. Resolve layout with this precedence:

   `document.pageLayout` → assigned master `layout` → page `layout`

   A page-local setting is a complete override, so a malformed or incomplete
   persisted value can safely fall back to the no-guide default.
3. Map inside/outside to physical left/right using facing-page side and binding
   direction. Single-page documents use inside as left and outside as right.
4. Layout resolution produces usable bounds, column guides, and non-fatal
   warnings when margins or gutters cannot fit. It never repositions, scales,
   reparents, or clips authored objects.
5. `page.set-layout` is the validated mutation boundary. The editor applies it
   through the existing `updateDoc` history boundary, and the Page inspector
   exposes the controls only in the Page tool context.
6. The canvas overlay is view-only and Page-tool scoped. It is not a scene
   node, hit-test target, layer, or export object.

## Consequences

- Print pages have publishing layout semantics without changing screen/design
  frames or frame auto-layout behavior.
- Master layout defaults can be introduced without copying layout guides into
  each page; page overrides remain explicit and serializable.
- Reflow, text threading, snapping to columns, and master editing remain
  separate follow-up slices. The current contract exposes geometry and warns
  about impossible settings instead of silently changing content.
- PDF export must consume the same resolved page geometry before it can claim
  full margin/column or spread fidelity.

## Implementation

- Model and resolver: `packages/scene/src/pageLayout.ts`
- Page/master/document fields: `packages/scene/src/types.ts` and
  `packages/scene/src/document.ts`
- Validated operation: `page.set-layout` in
  `packages/scene/src/operations/ops/pageOps.ts`
- Inspector: `packages/editor/src/components/Inspector/sections/PagePrintSection.tsx`
- View-only overlay: `packages/editor/src/components/PageLayoutOverlay.tsx`
