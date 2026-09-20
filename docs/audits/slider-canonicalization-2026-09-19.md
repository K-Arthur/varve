# Slider system canonicalization

Date: 2026-09-19

Status: implemented; validation recorded below.

Scope: every `<input type="range">` and every slider-like control in the
repository — the `@varve/ui` `Slider`, the editor `RangeValueControl`, the
`ColorPicker` `ColorSlider`, and the ~20 hand-styled range inputs in editor
panels and dialogs.

Prior art:
[radio-group canonicalization](radio-group-canonicalization-2026-09-19.md)
(2026-09-19) established the same pattern for mutually-exclusive choice
controls. This pass applies it to continuous controls.

## Findings

| ID | Surface | Evidence | Class of problem | Decision |
|----|---------|----------|------------------|----------|
| SL-01 | Two near-identical inspector range skins | `.insp-range` (`inspector.css:4774-4827`) vs `.insp-slider__input` (`inspector.css:3646-3699`): identical `appearance: none`, `--space-1` track, `--space-4` thumb, `2px solid var(--color-interactive-default)` border, identical focus ring | Accidental redundancy: same control, two names, two copies | MERGE into `.varve-native-range` |
| SL-02 | Adjustment editor third copy | `.adj-editor__slider` (`adjustment.css:458-521`) re-declares the same track/thumb and adds hover/active scale | Accidental redundancy | MERGE; delete the skin |
| SL-03 | Colorize section fourth/fifth copies with a *different* visual model | `.colorize-section__slider-row input[type="range"]` and `.colorize-section__compare-slider` (`ColorizeSection.css:102-126, 346-371`) paint the track as a background on the input (`--color-surface-raised`, `--radius-control-compact`) with a 14px thumb bordered `--color-surface-default` | Accidental redundancy plus visible drift from every other slider | MERGE into `.varve-native-range` |
| SL-04 | Platform-default ranges (only `accent-color`) in ten surfaces | `.photo-source-section__range input` (photoSource.css:130), `.fs-dialog__slider` (frequencySeparation.css:164), `.font-browser__axis input[type="range"]` (FontBrowser.css:722), `.quick-convert__controls input[type="range"]`, `.tool-options__field input[type="range"]`, `.liquify-options__slider input[type="range"]`, `.effect-studio__tuning-controls input[type="range"]`, `.effect-studio-comparison__split-control input`, `.insp-feature-browser__size input`, `.varve-modifier-popover__slider` | Accidental visual inconsistency: these render the platform slider, not Varve's | CANONICALIZE onto `.varve-native-range` |
| SL-05 | `RangeValueControl` has no default skin; every consumer must pass one | 48 × `adj-editor__slider`, 32 × `insp-range`, 4 × `insp-slider__input`, 1 × `varve-native-range gm-editor__slider`; the component renders a bare native range when `rangeClassName` is absent | The canonical skin is opt-in, so the default is platform chrome | CANONICALIZE: the component applies `.varve-native-range` itself; `rangeClassName` becomes a layout modifier |
| SL-06 | The `@varve/ui` `Slider` is a second interaction model | `Slider.tsx` renders a `div[role="slider"]` with hand-written Arrow/Home/End/Page handling, track-click math, and pointer capture; one consumer (`VectorizeWorkflow.tsx`, 10 instances) while ~100 surfaces use native ranges | Accidental redundancy of the platform's own slider contract; also a defect class (see SL-07) | REDESIGN over `<input type="range">`; keep the public API |
| SL-07 | Pointer-cancel leak in the custom slider | `Slider.tsx:100-107`: `pointermove`/`pointerup` listeners are attached to the thumb and removed only on `pointerup`; `handlePointerMove` never checks `event.buttons`, so a cancelled drag (touch takeover, browser gesture) leaves a listener that moves the value on a later hover | P1 correctness defect | REMOVE by SL-06 |
| SL-08 | `aria-valuetext` missing where the number is not the value | `RangeValueControl` sets only `aria-label`; with `displayScale`/`unit` (e.g. a normalized 0.65 shown as 65%) a screen reader announces the raw number | Accessibility (WCAG 4.1.2 / 1.3.1) | FIX: emit `aria-valuetext` from the displayed value when `unit` or `displayScale` is present |
| SL-09 | No forced-colors handling for range inputs | The only `@media (forced-colors: active)` block in `components.css` covers tooltips; custom `appearance: none` sliders can render invisible tracks/thumbs under Windows Contrast Themes | Accessibility (WCAG 1.4.11 / forced-colors support) | FIX: system-color track/thumb rules for `.varve-native-range` |
| SL-10 | Stale E2E locators for deleted classes | `tests/e2e/inspector/color-picker.spec.ts:157` and `tests/e2e/canvas/gradient-visual-check.spec.ts:45,50` query `.insp-slider__track` / `.insp-slider__thumb`; `ColorSlider` emits `.color-slider__track` / `.color-slider__thumb` | P0 broken test: the locator can never match; `gradient-visual-check` silently no-ops because it guards with `isVisible().catch(() => false)` | FIX locators |
| SL-11 | Inert `accent-color` declarations on `appearance: none` inputs | `.image-tuning__slider`, `.gm-editor__slider`, `.gradient-editor__slider`, `.effect-studio__tuning-controls input`, etc. set `accent-color`, which browsers ignore once `appearance: none` removes the native track | Dead declarations that imply the accent still applies | REMOVE with the skin merge |
| SL-12 | Undefined-value drift: photo/effect sliders used `--color-accent-primary` while everything else used `--color-interactive-default` | `photoSource.css:131`, `effectStudio.css:700`, `effect-studio-comparison` split control | Inconsistent accent ownership | RESOLVED by SL-04 (the canonical skin owns color) |
| SL-13 | Four copies of the same labelled photo-range row | `PhotoSourceSection.tsx:680` (`PhotoRangeControl`, 8 uses), `HdrSourceSection.tsx:405-428`, `HdrMergeDialog.tsx:315-340`, `GainMapExportSection.tsx:105-130` — identical label + `<output>` + range markup | Accidental redundancy: same presentation, four implementations that drifted (aria-label present in some, absent in others) | MERGE into one shared `PhotoRangeControl` under Inspector controls |

