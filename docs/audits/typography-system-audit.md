# Typography System Audit — Strata

> Date: 2026-07-03
> Scope: packages/scene, packages/engine, packages/shared, packages/editor, packages/codegen, crates/strata-engine, crates/strata-print
> Method: static review, test execution, competitive research

## Executive Summary

Strata's typography subsystem has a **strong type foundation** but a **weak execution layer**. The data model already defines rich text runs, character/paragraph styles, variable fonts, OpenType features, and text chains. However, the render pipeline, text measurement, and editor integration only exercise a small subset of these types. The gap between declared capability and actual behavior is the primary risk for a professional design tool.

## Existing Features

| Feature | Status | Evidence |
|---|---|---|
| Text node data model | Built | `packages/scene/src/types.ts` TextNode interface (lines 266–314) |
| Rich text types | Built | `packages/scene/src/typography.ts` RichText, Paragraph, TextRun (lines 172–188) |
| Character/paragraph style types | Built | `packages/scene/src/typography.ts` CharacterStyle/ParagraphStyle (lines 192–211) |
| OpenType feature tag set | Built | `packages/scene/src/typography.ts` OpenTypeFeatureTag (lines 13–83) |
| Variable font axis types | Built | `packages/scene/src/typography.ts` RegisteredAxisTag/VariableFontSettings (lines 99–117) |
| Basic font registry | Built | `packages/engine/src/fontRegistry.ts` FontRegistry class |
| Basic text rendering | Built | `packages/engine/src/replay.ts` paintText (lines 592–696) |
| Basic text measurement | Built | `packages/shared/src/textMeasure.ts` measureText/textWrap (lines 140–231) |
| Text chain data model | Built | `packages/scene/src/textFlow.ts` createChain/appendFrame/etc. |
| Preflight framework | Built | `packages/scene/src/typographyPreflight.ts` runTypographyPreflight |
| Typography inspector | Built | `packages/editor/src/components/Inspector/sections/TypographySection.tsx` |
| Floating text bar | Built | `packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx` |
| SVG text export | Basic | `packages/codegen/src/svg.ts` nodeToSvgTag text case (lines 93–117) |

## Existing Architecture

### Data Model

- `TextNode` stores a single `text` string and an optional `richText` object. When `richText` is set it conceptually overrides `text`, but many consumers (engine, SVG export, spec) still read `text` directly.
- `Document.styles` supports `TextStyle` (`packages/scene/src/types.ts` lines 480–497), but there is no `CharacterStyle` or `ParagraphStyle` integration into the document style dictionary. The rich-text style resolver exists in `typography.ts` but is not wired to `Document`.
- Text chains are pure functions over `TextChain` objects; they are not stored on `Document` and have no connection to rendering or the editor.

### Rendering Pipeline

- The engine IR (`packages/engine/src/types.ts` Primitive text kind, lines 229–249) only carries a single `text` string plus uniform font properties. It has no fields for runs, variable axes, or OpenType features.
- `engine.ts` `shapeToPrimitive` (lines 31–79) ignores `node.richText`, `node.variableAxes`, and `node.openTypeFeatures`.
- `replay.ts` `paintText` (lines 592–696) renders plain text with a single font and uses a hardcoded `0.6` char-width estimate for letter spacing. It does not shape text, does not apply variable font settings, and cannot render mixed-format runs.
- Path text math exists in `packages/engine/src/pathText.ts` but is not connected to the renderer or the engine IR.

### State Management & Events

- Text editing is property-driven: the inspector and floating bar mutate `TextNode` fields through `updateNode`. There is no inline text editor, no caret model, and no selection model.
- Undo/redo works at the document level via `beginTransaction`/`commitTransaction`, but there is no text-specific edit history.

### Export

- `packages/codegen/src/svg.ts` exports text as a single `<text>` element. It ignores `richText`, multi-line layout, list styles, variable fonts, and OpenType features.
- `packages/codegen/src/spec.ts` only counts `fontSize` for type styles and ignores rich text.
- `crates/strata-print` (PDF) exports text but is outside the scope of this audit's primary findings.

