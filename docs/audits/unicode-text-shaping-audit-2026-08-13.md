# Unicode text, shaping, BiDi, and rich-text audit

**Date:** 2026-08-13  
**Scope:** `@varve/scene`, `@varve/engine`, `@varve/editor`, `@varve/compositor`,
`@varve/import`, `@varve/codegen`, `@varve/platform`, `@varve/shared`,
`crates/varve-print`, and the desktop bridge.

This is the implementation audit for the production Unicode text overhaul. It
describes the code that is actually on the current branch; older typography
audits and implementation-memory documents remain historical records.

## Current-state pipeline

```text
Document / TextNode
  ├─ text: logical JS string (UTF-16 storage)
  ├─ richText: paragraphs → runs → logical JS substrings
  └─ optional story content / frame binding
        │
        ▼
sceneNodeToEngineNode (packages/editor/src/render/sceneToEngine.ts)
        │  copies rich-text and typography fields into the IR
        ▼
Engine Primitive::text (packages/engine/src/types.ts)
        │
        ├─ live replay: replay.ts → layoutRichText / Canvas measureText
        │                 → Canvas2D fillText (browser performs hidden shaping)
        ├─ text shaping seam: shaping.ts → per-grapheme measureText records
        │                         (glyphId is always 0 on the web path)
        ├─ native bridge: Tauri shape_text_command → rustybuzz
        │                 (available, but not the live layout authority)
        ├─ SVG/codegen: semantic <text> / <tspan> with CSS direction/features
        └─ PDF: WinAnsi/native or outline fallback in varve-print

Editing:
  Canvas → textarea overlay (logical UTF-16 value)
         → scene text update / RichSelection derived from graphemes
         → richTextOps range formatting (raw UTF-16 run slices)
```

The current renderer therefore has several representations of “layout”: the
browser’s internal shaping, the approximate `shaping.ts` records, the greedy
`textLayout.ts` measurement pass, and the native Rust shaper. They are useful
building blocks, but they are not yet one authoritative snapshot consumed by
rendering, editing, hit testing, selection, masks, and exports.

## What is already present

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Document model | `TextNode.text`, optional `TextNode.richText`, paragraph/run formatting, story/frame types | Preserve; evolve in place |
| Persistence | Canonical document codec and migrations; rich text is serialized as nested paragraphs/runs | Backward-compatible extension point |
| Rich-text commands | `packages/scene/src/richTextOps.ts` splits, formats, and merges runs | Useful pure foundation; offsets are not cluster-safe |
| Graphemes | `Intl.Segmenter` with a fallback in `engine/src/unicode/grapheme.ts` | Good API shape; fallback and mapping need stronger invariants |
| Script detection | `engine/src/unicode/script.ts` | Hand-maintained coverage table; suitable as a hint, not a shaping authority |
| BiDi dependency | `bidi-js` is declared in `@varve/engine` and now consumed by `engine/src/unicode/bidiUax9.ts` | Adapter is in place; conformance fixtures and live layout integration remain |
| BiDi implementation | `engine/src/unicode/bidi.ts` delegates paragraph resolution to the `bidi-js` adapter | Existing public paragraph/run API is preserved; visual indices and mirroring are now derived from resolved levels |
| Native shaping | `crates/varve-print/src/shaper.rs` uses `rustybuzz 0.20`; Tauri exposes `shape_text_command` | Strong native backend; needs canonical wire/layout integration |
| Web shaping dependency | `harfbuzzjs 1.6.0` is declared | Not integrated; must be evaluated behind lazy loading and font-byte ownership |
| Web rendering | `layoutRichText` and `replay.ts` use Canvas measurement and `fillText` | Browser text remains paint authority; no positioned glyph replay |
| Font system | Font registry/resolver, font storage, Tauri enumeration, opentype.js outlines | Exact face/coverage/fallback revision is not part of canonical layout |
| Editing | `TextEditOverlay` textarea, composition lifecycle, `RichTextSpanEditor` contenteditable | Composition exists; caret geometry and paragraph/BiDi editing are incomplete |
| Export | SVG emits direction/features; PDF has native/outline paths; codegen preserves basic strings | Export semantics are not driven by the live shaped snapshot |
| Performance | `ShapingCache` and text-layout benchmarks exist | Cache key omits features, variations, font revision, width, and layout mode |

## Docs-vs-code gap table

| Contract claimed by current docs/ADRs | Code evidence | Gap / required action |
| --- | --- | --- |
| “One canonical layout result” | `TextLayoutSnapshot` now carries source maps, positioned glyphs, line boxes, caret stops, and selection geometry; `replay.ts` still calls `layoutRichText` and paints `fillText` | Route live measurement/paint/hit testing through the snapshot after fallback and font-revision policy are explicit |
| Full UAX #9 BiDi | `unicode/bidiUax9.ts` delegates embedding levels, reorder indices, and mirrored-character lookup to `bidi-js` | Add broader conformance corpus coverage and feed line-level visual order into canonical layout |
| OpenType shaping in web | `shaping.ts` measures each grapheme; `glyphId: 0`; `harfbuzzjs` unused | Integrate HarfBuzz-compatible shaping for font bytes, with Canvas fallback explicitly marked approximate/unavailable |
| Complex-script correctness | Native Rust tests cover shaper calls, but live TS rendering does not consume native results | Add parity fixtures and a backend selection contract before advertising production support |
| Rich text takes precedence in rendering | IR carries `richText`, while paint-time layout still has separate logic and fallback defaults | Make paragraph/run resolution an input to canonical layout, not a parallel renderer path |
| Cluster-safe editing | `richTextOps.splitRunAt` slices at raw UTF-16 offsets; overlay reports only paragraph 0 | Add explicit UTF-16/code-point/grapheme/shaping-cluster maps and paragraph-aware edit operations |
| Caret/hit testing from shaped clusters | `hitTestCaret` treats glyph records as graphemes and returns the preceding cluster start | Return legal insertion stops with logical/visual maps and line geometry |
| Cache keyed by font/layout identity | `TextLayoutSnapshot` and `ShapingCache` now carry font revision, features, axes, width, and layout-policy identity; both caches are bounded | Migrate live callers to the snapshot cache and connect registry revision events to cache invalidation |
| PDF Unicode fidelity | Non-WinAnsi text can be outlined; native path is not driven by the canonical TS layout | Keep outlining as honest fallback; add shaped CID/ToUnicode work as a separate export slice |
| Thai line breaking | `textLayout.ts` uses `Intl.Segmenter`/whitespace/CJK heuristics | Separate shaping from UAX #14 breaking and document dictionary-based Thai limits |

