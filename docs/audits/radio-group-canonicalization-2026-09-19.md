# Radio-group canonicalization pass

Date: 2026-09-19

Status: implemented; browser verification partially blocked by concurrent
unrelated work (see "Remaining risks").

Scope: every mutually-exclusive choice surface in the repository — the
`SegmentedControl` family, `ViewModeSwitcher`, hand-rolled radiogroup clones,
and the shared `RadioGroup`/`Radio` family.

Prior art: [radio-group-system-audit-2026-08-31](radio-group-system-audit-2026-08-31.md)
established the native `RadioGroup` base and deliberately left the editor
`SegmentedControl` in place. This pass re-examined that KEEP against the code
as it stands: the two segmented implementations had diverged (the editor one
gained `disabled`/`disabledReason`/`hideLabel`/`tooltip`/`className`, the UI
one had `solid` icons and a different track style), three hand-rolled clones
had lost their selected-state styling, and a documented accessibility defect
in the pill variant was still open. The KEEP is therefore superseded.

## Findings

| ID | Surface | Evidence | Class of problem | Decision |
|----|---------|----------|------------------|----------|
| RG-01 | Two `SegmentedControl` implementations | `packages/ui/src/components/SegmentedControl.tsx` (input-based) vs `packages/editor/src/components/Inspector/controls/SegmentedControl.tsx` (button-based); 15 inspector consumers vs 2 dialog/ColorPicker consumers | Accidental redundancy: same job, divergent DOM, props, keyboard handling, and CSS (`varve-segmented*` vs `insp-segmented*`) | MERGE into `@varve/ui` |
| RG-02 | `ViewModeSwitcher` third copy of the roving-tabindex logic | `packages/ui/src/components/ViewModeSwitcher.tsx` `move`/`onKeyDown` were byte-identical to RG-01's; only the CSS differed | Accidental redundancy | CANONICALIZE as `SegmentedControl variant="pill"` adapter |
| RG-03 | Dead `--active` modifiers with no CSS rule | `SelectiveColorGrid.tsx`, `CurveEditor.tsx`, `ColorizeSection.tsx` set `insp-segmented__btn--active` / `insp-radio-btn--active`; no stylesheet ever defined them, and the checked input was never styled because the state selector targeted `[aria-checked]` on a button | P0 visual defect: the selected option was indistinguishable | FIX by migrating to the canonical control |
| RG-04 | Pill accessible name removed below 640px | `components.css` hid the only label span with `display:none`; platform UX audit U5 (2026-08-04) documented this and remained open | P1 accessibility defect (WCAG 4.1.2 / 1.3.1) | FIX: pill inputs carry `aria-label` |
| RG-05 | Duplicate segmented CSS | `.insp-segmented*` (inspector.css) duplicated `.varve-segmented*` (components.css); `.varve-view-mode-switcher*` duplicated the pill styling; `.spec-unit-selector__btn*` duplicated the base | Accidental duplication of design implementation | MERGE into `packages/ui/src/components/components.css` |
| RG-06 | `UnitSelector` radiogroup had no arrow-key model | Buttons with `role="radio"` and no roving tabindex; every option a Tab stop | APG contract gap | FIX by migrating to the canonical control |
| RG-07 | Native-radio dialog groups (archive, batch remove, conflict resolver, import preview, restore browser, batch rename, auto arrange, thumbnail pickers, code panel, intelligence, settings, color conversion, content-aware fill, output resolution, crash dialogs, privacy diagnostics) | 43 native radio inputs across 30+ files | Not redundancy — native radios are the correct semantics; the shared `RadioGroup` is a composition layer they do not need | KEEP (documented); optional follow-up |
| RG-08 | `MaskSection` fill-rule row | Tooltip-wrapped toggle buttons with `aria-pressed`, now emitting canonical `.varve-segmented*` classes | Distinct tooltip-rich presentation | KEEP, styling unified |
| RG-09 | Workspace tabs, tool-option popover, crop overlay, brush filter chips, color-picker format selectors | Purpose-built segmented/tab visuals with their own CSS and, in some cases, custom keyboard models | Distinct interaction contexts (tab strip, floating popover, canvas overlay, filter chips) | KEEP for this pass; follow-up candidates for the same hook |

