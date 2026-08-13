# Text pipeline architecture

**Status:** migration in progress — audit baseline recorded 2026-08-13; shaping, BiDi, and snapshot foundations landed

Varve’s text system keeps source text in logical Unicode order. Paragraphs and
rich-text runs are document data; visual ordering, glyph clusters, line boxes,
caret stops, and selection fragments are derived layout data.

## Current pipeline

```text
TextNode.text / TextNode.richText / TextStory
  → sceneNodeToEngineNode
  → text render IR
  → replay-time greedy layout
      ├─ Canvas measureText + browser fillText (live canvas)
      ├─ TS shaping seam (grapheme measurements; glyphId = 0)
      └─ Rust rustybuzz command (native, currently export/diagnostic oriented)
  → SVG/PDF/codegen-specific consumers
```

This is a transitional architecture. The browser’s shaping is not exposed
enough to serve as Varve’s authoritative glyph, cluster, caret, or export data.
The exact findings and code references are in
[the 2026-08-13 Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md).

## Target pipeline

```text
logical source string
  → paragraph boundaries
  → UTF-16 / scalar / grapheme index map
  → UAX #9 paragraph resolution
  → script, language, style, and font itemization
  → cluster-aware font fallback
  → HarfBuzz-compatible shaping
  → UAX #14 line breaking
  → line-level visual run ordering
  → TextLayoutSnapshot
      ├─ positioned glyph runs and metrics
      ├─ logical ↔ visual source maps
      ├─ legal caret stops and hit testing
      ├─ selection fragments
      ├─ layout/ink/object bounds
      └─ diagnostics and cache identity
  → canvas/WebGPU fallback renderer
  → editor, masks, raster export, SVG, PDF, and codegen
```

The snapshot is derived, revisioned, and bounded in memory. It must never be
serialized as authoritative document content. A document edit, font revision,
feature/variation change, frame geometry change, or relevant layout-policy
change invalidates the appropriate paragraph/story scope.

## Non-negotiable invariants

1. Serialized text remains logical Unicode order and is never reversed for RTL.
2. Source ranges remain UTF-16-compatible at persistence/DOM boundaries, while
   scalar, grapheme, shaping-cluster, glyph, and visual-caret units are explicit.
3. Complex scripts are shaped by a standards-based OpenType engine; one source
   character is not assumed to equal one glyph.
4. Rich formatting belongs to logical source ranges, never to visual glyph
   positions.
5. Rendering, bounds, caret placement, hit testing, selection, masks, and
   exports consume the same derived layout wherever practical.
6. Canvas2D may remain a rasterization backend, and WebGPU may fall back to it
   for text, but neither API is the layout authority.
7. Missing fonts and unsupported export semantics are reported explicitly;
   they are not silently presented as equivalent output.

## Backend strategy

* Native desktop shaping uses the existing `rustybuzz` implementation over
  validated font bytes.
* Web/WASM shaping uses the existing `harfbuzzjs` dependency behind the same
  request/result contract when font bytes are available.
* Canvas2D measurement is a bounded fallback for environments without a font
  byte source. It is marked approximate and cannot satisfy glyph-level parity
  or PDF text requirements.
* UAX #9 resolution is provided through the maintained `bidi-js` adapter in
  `unicode/bidiUax9.ts`; the public paragraph API retains logical UTF-16
  offsets while exposing resolved visual indices and mirrored-character data.

The backend contract currently lives in `packages/engine/src/shapingBackend.ts`.
It normalizes native font units to the requested size and uses UTF-16 source
cluster offsets. The HarfBuzz WASM adapter is lazy and owns one module instance
per backend; font bytes are supplied per request and are not transferred every
frame. This slice is an integration seam, not yet a switch of the live canvas
renderer.

The first derived snapshot contract lives in
`packages/engine/src/textLayoutSnapshot.ts`. It retains the logical source and
Unicode index map while carrying line boxes, positioned glyphs, caret stops,
selection rectangles, diagnostics, and an identity suitable for bounded LRU
caching. It is deliberately not wired into replay yet; the current canvas path
must be switched only after fallback and font-revision policy are explicit.

Rich text has a matching logical source index in
`packages/scene/src/richTextIndex.ts`. It derives paragraph separators and
run-local UTF-16 ranges without changing stored run order; formatting remains
attached to logical ranges and can later be itemized into shaped snapshots.
Canonical scene operations in `packages/scene/src/richTextOps.ts` now also
remove selected properties and replace text at grapheme-safe paragraph ranges,
with adjacent equivalent runs normalized after each transaction.

`characterFormatValue` reports mixed values across a logical selection, and the
existing rich-span inspector uses that state for its bold/italic controls while
keeping formatting changes property-specific.

`FontRegistry.revision` is a monotone process-local invalidation token. The
shaping cache accepts it, face identity, OpenType features, variation axes,
width, and layout mode in its key and bounds both entries and estimated bytes;
callers must supply the revision when requesting font-dependent geometry.

## Related decisions

* [ADR-0186 — text composition engine](../adr/0186-text-composition-engine.md)
* [ADR-0187 — persisted versus derived text ranges](../adr/0187-persisted-vs-derived-text-ranges.md)
* [ADR-0188 — incremental reflow](../adr/0188-incremental-reflow.md)
* [Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md)

The implementation is intentionally staged. The audit and index foundation
must land before replacing live shaping or renderer paths, so every later
consumer can use the same source-boundary contract.