## Indexing findings

Varve’s serialized JavaScript strings and browser selection APIs are UTF-16
indexed. That is compatible with existing persistence and DOM editing, but the
following units must not be conflated:

```text
UTF-16 code-unit offset       persisted/editor boundary today
Unicode scalar offset         Rust/HarfBuzz input iteration
extended grapheme boundary    user navigation/deletion boundary
shaping cluster               glyph-to-source mapping (may span graphemes)
glyph index                   font-local output identity
visual caret stop             line/camera-space editing position
```

No source normalization is introduced by this project. The source string stays
in logical Unicode order and retains its original normalization form. Internal
segmenters/shapers must carry mappings back to those source UTF-16 offsets.

## Dependency decision

The repository already has the two relevant implementation families:

* Native: `rustybuzz 0.20` over `ttf-parser`, already compiled in
  `varve-print` and exposed through Tauri.
* Web/WASM: `harfbuzzjs 1.6.0`, a MIT-licensed HarfBuzz WASM package, already
  declared by `@varve/engine` but unused.

The first implementation slice will define a backend-neutral request/response
contract and a real web HarfBuzz adapter. It will not silently claim that
Canvas2D measurement is equivalent. Native and web implementations must be
covered by glyph/cluster/advance parity fixtures where the same font bytes are
available. `bidi-js` is now the first UAX #9 adapter because it is already
installed and provides embedding levels, reorder indices, and mirroring. The
typed boundary leaves room for native/WASM BiDi if performance or worker
ownership requires it. Its levels are character-indexed; Varve retains the
source UTF-16 string and exposes the resolved visual index list separately so
later line breaking can derive line-local order without mutating document text.

## Implementation order and commit boundaries

1. Audit and regression corpus (this document; no code behavior change).
2. Unicode index model: explicit maps, cluster-safe boundaries, and property tests.
3. Shaping backend contract: HarfBuzz WASM adapter, Rust bridge normalization,
   feature/variation/font identity in the request and result.
4. Canonical layout snapshot: paragraph itemization, resolved BiDi visual order,
   line breaking, visual runs, metrics, cache identity, and stale font revisions.
5. Rendering and editing consumers: positioned runs, caret/hit testing,
   discontiguous selection geometry, composition-safe transactions.
6. Rich-text commands and inspector state: paragraph-aware ranges, insertion
   style, mixed values, logical alignment/direction controls.
7. Font fallback/loading and export consumers: cluster-aware fallback, SVG/PDF/
   codegen/raster fidelity policy, preflight diagnostics.
8. Visual fixtures, benchmarks, fuzz/stress checks, and platform reports.

Each behavior change is committed separately after the repository’s affected
validation plan is run. Full-suite escalation is reserved for the repository
conditions documented in `AGENTS.md`; native IME and WebKitGTK results will be
reported separately from browser automation.

## Initial regression corpus

The corpus is intentionally stored as logical source strings, never visual
reorderings:

* Arabic joining, lam-alef, harakat, Arabic/Persian/Urdu language tags,
  Arabic + Latin + European/Arabic-Indic digits.
* Devanagari conjuncts, virama, reph, nukta, and pre-base matras.
* Thai vowels, tone marks, stacked marks, and wrapped text.
* Mixed LTR/RTL punctuation, brackets, URLs, email addresses, isolates, and
  multi-line paragraphs.
* Latin, CJK, emoji ZWJ sequences, combining marks, variation selectors, and
  rich spans crossing script and style boundaries.

Lower-level tests will assert glyph IDs, advances, offsets, and source clusters;
layout tests will assert logical/visual mapping and legal caret stops; UI tests
will assert screenshots and editing behavior. Font files will be added only
when their licenses and repository policy permit deterministic redistribution.

## Audit conclusion

Varve has enough existing model, font, native-shaper, and editor structure to
evolve without replacing the document model. It does not yet have production
Unicode shaping or BiDi layout because the live browser path remains an
approximation and the canonical snapshot is not real. Slice 2 now provides the
explicit source-index foundation: one map distinguishes UTF-16, scalar, and
grapheme boundaries, and rich-text range formatting expands selection endpoints
to legal grapheme boundaries. Slice 3 now provides a backend-neutral shaping
contract and lazy HarfBuzz WASM adapter; the native response normalizer scales
font units, clamps source clusters, and reports missing glyphs. It is not yet
the live renderer authority. The next code slice is canonical paragraph/layout
integration, not an Arabic-specific rendering patch.
