# Toolbar surface review — 2026-09-17

Scope: the editor command surfaces and their contained dialogs — floating tool
palette, ToolOptionsPopover (marquee / magic-wand / text / retouch / liquify /
crop), context control bar, floating text bar, selection quick bar, status
bar, table-from-data dialog. Owner session: `docs/agents/toolbar-review-2026-09-17-ownership.md`.
Base HEAD `65da81887`.

Builds on the 2026-09-15 review pair (`docs/audits/toolbar-review-2026-09-15.md`,
session B commits `8bae3f14e…ac804fdcb`); this pass re-verified those results in
the running app and audited what they deferred. The density preference landed
2026-09-17 (`ae6563fd1`..`a06a0c02a`) after that review, so the toolbar×density
interaction is new evidence here.

## Method

Driven Playwright session against a dedicated dev server (port 4142, isolated
from the shared 1420 server). 33 captures of real interactions — palette,
context-bar states (none/shape/text/multi/frame/image), flyouts, every tool
options panel, overflow More menu, drawing controls row, floating text bar with
its More/colour popovers, table-from-data dialog, dark theme, compact density —
in `docs/screenshots/2026-09-17-toolbar-review/`. Every capture inspected
directly; 3x crops for the ambiguous regions. A DOM geometry probe measured the
command surfaces in both densities (`density-probe` results inline below).

The later 2026-09-20 recapture is preserved separately in
`docs/screenshots/2026-09-20-toolbar-recapture/` so these dated review images
continue to show the original 2026-09-17 evidence.

Not a defect (checked and cleared): crop keyboard activation failed only inside
the capture because focus sat in the liquify popover (16-toolbar-crop.png);
canvas `overflow` interplay verified by the 09-15 suite; text-bar session
persistence (24–26) matches its contract.

## Verified defects

