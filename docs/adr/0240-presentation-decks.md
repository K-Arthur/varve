# ADR-0240: Presentation decks reference editable frames

*Status: accepted — 2026-09-29*

## Context

Varve already stores editable frame artwork and renders it through the shared
scene pipeline, but it has no deck sequence, slide notes, or deck-level delivery
contract. Publishing pages and canvas paint order cannot provide presentation
ordering: frames may live on different canvases or pages, and layout in the
document is an editing concern rather than audience sequence.

The implementation audit also found that the current single-frame preview
leaves dock headers over the audience slide, while the existing export path is
per-object and does not provide a multi-page raster PDF or ordered PNG bundle.
The dated product evidence and reproduced-defect matrix are recorded in
[`docs/research/presentation-workflow-2026-09-29.md`](../research/presentation-workflow-2026-09-29.md)
and [`docs/audits/presentation-workflow-defects-2026-09-29.md`](../audits/presentation-workflow-defects-2026-09-29.md).

## Decision

1. Add optional, versioned `Document.presentation` metadata. A deck contains an
   explicit ordered list of stable slide-entry IDs that reference ordinary
   frame nodes. The deck's pixel size, sections, title, private notes, skip
   flags, accessibility metadata, theme references, and layout bindings are
   presentation metadata. They do not transfer scene ownership or reorder
   canvas layers.
2. Route deck, slide, and section mutations through typed operations and the
   existing transaction/history boundary. Navigation, preview position, and
   presenter display state stay transient. Removing a slide reference removes
   only that entry; deleting its frame remains a separate artwork operation.
   A deleted or otherwise missing frame leaves the reference, notes, and
   sequence position available for repair.
3. Use one resolver for navigation, preflight, preview, and export. It follows
   the deck array order, excludes skipped and scene-hidden slides from the
   default audience/export sequence, reports missing or invalid frames, and
   identifies artwork shared by other decks. Duplicate frame references in
   one deck are rejected by normal operations.
4. Store reusable layout sources as editable ordinary frames on a dedicated
   Design Canvas. Stable content-role keys and managed-property baselines
   distinguish inherited layout values from local changes. Reapplying a
   geometry-changing revision always requires preview and an explicit Apply;
   extra artwork and unmatched content remain editable.
5. Use one exact frame-local structured capture for thumbnails, audience
   preview, and delivery. Initial supported deck outputs are a visually
   faithful rasterized screen PDF and an ordered PNG archive. Neither format is
   described as editable slide structure. PPTX remains deferred until the
   post-core feasibility assessment verifies masks, effects, fonts, and
   geometry mapping.

## Consequences

- Multiple decks may reference the same frame, while order and skip decisions
  remain deck-specific.
- Ordinary frame editing, persistence, rendering, and artwork history remain
  the source of truth; deck metadata is a small, additive layer.
- Navigation and preview create no document mutations or undo entries.
- Migration is additive and preserves unresolved references and private notes.
- PDF/PNG delivery can preserve screen appearance without promising semantic
  editability or PDF accessibility that raster output cannot provide.
- Every future authoring, preview, or export consumer must use the shared
  resolver and capture contract rather than infer order from the canvas.