## Canonical architecture

`@varve/ui` now owns the single segmented radiogroup:

- `SegmentedControl` — APG radiogroup over clipped native inputs (selection is
  `checked`; no `aria-checked` override), roving tabindex skipping disabled
  options, Arrow/Home/End movement, per-option `icon`/`solid`/`hideLabel`/
  `tooltip`/`disabled`/`disabledReason`, group-level `disabled`, `className`,
  and `variant="pill"`.
- `ViewModeSwitcher` — thin adapter over `SegmentedControl variant="pill"`;
  keeps its public props and its `varve-segmented--pill` DOM.
- `RadioGroup` / `RadioOption` / `Radio` — unchanged native-radio composition
  layer for form-like and card choices (see the 2026-08-31 audit).

Class names owned by the canonical CSS: `.varve-segmented`,
`.varve-segmented--pill`, `.varve-segmented--distribute`,
`.varve-segmented__btn`, `.varve-segmented__label`. The `[aria-checked]` /
`[aria-pressed]` state selectors remain so the tooltip-rich `MaskSection`
toggle row can share the track styling without re-implementing it.

## Implementation files

- `packages/ui/src/components/SegmentedControl.tsx` (canonical union)
- `packages/ui/src/components/SegmentedControl.test.tsx` (new; 10 cases)
- `packages/ui/src/components/ViewModeSwitcher.tsx` (adapter)
- `packages/ui/src/components/components.css` (single style owner)
- Deleted: `packages/editor/src/components/Inspector/controls/SegmentedControl.tsx`
- Migrated consumers: `TableSection`, `TypographySection`, `TableCellsSection`,
  `LayoutSection`, `StrokeSection`, `PathTextSection`, `ImageCropSection`,
  `DocumentPanel`, `AssetExportControls`, `SelectiveColorGrid`, `CurveEditor`,
  `ColorizeSection`, `UnitSelector`
- CSS: `inspector.css`, `TypographySection.css`, `SpecPanel.css`, `SpecPanel`
  unit-selector rules
- Tests: `controls.test.tsx` (duplicate block removed), `TypographySection.test.tsx`,
  `AssetExportControls.test.tsx`, `PropertiesPanel.test.tsx`,
  `ColorizeSection.test.tsx`, `UnitSelector.test.tsx`
- E2E assertions moved from `aria-checked` to native `toBeChecked()`:
  `tests/e2e/inspector/blend-evaluation.spec.ts`,
  `tests/e2e/inspector/export-tab.spec.ts`

## Compatibility

- No persisted identifier, storage key, document field, shortcut, or route
  changed. All edits are internal component/class wiring.
- The deleted editor import path was not exported from a package entry point;
  the only consumers were the migrated files (verified by search).
- `data-disabled` and the `varve-*` class contract are unchanged for external
  CSS; the removed `insp-*` classes were inspector-internal and are replaced in
  the same commit.
- `spec-unit-selector` is retained as the stable class hook for tests and
  consumers even though its modifier rules are gone.

## Regression found and fixed during browser verification

The first lease-wrapped Chromium run (13 tests) passed 11, with one genuine
regression in `tests/e2e/inspector/blend-evaluation.spec.ts`: Playwright could
not click the canonical radio. The clipped (`.varve-visually-hidden`) input
was not hit-testable, so the visible `.varve-segmented__label` span intercepted
the pointer and the click timed out.

Fix: the canonical control now renders `.varve-segmented__input`, a
transparent input covering its label (`position:absolute; inset:0; opacity:0`).
The whole segment is one hit target, the input stays in the accessibility tree,
and pointer automation can click the radio directly. This is also the better
pointer target for users and keeps the `:has(input:focus-visible)` focus ring.
Unit tests and the spacing audit were re-run after the change (10/10, clean).

