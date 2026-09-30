# Bottom bar review — redundancy, single ownership, and verification (2026-09-29)

Scope: the editor's **bottom bar stack** — `SelectionInfoBar`
(`grid-area: selinfo`) and `StatusBar` (`grid-area: status`), the components
they render, the workspace section model that configures them, and the
`SelectionInfoBar`/status-bar split itself. Three command surfaces share this
strip of screen real estate, so "improve the design" here means deciding who
owns each fact, not adding more.

This is not an audit-only report: every finding below was reproduced, fixed,
and re-verified. Remaining work is listed honestly at the end.

## Method

1. Repository safety: read `AGENTS.md`, inspected `git status` (a large
   in-flight tree from concurrent sessions), left all unrelated work untouched,
   and committed only this review's paths.
2. Research gate: external failure evidence gathered before designing anything
   (see "External failure evidence" below).
3. Runtime diagnosis: rendered the real editor through Playwright, dumped the
   DOM, computed styles and bounding boxes for every control in both strips at
   six widths, and compared the *declared* workspace section configuration with
   what actually rendered.
4. Fix → component tests → browser regression specs → visual re-capture.

## What the bottom bar renders (before)

Read top to bottom, left to right:

| Strip | Contents |
|---|---|
| `SelectionInfoBar` | page name · layer count, or node icon + name + type + `W x H` + `X: Y` + rotation + clickable ancestor breadcrumbs, or "N selected" + type list + aggregate `W x H` |
| `StatusBar` | tool name · preflight badge · **debt badge** · **audit badge** · renderer diagnostic · page info · colour mode · image info · cursor X/Y · **layout score** · save state · view rotation ° · shortcut tip · units select · pixel grid toggle · snap toggle · snap spacing field · ruler-origin toggle · baseline grid toggle · reset rotation · clear guides · zoom −/value/%/+ · Fit page / Fit all / Fit sel · **selection name or N selected/layers** · AI status |

## Findings

### P0 — Three badges reported the same fact, three times, from three scans

**Evidence.** `AuditBadge` renders `runQuickStatus` counts, `DebtBadge` renders
`runDebtScan` totals, and `LayoutScoreIndicator` renders
`computeLayoutScore().score` — all three sit adjacent in the same row, two of
them draw the *same* `TriangleAlert` icon with a bare count, and all three open
the *same* inspector tab (`audit`) with a different sub-tab. `AuditBadge`'s own
docstring already claims ownership: *"This replaces the separate DebtBadge and
LayoutScoreIndicator with a single workspace-aware badge."* The replacement was
never completed — the other two were never removed.

**Cost.** Beyond the visual redundancy: each of the three re-scans the whole
document on every edit, on three independent schedules (`requestIdleCallback`
timeouts of 200ms, 500ms, and a 300ms settle timer). Three counts, three
icons, three scans, one question ("is this document healthy?").

**Root cause.** Each badge was added by a different session, each guarded its
own section id, and nothing owned the *aggregate* — so "add a badge" was always
locally cheaper than "extend the existing badge". The customize dialog listing
`debt` and `layoutScore` as separate sections made the duplication read as
intentional configuration.

**Fix.** One `DocumentHealthBadge` (section id `documentHealth`) owns the count,
the severity colour, and the click-through to the Audit tab, where the audit,
debt, and layout sub-views already live. `AuditBadge`, `DebtBadge`, and
`LayoutScoreIndicator` are deleted; `debt` and `layoutScore` are retired as
section ids, and a persisted preference that hid *both* folds into the new id so
the user's choice survives.

### P0 — The status bar duplicated `SelectionInfoBar` with a *different* answer

**Evidence.** With one node selected, `SelectionInfoBar` renders
`Hero Card — Rectangle — 320 x 140 — X: 40 Y: 80` and the status bar renders
`Hero Card`. With nothing selected, `SelectionInfoBar` renders
`Cover — 42 layers` (recursive count over `activePageNodes`) while the status
bar renders `38` + `layers` from `rootNodes().length` (top-level children only).
Two strips 28px apart, disagreeing about how many layers the document has.

