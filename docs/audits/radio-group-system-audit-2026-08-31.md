# Varve radio and mutually exclusive choice audit

Date: 2026-08-31

Status: implemented in the radio-system commit series ending at
`67785c64d`.

## Executive result

The repository-wide pass distinguishes mutually exclusive choices from binary
settings, actions, tabs, list selection, and menu radios. Shared UI now has a
native radio group with compact, row, and card compositions; dedicated
segmented and visual selectors retain their more efficient interaction models.
The pass also corrected peer-choice controls that had been exposed as pressed
buttons or switches.

## Audit inventory and classification

The final source search found 27 radiogroup declarations and 43 native radio
inputs across 34 source files. Surface-level classification was:

- Compact peer groups: document color mode, precision, working RGB, blend
  evaluation, gradient interpolation, marquee operation, and similarity mode.
- Visual peer group: website light/dark theme selection, with a visible active
  treatment and radio semantics.
- Segmented groups: short inspector choices, shared UI segmented controls,
  workspace/view selectors, and other controls where adjacent options are more
  scannable than stacked radios.
- Specialized native groups: geometry, color, curve, histogram, import,
  export, conflict, and other domain-specific controls retain their existing
  native or purpose-built markup.
- Menu radios, tabs, list selection, independent filters, tool actions, and
  multi-select checkboxes remain their respective semantics.

Four choice surfaces were explicitly repaired from toggle-like semantics:
document color/evaluation choices, marquee operation, website theme, and asset
similarity mode. No card treatment was introduced for an ordinary inspector
setting.

## Shared architecture

`packages/ui/src/components/Radio.tsx` exposes:

- `RadioGroup`: labelled fieldset/radiogroup, controlled or uncontrolled
  selection, stable generated group name, orientation, validation, and
  disabled propagation.
- `RadioGroupItem`: the small native item boundary responsible for the input,
  indicator, label, description, icon, metadata, required state, and disabled
  state.
- `RadioOption`: composable labelled item for custom groups.
- `RadioCard`: card composition over the same native radio semantics.
- `Radio`: minimal labelled native-radio wrapper.

IDs are generated with `useId` and option IDs are index-stable within a group;
labels and descriptions use separate explicit IDs, so descriptions contribute
to the accessible description rather than unexpectedly changing the accessible
name. Controlled groups remain authoritative when a callback does not rerender;
uncontrolled groups update locally. Required validation is applied to the first
enabled option so a disabled option cannot satisfy the form constraint.

The base uses native inputs and CSS only. It does not import Motion. Existing
motion or domain-specific selectors remain outside the base primitive.

## Visual and interaction decisions

The radio system reuses semantic surface, border, text, accent, feedback,
spacing, radius, duration, and focus-ring tokens. The selected dot remains
unmistakable in light, dark, and high-contrast themes. Descriptions and metadata
use muted text only where they carry supporting information; semantic colors are
reserved for validation or meaningful status. Card radios are reserved for
choices with enough explanatory or visual content to justify the extra surface.

Rows and cards activate through their associated native label. Keyboard behavior
is provided by native radio inputs for the shared group and by APG roving-focus
behavior in the specialized segmented controls. Disabled options are not
interactive, retain disabled semantics, and are skipped by the specialized
keyboard model. Responsive card grids collapse to one column in narrow
containers, and the group uses `min-inline-size: 0` so it does not widen a
resizable inspector or ScrollArea.

## Migrated and retained surfaces

Document color/evaluation and similarity choices now expose radios, with E2E
coverage for pointer and arrow-key changes. Marquee operation and website theme
choices expose radio semantics without changing persistence or defaults.

The UI retains `SegmentedControl`, `ViewModeSwitcher`, inspector segmented
controls, `MenuItemRadio`, and domain-specific native groups where their
navigation, listbox, menu, visual-preview, or domain interaction is the better
contract. `aria-pressed` remains for independent actions, tool activation,
filters, favorite/selection controls, and explicit preview commands; it is not
used as a substitute for peer-choice state in the migrated surfaces.

## Validation and visual review

- `packages/ui/src/components/Radio.test.tsx`: 13/13 passed, including group
  naming, controlled/uncontrolled state, descriptions, disabled/required
  behavior, and the extracted item composition.
- `pnpm run typecheck:e2e`: passed.
- `tests/e2e/inspector/blend-evaluation.spec.ts`: 1/1 Chromium test passed;
  the rendered screenshot was inspected.
- `tests/e2e/canvas/asset-similarity.spec.ts --grep "mode picker"`: 1/1
  Chromium test passed with pointer and ArrowRight interaction.
- Website theme switcher: 14/14 tests passed across the GitHub Pages and
  custom-domain builds, including pointer persistence and keyboard selection.
- The reviewed blend screenshot shows the selected radio state and supporting
  copy at the desktop inspector width. The reviewed soft-proof screenshot shows
  the surrounding compact inspector layout and confirms the shared switch does
  not overflow its row.

The table visual check was attempted twice but is a baseline/worktree failure:
one run hit a concurrent `Select` module rewrite and the retry remained on the
Home screen before the table helper could open its menu. No radio assertion
failed. The unrelated Settings Select test still reports its pre-existing SVG
option lookup failure.

## Exact implementation files and delivery

The radio-specific implementation and verification files are:

- `packages/ui/src/components/Radio.tsx`
- `packages/ui/src/components/Radio.test.tsx`
- `packages/ui/src/components/Radio.stories.tsx`
- `packages/ui/src/components/components.css`
- `packages/ui/src/components/index.ts`
- `packages/editor/src/components/Inspector/controls/SegmentedControl.tsx`
- `packages/editor/src/panels/IntelligencePanel.tsx`
- `apps/website/src/components/ThemeToggle.astro`
- `tests/e2e/inspector/blend-evaluation.spec.ts`
- `tests/e2e/canvas/asset-similarity.spec.ts`

The progressive commits are `e66d372df`, `312433709`, `c0af0a9bb`,
`752cd191f`, `e3a2f6e89`, `7e8f335d1`, `8907f50fc`, and `67785c64d`.

The local commit hook could not run its `madge` check because the executable is
not installed. Focused formatting, type, unit, E2E, website build, and browser
checks passed; the broader repository contains unrelated validation/release,
Select, layers, and workspace changes that were not staged or altered by this
audit.