## Identified Problems

### P0 — Data/Render Mismatch

1. **Rich text is declared but not rendered.** The `TextNode.richText` field can hold mixed-format paragraphs, yet the engine, renderer, and exporters all flatten to `node.text`. This makes rich text a dead feature.
2. **Variable fonts and OpenType features are dropped at the IR boundary.** `shapeToPrimitive` does not copy `variableAxes` or `openTypeFeatures` into the `Primitive` text kind. The renderer therefore cannot apply them.
3. **Path text is not integrated.** `pathTextSettings` and `pathId` exist on `TextNode` but are never passed to the renderer.

### P1 — Quality Bugs

4. **FontRegistry `buildFontCSS` generates invalid CSS.** The method calls `resolve(family)` which already returns a comma-separated fallback chain, then wraps the whole string in quotes:
   ```ts
   return `${s} ${w} ${size}px/${lh} "${familyStr}"`;
   ```
   Result: `"Inter, sans-serif, serif, monospace"` instead of `"Inter", sans-serif, serif, monospace`. This is invalid CSS and will fail font matching.
5. **FontRegistry `isAvailable` logic is contradictory.** It returns `false` for `state === 'error'`, but also returns `false` for `state === undefined || state === 'unknown' || state === 'error'`, making the first branch dead. The intended semantics (registered-but-not-yet-loaded vs. missing) are unclear.
6. **Renderer letter-spacing is incorrect.** When `ls !== 0`, the renderer draws each character individually and advances by `p.fontSize * 0.6 + ls`. This ignores the actual glyph width, producing wrong spacing for any non-monospace font.
7. **Renderer ellipsis overflow is incorrect.** The code appends `…` to the line text whenever `y + lh > p.y + p.h`, but does not re-measure or truncate the visible portion, so the ellipsis may overflow the box or be appended to fully-visible lines.

### P2 — Missing Professional Features

8. **No inline text editor.** Users cannot click into a text box and type.
9. **No text selection or caret model.** Rich text editing requires a selection model that maps screen coordinates to text offsets.
10. **No real text shaping.** Canvas2D `fillText` does not expose glyph positions, ligatures, kerning, or complex-script support. A professional tool needs a shaping layer (HarfBuzz-equivalent or at least platform APIs).
11. **No CJK/RTL/bidi support.** The current splitting and alignment logic assumes LTR, single-byte scripts.
12. **No text flow chain rendering.** `TextChain` objects exist but overflow detection is char-count based, not layout based, and chains do not render across frames.
13. **No parent pages / master text frames.** Multi-page typography is not implemented.
14. **No document-wide typography styles.** Character/paragraph styles cannot be created or applied through the document API.
15. **No missing-glyph detection.** Preflight only checks font family names, not whether glyphs exist in the font.

## Competitive Findings

- **Figma** stores a `derivedTextData` cache and requires explicit font loading (`loadFontAsync`). It renders rich text via a C++/WASM engine and shares the document tree across clients. Its architecture lesson: separate shaping/layout from drawing and cache derived glyph data.
- **Adobe InDesign** uses threaded text frames, paragraph/character styles with inheritance, and live preflight profiles. Its architecture lesson: text flow is a first-class graph, and styles need hierarchical update propagation.
- **HarfBuzz / Skia** demonstrate that correct text requires a dedicated shaping step before rendering. Canvas2D `fillText` is insufficient for complex scripts and precise typography.
- **Pretext / ZeroText** show that pure-arithmetic, DOM-free text layout can be fast, but they require careful calibration against browser ground truth and still rely on underlying font metrics.

## Gap Analysis

| Capability | Declared | Wired | Quality |
|---|---|---|---|
| Rich text | Yes | No | N/A |
| Variable fonts | Yes | No | N/A |
| OpenType features | Yes | No | N/A |
| Path text | Yes | No | N/A |
| Text chains | Yes | Partial | Char-count only |
| Char/para styles | Yes | No | N/A |
| Inline editing | No | No | N/A |
| Text selection | No | No | N/A |
| Real shaping | No | No | N/A |
| CJK/RTL | No | No | N/A |
| Preflight | Partial | Yes | Font-name only |
| SVG export | Partial | Yes | Single-line only |

