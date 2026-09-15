# Text Pipeline Continuation Prompt — M4-M8

> **Status:** M1 (Unicode foundation), M2 (shaping bridge + exports), M3
> (render path + bridge wiring) are **committed to master**. This document
> scopes the remaining M4-M8 work. Read it fully before touching code.

## Repository state

Branch: `master`, 2 text-pipeline commits on top of the color work:

- `aa8b5f5c` feat(text): shaping bridge + engine barrel exports
- `6c58f3af` feat(text): RTL render path + directional text pipeline types
- (before that: `f4b4f3af` color bitDepth — unrelated)

Other uncommitted working-tree changes (coordinateService, world.ts, nodeBounds,
version.ts, adjustmentScope) belong to a **concurrent agent**. Do NOT touch or
commit those files. Touch only files listed in this plan.

## What exists (M1-M3 — committed, do not redo)

### `packages/engine/src/unicode/` (committed)
| File | Purpose |
|------|---------|
| `grapheme.ts` | `splitGraphemes`, `graphemeBoundaries`, `graphemeCount`, `graphemeIndexAt`, `codepointOffset`, `utf16IndexAtCodepointOffset` — UAX #29 via `Intl.Segmenter` + fallback |
| `bidi.ts` | `analyzeParagraph`, `autoParagraphDirection`, `segmentRuns`, `reorderRuns`, `logicalToVisual`, `visualToLogical`, `bidiClassOf` — paragraph/run UAX #9 subset |
| `script.ts` | `detectScript`, `dominantScript`, `segmentByScript` — ISO 15924 codes, sorted-binary-search range table |
| `unicode.test.ts` | 27 passing tests |
| `index.ts` | barrel |

### `packages/engine/src/shaping.ts` (committed)
`shapeRun`, `shapeText`, `hitTestCaret`, `scriptCodeToTag`. Produces
`ShapedRun[]` from text + font + size + direction. `ShapeRunInput`,
`ShapeRichTextInput` types.

### New IR types — `packages/engine/src/types.ts`
- `ShapedGlyph` (line ~575): `glyphId`, `xAdvance`, `yAdvance`, `xOffset`, `yOffset`, `clusterUtf16`
- `ShapedRun` (line ~593): `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `direction`, `level`, `script`, `glyphs[]`, `width`, `ascent`, `descent`
- `TextShaping` (line ~622): `runs[]`, `width`, `height`, `baseDirection`, `direction`
- Text `Primitive` (line ~531): `direction?: 'ltr'\|'rtl'\|'auto'`, `language?: string`, `shaping?: TextShaping`
- `SceneNode` (line ~347): `direction?`, `language?`

### Scene model — `packages/scene/src/types.ts` (TextNode, line ~638)
`direction?: 'ltr'\|'rtl'\|'auto'`, `language?: string`

### Render path — `packages/engine/src/replay.ts`
- `detectRTL(text)` helper (line ~1702): scans first strong RTL codepoint
- `paintText` (line ~1872): when `isRTL && textAlign==='left'` sets `target.textAlign='right'` so the browser's native BiDi reorders runs in `fillText`
- `paintRichText` (line ~1753): same RTL handling sets `target.textAlign='right'` and computes `xOffset = p.w - lineWidth`

### Engine bridge — `packages/engine/src/engine.ts:141` and `packages/editor/src/render/sceneToEngine.ts`
Forward `direction` and `language` from scene node → engine IR text primitive.

### Engine barrel — `packages/engine/src/index.ts`
All unicode + shaping functions exported alongside existing engine API.

---

## Remaining work: M4-M8

### M4 — Grapheme-aware text editing (`TextEditOverlay`)

**File:** `packages/editor/src/components/TextEditOverlay.tsx`

The current overlay uses a plain `<textarea>` (line ~146 `onInput={handleInput}`).
It relies on the browser for caret movement, which is correct for basic
scripts but doesn't expose grapheme-aware caret to the editor state. For
RTL, the textarea already has `dir="auto"` so native BiDi caret movement
works; the remaining gaps are:

1. **Expose caret position to editor state.** Add a `onSelect` handler that
   reports the current `selectionStart`/`selectionEnd` to a new context
   method `setSelectionRange(nodeId, start, end)`. This lets the editor
   track which grapheme range is selected for applying formatting.

2. **IME/composition guard.** (Already exists via `composingRef`.) Verify
   it works for CJK/IME; if not, add `compositionStart`/`compositionUpdate`
   measurement that uses `splitGraphemes` on the committed value.

3. **Grapheme-aware backspace/delete** (low priority — native textarea
   handles this correctly on WebKitGTK/Chromium). Skip unless a real bug
   is reproduced.

**Test in:** `packages/editor/src/components/TextEditOverlay.test.tsx`
(use jsdom — editor package tests already run in jsdom).

### M5 — Inspector UI: direction toggle + rich-text span editor

**Files:**
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx`
- `packages/editor/src/context/types.ts` (interface)
- `packages/editor/src/context.tsx` (implementation)
- `packages/editor/src/components/Inspector/inspector.css`