**Root cause.** `SelectionInfoBar` was written as an *addition* ("comprehensive
selection feedback strip", research basis: "Figma selection info bar"), and the
pre-existing `selectionInfo` status section was left in place. Neither is
wrong; only one can be authoritative.

**Fix.** `SelectionInfoBar` is the single owner of selection identity, geometry,
and counts. The `selectionInfo` section id, its label, its six workspace
declarations, and its renderer are removed. `rootNodes().length` disappears with
it, so the two "layer count" definitions can no longer diverge.

### P1 — Section ordering was configurable and ignored

**Evidence.** `Customize Workspace ▸ Status Bar Sections` offers
Move-earlier/Move-later for every section, `setStatusSectionOrderOverride`
persists `statusSectionOrder`, and `applyDeclaredOrder` renumbers `order` in the
effective config — but `StatusBar.tsx` gated sections with
`sectionVisible(id)` membership checks against a **hard-coded JSX order**.
Reordering anything changed nothing. `getVisibleStatusSections()` was consumed
for membership only, so the sorted id list it returns was never rendered.

This also broke invariant 9 of `docs/architecture/workspace-system.md` ("no
decorative config — every `WorkspaceConfig` field must have a runtime
consumer"): ordering had a UI, a store, a schema, and no effect.

**Fix.** `StatusBar.tsx` renders from an ordered slot map driven by
`getVisibleStatusSections()`. Ordering applies within two clusters — the
information cluster and the control cluster — and the clusters are fixed, so a
section cannot land on the wrong side of the bar.

### P1 — The customize dialog described a bar it did not control

**Evidence.** The dialog listed 12 sections. The bar rendered those 12 *plus*
the audit badge, the renderer diagnostic, save state, five grid/view toggles,
the reset-rotation action, the clear-guides action, the fit cluster, and the AI
chip — none of which had a section id. Unchecking every box left most of the bar
in place. Meanwhile `toolName` was listed and rendered, but the active tool is
already shown, highlighted and labelled, by the floating palette and repeated in
the tool-options popover.

**Fix.** `renderer`, `viewToggles`, `fit`, and `saveStatus` become real section
ids, so the row is fully described by its configuration — and the on-device AI
chip *loses* its section, because there was nothing persistent left to
configure once it stopped claiming things (see P2 below). `toolName` is
removed: the one thing the bottom bar is worst at (naming a tool that is
already labelled twice above it) was consuming the leftmost, most valuable
position on the row.

**Deliberate exception, stated once.** `saveStatus` exists as a section id but
`getVisibleStatusSections()` clamps it visible, the same way
`ESSENTIAL_TOOL_IDS` clamps Select/Hand/Zoom into the palette. A workspace may
not hide save state — `docs/architecture/workspace-system.md` owns that rule —
so the id exists to make the bar complete, not to make save state hideable. The
customize dialog renders its checkbox disabled with a reason.

### P2 — Zoom existed twice in the chrome

**Evidence.** `#menubar-zoom` and `#status-zoom` are both
`<input type="number">` with the accessible name `Zoom N%`. `editor.css` states
the duplication outright, in a comment above the portrait rule that hides the
menubar copy: *"the menubar zoom duplicates the status-bar zoom chip"*.

**Why it matters beyond tidiness.** Illustrator shipped exactly this pair and
broke it: *"I can select the zoom once from the status bar, but when I try again
it is not selectable"* (Adobe Illustrator bug report 47309126, 2023) — a
one-and-done zoom field. Two inputs writing one camera is a defect waiting for a
race, and two spinbuttons with identical accessible names make the control
ambiguous to assistive technology.

**Fix.** The status bar keeps the zoom chip (documented in
`docs/architecture/responsive-workspace.md` and asserted by
`tests/e2e/canvas/tooltip-system.spec.ts`); the menubar copy is removed. Zoom
remains in the View menu, on its shortcuts, and on the chip. The E2E harness
that used `#menubar-zoom` as a convenient zoom *setter*
(`tests/e2e/layers/layer-navigation.spec.ts`) now drives `#status-zoom`.

### P2 — A bare, unlabelled number, and a bare abbreviation

**Evidence.** `.editor-status__snap-grid` rendered a `<input>` whose only name
was `aria-label="Snap grid spacing (px)"`, sitting between the magnet toggle and
the ruler toggle, with no visible label and no effect when snapping was off.
`Fit sel` was the only user-visible token in the app using "sel".

**Fix.** The spacing field is labelled `Grid`, and is rendered only when it can
do something (`snapEnabled || pixelGridEnabled`). `Fit sel` is `Fit selection`,
and the control is not rendered at all with no selection rather than sitting
there inert.

### P2 — Rotation was two adjacent items, one of them anonymous

**Evidence.** With the view rotated the bar rendered a naked `15°` span and,
separately, a `Reset rot` button — plus the value again in
`SelectionInfoBar` and the View menu's `Reset View Rotation`. The bare degrees
span was the only element in the bar with no accessible name and no unit
context beyond the glyph.

**Fix.** One control: `↻ 15°`, whose label is "Reset view rotation", whose
tooltip carries the angle, and whose press resets. The value is still visible —
the failure mode to avoid here is Figma UI3 *hiding* width/height and rotation
values designers relied on, not showing them once.

### P1 — The row's own controls were taller than the row

**Evidence.** Every status-bar control took `min-height: var(--component-compact-height)`
(28px). The shell clamps `--statusbar-height` to
`max(26px, clamp(24px, 1.45rem + 0.25vw, 28px))` — **26.8px at 1440px, minus
its 1px top border**, so the content box is 25.8px. A 28px control centered in
it overflowed by ~1.2px and the shell's `overflow: hidden` ate that. Measured by
`tests/e2e/workspace/bottom-bar.spec.ts`, which reports the bar's box beside
every control's box:

```text
Modified — open Document Info clips at 1440px
bar [871.0, 897.8], control [870.0, 898.0]
```

The same class of bug shipped in Photoshop's status bar (a control that reads as
present but is partly cut), and it is invisible at a glance: 1.2px of a chip is
not something a person reports.

**Root cause.** The `editor.css` comments already state the intent — *"the
status bar's control tier … floored to 26px inside `.editor-shell` so 24px
controls fit"* — but the rules reused `--component-compact-height`, a 28px
token belonging to the toolbars. The comment and the value had diverged.

**Fix.** One token, `--statusbar-control-height: var(--component-xs-height)`
(24px, the WCAG 2.2 SC 2.5.8 floor), declared beside the row height it has to
fit inside. Every block-axis control height in the bar reads it; widths keep
`--component-compact-height`, which the row has room for.

### P1 — The preflight badge sat under the WCAG target floor

**Evidence.** `.preflight-warnings__badge` carries no `min-height` at all —
roughly 19px tall from `font-size × line-height + padding + border` — and it
was also missing from the coarse-pointer block that raises the other status
badges to 24px. It is an interactive button in the status bar of the Print and
Email workspaces, so it failed SC 2.5.8 there while every neighbour passed.

**Fix.** It joins the status-bar badge rule (`min-height:
--statusbar-control-height`, `min-width: --target-min-compact`) and the
coarse-pointer block.

### P1 — The grid-spacing field was a 28px field in a 26px row (regression, caught in review)

**Evidence.** A follow-up review screenshot showed the grid-spacing input
sitting proud of the row. `.varve-number-input` (from `@varve/ui`) carries that
package's field contract — `min-height: var(--component-compact-height)` (28px)
and `font-size: var(--font-size-sm)` — and nothing in the status bar overrode
it, so it overflowed the 25.8px content box by ~1.1px each side and rendered
bigger than every 24px control beside it. Optically it read as off-centre even
though `align-items: center` was doing its job: the box was taller than the row
it was being centred in.

**Why the check missed it.** The geometry assertion measured
`bar.querySelectorAll('button')`. A field is not a button, so the one
non-button control in the row was the one control never measured.

**Fix.** `.editor-status__snap-grid .varve-number-input` is re-scoped to
`--statusbar-control-height`, `--font-size-xs`, and the row's own padding.
While there: the previous rule targeted `.number-input`, which never matched
`varve-number-input`, so the intended width cap was dead CSS.

**Regression guard.** The geometry check now measures
`button, input, [role="combobox"], [role="spinbutton"]` — every interactive
shape in the row, not just buttons — and it asserts height as well as clipping.

### P2 — The idle AI chip was a claim, not a status

**Evidence.** `AIStatusIndicator` spent nearly all of its life rendering
`● On-Device AI` with the tooltip *"Private & 100% local (no cloud
transmission)"*. The message can never be false and can never change, so at no
moment does it carry information; a status bar that renders constants is
reporting the product's architecture back to the user, not their session. The
website already makes the same promise in the FAQ, `/compare`, the homepage,
`TrustStrip`, and the shader-effects page — the status bar was the seventh
place for it.

