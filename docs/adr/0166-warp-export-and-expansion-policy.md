# ADR-0166: Warp export and Expand Appearance policy

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

SVG has no editable envelope primitive; PDF, raster, and codegen targets
differ in capability. Export must produce the visible result accurately and
Expand Appearance must use the canonical evaluator.

## Decision

D1 — **Editable Varve documents** (save/reopen/clipboard) preserve the live
warp stack (nodes serialize it; migration 2.15→2.16 sanitizes).

D2 — **SVG**: warped shapes bake to `<path>` with the canonical export-
quality evaluator; warped text exports as per-cluster `<text>` elements
with affine transforms (stays text); warped containers export evaluated
child paths with the container's world transform. Image fills under warp
bake with an explanatory comment.

D3 — **PDF**: warped subtrees take the raster-PDF fallback path
(`subtreeRequiresRasterPdfFallback`), which renders through the live canvas
— exactly the warped result.

D4 — **Raster export**: uses the live canvas (already warp-aware).

D5 — **Codegen web targets**: `analyzeNodeFlattening` marks warped nodes
`mustFlatten` (reason `warp`) → raster fallback rather than silently
dropping the deformation.

D6 — **Expand Appearance**: destructive bake via `bakeNodeWarp` using the
same canonical evaluator at export quality; text keeps text (adjustments
baked); warped containers are unsupported with a visible reason; undo
restores the exact pre-expand document.

## Alternatives

- Misleading affine transforms for nonlinear warps: rejected (task).
- Rasterizing everything: rejected for SVG (vector targets stay vector).
