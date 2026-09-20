# Radio-group review — 2026-09-20

Scope: every mutually-exclusive choice surface in the repository — the 56
`SegmentedControl` usages, the `RadioGroup`/native-radio family (43 native
inputs across dialogs), the 25 hand-rolled `role="radio"` / `type="radio"`
groups, and the marketing site's theme switcher.

Prior art: `radio-group-system-audit-2026-08-31.md` (classification),
`radio-group-canonicalization-2026-09-19.md` (single implementation + hit
area), `corner-radius-system-audit-2026-08-31.md` (radius ownership). This
pass re-checked those decisions against the rendered product and against
external guidance, fixed the geometry regression they left behind, and closed
the remaining role/keyboard/label defects.

## Findings

| ID | Surface | Evidence | Class | Decision |
|----|---------|----------|-------|----------|
| RG-10 | Segmented geometry | Measured in Chromium: track `border-radius: 8px`, every `.varve-segmented__btn` `0px`; selected "Top" rendered as a square chip inside a rounded track (user-reported screenshot) | P0 visual defect from two radius owners disagreeing (`radius-system.css` flattened members; `components.css` had its own values) | FIX: derived inset radius in `radius-system.css`, duplicate declarations removed |
| RG-11 | Pill variant geometry | Home view switcher measured track `8px`, thumb `9999px` — capsule inside rounded rectangle | P0 visual defect (same cause; `--pill` track rule lost to load order) | FIX: pill radii for both levels in the geometry owner |
| RG-12 | Narrow-rail truncation | At a 240px inspector rail, "Linear RGB" (60px) rendered in a 56px segment with `overflow:hidden` and no working ellipsis: hard clip, no indication | P1 readability defect; "clipped labels" is a top segmented-control complaint in the research | FIX: content-driven auto-fit (`minmax(fit-content, 1fr)`) + label ellipsis + tooltip; the fixed 2-column container override removed |
| RG-13 | Upscale dialog | `.varve-segmented` used `overflow-x: auto`, producing a horizontal scroll strip for quality/scale options | P1 (hidden options at the inline end) | FIX: `flex-wrap: wrap` |
| RG-14 | `AlignDistributeBar` alignment reference | `role="radiogroup"` contained three `aria-pressed` buttons; no radio children | P1 ARIA ownership violation (same class as the workspace-dock fix) | FIX: labelled `role="group"` |
| RG-15 | `CropOverlay` aspect + guides | `role="radio"` buttons, every option a Tab stop, no arrow keys | P1 APG gap in a canvas overlay | FIX: shared local `CropRadioGroup` helper (roving tabindex, arrows, Home/End, focus follows selection) |
| RG-16 | `ImportPreview` options | Two radios with `defaultChecked`/no state; `importMode` unused anywhere; no flatten mode in `@varve/import` | P1 "control that lies" — a visible choice with no effect | REMOVE the block, its CSS, and its test |
| RG-17 | `ArchiveDialog` type radios | Emoji HTML entities (`&#128194;`, `&#9881;`) as option icons | Hard-rule violation (zero emoji) | FIX: Lucide `FolderArchive` / `Settings` |
| RG-18 | `LayoutSection` align/justify | Six text segments with cryptic abbreviations ("Ctr", "Spc", "Ard", "Evn") — 6 text options is above the 2–5 guidance | P1 comprehension + limit violation | FIX: icon-only segments (6 allowed), full accessible names and tooltips |
| RG-19 | Native-radio dialog groups (archive, batch rename/remove, conflict resolver, restore browser, auto arrange, thumbnail pickers, code panel, intelligence, settings, color conversion, content-aware fill, output resolution, crash dialogs, privacy diagnostics, text discovery, histogram, palette) | Native `<input type="radio">` with group labels; browser provides arrow navigation | Correct semantics for form-like choices | KEEP (documented) |
| RG-20 | `ToolOptionsPopover`, `WorkspaceTabs`, `BrushBrowser`, `ColorSpaceSelector`, `ColorFields`, website `ThemeToggle` | Purpose-built chrome; APG model already present or completed by the 2026-09-19 pass | Distinct contexts with their own visuals | KEEP, contract pinned in `docs/design/radio-group-system.md` |
| RG-21 | `TextDiscoveryPanel`, `IntelligencePanel` | Native radios in named groups; Intelligence adds a redundant roving handler but keeps the native name group | Acceptable; native keyboard model present | KEEP (no change) |
| RG-22 | Modal crop key capture | `inputPipeline`'s window-capture `handleModalCropKey` consumed Arrow keys for `CropTool` before any widget saw them, so the crop toolbar's radiogroups could not be operated by keyboard (`stopPropagation` at window) | P1 keyboard defect found by the new E2E spec | FIX: `[role="radiogroup"]` added to the shortcut-ignore selector, alongside combobox/slider/listbox |
| RG-23 | Inspector icon groups stacked | A fixed 6rem text minimum made icon-only groups (Layout align/justify) render one option per row | P2 density regression | FIX: content-driven tracks; the icon-specific minimum is no longer needed |

## What changed

