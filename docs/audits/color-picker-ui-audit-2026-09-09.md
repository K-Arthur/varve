# Color picker UI audit — 2026-09-09

## Scope and evidence

This audit covers the shared picker in `packages/ui/src/components/ColorPicker/`,
its Inspector color and gradient entry points, the Selection Colors integration,
and the matching product documentation and website pages. The repository was
already on `master` with unrelated working-tree changes; those changes remain
outside this audit. The previous picker composition work landed in
`aaa61e62d` (2026-08-31) and improved spacing and Inspector organization, but it
did not add picker-specific screenshots.

The baseline evidence included the existing component and browser tests, a real
Chromium editor session at 1440×1000 and 900×600, and captures in Light, Dark,
and High Contrast themes. That session showed a roughly 407 px panel whose Done
action began below the 560 px visible portal, a saturation/value surface with an
incorrect black corner, an opaque accent overlay on the alpha ramp, and a Lab
field that continued to display `75.8` after entering `42`. The current
evidence adds real product captures from the deterministic screenshot pipeline:
[solid picker](../screenshots/product/solid-picker-light.png) and [gradient
picker](../screenshots/product/gradient-picker-light.png), both at 1440×900.
The solid capture shows the 400 px panel with its header and Done action in the
visible frame. The gradient capture shows the same surface with the selected
stop color controls and the Gradient options disclosure; expanding that
disclosure intentionally scrolls the body to the advanced controls.
The repaired picker was also captured and inspected in Light, Dark, and High
Contrast at 1440×1000 and 900×600, plus a Light DPR 2 pass. The temporary
matrix (`/tmp/varve-picker-*.png` and `/tmp/varve-picker-crop-*.png`) confirmed
that the panel stays within the viewport, retains keyboard-visible focus rings,
and keeps Done reachable at the 900×600 minimum.

## Component and access map

The shared `ColorPicker` owns color-space selection, HSV area and sliders,
precision-aware fields, native CMYK/Gray/Lab/LCH/Spot editors, swatches, proof
status, and eyedropper capability. `InspectorColorPopover` supplies the common
portaled shell, focus trap, document/recent colors, profile and proof context,
and transaction callbacks. `FillSection`, `StrokeSection`, Selection Colors,
the quick bar, effects, document settings, and gradient controls consume that
shell. `GradientEditor` now supplies its selected stop to the same floating
picker surface, so gradient controls no longer create a second tall inline
editor in the Inspector.

## Findings and priority

| Priority | Finding | Evidence | Planned correction |
| --- | --- | --- | --- |
| P1 | Saturation/value layering paints the white layer above the black layer, so the bottom-left corner is not black. | `color-picker.css`, `.color-area__gradient`; browser capture | Reverse the layers and add pixel assertions. |
| P1 | Lab/LCH drafts do not update after their own emitted edits, so controlled fields appear frozen and later edits can reuse stale channels. | `ColorPicker.tsx` draft sync and Lab/LCH handlers | Update drafts on emit and resync every external value. |
| P1 | Alpha edits reconstruct RGB for native CMYK and Spot values. | `ColorPicker.tsx`, `handleAlphaChange` | Change only the native alpha channel while preserving identity, profile and precision. |
| P1 | Numeric drafts reject empty, signed and decimal intermediate input. | `SpinbuttonRow.tsx` | Maintain draft text and commit on Enter/blur. |
| P2 | Alpha ramp is covered by an opaque accent fill. | `ColorSlider.tsx` | Remove the fill overlay from both color ramps. |
| P2 | High-precision RGB fields derive their displayed number from an 8-bit preview. | `ColorFields.tsx` | Format values from canonical normalized channels. |
| P2 | HEX clearing and invalid correction are difficult because the draft is collapsed with the current value. | `ColorFields.tsx` | Distinguish an active empty draft from no draft and retain invalid text. |
| P2 | Swatch sections are defined inside render and can remount on controlled updates; display-derived keys can collide. | `SwatchPalette.tsx` | Hoist the section and key by canonical color identity. |
| P2 | Recent colors are read on open but rendered from mount-time state. | `InspectorColorPopover.tsx` | Refresh state whenever the popover opens. |
| P2 | Proof classes have no complete styling, and unsupported eyedropper copy promises a nonexistent native action. | picker CSS and `EyeDropperButton.tsx` | Add token-based proof layout and truthful capability text. |
| P2 | Spot swatches ignore K and show dark Pantone values as white. | `SpotColorBrowser.tsx` | Use the canonical process fallback converter. |
| P2 | Color format buttons and hidden ColorArea ranges have inconsistent interaction semantics. | `ColorFields.tsx`, `ColorArea.tsx` | Use the existing radio pattern and remove redundant hidden ranges. |
| P1 | Gradient editing is a second inline picker and gradient fill/stroke swatches do not consistently open the real gradient. | `GradientEditor.tsx`, Fill/Stroke sections | Share one wider floating panel with a selected-stop editor and collapsed advanced options. |

## Design decisions

