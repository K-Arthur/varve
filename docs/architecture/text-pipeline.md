# Text pipeline architecture

**Status:** migration in progress — audit baseline recorded 2026-08-13; shaping, BiDi, snapshot foundations, and the canonical paragraph layout pipeline landed

Varve’s text system keeps source text in logical Unicode order. Paragraphs and
rich-text runs are document data; visual ordering, glyph clusters, line boxes,
caret stops, and selection fragments are derived layout data.

## Current pipeline

```text
TextNode.text / TextNode.richText / TextStory
  → sceneNodeToEngineNode
  → text render IR
  → replay-time layout selection
      ├─ TextLayoutSnapshot → positioned cluster replay (plain text when shaping is available)
      ├─ Canvas measureText → transient approximate snapshot → cluster replay (browser fallback)
      ├─ rich-span snapshot → positioned cluster replay (Canvas2D measurement fallback)
      ├─ legacy rich layout fallback (advanced paragraph controls)
      └─ Rust rustybuzz command (native desktop outline conversion; PDF is separate)
  → SVG/PDF/codegen-specific consumers
```

This is a transitional architecture. The browser’s shaping is not exposed
enough to serve as Varve’s authoritative glyph, cluster, caret, or export data.
The exact findings and code references are in
[the 2026-08-13 Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md).

## Editing surface and inspector cost

The native textarea preserves the full transformed text bounds for caret,
selection, input and IME behavior. Its body portal clips painting and hit
testing to the canvas viewport, so an off-canvas line cannot intercept the
inspector. The floating formatting toolbar remains a separate overlay.
This does not replace the pending shaped-glyph caret geometry work.

The glyph inspector segments a paragraph once, derives each label from its
existing grapheme, and memoizes the option arrays. Closed shared Select
controls do not construct their option elements. This avoids quadratic
whole-paragraph segmentation and unnecessary option allocation when selecting
or editing long text. The [September 12 frontend evidence](../audits/font-frontend-evidence-2026-09-12.md)
records the real long-text interaction, clipping hit-test and validation limits.

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

The legacy `textOutlines` adapter reads embedding diagnostics from opentype.js's
`tables.os2` metadata. It preserves the base restriction when no-subsetting is
set, reports bitmap-only separately, and treats malformed modern flags as
unknown. These flags do not establish source-license permission, and the
adapter's warnings are not yet a shared export enforcement policy. Its tests
use the checked-in licensed Geist artifact; synthetic flag variants are
created only in memory. See the [diagnostic repair evidence](../audits/font-outlining-policy-evidence-2026-09-10.md).

* Native desktop shaping uses the existing `rustybuzz` implementation over
  validated font bytes. The editor's desktop text-to-outlines command now
  reaches it through `createNativeShapingBackend`; the adapter carries exact
  artifact/face identity, UTF-16 feature ranges, numeric feature values, and
  variation coordinates, then normalizes native units back to the shared
  `ShapingBackendResult`. If the command is unavailable, the local HarfBuzz WASM
  adapter is an explicit fallback and emits a diagnostic rather than silently
  changing the source.
* Web/WASM shaping uses the existing `harfbuzzjs` dependency behind the same
  request/result contract when font bytes are available. The WASM adapter
  always runs `buffer.guessSegmentProperties()` before applying explicit
  direction/script/language overrides — a direction-only request must not
  silently shape with the default script, which drops all Arabic/Indic GSUB
  features (fixed 2026-08-13, covered by `shapingOracle.test.ts`).
* Structural shaping invariants are verified against system Noto fonts by
  `shapingOracle.test.ts` (skipped when the fonts are absent; never
  redistributed): Arabic joining forms differ per position, harakat are
  zero-advance GPOS-positioned marks, RTL output is visual-order with
  monotone clusters, Devanagari conjuncts reduce glyph counts, and Thai
  marks stay attached to their clusters. Lam-alef is asserted
  font-independently: modern Noto Arabic does not ligate it, and both
  shaped and ligated output are valid.
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
frame. Plain-text replay now consumes a derived snapshot when a pre-shaped IR
result is present, or derives a transient Canvas2D-measured snapshot when the
target exposes `measureText`. The transient fallback is deliberately not
cached because replay does not own a font-face revision token; late font
loading must be allowed to change its measurement.

The live browser canvas still paints complete source runs through the browser's
native shaping implementation. When the selected family has an inspectable
local CSS source, Varve creates a process-local `FontFace` descriptor alias so
whole-run feature values and custom variation axes reach that browser shaper;
the generated family is never persisted. Canvas2D has no portable API for
drawing an arbitrary glyph ID or applying a UTF-16-ranged feature map, so the
byte-backed backend is used for exact outline conversion rather than
pretending that browser `fillText` exposed the same glyph stream. Native PDF
currently has a character-oriented writer; the
editor preflight rasterizes path text, complex/non-Latin text, rich runs,
ligature-sensitive strings, feature/axis/range settings, tracking, and manual
cluster edits through the live renderer. This is an intentional appearance
guarantee with an explicit loss of PDF text searchability for those nodes.

