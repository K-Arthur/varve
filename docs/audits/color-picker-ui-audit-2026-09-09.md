# Color picker UI audit — 2026-09-09

## Scope and evidence

This audit covers the shared picker in `packages/ui/src/components/ColorPicker/`,
its Inspector color and gradient entry points, the Selection Colors integration,
and the matching product documentation and website pages. The repository was
already on `master` with unrelated working-tree changes; those changes remain
outside this audit. The previous picker composition work landed in
`aaa61e62d` (2026-08-31) and improved spacing and Inspector organization, but it
did not add picker-specific screenshots.

The current evidence includes the existing component and browser tests, a real
Chromium editor session at 1440×1000 and 900×600, and captures in Light, Dark,
and High Contrast themes. The browser session showed a roughly 407 px panel
whose Done action began below the 560 px visible portal, a saturation/value
surface with an incorrect black corner, an opaque accent overlay on the alpha
ramp, and a Lab field that continued to display `75.8` after entering `42`.

## Component and access map

The shared `ColorPicker` owns color-space selection, HSV area and sliders,
precision-aware fields, native CMYK/Gray/Lab/LCH/Spot editors, swatches, proof
status, and eyedropper capability. `InspectorColorPopover` supplies the common
portaled shell, focus trap, document/recent colors, profile and proof context,
and transaction callbacks. `FillSection`, `StrokeSection`, Selection Colors,
the quick bar, effects, document settings, and gradient controls consume that
shell. `GradientEditor` currently embeds a second full picker inline, which
pushes the Inspector content downward and gives gradient stops a different
surface from solid colors.

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

The color guide currently describes four modes, a tabbed interface, automatic
printable-CMYK warnings, and swatch CRUD that the picker does not provide. It
also conflates picker view changes with document Assign/Convert operations.
The feature page emphasizes print/effects but does not show the core picker
workflow. Help copy overstates eyedropper availability. These claims will be
updated to describe RGB, CMYK, Grayscale, Lab, LCH, and Spot views, bounded
document/recent/theme swatches, proof conditions, and feature-detected screen
sampling. A dedicated real-editor picker capture will be added to the existing
website screenshot manifest.

## Implementation status and validation

This audit records the pre-change evidence. Correctness repairs, shared panel
integration, website documentation, and visual captures are landed in separate
commits. Focused validation covers the shared picker and Inspector tests,
Chromium interaction tests, website builds and E2E, token/emoji/docs audits,
and inspected Light/Dark/High Contrast captures at desktop and constrained
window sizes. The Rust/WASM engine's existing inability to deserialize Lab/LCH
scene colors is recorded as an engine boundary limitation; this UI work does
not expand that engine contract.

## Residual risks

The native engine still rejects Lab/LCH scene colors in the existing browser
fallback path. Proof conversion remains conditional on a registered profile
converter. Screen sampling remains dependent on secure-context browser support.
Those are documented capability boundaries, not reasons to silently convert
or discard canonical picker values.