The picker will use a stable 400 px surface, constrained to the viewport, with a
fixed header/footer and a scrollable body. The color area, hue and alpha ramps,
numeric values, and swatches form one visual sequence. Six color-space views
remain visible. RGB/HSL/HSB value format selection is separate from the color
space selector; HEX and alpha remain directly available in RGB editing. CMYK,
Gray, Lab, LCH, and Spot retain their native authoring behavior.

Gradient type, stop bar, selected-stop controls, and the selected stop's color
picker will share the same floating shell. Interpolation, hue direction,
tiling, midpoint, and rotation stay available under a collapsed Gradient options
disclosure. This follows the compact area-plus-slider-plus-precise-fields
pattern documented by [Sketch](https://www.sketch.com/docs/symbols-and-styles/styling/the-color-panel/)
and [Adobe React Aria](https://react-aria.adobe.com/ColorPicker), while keeping
Varve's tokens, themes, native color model, and undo contract.

## Documentation and website drift

The color guide described four modes, a tabbed interface, automatic
printable-CMYK warnings, and swatch CRUD that the picker does not provide. It
also conflated picker view changes with document Assign/Convert operations.
The feature page emphasized print/effects but did not show the core picker
workflow. Help copy overstated eyedropper availability. The docs now describe
RGB, CMYK, Grayscale, Lab, LCH, and Spot views, bounded document/recent/theme
swatches, proof conditions, and feature-detected screen sampling. The website
manifest now carries deterministic solid and gradient picker captures with
captions and alt text.

## Implementation status and validation

The correctness repairs and shared panel integration are committed as
`b8bd9adfc`, after the baseline audit commit `cf400ac68`. Website, docs, test
selector, and capture-pipeline changes are staged for the following commit.
The implementation status is:

- **Complete:** corrected area/ramp layering; native alpha preservation;
  precision-aware RGB display; Lab/LCH draft synchronization; signed,
  decimal, empty, invalid, Enter/blur, and Escape draft behavior; canonical
  swatch identity and cross-picker recents; proof and eyedropper capability
  presentation; shared floating gradient editing; one-owner gradient gestures;
  and the 400 px constrained shell.
- **Covered:** 72 focused ColorPicker tests, 21 GradientEditor tests, 11
  InspectorColorPopover tests, 6 StrokeSection tests, 56 ColorPicker tests in
  the affected planner lane, 4 SpotColorBrowser tests, 7 focused Chromium
  picker/gradient tests, and all 9 Chromium fill-interaction tests. The demo
  parity assertion now compares both corresponding samples because its first
  gradient stop intentionally matches the source fill.
- **Captured and inspected:** Light solid and gradient full-editor compositions
  at 1440×900. The earlier audit also retains Light, Dark, High Contrast, and
  constrained-window baseline captures for comparison. The capture pipeline is
  deterministic and uses the real application scene rather than a mock.

The staged validation report will record the exact planner, affected checks,
docs/emoji/token audits, website build, architecture audit result, and any
commands that were interrupted or blocked by the local PNPM/Vite environment.
The Rust/WASM engine's existing inability to deserialize Lab/LCH scene colors is
recorded as an engine boundary limitation; this UI work does not expand that
engine contract.

## Residual risks

The native engine still rejects Lab/LCH scene colors in the existing browser
fallback path. Proof conversion remains conditional on a registered profile
converter. Screen sampling remains dependent on secure-context browser support.
Those are documented capability boundaries, not reasons to silently convert
or discard canonical picker values.

## Validation report

```text
Changed scope: packages/ui ColorPicker; editor InspectorColorPopover, GradientEditor, FillSection, StrokeSection; color picker tests; docs/help; website pages and screenshot manifest; product capture scenes; focused E2E selectors.
Validation plan: pnpm verify:plan --staged selected Tier 0, picker/editor Tier 1 tests, affected editor/ui checks, and website closure; no full-suite escalation.
Commands actually run: focused ColorPicker Vitest (72 passed); GradientEditor Vitest (21 passed); planner-selected Inspector/Stroke/ColorPicker/Spot tests (all passed); Chromium color-picker + gradient visual tests (7 passed); Chromium fill-interaction (9 passed); website Astro builds for `/` and `/varve` (82 pages each); website desktop visual checks (workspace page passed; docs/features baselines correctly reported expected content-height diffs); desktop and mobile website captures inspected; product capture for solid-picker,gradient-picker (20 captured, 0 skipped, 0 failures); Biome check/write and diff check; docs, emoji, and token audits passed.
Passed: focused picker correctness, gradient composition, browser picker/gradient workflows, real Light captures, website builds, and no-overflow checks at 1280 px and 390 px.
Skipped as unrelated: Rust, broad workspace tests, full Playwright matrix, and unrelated working-tree changes. The architecture audit was attempted with a 120-second bound and timed out in the existing madge graph scan after a shared parse warning; no hub imports were changed.
Escalations: isolated local Vite/Chromium server required approved sandbox escalation; the first sandboxed server attempt failed before tests because local bind/PNPM store access was denied.
Full suite run: no.
```
