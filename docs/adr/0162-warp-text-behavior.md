# ADR-0162: Warped editable text

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Warping text must not convert it to outlines. Text stays editable; the warp
must follow content, font, and style edits.

## Decision

D1 — Text warp = **per-cluster affine adjustments** (translate/rotate/scale)
derived from the warp's Jacobian at each grapheme-cluster position, written
into the engine text primitive's `glyphAdjustments` (already consumed by
`drawClusters`). The scene text node is untouched — adjustments are derived,
disposable, and regenerated on every node change.

D2 — Scope gates (documented, surfaced via warnings): plain single-line
text, point or area mode, LTR/non-RTL, no rich text, no path text, no tabs,
no case transform. Anything else renders unwarped with the reason available
to the Inspector.

D3 — Expand Appearance bakes the derived adjustments into the node's
`glyphAdjustments` (text stays text; the warp stack is cleared). True glyph
outlines under warp remain a follow-up via the Rust shaping backend
(rustybuzz + ab_glyph), noted in `textOutlines.ts`.

## Alternatives

- Text → outlines at warp time: rejected — needs font-binary access on every
  render path and destroys editability.
- Whole-box affine approximation: rejected — cannot express curvature.
