# Typography System Redesign — Design Spec

> Date: 2026-07-03
> Author: Cascade
> Status: Approved for implementation (user directed to proceed)

## Goal

Close the gap between Strata's declared typography data model and its actual render, measurement, and export behavior. The immediate deliverable is a **foundation upgrade** that makes rich text, variable fonts, OpenType features, and professional text layout measurable, renderable, and exportable.

## Non-Goal

This phase does not build a full inline text editor, HarfBuzz-level shaper, or multi-page publishing system. Those are architected but deferred to follow-up phases.

## Architecture

### Core Principle: One Layout, Many Outputs

Introduce a single `PositionedText` structure produced by the typography layout engine. The same structure feeds:
- Canvas2D replay renderer
- SVG export
- Hit-testing (future)
- Spec/export metadata (future)

```
TextNode + FontRegistry + CanvasMeasure
            ↓
    TypographyLayoutEngine
            ↓
     PositionedText
            ↓
   ┌────────┼────────┐
   ↓        ↓        ↓
  Canvas   SVG    Preflight
```

### Data Model Changes

1. **Engine IR** `Primitive` text kind gains:
   - `richText?: RichText` (from `@varve/scene`)
   - `variableAxes?: Record<string, number>`
   - `openTypeFeatures?: Record<string, boolean>`
   - `textMode?: TextMode`
   - `pathTextSettings?: PathTextSettings`

2. **Engine IR** keeps the existing `text` field for backward compatibility. When `richText` is present, it takes precedence for rendering.

3. **FontRegistry** exposes:
   - `resolve(family, weight, style)` → properly quoted CSS font-family string with unquoted fallbacks.
   - `buildFontCSS(family, size, weight, style, lineHeight)` → valid CSS `font` shorthand.
   - `isAvailable(family)` → clear semantics: true only if state is `loaded`.
   - `isRegistered(family)` → true if family is in the registry (regardless of load state).

### Layout Engine Responsibilities

The layout engine lives in `packages/engine/src/textLayout.ts` and provides:

- `layoutText(node: SceneNode, measure: MeasureTextFn, registry: FontRegistry): PositionedText`
- `layoutRichText(richText: RichText, width: number, defaultFormat: CharacterFormat, measure: MeasureTextFn, registry: FontRegistry): PositionedText`
- `wrapRichTextParagraphs(...): PositionedParagraph[]`

Each `PositionedText` contains:
- `lines: PositionedLine[]`
- `width`, `height`
- `overset: boolean` (for overflow detection)

Each `PositionedLine` contains:
- `runs: PositionedRun[]`
- `x`, `y`, `width`, `height`, `baseline`

Each `PositionedRun` contains:
- `text: string`
- `x`, `y`, `width`, `height`
- `format: ResolvedCharacterFormat`
- `font: string` (canvas-ready font string)
- `featureSettings?: string`
- `variationSettings?: string`

### Rendering Strategy

1. If `richText` is absent, render as today (single-format text) but with improved letter-spacing using actual glyph widths.
2. If `richText` is present, iterate over positioned lines and runs, set canvas state per run, and draw with `fillText`.
3. Apply OpenType features and variable font settings via `font-feature-settings` and `font-variation-settings` on the canvas context when supported, or via the CSS `font` shorthand for the renderer.
4. Text overflow modes (`clip`, `ellipsis`, `visible`) are enforced by the layout engine's line culling, not the renderer.

### SVG Export Strategy

1. Plain text → `<text>` with `<tspan>` per line.
2. Rich text → `<text>` with nested `<tspan>` per run, preserving per-run `font-family`, `font-size`, `font-weight`, `font-style`, `fill`, `letter-spacing`, `text-decoration`.
3. Variable fonts → `font-variation-settings` attribute on the run or text element.
4. OpenType features → `font-feature-settings` attribute on the run or text element.
5. List styles → prefix characters in the run text or SVG `marker` (simplified: prefix characters for this phase).

### Preflight Strategy

1. Use `FontRegistry.availableFamilies()` for the available-font check instead of a hardcoded set.
2. Add `missing-variable-axis` check for variable fonts that reference unregistered axes.
3. Add `unsupported-glyph` check stub using `FontRegistry` metadata `glyphCount` (conservative: if glyph count is unknown, skip).
4. Detect `style-conflict` when a TextNode references both a `styleId` and `richText` with inline overrides that cannot be represented by the referenced style.
5. Detect `orphaned-typography-style` for character/paragraph styles not used by any run.

## Testing Strategy

- TDD for every changed module: failing test first, then implementation.
- Use jsdom + mock canvas context for deterministic measurement.
- Add tests for:
  - FontRegistry CSS quoting and availability semantics.
  - Engine IR carrying rich text / variable axes / OpenType features.
  - Canvas renderer drawing rich text runs with correct per-run state.
  - SVG export producing `<tspan>` runs with correct attributes.
  - Layout engine wrapping rich text across runs.
  - Preflight detecting missing fonts and variable-axis issues.

## Regression Gate

After implementation, run:
```bash
pnpm typecheck
pnpm --filter @varve/shared test -- --run
pnpm --filter @varve/engine test -- --run
pnpm --filter @varve/scene test -- --run
pnpm exec vitest run packages/codegen/src -- --run
pnpm format-check
pnpm lint
pnpm audit:emoji
pnpm audit:tokens
```

Pre-existing unrelated failures (`brush.test.ts`, `textWarp.test.ts`) are documented and not within scope.

## Risks

- Canvas2D `font-feature-settings` and `font-variation-settings` support varies by browser. We will set them via `ctx.font` when possible and degrade gracefully.
- Rich text layout without a real shaper is approximate for complex scripts. This is acceptable for Phase A and documented as a future limitation.
- Performance: per-run canvas state changes are slower than single-text draws. Caching `PositionedText` will mitigate this in a follow-up phase.

## Future Phases

- Phase B: Inline editor, selection model, text hit-testing.
- Phase C: HarfBuzz/WASM shaping, CJK/RTL/bidi, threaded text frames, parent pages, print production preflight profiles.
