# Text Pipeline Architecture

The text pipeline covers Unicode analysis, bidirectional (BiDi) layout,
shaping, rich-text editing, and multilingual export across SVG and PDF.

## Pipeline stages

```
TextNode (scene model)
  ↓ direction, language
Engine IR (Primitive::text)
  ↓ shapeText / shapeRun
TextShaping (ShapedRun[])
  ↓ replayIr → paintText
Canvas2D (browser-native BiDi via fillText)

Export paths:
  SVG  → <text direction="rtl" unicode-bidi="bidi-override">
  PDF  → WinAnsiEncoding Tj  (Latin-1)
       → outline_text_multi   (non-Latin fallback to vector paths)
```

## Design decisions

### BiDi is paragraph/run-level, not full UBA

`analyzeParagraph` in `packages/engine/src/unicode/bidi.ts` implements the
P2/P3 baseline-resolution and run-formation steps of UAX #9. It does **not**
implement the full embedding-level resolution (X1-X10, implicit levels,
bracket pairing). Rationale: the browser's native `fillText` already applies
the full Unicode Bidirectional Algorithm to the final run list, so the engine
only needs to establish the *base direction* of each paragraph and segment
strong runs. The renderer aligns `textAlign` to the right edge for RTL so
the browser renders runs in visual order.

For SVG/PDF export, explicit `direction="rtl"` attributes and vector
outlining sidestep the need for server-side UBA entirely.

### Shaping uses browser-native advances (not per-glyph rustybuzz)

`shapeRun` measures glyph advances via `CanvasRenderingContext2D.measureText`,
not a Rust shaleharfBuzz port. Rationale: the web target already has a
high-quality shaper (the browser); a Rust shaper would only matter for
pixel-perfect native-PDF glyph positioning, which the outline-text export
path already covers. The `TextShaping` IR seam (`types.ts:622`) is kept so a
future rusthbuzz backend can slot in without changing consumers.

### The `TextShaping` seam

`ShapedRun[]` carry glyph IDs, advances, offsets, and per-run direction level.
The renderer (`replay.ts:paintText`) currently ignores per-glyph positioning
and relies on the browser's `fillText` — the shaped data feeds hit-testing
(`hitTestCaret`) and the SVG/PNG exporters. Pre-computed shaping results are
cached in an LRU keyed by `(text, font, size, direction, language)`.

### Non-Latin PDF export uses outlining

`crates/varve-print/src/lib.rs` detects non-WinAnsi text via
`requires_outline()` and falls back to `outline_text_multi()` (ab_glyph)
which emits vector path operators (`m`, `l`, `c`, `h`). This preserves
visual fidelity for Arabic/Hebrew/Devanagari/CJK without a CIDFont/ToUnicode
CMap implementation (deferred as Option B).

## Supported scripts

| Script        | Canvas render | SVG export | PDF export |
|---------------|---------------|------------|------------|
| Latin         | Yes           | Yes        | WinAnsi Tj |
| Arabic/Hebrew | Yes (BiDi)    | Yes (dir)  | Outlined   |
| Devanagari    | Yes           | Yes        | Outlined   |
| CJK           | Yes           | Yes        | Outlined   |
| Thai          | Yes           | Yes        | Outlined   |

The renderer's `detectRTL()` helper (`replay.ts:1707`) scans for the first
strong RTL codepoint (Hebrew U+0590–U+05FF, Arabic U+0600–U+06FF and
extensions) to set canvas `textAlign='right'` for native BiDi reordering.

## Key files

| File | Purpose |
|------|---------|
| `packages/engine/src/unicode/bidi.ts` | UAX #9 paragraph/run analysis |
| `packages/engine/src/unicode/grapheme.ts` | UAX #29 grapheme boundaries |
| `packages/engine/src/unicode/script.ts` | ISO 15924 script detection |
| `packages/engine/src/shaping.ts` | `shapeRun`, `shapeText`, `hitTestCaret` |
| `packages/engine/src/shapingCache.ts` | LRU cache for TextShaping |
| `packages/engine/src/replay.ts` | RTL canvas rendering, `detectRTL` |
| `packages/engine/src/types.ts` | `ShapedGlyph`, `ShapedRun`, `TextShaping` |
| `packages/scene/src/typography.ts` | `RichText`, `CharacterFormat`, `ParagraphFormat` |
| `packages/scene/src/richTextOps.ts` | Pure run split/merge/format helpers |
| `packages/codegen/src/svg.ts` | SVG `direction`/`unicode-bidi` emission |
| `crates/varve-print/src/lib.rs` | WinAnsi + outline fallback for PDF |
| `packages/editor/src/components/TextEditOverlay.tsx` | Inline editing, caret reporting |
| `packages/editor/src/components/Inspector/controls/RichTextSpanEditor.tsx` | Span-level formatting |

## Known limitations

- Full UBA embedding resolution is deferred (browser-native BiDi covers the
  render path; SVG/PDF use explicit direction attrs / outlining).
- Per-glyph positioning for PDF CID text (Option B) is deferred.
- `shapeText` advances are `measureText`-based, not ink-box-accurate.
- The `RichTextSpanEditor` is MVP — full inline caret tracking for BiDi
  text requires mirroring the browser's visual↔logical mapping.
- Shaping cache is module-level; server-side rendering would need
  per-request cache isolation.

## Recent milestones

- **M1–M3** (committed): Unicode foundation, shaping bridge, RTL render path.
- **M4** (this session): grapheme-aware caret reporting in TextEditOverlay.
- **M5** (this session): direction toggle + rich-text span editor.
- **M6** (this session): SVG `direction`/`unicode-bidi` export.
- **M7** (this session): PDF non-WinAnsi outline fallback.
- **M8** (this session): a11y labels, perf bench, architecture docs.