The legacy Canvas measurement bridge now consumes the resolved visual BiDi run
order from `analyzeParagraph`; it no longer reverses an entire RTL paragraph as
a proxy for UAX-9 ordering. Glyph advances remain approximate until a font-byte
shaping backend is selected, but the run-order contract is shared.

The derived snapshot contract lives in
`packages/engine/src/textLayoutSnapshot.ts`. It retains the logical source and
Unicode index map while carrying line boxes, positioned glyphs, caret stops,
selection rectangles, diagnostics, and an identity suitable for bounded LRU
caching. `replay.ts` uses it for plain text; callers that own shaping and font
revisions should continue to use the bounded shaping/snapshot caches outside
the paint hot path. Rich-text, path text, and advanced legacy spacing/list
cases retain explicit fallbacks until they can be itemized into the same
snapshot without losing behavior.

Rich text has a matching logical source index in
`packages/scene/src/richTextIndex.ts`. It derives paragraph separators and
run-local UTF-16 ranges without changing stored run order; formatting remains
attached to logical ranges. `richTextLayout.ts` now itemizes those logical
paragraph/run ranges and routes supported measured spans through the same
snapshot renderer; advanced paragraph controls retain a documented fallback.
Canonical scene operations in `packages/scene/src/richTextOps.ts` now also
remove selected properties and replace text at grapheme-safe paragraph ranges,
with adjacent equivalent runs normalized after each transaction.

`characterFormatValue` reports mixed values across a logical selection, and the
existing rich-span inspector uses that state for its bold/italic controls while
keeping formatting changes property-specific.

## Artistic text and outline conversion

Point text and area text share one logical `TextNode`; resizing a frame changes
wrapping, while a font-size edit changes type metrics and an object transform
changes placement. Path text consumes shaped cluster advances and positions each
cluster along the canonical curve. It deliberately does not bend glyph
outlines. Detaching a deleted or missing path returns the node to ordinary text
so a stale path cannot make the artwork disappear.

Per-cluster offsets, rotation, scale, baseline movement, and pair spacing are
stored against grapheme/source indices. Required script clusters and likely
active standard Latin ligatures are not split by the direct-manipulation path;
the user must explicitly disable optional `liga` before editing inside a
sequence such as `fi` or `ffi`. Source edits invalidate these derived
adjustments, and a reset removes only the authored adjustment map.

Arc/bend/wave-style deformation remains a bounded, non-destructive effect. The
operation order is source text → shaping/layout → cluster adjustments →
deformation → appearance. The live warp must be expanded before outline
conversion; the conversion command refuses to bake a different geometry by
accident. Exact monochrome text-to-outlines uses the shaped glyph stream and
records source ranges, face identity, feature values, and variation axes on the
resulting group. Corrupt, missing, collection-face, and colour-font inputs are
reported and leave the editable source untouched.

## Canonical paragraph layout

`packages/engine/src/text/` implements the paragraph-aware layout stage that
the snapshot pipeline is built on:

* `paragraphs.ts` — `splitParagraphs` splits a logical string at U+000A with
  document offsets; `itemizeParagraph` runs UAX #9 (bidi-js) per paragraph and
  retains per-code-unit embedding `levels` for line-local reordering, mirrored
  punctuation, and script-itemized shaping runs (`scriptedRuns`). Common and
  inherited characters (digits, combining marks, emoji) are absorbed into the
  surrounding run so a grapheme is never split by itemization.
* `lineBreak.ts` — `segmentBreakUnits` produces word-level break units via
  `Intl.Segmenter` (CJK per-ideograph, Thai dictionary segmentation where the
  runtime provides it). Units never split an extended grapheme cluster; NBSP is
  whitespace but explicitly non-breaking (`isBreakable`); over-long words are
  re-broken at grapheme boundaries.
* `visualOrder.ts` — `lineVisualRuns` derives each wrapped line's visual run
  sequence with UAX #9 X8/L2 applied to the line's character slice (bidi-js
  `getReorderedIndices` with L1.4 trailing-whitespace reset), so RTL lines
  reverse correctly after wrapping instead of using paragraph-level order.
* `textLayoutSnapshot.ts` — `layoutText(input)` is the canonical entry:
  paragraph itemization → word-level wrapping → per-line visual ordering →
  positioned glyph runs (glyphs are consumed in the visual order the shaping
  backend emits; the pen always advances left-to-right) → cluster-safe caret
  stops (snapped to extended grapheme boundaries so a shaper's per-character
  clusters can never create illegal insertion points) → hit testing and
  selection rectangles. `buildTextLayoutSnapshot` remains the single-paragraph
  compatibility wrapper.
