# Select system audit — 2026-08-31

## Scope and baseline

This audit covers the editor, home surface, desktop entry points, `@varve/ui`
primitives, and the Playwright/Vitest coverage that drives them. The working
tree also contained an unrelated validation/release-system change on branch
`validation-release-system`; that work was preserved and is not attributed to
this audit.

The initial repository scan found 156 `Select` instances in 63 production and
feature files, five native `<select>` elements, 36 additional custom
combobox/listbox surfaces, and the existing `Combobox`, `PresetPicker`, brush,
font, icon, and model-specific browsers. The initial `Select` primitive was
already the dominant compact single-value path, but did not provide grouped
options, helper text, rich option metadata, controlled/uncontrolled parity,
stale-value signaling, `NativeSelect`, or `MultiSelect`.

## Classification

| Classification | Count / finding | Decision |
| --- | ---: | --- |
| Compact single Select | 156 uses, mostly finite inspector/settings values | Retain the shared `Select`; migrate behavior through the primitive |
| Grouped Select | No existing shared data model | Add optional labelled groups; use only where categories improve scanning |
| Searchable Select | No production caller used the flag yet | Keep explicit and use for moderate textual lists |
| Combobox | Existing `Combobox` plus feature-local APG listboxes | Retain for editable text or feature-specific keyboard contracts |
| Multi-select | Existing list/tree selection, but no shared value picker | Add `MultiSelect`; do not convert canvas/layer selection |
| Native Select | Five native elements in feature code/tests | Preserve where native behavior is intentional; add a shared field wrapper |
| Radio/segmented | Existing shared `RadioGroup`/`SegmentedControl` | Keep for small peer-mode choices; recent adjacent migrations are correct |
| Visual browser | Preset, brush, font, icon, gradient, effect/model browsers | Keep specialized; previews and metadata do not belong in compact rows |
| Object/list navigation | Layers, selection sets, workspaces, backups, palettes | Keep owning list/tree/browser semantics |

Counts are inventory counts, not a claim that every control should have an
identical presentation. A `Select` occurrence in a test or an intentionally
specialized panel is recorded in the scan so duplicate semantics are visible.

## Findings and repairs

1. The shared select now has a real button trigger, stable button type, explicit
   controlled/uncontrolled handling, groups, descriptions, option icons/status
   metadata, disabled reasons, and a visible unavailable state for stale saved
   values.
2. Search is opt-in and uses pre-normalized labels for predictable filtering.
   The component does not pretend that a simple dropdown is a virtualized
   asset browser; the existing font/preset/brush/model surfaces remain the
   high-scale path.
3. A shared `MultiSelect` now handles selection arrays, search, selected values
   outside the current filter, disabled options, maximum selection limits, and
   compact summaries.
4. A shared `NativeSelect` now provides label/helper/error relationships while
   retaining platform-native popup behavior.
5. Popup geometry continues to use `FloatingPortal`; no feature-local z-index
   or fixed-position dropdown implementation was introduced.
6. Static descriptions are linked with `aria-describedby`; errors retain the
   existing alert contract. Disabled reasons are rendered as supporting text
   rather than relying on opacity alone.

## Migration decisions

No broad production migration was made solely to alter markup. Existing
inspector/settings/export callers already use the shared `Select`; changing
them all at once would create a large, low-signal diff and risk staged-form
behavior. The safe migration boundary is the primitive API plus focused
high-scale consumers when their option data justifies it.

The following remain deliberate exceptions:

- `FontSelector`, `PresetPicker`, `BrushBrowser`, `IconBrowser`, gradient
  browsers, and effect/model pickers are rich browsers with preview/search or
  feature-specific availability. They should not be flattened into `Select`.
- Layers, selection sets, workspaces, backups, and canvas selection are object
  navigation/list semantics, not value selects.
- A native `<select>` remains appropriate where the owning feature explicitly
  prefers platform behavior or is a test fixture for native behavior.
- Radio and segmented controls remain appropriate for two-to-four peer modes.

## Visual-validation matrix

The component gallery stories cover compact/default, placeholder, selected,
disabled, grouped, long labels, icons, semantic status, helper/error,
searchable, empty, multi-select, and dark-theme states. Browser validation
should inspect the actual rendered states rather than relying only on snapshot
diff thresholds:

| State | Review points |
| --- | --- |
| Closed compact trigger | 32/44px density, truncation, chevron reservation, focus ring |
| Open/grouped | portal placement, group hierarchy, selected visibility, separators |
| Search/empty | named input, loading/error distinction, no-result copy, active descendant |
| Disabled/invalid | readable disabled reason, tokenized danger state, helper alignment |
| Multi-select | count/chip summary, selected state under filtering, max-selection feedback |
| Narrow panel/dialog | no parent expansion, collision flip/shift, focus restoration |
| Light/dark/high contrast | semantic tokens and contrast, no feature-specific accent colors |
| Reduced motion | immediate open/close with unchanged keyboard semantics |

## Validation record

The repository-wide planner initially selected broad validation because the
working tree contains concurrent workspace, validation, and release changes.
The focused select checks completed as follows:

| Command / evidence | Result |
| --- | --- |
| `pnpm --filter @varve/ui typecheck` | Pass |
| `pnpm exec vitest run --maxWorkers=1 packages/ui/src/components/Select.test.tsx` | 20/20 pass |
| `pnpm exec vitest run --maxWorkers=1 packages/ui/src/components/MultiSelect.test.tsx packages/ui/src/components/NativeSelect.test.tsx` | 7/7 pass |
| `pnpm --filter @varve/editor typecheck` | Pass |
| `pnpm --filter @varve/ui exec storybook build --output-dir /tmp/varve-ui-storybook-select-2` | Pass; production gallery built successfully (Vite emitted only the existing large SolidIcon chunk warning) |
| `/tmp/varve-select-grouped-open-2.png` and `/tmp/varve-multiselect-open-2.png` | Directly inspected in Chromium; grouped/status/description rendering, focus ring, portal width, and internal list scrolling were acceptable |
| `/tmp/varve-select-narrow-2.png`, `/tmp/varve-select-stale-2.png`, `/tmp/varve-select-loading-2.png` | Directly inspected in Chromium; long-label truncation, stale-value signaling, loading state, and reduced-motion narrow-panel geometry were acceptable |
| `/tmp/varve-select-dark-3.png` and `/tmp/varve-select-high-contrast-2.png` | Directly inspected in Chromium; portaled menus inherited dark/high-contrast root themes and maintained readable selected/disabled states |
| `VARVE_E2E_PORT=1422 pnpm exec playwright test tests/e2e/settings/settings-dialog.spec.ts --project=chromium --reporter=list` | 3/3 pass |
| `test-results/run-213154-1422/.../select-open-light.png` | Directly inspected; width, hierarchy, contrast, and placement acceptable |
| `VARVE_E2E_PORT=1423 pnpm exec playwright test tests/e2e/canvas/marquee-selection.spec.ts --project=chromium --reporter=list` | 1/2 pass; one unrelated baseline mismatch in the overlapping selection-system test (`replace selection` button no longer exists) |

The first Storybook capture exposed a missing component-style import and showed
browser-default controls. The preview import was repaired, the gallery rebuilt,
and the open grouped and searchable states were recaptured and inspected. The
Settings capture was also first used to find and repair the menu-width defect,
then recaptured and inspected after the fix. Dark-theme coverage is included in
the Settings workflow; the high-contrast desktop GUI matrix and WebKitGTK
native-window matrix remain separate follow-up evidence lanes. Full repository
certification was not run because the planner's escalation was caused by the
concurrent validation/release infrastructure change, not by this select slice.
