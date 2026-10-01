# Text enlargement audit and repair — 2026-09-30

**Scope:** the editor shell's response to user text enlargement (WCAG 2.2 SC
1.4.4), plus the narrower reflow floor (SC 1.4.10) that the responsive
document claimed but did not test.

**Branch:** `master`, per instruction. No branch was created.
**Initial HEAD:** `302712c816d84bd7ebe78d36809225d3d3044b7d`.
**Checkout state at inspection:** one worktree; no in-progress Git operation;
407 modified/staged/untracked paths belonging to other concurrent sessions
(workspace/dock layout, GPU rendering, pattern system, website content,
screenshot assets). None of those paths were reverted, staged broadly, or
otherwise touched. The changes recorded here are confined to the three paths
listed at the end.

**Hardware:** none. All evidence is headless Chromium driven by Playwright on
this machine. No screen-reader, no real OS text-scaling, and no packaged
desktop-app run was performed — see "Not established".

## 1. Why this condition was in scope

`packages/ui/src/tokens/typography.ts` states the project's own contract:

> Interface chrome (`2xs`–`xl`) is **stable rem**, so a dense toolbar … scales
> with the user's UI font-size preference and with browser text zoom because
> the values are rem.

Interface *geometry* is the other half of that contract and is deliberately
px-based (`packages/ui/src/tokens/sizing.ts`, the 24/28/32/40/48 ladder). Text
enlargement therefore grows the labels without growing the bars that hold
them. The project already tests 200% text in several places, but only locally:
the status bar and the View menu (`tests/e2e/canvas/toolbar-followup.spec.ts`),
the export inspector, the plugin manager, and the website. The **shell chrome
as a whole** had no coverage, and that is where the defects are.

## 2. Method (and why the first measurements were wrong)

1. Read-only reconnaissance of the responsive contract
   (`docs/architecture/responsive-workspace.md`), the token layer, and the
   existing E2E coverage.
2. Baseline reproduction at 1280×800 with `documentElement.style.fontSize =
   '200%'` — the same text-size stand-in the existing tests use.
3. **Correction that mattered.** The first pass measured each control's
   *layout* box (`getBoundingClientRect()`), which for an element inside an
   `overflow: auto/hidden` ancestor extends past the clipped edge. That reports
   losses at points no user can reach and produced two false positives (the
   inspector's active tab and the floating toolbar's Eyedropper). Every finding
   below is therefore confirmed twice, on the *visible* rect only:
   - `document.elementFromPoint()` sampled across the control's visible area
     (its box intersected with every clipping ancestor), and
   - Playwright's own actionability trial, `locator.click({ trial: true })`,
     which is the harness's definition of "a user can activate this".
4. Attribution: for each loss, the topmost element that actually receives the
   hit test was recorded, so the root cause is identified rather than guessed.
5. Regression proof: the new test was run with the fix temporarily reverted and
   failed; with the fix present it passes.

## 3. Research