## Performance & Scalability Risks

- `measureText` uses `ctx.measureText` per line but only for single-font plain text. Rich text measurement would require per-run measurement and currently has no wrapping integration.
- The renderer redraws every character separately when letter-spacing is nonzero. For large text blocks this is a significant CPU cost.
- There is no glyph cache. Every frame re-measures and re-renders text from scratch.
- Text chains and styles are not indexed; document-wide operations would be O(n) over all nodes.

## Accessibility Findings

- Contrast validation exists in `typographyPreflight.ts` but is not integrated into the runtime canvas or export accessibility metadata.
- There is no screen-reader support for text content in the canvas.
- `textCase` is applied via `toUpperCase()` which may break screen-reader pronunciation of words that are meant to be read as letters (e.g., acronyms).

## Print/Publishing Findings

- SVG export does not produce `<text>` with proper multi-line layout, making it unsuitable for handoff to SVG-based publishing workflows.
- Text overflow detection is char-count based, not based on actual layout metrics, so it will misreport overflow for mixed-format or variable-font text.
- There is no bleed, margin, or safe-area awareness in the typography system.

## Recommendations (Architecture)

1. Introduce a **Typography Layout Engine** (`packages/engine/src/textLayout.ts`) that takes a `TextNode` + `FontRegistry` and produces a `PositionedText` structure: lines, runs, glyphs with screen positions. This becomes the single source of truth for measurement, rendering, hit-testing, and export.
2. Extend the engine IR `Primitive` text kind to carry optional rich text data, variable axes, and OpenType features so the native/wasm backend can render them correctly.
3. Make `Document` own `textChains` and `typographyStyles` (character/paragraph styles) so they can be referenced by `TextNode` and `TextRun`.
4. Decouple **shaping** from **drawing**: use Canvas2D `fillText` for simple Latin short-term, but architect the layout engine so a HarfBuzz/WASM shaper can replace it.
5. Cache derived text layout keyed by text content + font + size + box width to avoid re-measurement per frame.

## Recommendations (Implementation Priority)

### Phase A — Foundation (this session)
- Fix FontRegistry CSS and availability bugs.
- Extend engine IR and stub backend to carry `richText`, `variableAxes`, and `openTypeFeatures`.
- Implement rich-text rendering in `replay.ts` for Canvas2D (run-by-run with per-run font/style).
- Improve text measurement wrapping and add rich-text line breaking.
- Improve SVG export for multi-line text and rich text.
- Strengthen preflight with real font registry integration and missing-variable-font checks.
- Add regression tests for all of the above.

### Phase B — Editor Experience (future)
- Build inline text editor with caret/selection model.
- Add text hit-testing to map pointer events to text offsets.
- Wire character/paragraph styles into document styles and UI.

### Phase C — Professional Typography (future)
- Integrate a real shaping engine (HarfBuzz via WASM or platform APIs).
- Add CJK/RTL/bidi support.
- Implement threaded text frame rendering and overflow based on layout metrics.
- Add parent pages and master text frames.
- Add print production preflight profiles.

## Test Baseline

- `packages/shared` textMeasure: 33/33 pass
- `packages/engine` fontRegistry: 36/36 pass; replay: 36/36 pass; engine: 24/24 pass
- `packages/scene` typography: 16/16 pass; typographyPreflight: 11/11 pass; textFlow: 20/20 pass
- `packages/codegen` svg/spec/codegen: 45/45 pass
- `packages/scene` pre-existing failures: `brush.test.ts` (1), `textWarp.test.ts` (1) — unrelated to typography

## Conclusion

The typography subsystem is ready for a focused foundation upgrade. The type model is already professional-grade; the execution layer needs to catch up. Phase A improvements will close the gap between declared types and actual behavior, while the architecture recommendations prepare the system for the more advanced features in Phases B and C.
