# ADR-0238: Non-destructive guide layouts and transformed snapping

- **Status:** Accepted (implemented in v2.30)
- **Date:** 2026-09-21
- **Related:** ADR-0227, ADR-0229, ADR-0233, `architecture/grid-system.md`,
  `architecture/figma-import-system.md`

## Context

Frames, publishing pages, and master pages need composition guides without
turning guides into auto-layout or silently moving authored content. The old
layout-grid representation coupled axes, described uniform grids ambiguously,
and treated a transformed frame as an axis-aligned rectangle. Those choices
made duplicate/copy/paste ownership fragile and made page/master inheritance
hard to explain.

Users of other design tools also report predictable failure modes: guides that
disappear when scope changes, one gutter shared by rows and columns, rotated
frames that stop snapping, and master duplication that loses layout metadata.
Varve can address these locally because guide geometry is metadata and the
document already has explicit page/master ownership and transactional history.

## Decision

1. **One canonical geometry contract.** `LayoutGrid` is a typed layout-guide
   value. Column/row layouts have count, stretch/fixed sizing, optional fixed
   track size, independent gutters, four named margins, axis-neutral
   start/center/end/stretch alignment, and a signed offset. A `uniform` layout
   is a square lattice with `cellSize`, `offsetX`, and `offsetY`. Geometry is
   resolved in `@varve/scene` into bounded local regions and finite segments;
   rendering, snapping, import verification, and measurements consume that
   result.
2. **Explicit ownership and precedence.** A frame owns an array of layouts.
   A page resolves page override → master → document default → built-in default.
   Page rows and columns are independent. Visibility, snapping, and locking are
   separate fields. Guides never reflow, resize, reparent, or export content.
3. **Transactional editing.** Guide Layouts opens one target snapshot (frame
   selection, page, master, or document defaults), previews immediately, and
   applies as one undo entry. Cancel, Escape, document switch, or owner deletion
   restores only the targeted guide fields. Add is the default; Replace all and
   Clear all are explicit destructive actions. Locked layouts allow visibility,
   snap, and unlock changes but block geometry edits.
4. **Identity follows content.** All user-facing subtree clones use the scene
   clone/remap helper. Removed descendants prune keyed guide metadata. Clipboard
   v3 includes only guide owners in the fragment and remints owner/guide ids on
   paste; v1 and v2 payloads remain readable.
5. **Transforms are first-class.** Finite oriented segments are transformed
   through the complete owner world transform and camera. Snapping projects an
   artwork anchor to a segment and applies one joint two-dimensional correction.
   Candidates are scoped to the containing/active owner; invalid or
   non-invertible geometry is reported and never moves content.
6. **Presets are copy-based.** Built-in presets and a bounded, corrupt-tolerant
   local personal preset store materialize fresh layouts. No preset creates a
   hidden document or cloud dependency.

## Consequences

The model is portable and deterministic across save/reload, duplication,
clipboard, page reorder, master reassignment, undo, and camera rotation. The
cost is a bounded geometry resolver and explicit UI state instead of deriving
guides from auto-layout. Arbitrary-angle authored lattices, unequal individual
tracks, linked/cloud layout styles, and lossy ruler-guide conversion remain
outside this contract.

## Verification

- Scene migration, geometry limits, page precedence, clone/prune, and page
  duplication tests cover the v2.30 model.
- Editor tests cover presets, finite transformed segment snapping, page overlay
  visibility, clipboard v3 validation/remapping, and Figma GRID conversion.
- Browser and visual evidence is recorded in
  `docs/audits/guide-layouts-verification-2026-09-21.md`.