#### 5a — Direction toggle

1. In `TypographySection.tsx` (near the existing `SegmentedControl` for
   textAlign at line ~362), add a **Direction** segmented control with
   options: `Auto`, `LTR`, `RTL`. Use the existing `commonValue` /
   `isMixed` pattern (like `alignRaw` at line 254) to read
   `textNodes[0].direction ?? 'auto'`.

2. Add `setTextDirection` to `EditorContextValue` interface
   (`context/types.ts`) and implement in `context.tsx`:
   ```ts
   setTextDirection: (direction: 'ltr' | 'rtl' | 'auto') => void
   ```
   Implementation: `updateDoc` patching `direction` on every selected
   text node, wrapped in `beginTransaction`/`commitTransaction`.

3. Wire the SegmentedControl `onChange` to `setTextDirection`.

#### 5b — Rich-text span formatting (MVP)

The `richText` model already exists (`RichText → Paragraph[] → TextRun[] →
CharacterFormat`). The gap is **UI to edit runs within a node**.

1. Add a **"Rich Text" toggle** in TypographySection. When the node has
   `richText` (or the user enables it), show a span editor instead of the
   plain textarea.

2. **Span editor** (new component
   `components/Inspector/controls/RichTextSpanEditor.tsx`):
   - Render each run as an inline editable span with its own
     `CharacterFormat` (fontFamily, fontSize, weight, color, etc.).
   - On selection change within a span, show a popover with formatting
     controls (bold, italic, color, size).
   - On Enter/IME commit, split the run at the caret and apply the
     pending `CharacterFormat` to the new run.
   - Merge adjacent runs with identical format on blur.

3. **Context methods** (add to interface + impl):
   - `applyFormatToSelection(format: Partial<CharacterFormat>)` —
     splits/merges runs to apply formatting to the selected range.
   - `setPendingFormat(format)` — stores the format that new typing
     should inherit (collapsed caret with mixed formatting state).

4. **Mixed-state controls.** When the selection spans runs with different
   values for a property, show `'(Mixed)'` placeholder (same pattern as
   existing `commonValue`/`isMixed` in TypographySection).

**Tests:** `TypographySection.test.tsx` (jsdom). Test direction toggle
renders, fires `setTextDirection`, and that mixed-state shows '(Mixed)'.

### M6 — SVG export with direction

**File:** `packages/codegen/src/svg.ts` (line ~794)

The current SVG export emits `text-anchor` for alignment but ignores
`direction`. For RTL text:

1. Add `direction="rtl"` attribute on the `<text>` element when
   `node.direction === 'rtl'`.
2. Add `unicode-bidi="bidi-override"` only when explicit direction is
   set (not for 'auto' — let the SVG renderer handle auto-detection).
3. For rich text `<tspan>` runs, emit `direction` per-paragraph when the
   paragraph format has `direction: 'rtl'`.

