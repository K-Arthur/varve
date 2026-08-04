# Strata Intelligence: Phase 0–1 Implementation Plan

Reconcile and extend the existing `packages/editor/src/intelligence/` modules to match the Phase 0–1 megaplan, wiring them into `EditorContext`, the menu system, shortcuts, and inspector panels.

## Scope

- Phase 0: Foundation (`colorMath.ts` in `@varve/shared`; `recordAction` wired to all interactive surfaces).
- Phase 1: Layout & Color Intelligence (auto-naming, image fit, spacing harmonizer, WCAG contrast, palette extraction, cognitive load budget).
- Existing modules (`actionTracker`, `autoNamer`, `imageFitAdvisor`, `spacingHarmonizer`, `wcagFix`) will be refactored to match the spec where they diverge.
- New modules (`colorMath`, `paletteExtractor`, `cognitiveLoad`, `ContrastIndicator`, `CognitiveLoadIndicator`) will be created from scratch.

## Approach

- `@varve/shared` is the canonical location for color/contrast math. `colorMath.ts` will be added there and re-exported from `index.ts`.
- `findAccessibleColor` will be implemented as a thin wrapper around the existing `autoFixContrast`, exposing the `Rgb`/`Oklch` API described in the plan.
- `EditorContextValue` additions will be delivered through the existing `context/useX.ts` extraction pattern, preserving React hook order in `EditorProvider`.
- Hub files (`Shell.tsx`, `CanvasArea.tsx`, `Menubar.tsx`) will receive their integrations via adapter modules under `packages/editor/src/intelligence/` where possible, to respect the dependency budgets in `AGENTS.md`.
- Changes will be committed per phase to minimize conflicts with concurrent agents.

## Phase Breakdown

### Phase 0a — Action Recording

- Reconcile `packages/editor/src/intelligence/actionTracker.ts` with the spec: keep `ActionRecord`, `ActionTracker`, `getActionTracker` API; ensure 30-day pruning, `toJSON`/`fromJSON`, 100 ms dedupe.
- Wire `recordAction(actionId)` into `EditorContextValue`.
- Subscribe to tool selection in `Shell.tsx` and record `tool:<id>`.
- Instrument `handleAction` in `Menubar.tsx` to record `menu:<id>`.
- Add `recordAction('shortcut:<id>')` in `useShortcuts.ts` dispatch path.

### Phase 0b — WCAG Math Foundation

- Create `packages/shared/src/colorMath.ts` with `mean`, `stddev`, `median`, `binnedMode`, `deltaEOK`, and `findAccessibleColor`.
- `findAccessibleColor` uses `autoFixContrast` internally and returns `Rgb` while respecting `targetRatio` and `maxDeltaE`.
- Add `packages/shared/src/colorMath.test.ts` with the 6 spec tests.
- Re-export from `packages/shared/src/index.ts`.

### Phase 1.1 — Content-Aware Layer Naming

- Reconcile `autoNamer.ts` rules with the 14-rule decision tree in the spec (button text, heading, body, frame/component/variant, layout, section, image filename, icon placeholder, rectangle, ellipse, path, group, preserve custom name).
- Add counter logic so duplicate auto-names append `2`, `3`, etc.
- Wire `autoName()` into `createShapeAt` and `createTextNodeAt` in `context.tsx`.
- Add ghost-text auto-suggestion to `LayersRow.tsx` rename field.

### Phase 1.2 — Image Smart-Fit

- Reconcile `imageFitAdvisor.ts` values (`fill`/`fit`/`stretch`/`tile`) with the spec (`cover`/`contain`/`fill`/`crop`), mapping semantics where needed.
- Call `suggestFit()` from `createShapeAt` when dropping an image into a frame and from the `CanvasArea.tsx` drag-drop handler.
- Toast the applied fit; ensure one undo step.

### Phase 1.3 — Smart Spacing Harmonizer

- Keep existing `spacingHarmonizer.ts` core; expose `harmonizeSpacing` on `EditorContextValue`.
- Add "Harmonize Spacing" to the Arrange menu in `Menubar.tsx`.
- Register `Ctrl+Shift+H` in `ShortcutManager.ts` and `useShortcuts.ts`.
- Implement `aria-live` announcement and non-intrusive inconsistency toast.

### Phase 1.4 — WCAG Contrast Auto-Fix

- Reconcile `wcagFix.ts` with the spec: check solid, gradient, and multiple fills; compute effective background by walking ancestors; apply large-text threshold.
- Create `ContrastIndicator.tsx` inspector section.
- Render `ContrastIndicator` in `FillSection.tsx` and `TypographySection.tsx`.
- Toast contrast improvement ratio after auto-fix.

### Phase 1.5 — Color Palette Extraction

- Create `paletteExtractor.ts` with 64×64 downsample, median-cut quantization, OKLCH conversion, and harmony generation (complementary, triadic, analogous, split-complementary) with sRGB gamut mapping.
- Add `extractPalette` and `generateHarmony` to `EditorContextValue`.
- Add "Extract Palette" to Object menu for image nodes.
- Add "Generate Harmony" button to `FillSection.tsx` color swatches.

### Phase 1.6 — Cognitive Load Budget

- Create `cognitiveLoad.ts` with `DEFAULT_CONFIG`, `computeCognitiveLoad`, and localStorage persistence.
- Create `CognitiveLoadIndicator.tsx` for the Inspector.
- Add `getCognitiveLoad(nodeId)` to `EditorContextValue`.

## Verification Gates

After each phase:

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:tokens
pnpm audit:emoji
```

Final gate:

```bash
just gate
```

## Open Questions

- Should existing `actionTracker.ts` be extended with `recordAction(actionId)` through `EditorContext` or keep the global singleton? Plan uses a context-backed singleton so tests and SSR stay clean.
- Should `imageFitAdvisor` rename `FitSuggestion` values to match the spec exactly (`cover`/`contain`/`fill`/`crop`) or keep backward-compatible aliases? Plan maps to spec values internally and leaves storage schema unchanged.