* `shaping.ts` — `shapeParagraphRuns` is the logical-order Canvas2D-measurement
  bridge into `layoutText` (`glyphId` 0, no contextual joining); the
  harfbuzz-wasm and rustybuzz-native backends fill the same contract.

The paragraph pipeline is deterministic, source-preserving, and covered by the
multilingual regression corpus in `text/fixtures.ts` (Arabic joining/lam-alef/
harakat fixtures, Devanagari conjuncts, Thai vowels and tone marks, mixed
LTR/RTL sentences, isolates, mirroring, emoji ZWJ, NBSP) plus conformance tests
in `unicode/bidiConformance.test.ts`.

Property testing (`text/unicodeLayout.fuzz.test.ts`) drives the pipeline with
random Unicode — combining-mark runs, emoji ZWJ chains, BiDi controls,
isolates, NBSP/ZWSP, multi-paragraph text — and asserts termination, finite
coordinates, source-mapped cluster bounds, exact paragraph tiling, caret stops
on grapheme boundaries, in-bounds selection rects, and determinism. It has
already caught and fixed three real defects: dropped trailing whitespace
breaking caret coverage, script itemization splitting Arabic harakat from
their base, and ICU-reported grapheme boundaries for degenerate ZWJ chains.

The application-level browser check in
`tests/e2e/canvas/text-multilingual-visual.spec.ts` complements the primitive
replay screenshots. It creates text through the real editor tool, renders the
mixed-script string through the desktop compositor, fits the selection, and
captures the canvas for human review. This catches editor-state, camera,
selection-overlay, and compositor defects that engine-only screenshots cannot.

Line-level visual ordering is implemented locally in `reorderLineIndices`
(UAX #9 L1.4 + L2 restricted to the line) instead of calling bidi-js
`getReorderedIndices` per line, which allocates a full-paragraph index array
per call (measured ~4 ms/line at 10k characters). Parity with bidi-js is
pinned by `unicode/lineReorderParity.test.ts`, including an exhaustive sweep
of all 65,536 BMP code points in trailing positions. Note: bidi-js's L1.4
reset is only correct for ranges starting at index 0 — its `getReorderSegments`
writes `lineLevels[i]` instead of `lineLevels[i - lineStart]`, so sub-range
reorders silently skip the reset; the local implementation applies the reset
correctly and the parity reference replicates bidi-js's intended semantics.

Timing baseline (`text/layout.bench.test.ts`, min-of-7 on a 2026 developer
workstation): 100 chars ≈ 1 ms, 1,000 chars ≈ 6–16 ms, 10,000 chars
≈ 76–103 ms across Latin/Arabic/mixed; the per-line reorder change alone took
10k-character RTL layout from ~2.1 s to ~0.2 s.

`FontRegistry.revision` is a monotone process-local invalidation token. The
shaping cache accepts it, face identity, OpenType features, variation axes,
width, and layout mode in its key and bounds both entries and estimated bytes;
callers must supply the revision when requesting font-dependent geometry.

## Research references (checked 2026-09-13)

The implementation choices above are grounded in the [OpenType feature
registry](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist),
[HarfBuzz shaping API](https://harfbuzz.github.io/harfbuzz-hb-shape.html),
[HarfBuzz cluster guidance](https://harfbuzz.github.io/clusters.html),
[Unicode grapheme rules](https://www.unicode.org/reports/tr29/),
[Unicode bidirectional algorithm](https://www.unicode.org/reports/tr9/),
[Unicode line breaking](https://www.unicode.org/reports/tr14/),
[CSS Fonts 4](https://www.w3.org/TR/css-fonts-4/),
[SVG 2 text](https://www.w3.org/TR/SVG2/text.html), and the
[WHATWG Canvas 2D specification](https://html.spec.whatwg.org/multipage/canvas.html).
The installed bindings are `harfbuzzjs` 1.6.0, `rustybuzz` 0.20.1,
`ttf-parser` 0.25.1, and `opentype.js` 2.0.0. These sources establish the
contract; they do not imply that Canvas2D or the native PDF writer exposes all
of the same capabilities.

## Related decisions

* [ADR-0186 — text composition engine](../adr/0186-text-composition-engine.md)
* [ADR-0187 — persisted versus derived text ranges](../adr/0187-persisted-vs-derived-text-ranges.md)
* [ADR-0188 — incremental reflow](../adr/0188-incremental-reflow.md)
* [Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md)

The implementation is intentionally staged. The audit and index foundation
must land before replacing live shaping or renderer paths, so every later
consumer can use the same source-boundary contract.