**Test:** `packages/codegen/src/codegen.test.ts` — add a fixture with
an Arabic text node and assert the output contains `direction="rtl"`.

### M7 — PDF export with Unicode

**File:** `crates/strata-print/src/lib.rs` (line ~1243 `WinAnsiEncoding`)

The current PDF export uses `WinAnsiEncoding` (Latin-1 subset). This
**cannot** represent Arabic/Hebrew/Devanagari. Two options:

**Option A (recommended for MVP): outline text.** When the text contains
non-WinAnsi characters, convert the text node to vector outlines using
the existing `outline_text()` / `outline_text_multi()` infrastructure
(`crates/strata-print/src/outline.rs`). This preserves visual fidelity
without needing full Unicode PDF text support. Detect via
`text.chars().any(|c| c as u32 > 255)`.

**Option B (full Unicode):** Embed a CIDFont with UTF-16BE encoding.
This is a large undertaking (cmap, CIDToGIDMap, ToUnicode CMap). Defer
unless required.

For M7, implement **Option A**: detect non-WinAnsi text and fall back to
outlining. Add a `requires_outline(text: &str) -> bool` helper.

**Test:** `crates/strata-print/src/lib.rs` tests — assert that an Arabic
text node produces outline path operators (`m`, `l`, `c`, `h`) instead of
a `Tj` text-showing operator.

### M8 — Accessibility, performance, docs

#### a11y
- TypographySection direction control: `aria-label="Text direction"`.
- Rich-text span editor: `role="textbox"` with `aria-multiline="true"`,
  `aria-activedescendant` pointing to the focused span.
- Verify with `npx playwright test tests/e2e/spec/axe.spec.ts`.

#### Performance
- Add `packages/engine/src/shaping.bench.test.ts` with a 1000-node
  multilingual document (mix Latin + Arabic + CJK). Assert shaping all
  nodes completes < 100ms.
- Cache `TextShaping` results keyed by `(text, font, size, direction,
  language)` in a module-level LRU (max 500 entries).

#### Docs
- `docs/architecture/text-pipeline.md` — architecture decision record
  covering: why BiDi is paragraph/run-level (not full UBA), why shaping
  uses browser-native advances (not per-glyph rustybuzz on web), the
  `TextShaping` seam, supported scripts, known limitations.
- Update `AGENTS.md` with the new text pipeline section (mirror the
  motion-system section pattern).

---

## Architecture constraints (from AGENTS.md — do NOT violate)

- **Hub file budget:** `CanvasArea.tsx` (imports 82) and `Shell.tsx`
  (imports 71) are **over budget**. Do NOT add new imports to them.
  Route new functionality through existing sub-modules or context.
- **No circular `workspace:*` deps.** `@varve/engine` must not import
  from `@varve/editor` (would create a cycle via scene→editor→engine).
- **Sub-context `onReady` pattern** if extracting any context logic.
- **ActionRegistry overwrite order** if adding shortcuts.
- **No emoji, no hardcoded colors, trace to CSS custom properties.**

## Regression protocol (mandatory after every change)

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:emoji
pnpm audit:tokens
```

Failure at any step = regression. Fix before committing.

## TDD order for each milestone

1. Write failing test.
2. Run it (red).
3. Implement.
4. Run it (green).
5. Run full regression protocol.
6. Commit scoped, reviewable units.

## Completion criteria

- Arabic/Hebrew/Thai text renders RTL in the canvas (verified via
  Playwright screenshot or `page.evaluate` on canvas pixels).
- Direction toggle in TypographySection changes rendering direction.
- Rich-text span formatting applies bold/color/size to a selected range.
- SVG export emits `direction="rtl"` for RTL nodes.
- PDF export outlines non-WinAnsi text instead of producing garbage.
- All existing tests still pass (6890+ JS, 356 Rust).
- No new lint errors on touched files.

Do not claim completion because Latin text still works. Verify with real
multilingual fixtures.