## Research synthesis — what slider implementations fail at

Sources: NN/g "Slider Design: Rules of Thumb" and "Sliders, Knobs, and
Matrices"; Baymard's slider-interface research; Smashing Magazine "Designing
The Perfect Slider UX"; USWDS Range Slider; accessibility.build's accessible
slider guide; the WordPress Gutenberg `RangeControl` forced-colors fix; MDN's
`forced-colors` reference.

| Failure observed in the wild | How Varve already answers it | What this pass adds |
|---|---|---|
| Sliders used where precision matters; no way to type an exact value (NN/g, Baymard: "always accompany numeric filters with text inputs") | `RangeValueControl` pairs a range with `NumberField`; the website already documents "sliders and precision fields stay synchronized" | The pairing becomes the default and is enforced by the canonical component rather than by 84 call sites choosing a class |
| Value not visible while dragging (NN/g, Smashing: labels must stay beside/above the thumb) | Labels and outputs sit above/beside every slider | Audited: every raw range has a visible value or an adjacent number field; CAF/Liquify/QuickConvert show the value in the label text |
| Screen readers announce a meaningless raw number (accessibility.build: `aria-valuetext`) | `Slider` set `aria-valuetext` unconditionally | `RangeValueControl` now emits `aria-valuetext` whenever `unit`/`displayScale` make the raw number misleading |
| Custom `div[role=slider]` implementations lose Home/End/PageUp/PageDown, single-pointer set, or AT support (USWDS, accessibility.build, Smashing) | The custom `Slider` implemented all keys but was a second implementation to maintain | Reimplemented over the native range: the browser owns the keyboard and the WCAG 2.5.7 single-pointer path |
| Custom skins disappear in Windows Contrast Themes / forced-colors (Gutenberg #75165, MDN) | Nothing | System-color track/thumb rules in `forced-colors: active` |
| Thumb/track contrast and focus visibility lost when `appearance: none` removes native chrome (Smashing, a11y-examples) | Canonical skin has a bordered thumb and an explicit `:focus-visible` ring | Unchanged, now applied everywhere instead of in five variants |
| Touch targets below 44px (Smashing: 32×32 thumb minimum; accessibility.build: 24×24) | `.varve-native-range` raises the hit band to 44px on coarse pointers | Now applies to every surface, not just the ones that opted in |
| Linear scales for skewed ranges (Baymard: 83% of top sites) | Most Varve ranges are perceptual or bounded (0–100, 0–1); wide ranges (max paths 50–2000, blur radius) are paired with numeric entry | Documented as a deliberate KEEP: ranges are bounded and the numeric companion covers precision; no log scale is introduced without evidence |
| Dual-thumb ranges misinterpreted (Baymard: >50% of users) | Varve has no dual-thumb control; black/white points are two separately labelled sliders | Documented as a deliberate KEEP — the accessible two-slider pattern is already used |
| Slider changes flooding undo history | Transactions group a drag into one entry (`AdjustmentPanel.test.tsx` "coalesces a slider scrub into one undo operation") | Unchanged; E2E re-verifies one undo step through the real pointer path |

## Canonical architecture

`@varve/ui` owns the single range-input skin:

- `.varve-native-range` — the only place that styles a native range. It owns
  track, thumb, focus ring, disabled state, coarse-pointer target, and the
  forced-colors fallback. Sizes are parameterized by two inherited custom
  properties (`--varve-native-range-track`, `--varve-native-range-thumb`) so
  compositions can resize it without redeclaring pseudo-elements.
- `Slider` — labeled composition (legend, value output or inline number,
  optional reset, `sm`/`md`/`lg`) rendered as a native range.
- `ColorSlider` — deliberate exception: the track is a hue/alpha gradient with
  a checkerboard, which a scale-based skin cannot express. Kept custom and
  documented; it is the only remaining `div[role="slider"]`.

`@varve/editor` owns the precision composition:

- `RangeValueControl` — range + `NumberField`, always emitting the canonical
  class; `rangeClassName` is a layout modifier only.

## Implementation files

- `packages/ui/src/components/components.css` — canonical skin,
  parameterization, forced-colors, size variants; deleted
  `.varve-slider__track/__fill/__thumb` and their state rules
- `packages/ui/src/components/Slider.tsx` — native-range reimplementation
- `packages/ui/src/components/Slider.test.tsx` — native contract
- `packages/ui/src/components/radius-system.css` — radius ownership list
- `packages/editor/src/components/Inspector/controls/RangeValueControl.tsx` —
  default class + `aria-valuetext`
- Editor consumers and CSS: `AdjustmentEditor`, `AdjustmentPanel`,
  `SelectionSourcesPanel`, `DocumentPanel`, `PathTextSection`,
  `AIDenoiseSection`, `MaskSection`, `SmartFiltersSection`, `GradientMapEditor`,
  `ImageTreatmentEditor`, `ColorBalanceAdjustmentEditor`, `SpatialEffectEditors`,
  `LiveEffectEditors`, `ThresholdAdjustmentEditor`, `CornerRadiusSection`,
  `BackgroundRemovalSection`, `DepthMaskSection`, `EffectStudioSection`,
  `ImageEnhancementSection`, `LensBlurSection`, `TypographySection`,
  `PhotoSourceSection`, `HdrSourceSection`, `HdrMergeDialog`,
  `GainMapExportSection`, `FrequencySeparationDialog`, `FontBrowser`,
  `QuickConvertDialog`, `LiquifyToolOptions`, `ToolOptionsPopover`,
  `FloatingToolbar`, `EffectStudioComparison`, `VariableModifierPopover`,
  `AdvancedOpenTypeFeaturesSection`, `ColorizeSection`, `CropOverlay`,
  `ContentAwareFillDialog`
- CSS: `inspector.css`, `adjustment.css`, `ColorizeSection.css`,
  `photoSource.css`, `frequencySeparation.css`, `FontBrowser.css`,
  `quick-convert.css`, `liquifyToolOptions.css`, `ToolOptionsPopover.css`,
  `effectStudio.css`, `imageTuning.css`, `editor.css`
- Tests: `tests/unit/slider-system.test.ts` (new guard),
  `RangeValueControl.test.tsx`, `Slider.test.tsx`,
  `tests/e2e/inspector/slider-canonicalization.spec.ts`,
  `tests/e2e/inspector/slider-real-world.spec.ts`,
  `tests/e2e/inspector/color-picker.spec.ts`,
  `tests/e2e/canvas/gradient-visual-check.spec.ts`
- Docs: this file, `docs/architecture/slider-system.md`, `AGENTS.md`

## Compatibility

- No persisted identifier, storage key, document field, shortcut, or route
  changes. All edits are internal component/class wiring.
- The `Slider` public props are unchanged (`value`, `min`, `max`, `step`,
  `label`, `onChange`, `formatValue`, `disabled`, `showInput`, `onReset`,
  `size`).
- `.varve-slider` remains the root class for consumers and tests; only the
  internal track/fill/thumb elements and their CSS are gone.
- `rangeClassName` remains supported; passing a removed skin class is inert,
  and all in-repo call sites are cleaned up in the same change.

## Validation

Exact commands and results for this pass:

- **Unit (main tree, after patch):**
  `npx vitest run tests/unit/slider-system.test.ts packages/ui/src/components/Slider.test.tsx packages/editor/src/components/Inspector/controls/RangeValueControl.test.tsx`
  — 3 files, 25 tests passed. The guard failed before the migration with
  122 offender findings (the five duplicate skins, ten platform-default
  ranges, 84 retired `rangeClassName` values) and passes after it.
- **Typecheck:** `pnpm --filter @varve/ui typecheck` passed.
  `pnpm --filter @varve/editor typecheck` reports only pre-existing errors
  from concurrent uncommitted work (`Menubar.tsx`, `workspace/layoutVariants`,
  `ContextControlBar` tests, `sceneNodeGeometry` panel work); no error is in a
  file this pass changed except `MaskSection.tsx:294` (`mask?.rasterMask` on a
  `never` type produced by the concurrent scene-type edits, untouched by this
  pass). `pnpm typecheck:e2e` passed.
- **Tier 0:** `npx biome check` on all 55 touched/added files — 0 errors
  (15 pre-existing specificity warnings in concurrently edited stylesheets).
  The pre-commit checkpoint ran the staged unit tests for each commit and
  passed.
- **E2E — contract and capture** (lease-wrapped, `VARVE_E2E_PORT=4214`):
  `tests/e2e/inspector/slider-canonicalization.spec.ts` — 5 passed. The
  contract tests assert every adjustment/document range carries
  `.varve-native-range` and that `Slider` renders a native range with no
  `div[role="slider"]`.
- **E2E — real-world workflow** (`VARVE_E2E_PORT=4215`):
  `tests/e2e/inspector/slider-real-world.spec.ts` — 3 passed. A real
  photograph (`real-life-still-life.jpg`) is imported, an adjustment layer is
  created, and Brightness is added: a pointer drag changes the value, repaints
  the canvas (64×64 FNV digest), and restores both value and pixels with one
  Edit > Undo; ArrowRight/End/Home/PageUp behave natively and the effect
  opacity slider exposes `aria-valuetext="100%"`; a coarse-pointer context
  sees a ≥44px hit band and a single-pointer click sets the value.
- **E2E — colour-slider locator repair:** the two stale locators now target
  `.color-slider__track` / `.color-slider__thumb`. Re-running
  `color-picker.spec.ts -g "undo groups a slider drag"` is blocked by a
  concurrent boot breakage (below); the selector correction is mechanical
  against `ColorSlider.tsx`'s emitted classes, and the same drag contract is
  covered by the passing real-world spec.
- **Audits:** `audit:tokens` clean (315 contrast pairs, 561 properties, 0
  undefined references after correcting two pre-existing undefined tokens);
  `audit:emoji`, `audit:docs`, `audit:inspector-css`, `audit:spacing` clean.
  `audit:radius` still reports pre-existing `4px`/`3px` radii in
  `smartFilters.css` and `effects/effects.css`, which this pass did not touch.
- **`pnpm verify:plan`** escalates to `FULL-SUITE ESCALATION: YES` because the
  shared working tree contains workspace/toolchain changes from concurrent
  work (349 changed files at the time of the pass). The escalation is not
  attributable to the slider changes; their affected closure (ui + editor +
  e2e typecheck + the specs above) was run instead.

Baseline and after captures: `reports/slider-canonicalization/`
(`baseline/`, `after/`, `real-world-adjustment.png`).

## Blocked by concurrent work (not attributable to this pass)

- The app currently fails to boot in the shared working tree:
  `context/sceneNodeGeometry.ts` does not export `joinPanels`, which another
  agent's in-flight panel/comic work imports. Every browser run after that
  landed fails in `global-setup.ts`. The slider E2E evidence above was
  captured before the breakage.
- `packages/editor/src/workspace/layoutVariants.ts` and its test reference
  types that no longer exist (`WorkspacePreferences`,
  `WorkspaceLayoutStoreState`), so the editor package typecheck cannot go
  green until that refactor lands.
- `audit:radius` and the `smartFilters.css` spacing warnings pre-date this
  pass.

## Remaining risks

- The canonical skin is larger than the inspector copies it replaces (18px
  thumb / 6px track vs ~12–14px / ~3px). This is the intended unification and
  was inspected on every surface; dense adjustment rows keep their layout
  because the input's hit box is unchanged.
- `ColorSlider` remains a custom `role="slider"`. It implements the full key
  set and single-pointer set; migrating it would require a gradient track in
  the native skin and is deferred with the exception documented.
- Non-linear (logarithmic) scales are not introduced. Wide-range parameters
  rely on the paired numeric field; revisit only with evidence that users
  struggle at the low end.