**Fix.** The chip is now **busy-only**: `AIStatusIndicator` returns `null`
unless an `InferenceAdmission` lease is active/queued or the upscale dialog is
open, in which case it renders `● Processing` with a pulsing dot. The privacy
claim moves to where a decision is made — the AIPanel header (*"There is no
cloud model"*), the AI command tooltips, and Settings — all of which already
carry it. `aiStatus` is retired as a section id in the same change, because
there is no longer anything persistent to toggle; the always-mounted `sr-only`
live region stays so screen readers announce the transition (a live region
inserted together with its text often goes unannounced — the pattern
`SaveStatusIndicator` already uses in this bar).

### P2 — Informational dashes marked nothing

**Evidence.** Two `<span aria-hidden>—</span>` elements separated the bar.
They sat between the shortcut-tip chip and the units select, and between the
guide controls and the zoom chip — i.e. at neither the information/control
boundary nor any groupable boundary. `editor.css` styles them through
`.editor-status > [aria-hidden]`.

**Fix.** Removed. The bar uses one flex gap, plus a single flex spacer at the
information/control boundary, so the visual grouping matches the structural
grouping.

## External failure evidence

Researched before designing, because the failure modes here are well documented
by other applications.

| Source | What failed there | What it means here |
|---|---|---|
| VS Code, status bar overflow — issues [#6651](https://github.com/microsoft/vscode/issues/6651), #74357, #117494, #117861, and [Stack Overflow 75613407](https://stackoverflow.com/questions/75613407/how-to-work-around-a-filled-status-bar-in-vscode) | No overflow policy: extension items silently truncate off the end. Users resorted to injected CSS/JS that hides the right half of the bar until hover. Hiding an item is also global, not per-workspace. | Varve keeps a **stated tier order** in `editor.css` (diagnostic, fit cluster, AI label, grid spacing, keep the controls) and scrolls rather than clips. Section visibility is per workspace, which is the half VS Code got wrong. |
| VS Code, [issue #83133](https://github.com/microsoft/vscode/issues/83133) | "We never wanted to show more than 3 actions until we put the rest into overflow"; with no per-item control the fix became "cap the count". | The customize dialog must describe the *whole* row, or users cannot fix a crowded bar themselves. That is the P1 above. |
| Inkscape, [`Make parts of the main status bar optional` (MR !3445)](https://gitlab.com/inkscape/inkscape/-/merge_requests/3445) and the [StatusBar UX notes](https://upchur.ch/gitea/n_u/Inkscape_Status_Bar_UX_Idea) | Users asked for per-part visibility "to help on small screen devices"; the UX critique is blunt: *"Elements that can be interacted with [should] look as though they can be interacted with"*, and abbreviations are only acceptable "where we can be absolutely sure that users will understand the purpose". | Per-section visibility stays. `Fit sel` stops being an abbreviation; the unlabelled spacing field gets a label; the rotation readout becomes the button that resets it. |
| Photoshop, [measurement status display glitch](https://community.adobe.com/bug-reports-711/p-measurement-status-display-glitch-2020-658437) and [zoom percentage display](https://community.adobe.com/questions-712/photoshop-2024-ps-ver-25-0-zoom-percentage-display-1164108) | The status bar showed the *pre-resize* dimensions after an image resize, and a zoom percentage that disagreed with the Navigator. The value was wrong, not ugly. | A duplicated readout is a correctness risk, not just clutter — which is why the two disagreeing layer counts (P0) had to be resolved by deletion, not by "syncing" them. |
| Illustrator, [Cannot re-select zoom level in status bar](https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/47309126-cannot-re-select-zoom-level-in-status-bar) | A status-bar zoom field that worked once and then went inert. | One zoom input, one owner. |
| Blender, [Status Bar manual](https://docs.blender.org/manual/en/latest/interface/window_system/status_bar.html) and [T56599](https://archive.blender.org/developer/maniphest/0056/0056599/index.html) | Deliberate split: *keymap/shortcut* hints and transient operation messages in the status bar, *values being edited* next to the work. Blender's dev discussion rejected mixing them and rejected dumping keymaps into a strip that is too short for them. | Varve follows the split: transient in-progress state (save, AI busy, preflight, document health) and durable view toggles in the bar; the selected node's geometry stays in `SelectionInfoBar`, next to the canvas. |
| Figma UI3 feedback — [forum thread](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index8.html), [Petition for the Old UI](https://www.reddit.com/r/FigmaDesign/comments/1kddp30/petition_for_the_old_ui/), [Too much UI for small screens](https://forum.figma.com/share-your-feedback-26/too-much-ui-for-small-screens-55147) | The complaint is not "too much" or "too little" — it is permanent chrome that *"provides nothing that isn't already available in menus or keyboard shortcuts"* and steals canvas space, alongside *"hiding width and height values"*. | Remove what is already available elsewhere (tool name, second zoom, second selection readout) and keep what is only here (selection geometry, save truth, health counts, renderer truth). |
| Krita Artists, ["More compact dockers and interface layout"](https://krita-artists.org/) (2026-07) and "Display the current layer name on Status Bar" (2025-04) | Users on large displays still want a *smaller* bar, and the one thing they ask to add is the current layer name, because "oops, painted on the wrong layer" is a recurring failure. | The selected-node identity readout stays — and now lives in exactly one place. |

## Changes

| File | Change |
|---|---|
| `packages/editor/src/components/StatusBar/DocumentHealthBadge.tsx` | New. One health badge: audit counts, severity colour, tooltip carrying debt + layout score, click → Audit tab. |
| `packages/editor/src/components/AuditBadge.tsx` | Deleted (superseded by `DocumentHealthBadge`). |
| `packages/editor/src/components/DebtBadge.tsx` | Deleted. The debt sub-view stays in the Audit tab. |
| `packages/editor/src/components/StatusBar/LayoutScoreIndicator.tsx` | Deleted. The layout sub-view stays in the Audit tab. |
| `packages/editor/src/StatusBar.tsx` | Rewritten around an ordered slot map; rotation is one control; grid spacing is labelled and conditional; fit cluster drops "sel" and the inert button; renderer/toggles/fit/save/AI are sections. |
| `packages/editor/src/workspace/workspaceTypes.ts` | Section vocabulary updated (`+documentHealth`, `+renderer`, `+viewToggles`, `+fit`, `+saveStatus`; `−toolName`, `−selectionInfo`, `−debt`, `−layoutScore`), six configs updated, `ESSENTIAL_STATUS_SECTION_IDS`, legacy fold in `migrateWorkspaceConfig`. |
| `packages/editor/src/workspace/workspaceStore.ts` | Folds legacy `debt`/`layoutScore` overrides into `documentHealth` before sanitizing. |
| `packages/editor/src/components/AIStatusIndicator/AIStatusIndicator.tsx` |
  Busy-only: renders `Processing` while an inference lease is queued or
  running, `null` otherwise; permanent `sr-only` live region; `aiStatus`
  retired as a section id. |
| `packages/editor/src/Menubar.tsx` | Menubar zoom control removed (duplicate of the status-bar chip). |
| `packages/editor/src/editor.css` | Status-bar cluster/spacer rules; `--statusbar-control-height` (the row's own control tier) replacing the 28px toolbar token; preflight badge target size; grid-spacing field re-scoped to that same tier (and its dead `.number-input` selector corrected to `.varve-number-input`); removed the informational dash rule and the menubar zoom rules. |
| `packages/editor/src/components/WorkspaceCustomizeDialog.tsx` | Save-status row renders disabled with a reason; hint text describes the two clusters. |

## Verification

- Component: `packages/editor/src/StatusBar.test.tsx` (section gating, order
  honoured, cluster placement, essentials clamped, zoom editing, renderer
  truth), `DocumentHealthBadge.test.tsx`, `workspaceTypes.test.ts`,
  `workspaceStore.test.ts`.
- Browser: `tests/e2e/workspace/bottom-bar.spec.ts` — single-ownership
  assertions (no second selection readout, no second zoom field, exactly one
  health badge), the customize dialog driving the row, and every visible
  control at ≥24px with nothing clipped at six widths. That last check is what
  found the control-tier bug above, and it now reports the bar's box beside
  each control's so a future failure names the geometry instead of a boolean.
- Browser: `tests/e2e/canvas/toolbar-followup.spec.ts` and
  `tests/e2e/interaction/chromeos-device-matrix.spec.ts` — the pre-existing
  status-bar target and coarse-pointer floors, re-run against the new tier.
- Visual: `tests/e2e/visual/bottom-bar-visual.spec.ts` captures human-review
  PNGs into `VARVE_VISUAL_QA_DIR` (promoted into
  `docs/screenshots/bottom-bar-2026-09-29/` for this review): the design row
  selected and unselected in light, dark, and high contrast; the print row with
  its preflight badge; the rotation chip carrying the angle; the 640px row
  after every tier has dropped; and the customize dialog's section list.

**Results.** `tests/e2e/workspace/bottom-bar.spec.ts` +
`bottom-bar-visual.spec.ts`: **8/8 passed**. `toolbar-followup.spec.ts` +
`chromeos-device-matrix.spec.ts`: **41 passed, 1 failed** — the failure is the
floating palette's placement, whose source is another session's uncommitted
work, while this change's own geometry assertions in that file passed. The
seven other edited specs: **15 passed, 6 failed**, all at assertions this task
did not write (undo history, workspace-switcher overflow, Email dock tabs,
View-menu workspace labels, artboard coordinates). Full attribution is in
`docs/agents/bottom-bar-2026-09-29-ownership.md`.

## Remaining work (honest list)

- The **Editor chrome ▸ Status bar** checkbox in *Customize Workspace* gates
  `SelectionInfoBar` and `StatusBar` together (both render inside
  `effectiveConfig.statusBar`). It behaves as "hide the bottom bar", which is
  defensible, but the label still says *Status bar* and the selection strip now
  owns facts the status bar no longer repeats. Either rename the toggle to
  *Bottom bar* or split the preference — the split is the more honest option
  and needs a `chromeOverrides` key that persisted layouts can carry.
- The information cluster's `.editor-status__meta` still caps at `14rem` each;
  four long labels on a narrow window ellipsize before the tier rules fire.
  Tiering by *content length* would need measurement, not media queries.
- `PreflightWarnings` and `DocumentHealthBadge` can both show a `TriangleAlert`
  count in print/email workspaces. They answer different questions (production
  readiness vs. document health) and open different surfaces, so they are
  deliberately not merged — but they are the next candidates if the row gets
  crowded again.