| # | Severity | Evidence | Defect | Response |
|---|---|---|---|---|
| D1 | High | geometry probe: palette/CCB 47.6px, buttons 32px, status 26.8px — **identical in comfortable and compact** | Compact Pro never reaches the command surfaces; the density contract defines only `--density-rows-*` (rows 34→28px, icon 16→14). The setting's most visible surfaces do not change. | Add `--density-control-size` (32/28px, cozy 36) to the density blocks; wire palette, context bar, text bar, quick bar to it. Touch promotion stays 44px and keeps priority. |
| D2 | A11y | `.floating-toolbar__chevron{width:14px}`; adjacent buttons (02) | Flyout chevron is a 14×32 target; WCAG 2.2 SC 2.5.8 needs 24×24 or the spacing exception, which fails for an inline control | Widen the hit area to 24px (glyph stays 14px, padding carries the width) |
| D3 | Labeling | literal text `AB` at StatusBar.tsx:261 (visible in every capture) | The artboard-ruler toggle renders the letters "AB" — no icon, not guessable | Replace with the `Ruler` icon (12px, same as its twin toggles) |
| D4 | Consistency | 12-tool-options-magicwand.png, Mode row | Magic-wand Mode segmented uses a fixed 4-column grid with 2 options — an empty sunken half-row reads as broken | Segmented rows become flex equal-width (works for 2 and 4 options) |
| D5 | Tokens | 12-tool-options-magicwand.png sliders are browser-default blue | Tolerance/Feather sliders skip `accent-color`; every other slider (drawing, liquify) uses the teal token | Add the accent token to the popover's range inputs |
| D6 | Keyboard | source: MagicWandOptions uses `aria-pressed` buttons with no roving model; AreaSelectionOptions has a full radiogroup | The two visually identical "Operation" segmented controls behave differently by keyboard (arrows work in one, not the other) | Extract one `SegmentedRadioGroup` (radiogroup, roving tabindex, arrows) used by both |
| D7 | Truth | source: flyout `menuItems` build without `disabled`; overflow menu does disable | If the boolean flyout menu is open while the selection stops qualifying, its items render enabled and silently no-op | Mirror the overflow rule: boolean members disable when the precondition fails |
| D8 | Double label | 15-tool-options-liquify.png "Size / SIZE (PX) / 160" | Liquify Size row labels itself twice (outer span + NumberField's own label) | Drop the outer label; the NumberField row is the row |
| D9 | Missing label | 14/28-tool-options-clonestamp.png | The retouch "Sampling scope" select is the only unlabeled row in its panel (its label is accessible-only) | Give it the same visible label grammar as the sibling rows |
| D10 | Clipping | 06-tool-options-text.png "Mixed (stan ⌄" | Text options' native select truncates option labels at the fixed 7rem field width | Selects in the popover size to content within a bounded max |
| D11 | Hidden values | 19-drawing-toolbar.png | Brush Size/Opacity sliders expose values only to AT (`aria-valuetext`); label "OP" is an abbreviation | Visible numeric readout beside each slider; spell "Opacity" |
| D12 | Truth | ContextControlBar EmptySection hardcodes `<kbd>F</kbd>`/`R`/`T`/`P` + "(F)" tooltips | The empty-selection pills display hard-coded shortcuts; a remapped binding lies to the user (architecture doc forbids hard-coding) | Resolve through `getEffectiveBinding` like the status bar does |
| D13 | Polish/geometry | 02-context-shape.png crop | (a) The CCB swatch override shrinks the shared `insp-swatch` from 24px to 20px — below the 24px target floor; (b) the add-stroke button stacks three dash motifs (dashed border + dashed fill gradient + dashed icon) and reads as a broken image | Keep the 24px base swatch; drop the repeating-gradient, keep one dashed border |

Recorded, not changed here: the multi-select group/align/boolean ops are
offered by three surfaces at once (context bar Multi section, selection quick
bar, boolean flyout). All route through the same commands so they cannot
disagree; consolidation is an information-architecture decision beyond this
review (see toolbar-system.md "quick actions" rule). The status-bar tip chip's
"You've used Select tool 6 times this week. Try V…" copy is owned by the
shortcut-tips system.

## Density × toolbar measurement (the D1 probe)

| Surface | comfortable | compact |
|---|---|---|
| Floating palette height | 47.6px | 47.6px |
| Context bar height | 47.6px | 47.6px |
| Status row height | 26.8px | 26.8px |
| Palette button | 32×32 | 32×32 |
| Layer row (separate check) | 37.8px | 28px min (row contract works) |

Status bar is deliberately excluded from density (its 24px control floor
already pins the 26px row); the palette, context bar, text bar, and selection
quick bar become density-aware.

## Resolution (landed with this review)

Each defect above was fixed and re-verified in the running app; the fixes and
their regression coverage are:

| # | Fix | Where | Regression |
|---|---|---|---|
| D1 | `--density-control-size` in the density blocks; palette/context bar/text bar/quick bar rows and inner primitives consume it (comfortable byte-identical) | `packages/ui/src/components/components.css`, four toolbar CSS files | `toolbar-surface-review.spec.ts` D1/D2 test (28px compact, palette↔CCB parity) |
| D2 | Chevron hit width 14px → 24px (glyph unchanged) | `FloatingToolbar.css` | same spec, chevron ≥ 24px |
| D3 | Literal "AB" → `Ruler` icon | `StatusBar.tsx` | toolbar-followup 24px-target suite |
| D4 | Segmented rows flex equal-width (2- and 4-option groups fill) | `ToolOptionsPopover.css` | D4/D5/D6 test |
| D5 | `accent-color` token on popover range inputs | `ToolOptionsPopover.css` | same |
| D6 | One `SegmentedRadioGroup` (radiogroup + roving + arrows) for marquee and magic wand | `ToolOptionsPopover.tsx` | same, ArrowRight moves check + focus |
| D7 | `getFlyoutMenuItems` applies the overflow menu's boolean precondition | `FloatingToolbar.tsx` | unit tests in `FloatingToolbar.test.tsx` |
| D8 | Liquify size row labels once (NumberField owns it) | `LiquifyToolOptions.tsx` | D8/D9 test |
| D9 | Retouch sampling scope carries a visible label row | `RetouchToolOptions.tsx` | same |
| D10 | Native selects size to content (bounded); longest option labels tightened where still over the row's space | `ToolOptionsPopover.tsx/.css` | D10 test (canvas-measured text fit) |
| D11 | Drawing sliders show values; "Op" → "Opacity" | `FloatingToolbar.tsx/.css` | D11/D12 test |
| D12 | Empty-selection kbd badges resolve `getEffectiveBinding` | `ContextControlBar.tsx` | same (pressing the badge activates Rect) |
| D13 | CCB swatch keeps the 24px primitive target; add-stroke is one dash motif + plus | `ContextControlBar.css`, `ShapeQuickControls.tsx` | forced-colors target suite |

After-evidence in the same screenshot directory (`32-after-…` … `36-after-…`).
Marquee number fields also moved to the canonical `NumberField` (scrub,
wheel, draft/restore, aria-invalid) — the old inline `numberValue` mapped
invalid input to `0`, violating the numeric-field contract.

## What was deliberately not redesigned

- Palette placement, overflow retention, keyboard roving, status-bar tiers,
  text-bar session persistence: verified working (01/04/20/21/24/25), the
  09-15 contract holds — no churn without a demonstrated problem.
- Duplicate access across context bar / quick bar / flyouts (D15 note above).
- The 9px `.ccb__kbd` micro-badges stay (supplementary metadata beside a
  labelled pill; the pill text carries the essential information).
- The status bar is density-invariant by design (24px control floor pins the
  row); density reaches the four floating/docked command surfaces instead.
