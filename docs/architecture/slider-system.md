# Slider System

Canonical contract for every continuous-value control in Varve: sliders,
range inputs, and their precision companions. Audit evidence and research
grounding: `docs/audits/slider-canonicalization-2026-09-19.md`.

## Model

A slider is an **exploration** control. It answers "roughly here" quickly and
shows where a value sits in its range. It is not a precision control; whenever
the exact number matters, a slider must be paired with a numeric field that
edits the same value. Varve's slider system is built around that split:

- **One primitive**: the native `<input type="range">` carries the value,
  keyboard model, and accessibility semantics.
- **One skin**: `.varve-native-range` (in `@varve/ui` `components.css`) owns
  the track, thumb, focus ring, disabled state, coarse-pointer target, and
  forced-colors fallback.
- **Two compositions**: `RangeValueControl` (dense inspector rows: range +
  numeric field) and `Slider` (labelled standalone: legend, value or inline
  number, optional reset). Both render the same primitive and skin.
- **One documented exception**: `ColorSlider` in `ColorPicker` — a
  gradient-track marker for hue/alpha. Its track is a gradient plus a
  checkerboard, not a scale, so it stays a custom `role="slider"` with the full
  key set and single-pointer set implemented.

## Invariants

1. **The primitive is native.** No new `div[role="slider"]` widget. A custom
   slider must reimplement the complete keyboard contract (arrows, Home, End,
   PageUp/PageDown) and the WCAG 2.5.7 single-pointer path (click anywhere on
   the track); the native element provides both for free.
2. **One skin owner.** Only `packages/ui/src/components/components.css` may
   declare range pseudo-element styling
   (`::-webkit-slider-thumb`, `::-moz-range-thumb`,
   `::-webkit-slider-runnable-track`, `::-moz-range-track`).
   `radius-system.css` may declare `border-radius` only. Enforced by
   `tests/unit/slider-system.test.ts`.
3. **The skin is not opt-in.** `RangeValueControl` applies
   `.varve-native-range` itself; `rangeClassName` is a layout modifier only
   (width, flex, grid placement). Every JSX range input in `packages/` and
   `apps/` references the canonical class. Enforced by the same guard.
4. **Precision has a path.** Every slider whose exact value matters is paired
   with a numeric field: `RangeValueControl` always; `Slider` via `showInput`.
   The two stay synchronized in both directions, and the numeric path supports
   the editor's arithmetic expressions and fine steps through `NumberField`.
5. **The value is visible.** A slider never communicates its value by position
   alone. Compositions render an `<output>` or numeric field; raw dialog
   ranges print the value in their label text.
6. **`aria-valuetext` whenever the raw number is not the value.** If a slider
   stores a normalized value (`displayScale`) or carries a `unit`, the input
   announces the human string ("65%") rather than the raw number ("0.65").
   Plain 0–100 percentages leave `aria-valuetext` off and let `aria-valuenow`
   speak.
7. **A drag is one undo entry.** Pointer gestures on a slider open a
   transaction and commit once on release (see
   `packages/scene/src/operations/transaction.ts` and the AdjustmentPanel
   unit test "coalesces a slider scrub into one undo operation").
8. **No inert declarations.** `accent-color` is not used on `appearance: none`
   ranges; it has no effect there and implies otherwise.

## Sizing

The skin is parameterized by two inherited custom properties:

```css
.varve-native-range { /* track: var(--varve-native-range-track, 6px) */ }
.varve-native-range { /* thumb: var(--varve-native-range-thumb, 18px) */ }
```

`Slider`'s `size` prop sets them (`sm` 4/14, `lg` 8/24); the default is the
canonical 6/18. On coarse pointers the input's hit band rises to 44px while the
visual track stays the same. The thumb never drops below the 24×24 WCAG 2.5.8
target measured on the input box, which is the full row height.

## Forced colors

Under `forced-colors: active` (Windows Contrast Themes) the skin switches to
system colors: `ButtonText` track, `ButtonFace` thumb with a `ButtonText`
border, `GrayText` for disabled. Without this, an `appearance: none` range can
render its track and thumb in the same forced color as the background and
disappear.

## Access and input parity

| Input | Path |
|---|---|
| Pointer drag | Native range drag (primitive); transaction groups the gesture |
| Single pointer (WCAG 2.5.7) | Click anywhere on the track — native behavior |
| Keyboard | Arrows step; Home/End jump; PageUp/PageDown take a larger step — native behavior |
| Numeric precision | The paired `NumberField` / inline number input |
| Screen reader | Native `slider` role, name from label/legend, `aria-valuetext` when formatted |
| Touch | 44px hit band on coarse pointers; no hover-only affordance |
| Reduced motion | The skin has no animated state; only color/position feedback |

## File map

| Concern | Location |
|---|---|
| Skin + size parameterization + forced colors | `packages/ui/src/components/components.css` |
| Labelled composition | `packages/ui/src/components/Slider.tsx` |
| Precision composition | `packages/editor/src/components/Inspector/controls/RangeValueControl.tsx` |
| Gradient-track exception | `packages/ui/src/components/ColorPicker/ColorSlider.tsx` |
| Guard | `tests/unit/slider-system.test.ts` |
| Real-workflow E2E | `tests/e2e/inspector/slider-real-world.spec.ts` |
| Contract E2E | `tests/e2e/inspector/slider-canonicalization.spec.ts` |