| Source | Retrieved | What it establishes here |
|---|---|---|
| [Understanding SC 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text) (W3C, WAI) | 2026-09-30 | 200% is the bar; "layout constraints may cause text to overlap with other content when it is scaled larger" is the named symptom; "Content satisfies the success criterion if it can be scaled up to 200% using at least one text scaling mechanism supported by user agents"; lists F69 as a failure and G179 as a technique |
| [F69](https://www.w3.org/WAI/WCAG22/Techniques/failures/F69) (via the 1.4.4 technique/failure list) | 2026-09-30 | "Failure … when resizing visually rendered text up to 200 percent causes the text, image or controls to be clipped, truncated or obscured" — the exact class found here |
| G179 (same list) | 2026-09-30 | "Ensuring that there is no loss of content or functionality when the text resizes and text containers do not change their width" — the technique the fix implements (the rail is a container whose width cannot grow) |
| [F94 Incorrect use of viewport units to resize text](https://www.w3.org/WAI/WCAG22/Techniques/failures/F94) (W3C) | 2026-09-30 | Viewport-unit text sizing defeats user text enlargement. Checked: Varve sizes interface type in `rem`, not `vw`, so this failure does not apply |
| [1.4.4 testing guidance, NYU Digital Accessibility](https://digitalaccessibility.nyu.edu/testing/sc144.html) (secondary) | 2026-09-30 | Distinguishes full-page zoom from text-only zoom and notes post-zoom overlap/cut-off as the failure signal. Used to keep the conformance claim below honest |

**Conformance claim, stated conservatively.** The Understanding document
allows satisfaction "using at least one text scaling mechanism supported by user
agents". Chrome and Edge offer only full-page zoom, which scales px geometry
too, so the defects below are **not** observed under full-page zoom and the page
still satisfies 1.4.4 through that mechanism. What is broken is *text-only*
enlargement — Firefox's "Zoom text only", a user stylesheet, and the rem-based
"UI font-size preference" the token file explicitly promises to honour. They are
reported as F69-class loss of functionality, not as a blanket conformance
failure.

## 4. Defects found

All at **1280×800, root font size 32px (200%)**, Chromium, fresh document.

### D1 — Application-menu rail painted outside its own box; `Page` and `Help` unreachable — **FIXED**

| Measurement | Before | After |
|---|---|---|
| `.editor-menubar__left` box | 704px wide, `right = 735` | 519px wide, `right = 569`, `scrollWidth = 704` |
| `.editor-menubar__side` (owning segment) | 537px, `scrollWidth = 725` (188px painted outside) | 559px, `scrollWidth = 559` |
| `getComputedStyle(left).minWidth` | `auto` | `0px` |
| Document title box | 552–728 | 574–750 |
| `elementFromPoint` at each menu's visible centre | `Page` 50/50 samples lost, `Help` 50/50 lost | none lost |
| Covering element | `button.editor-menubar__doc-name-text` (the document title) | — |
| `click({ trial: true })` | `Page`, `Help` timed out | both clickable |

Root cause: the rail's containment (`min-width: 0; flex-shrink: 1; overflow-x:
auto; scrollbar-width: none`) existed **only inside `@media (max-width: 899px)`**
and again inside the portrait tier. Above 899px the rail therefore could not
shrink, painted past the end of its own segment, and — because
`.editor-menubar__center` follows it in the DOM — the centred document title won
hit-testing over every label it overlapped. The repository had already written
this mechanism down and fixed it once for narrow widths
(`docs/audits/workspace-switcher-design-review-2026-09-29.md` F6, quoted in the
stylesheet); text enlargement reopened it above the breakpoint because the
labels grow while the bar's half-width share does not.

**Correction recorded so this audit does not mislead.** A draft of this record
attributed a 1325px shell width to the rail's min-content. That is wrong. The
shell measures 1325px **before and after** the rail fix, because the resolved
grid tracks are `486.391px 320px 518.391px` = 1325px — that is D2 below and is
entirely independent of the rail. The rail containment fixes the title overlap
and the menu hit-testing, and nothing else.

**Fix:** hoisted the rail's containment from the `<= 899px` tier into the base
`.editor-menubar__left` rule (one rule; the two tier duplicates were removed so
there is exactly one definition), with the mechanism recorded in a comment.
Verified: `Page`/`Help` clickable, rail `right` equals the segment's `right`,
no menu overlaps the title.

**Preserved:** at 100% text the rail's content (361px) is narrower than its box
(361px), so no scrollbar appears and the desktop bar is pixel-identical — see
the before/after menubar captures.

**Residual (accepted, documented):** at 200% text the rail's content is 704px
inside a 519px box, so `Page` and `Help` are reachable by horizontal scroll
(trackpad / Shift-wheel) and by keyboard menubar navigation (the browser scrolls
a focused item into view), but they are off-screen at rest, and the rail's
scrollbar is hidden for visual parity with the narrow tiers. Hiding the
duplicate document title instead would **not** solve it: even with the title
gone the rail would have ~607px for 704px of labels, so scrolling is intrinsic
at this size, not a compromise of the fix. A follow-up could show a scroll
affordance, but that changes a treatment shared with the `<= 899px` tiers and
was out of this change's boundary.

### D2 — Shell grid tracks exceed the viewport at 200% text — **OPEN**

Resolved `gridTemplateColumns` of `.editor-shell`:

| Root font | Tracks | Sum vs viewport |
|---|---|---|
| 16px (100%) | `288px 681.609px 310.391px 0px` | 1280 = 1280 |
| 32px (200%) | `486.391px 320px 518.391px 0px` | **1324.8 > 1280** |

Root cause: `--sidebar-width: clamp(14rem, 12rem + 8vw, 18rem)` and
`--inspector-width: clamp(15rem, 13rem + 8vw, 20rem)` are rem-derived, so they
grow with text, while the canvas track floors at a fixed `minmax(320px, 1fr)`.
At 200% text the two panels demand 1004.8px, leaving 275px for a canvas that
refuses to go below 320px, so the track sum overflows the container and
`.editor-shell { overflow: hidden }` clips the right 45px of every chrome row
(`.editor-shell__menubar`, `.context-control-bar`, `.editor-tabs-row`,
`.editor-status` all measured `right = 1325`).

Measured impact: layout is 45px wider than the viewport on those rows. The
"New document" tab-strip control sits at `right = 1325`, i.e. beyond the edge;
automated actionability still reported it clickable, so it is recorded as **at
risk / clipped**, not as confirmed unreachable. The user-resized path is
unaffected: when a panel width has been persisted, `Shell.tsx` writes a px value
into the same custom property and the tracks do not scale with text.

Why not fixed here: the correct fix has to decide between letting the panels
shrink below their `clamp()` (which then also requires the panel elements to
fill their track rather than their token — `width: var(--sidebar-width)` at
`editor.css:2181/2190/7145/7167` — and must keep `PanelResizeHandle`'s geometry
math consistent) or lowering the canvas minimum. Both are decisions in the
dock/panel-sizing system, whose stylesheet and `Shell.tsx` are under another
agent's active concurrent edit in this checkout. Shipping it blind would risk
the persisted-width and resize-handle contracts that the shell matrix asserts.

Recommended next step: make the two panel tracks shrinkable
(`minmax(0, var(--sidebar-width))` / `minmax(0, var(--inspector-width))`) **and**
switch the panel elements to fill their track, then re-run the whole
`chromeos-device-matrix` file plus the `PanelResizeHandle` unit tests and a
drag-resize round trip at 100% and 200%.

### D3 — Workspace dock panel chrome covers the document tab strip — **OPEN**

| Root font | Document tab | Topmost element at the tab's centre | `click({ trial: true })` |
|---|---|---|---|
| 16px (100%) | y 91, 98×32 | `span.editor-tabs__name` ("Untitled 1") | clickable |
| 32px (200%) | y 104, 167×32 | `span.workspace-dock-panel-chrome__title` ("Layers") | **not clickable** |

The tab widens (98→167px) and the tab strip shifts down as the header stack
grows, and the workspace dock's panel chrome then covers the tab's centre. The
document tab cannot be activated at 200% text.

Attribution is from the hit test: the covering element is a
`workspace-dock-panel-chrome` title. The exact anchoring expression was not
narrowed further — `--menubar-total-height` is a static px/rem estimate of the
header stack (`.editor-shell`, `editor.css:326`) consumed by several fixed
panels (`editor.css:2175`, `3080`, `7132`,
`components/Shell/WorkspaceBottomPanels.css:237`), and at least one of them
places chrome in the tab strip's band. That is a hypothesis, not a confirmed
cause, and is recorded as such.

## 5. Verified clean (no defect)

| Condition | Result |
|---|---|
| Reflow at the 320px WCAG 1.4.10 floor and 360px, editor shell | No horizontal drift; canvas ≥120px; no chrome overlap; 44px targets; the compact multi-select control present. **Promoted into the permanent matrix** (`reflow-floor-320x640`, `phone-360x780`), which previously stopped at 480×640 while `docs/architecture/responsive-workspace.md` claimed 320px as the floor |
| Editor at 390×844, 200% text | No page overflow; no clipped text found by the sweep |
| Home surface at 320px, 200% text | No page overflow. `.varve-home` reports `scrollWidth 521 > clientWidth 320` under `overflow: hidden`; inspected — the excess is the intentionally off-screen contextual-help panel plus `.sr-only`/`.visually-hidden` text, not lost content |
| Editor at 1280×800, WCAG 1.4.12 text-spacing overrides (`line-height: 1.5`, paragraph spacing `2em`, `letter-spacing: .12em`, `word-spacing: .16em`) | No overlap, no clipping, no page overflow. Layout visually identical to baseline |
| Inspector active tab and floating-toolbar Eyedropper at 200% text | **False positives** from the first measurement pass. Both are clipped by a scrolling ancestor, not obscured; `click({ trial: true })` succeeds for both |
| Menubar `Undo` / `Redo` at 200% text | **False positive.** `disabled === true` on a fresh document (empty history), which is why the actionability trial times out. Not a layout defect |
| 13-entry responsive viewport matrix (960×600 … 640×400, 899/900, 1094/1095, portrait, split) | 13/13 pass after the change |

## 6. Validation performed

```bash
# Regression guard proof (fix temporarily reverted, then restored)
npx playwright test tests/e2e/interaction/chromeos-device-matrix.spec.ts \
  --project=chromium --workers=1 -g "text enlargement"
#   → FAILS with "the application menu rail painted outside its own segment"
#   → PASSES with the fix

# New coverage
... -g "text enlargement"            # 1 passed
... -g "reflow-floor-320x640|phone-360x780"   # 2 passed
... -g "responsive viewport matrix"  # 13 passed (3.3m)

# Repository gates (see the agent validation report in the handoff)
pnpm verify:plan ; pnpm verify:affected ; pnpm typecheck:e2e ; pnpm audit:sizing
```

Every Playwright run went through
`scripts/quality/heavy-lease.mjs` on an isolated port (`VARVE_E2E_PORT=1433`)
with `--workers=1`, because another agent's suites were running on this machine.

## 7. Not established

- **Real text-enlargement conditions.** Only the CSS stand-in
  (`documentElement.style.fontSize = '200%'`) was exercised. Firefox "Zoom text
  only", a real user stylesheet, and OS text scaling were not run.
- **Real on-screen keyboard / packaged desktop app.** Not part of this change.
- **Screen readers.** No NVDA/VoiceOver/Orca run; the accessible names of the
  affected menus were not separately verified.
- **Non-Chromium engines.** Chromium only.
- **D2 and D3** remain open with the evidence above; the recommended fixes are
  recorded rather than applied, for the ownership reason stated in D2.

## 8. Files changed by this audit

| Path | Change |
|---|---|
| `packages/editor/src/editor.css` | Rail containment hoisted from the `<= 899px` tier into the base `.editor-menubar__left` rule; the two duplicate tier rules removed; the stale tier comment corrected |
| `tests/e2e/interaction/chromeos-device-matrix.spec.ts` | New `text enlargement (WCAG 1.4.4)` regression; two new matrix entries at the reflow floor |
| `docs/architecture/responsive-workspace.md` | Rail containment documented as every-width; text-enlargement contract and coverage recorded |
| `docs/audits/text-enlargement-2026-09-30.md` | This record |