1. `packages/ui/src/components/radius-system.css` — segments derive
   `max(0px, calc(var(--radius-control) - var(--space-05)))`; pill variant
   rounds both levels. `components.css` no longer declares segmented radii.
2. `packages/editor/src/components/Inspector/inspector.css` — field segments
   use `repeat(auto-fit, minmax(min(6rem, 100%), 1fr))`, labels ellipsize
   with their tooltip, and the forced 2-column container rule is gone.
3. `packages/editor/src/components/Upscale/UpscaleDialog.css` — wrap.
4. `AlignDistributeBar.tsx` — `role="group"`.
5. `CropOverlay.tsx` — one APG radiogroup helper for both pickers.
6. `ImportPreview.tsx` / `.css` / `.test.tsx` — inert options removed.
7. `ArchiveDialog.tsx` — icons instead of emoji entities.
8. `LayoutSection.tsx` — icon pickers with full names; unit + E2E selectors
   updated.
9. `tests/unit/radio-group-system.test.ts` — geometry/ownership guard.
10. `packages/editor/src/shortcuts/ShortcutManager.ts` — radiogroups added to
    the widget-ownership selector so global/modal key captures (including the
    modal crop handler) stop stealing Arrow keys from them.
11. `docs/design/radio-group-system.md` — canonical contract and registry;
    `corner-radius-system.md` clarifies connected vs inset groups;
    `component-status.md` links the contract; website settings docs describe
    the limits.
12. `tests/e2e/inspector/radio-group-visual.spec.ts` — permanent rendered
    geometry, keyboard, viewport-matrix, and touch-target coverage, with
    evidence screenshots under
    `docs/screenshots/2026-09-20-radio-group-review/`.
13. Responsive pass: inspector field rows wrap by content
    (`flex-wrap: wrap`, `flex: 1 1 auto`, `min-inline-size: 0`), and coarse
    pointers raise every segment to the shared 44px touch minimum.

## Rendered evidence

Measured in Chromium (Playwright, lease-wrapped, isolated port):

- Before: track `8px` / segment `0px`; pill track `8px` / thumb `9999px`;
  construction-plane group 2×2 with 82.5px columns at the default rail.
- After: track `8px` / segment `6.448px`; pill track and thumb `9999px`;
  construction plane on one row at the reference rail (four columns), a
  content-driven wrap below that, labels ellipsized with tooltips when a
  single label exceeds the track, and no group overflow.
- Viewport matrix (1440×900, 1120×700, 900×700, 640×800, 375×667, inspector
  drawer opened below 900px): no group overflows its track, no square
  segments, no clipped label without a tooltip, and no page-level horizontal
  scrolling.
- Coarse pointer (`hasTouch`): every segment is at least 44×44 CSS px.
- Screenshots: `docs/screenshots/2026-09-20-radio-group-review/`
  (construction plane dark/light/narrow, view-mode pill, layout icon
  pickers, crop toolbar, forced colors, phone inspector drawer, touch
  targets). Raw diagnostic captures remain in the gitignored
  `reports/radio-group-review/`.

## Research basis

- WAI-ARIA APG Radio Group; Apple HIG Segmented Controls (2–7 wide, ≤5
  iPhone, consistent sizes, do not mix text and images); Material 3
  segmented buttons; Primer segmented control (2–5 text, ≤6 icon-only,
  immediate apply).
- Documented misuse patterns: 6+ text segments, cryptic abbreviations,
  clipped/scrolled overflow, radiogroup containing non-radios, icon-only
  without accessible names, selection conveyed by color alone.
- Sources collected in the session research notes; contract rules distilled
  into `docs/design/radio-group-system.md`.

## Validation

- `tests/unit/radio-group-system.test.ts` 5/5; `SegmentedControl.test.tsx`
  10/10; `LayoutSection.test.tsx` + `ImportPreview.test.tsx` 12/12;
  `ShortcutManager.test.ts` 28/28.
- `pnpm --filter @varve/editor typecheck` — no errors in changed files
  (pre-existing failures elsewhere in the shared worktree); `typecheck:e2e`
  clean after the committed `callout.ts` fallback fix.
- Playwright (lease, `VARVE_E2E_PORT=4213`):
  `tests/e2e/inspector/radio-group-visual.spec.ts` 7/7 — segment radii and
  content-driven wrap, pill concentricity, icon pickers + arrow keys,
  radiogroup ownership across the app, crop radiogroup keyboard and pointer
  activation, forced-colors contrast, the 1440→375 viewport matrix, and the
  coarse-pointer 44px touch minimum. The crop case initially failed and
  exposed RG-22; it passes after the fix.
- `tests/e2e/canvas/autolayout-visual.spec.ts` align/justify 5/5 after the
  icon-picker migration (the spec's option names were updated with it).
- Website: `astro check` on the edited docs page passes (the website E2E
  tsconfig has a pre-existing unrelated error in an untouched spec file).
- `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` — clean.
- `pnpm verify:plan` escalated to the full suite because the shared worktree
  carries workspace/toolchain changes from concurrent sessions; the
  escalation is not attributable to this pass.