The other failure in that run (`typography-insights-review` "shows Spacing once
two layers are selected") was a canvas `boundingBox()` timeout during document
seeding and passed on retry; it is not related to the radio controls.

## Validation

See the Agent Validation Report in the session response for exact commands and
results. Summary:

- `pnpm --filter @varve/ui typecheck` — passed.
- Targeted Vitest: canonical control 10/10; migrated inspector surfaces
  81/81 + 70/70 + 16/16; spec-panel surfaces 31/31; ownership/registry 79/79.
- `pnpm typecheck:e2e` — passed.
- `pnpm audit:emoji`, `pnpm audit:docs`, `pnpm audit:spacing`,
  `pnpm audit:inspector-css`, `pnpm audit:tokens` — clean.
- `pnpm verify:plan` escalated to Tier 5 because the working tree contains 350
  changed files from concurrent work, including workspace/toolchain surfaces;
  the escalation is not attributable to this pass.
- Playwright run 1 (lease, isolated `VARVE_E2E_PORT=4199`):
  `home/search-sort-filter` 5/5 (view-mode adapter + label clicks),
  `typography-insights-review` 5/6 + 1 flaky-retry-pass, `blend-evaluation`
  failed on the click-interception regression above.
- Playwright run 2 after the hit-area fix:
  `blend-evaluation` passed (16.3s), `export-tab` "quick export PNG 2x" and
  "custom scale rejects" passed (direct radio clicks); a second invocation
  including `typography-layout` failed before touching a radio (`Font family`
  combobox detached) — the attached screenshot shows the app's startup screen,
  i.e. a Vite HMR reload from a concurrent session editing source during the
  run. The isolated re-run then **passed** (run 3, 1/1, 32.8s); its
  light-expanded and high-contrast-expanded screenshots were inspected
  directly — four icon-only alignment segments on one row, active segment
  filled (teal in light, yellow/black in high contrast), others transparent.
- Post-fix unit re-check: `TypographySection` + `paintRows` + `controls`
  35/35.
- During verification a concurrent session introduced and then fixed a
  duplicate `const profile` in `packages/scene/src/presetToDocument.ts`; it
  temporarily blocked Vitest transforms and is not related to this pass.

## Addendum — 2026-09-20 styling review

A follow-up review of the canonical control against the rendered product found
two gaps; both are fixed alongside the canonical UI styling.

1. **The default variant lost its hover affordance.** The pre-migration button
   filled with `--color-surface-sunken` on hover; after the restyle the track
   itself is sunken, so that fill would have been invisible and the rule was
   replaced with a text-colour change only. An unselected segment now lifts on
   `--color-surface-raised`, matching the pill variant. Verified by computed
   style in both themes (hover background `oklch(0.22 0.006 260)` in dark,
   `oklch(0.99 0.006 260)` in light).

2. **Forced colors made the selection invisible.** Every author background is
   force-adjusted in Windows Contrast Themes, so the accent-filled selected
   segment computed the same colour as its track (measured: selected and track
   both `rgb(0, 0, 0)` in dark and `rgb(255, 255, 255)` in light) — the same
   "selected option indistinguishable" defect this pass removed for normal
   themes. The selected segment now uses the system-guaranteed
   `Highlight`/`HighlightText` pair with `forced-color-adjust: none`, the track
   takes a `CanvasText` border, a disabled selection takes `GrayText`, and the
   focus outline is explicit `Highlight`. Verified with emulated forced colors
   and a screenshot.

The `RadioGroup`/`Radio` family was reviewed too and needs no change: its
custom dot keeps a distinguishable checked state under forced colors (filled
`::after` versus hollow ring, verified in the New design dialog).

Normal-theme contrast was measured from resolved sRGB values: unselected labels
are 14.8:1 on the dark track and 11.3:1 on the light track, and the selected
chip carries the accent with `--color-text-on-accent`.

Editor-side consumer migration (the old
`Inspector/controls/SegmentedControl.tsx` deletion and the class swaps in its
consumers) is not part of this commit; it remains uncommitted in the shared
working tree.
