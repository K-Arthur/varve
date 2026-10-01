# Responsive audit and repair — Layers and Inspector panels (2026-09-30)

**Scope:** the two docked rails of the editor shell — the Layers panel
(`#editor-layers-panel`, including the Design Canvas navigator it hosts) and
the Inspector (`#editor-inspector-panel`) — plus the shell grid tracks that
size their chrome rows, across desktop widths, short windows, the ≤899px
drawer/sheet presentation, and text-only enlargement (WCAG 2.2 SC 1.4.4).

**Branch:** `master`, per instruction. No branch was created.
**Initial HEAD:** `54b9f1369`; HEAD moved to `1ed07a96f` during the session as
other sessions committed (recorded so results are attributable to the working
tree, not to a single revision).

**Checkout state:** shared and heavily dirty (~400 modified/staged/untracked
paths from concurrent sessions: dock/workspace layout, pattern system,
text-enlargement fix, failure sweep). None of those paths were reverted,
staged, or rewritten. Attribution of every failure is recorded below —
failings were re-run with this task's changes temporarily reversed (exact
inverse edits, restored byte-for-byte from saved copies) to separate "mine"
from "pre-existing on this tree".

**Hardware:** none. All evidence is headless Chromium driven by Playwright
through `scripts/quality/heavy-lease.mjs` on isolated ports (1541 official
runs; 1533 for measurement probes). No screen reader, no physical touch/pen,
no Firefox/WebKit, no packaged desktop run — see "Not established".

## 1. Method

1. Read-only discovery of the responsive contract
   (`docs/architecture/responsive-workspace.md`), the prior audits
   (`text-enlargement-2026-09-30`, `inspector-responsive-surface-audit-2026-09-17`,
   `layers-panel-review-2026-09-15`), and the ownership records for both
   surfaces (the Layers scope was recorded free; the Inspector responsive
   slice was complete).
2. Research before solutioning (§2).
3. Baseline measurement: nine probe scripts (probe…probe12, kept under
   `/tmp/opencode/varve-responsive/`) measuring geometry, `elementFromPoint`
   hit tests, clipped-text sweeps, and event traces at 320/360/390/768/844/
   1024/1280/1920 widths, 600/800/1080 heights, drawer modes, and a 200% root
   text size. Screenshots captured to `/tmp/opencode/varve-responsive/shots/`
   for human review (the read tool's image return was unreliable in this
   session — it repeatedly returned an unrelated cached image for distinct
   paths — so visual claims below are backed by programmatic geometry, and
   the PNGs are left for human inspection).
4. Fixes implemented incrementally in the real components; each validated by
   a new regression spec plus the existing affected suites.
5. Every failure classified by re-running it with this task's changes
   reversed (§6).

## 2. Research (checked 2026-09-30)

| Source | What it establishes here | Type |
|---|---|---|
| [Understanding SC 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) (W3C WAI) | 320 CSS px reflow floor; the two-dimensional exception applies only to the section that needs it and "does not automatically extend to other content" — a panel's chrome and rows are not excepted; C32/C31/SCR34 are the named techniques | Standard |
| [Understanding SC 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text) + F69/G179 (W3C) | 200% text with clipped/truncated/obscured controls is the named failure (F69); G179 — no loss of content or functionality when containers do not change width — is the technique these fixes implement (the rails are fixed-px while type is rem) | Standard |
| [minmax() — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax) and the csswg track-sizing discussion ([#12071](https://github.com/w3c/csswg-drafts/issues/12071)) | A `0` minimum lets a track shrink below its content/max when the container is smaller; plain length tracks keep their max and overflow — the D2 fix | Platform docs |
| [WCAG 2.2 SC 2.5.8 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (via the repo's own contract) | 24×24 CSS px minimum with spacing exceptions; the `+` button measured 19×22 and now holds `--target-min-compact` explicitly | Standard |
| Comparative failure reports already vetted in `inspector-responsive-surface-audit-2026-09-17` §2 (Figma forum, Adobe community, Blender docs) | High-frequency controls must stay close and reachable; hiding/clipping is never the fix — the same principle applied here to the filter toggle and canvas row actions | User-reported failures |

Decisions from the research: (a) fix the tracks (`minmax(0, …)`) rather than
clipping chrome rows; (b) make fixed-width rail content *wrap* (G179) rather
than truncate — labels, align clusters, segmented options; (c) keep every
action reachable — no control may be only-hidden; (d) hold the 24px target
floor explicitly where the spacing exception was the only cover.

## 3. Defects found and fixed

All measurements are from the live app (Vite dev build of the shared tree).

### D1 — Layers filter bar overflowed the rail; "Show filter options" unreachable — **FIXED**

| Measurement (1280×800, desktop) | Before | After |
|---|---|---|
| `.layers-panel__content` scroll/client | 313/313 inside a 281.6px rail (33px clipped) | 279/279 |
| `.layers-filter-bar` scroll/client | 312/312 | 279/279 |
| `.layers-filter-bar__toggle-advanced` visible box | ~10px of 28px, centre covered by `dock-splitter-layers-main` (z1000) | 28×28, centre hit-tests itself, `click({trial:true})` passes, 1px clear of the splitter band |
| Layers tree row right-side controls (Hide/Lock/Solo) | pushed into the clipped 33px zone | all hit tests OK (probe9) |

Root cause: the short-height tier
(`@media (min-width: 900px) and (max-height: 900px)`) scoped
`flex: 0 0 auto` to every `.editor-layers`, **including the inner
`.layers-panel__content` whose parent is a ROW-direction flex container**
(`.layers-panel-workspace__content > div`). In a row parent that value means
"do not shrink horizontally", so the inner content was sized to its
max-content width and everything right of ~280px was cut by the intermediate
`overflow: hidden`; the dock splitter's 24px hit band then covered the
remains. The tier's intent ("the rail becomes the outer scroller; do not
squeeze the tree") is vertical and lives on the **outer** wrapper; the rule
now targets `.layers-panel-workspace` only.

Attribution: the failure was present at every 900–1200×≤900 desktop window
before the fix (probes 1, 3, 5); the fix was verified in the same probes and
by the new regression spec.

### D2 — Design canvas name collapsed to "C…"; row overflowed; hidden actions hit-tested — **FIXED**

| Measurement | Before | After |
|---|---|---|
| `.design-canvas-panel__select` width (1280 rail) | 52px | full row (260px) |
| `.design-canvas-panel__select` width (390 drawer, 224px rail) | 10px | 205px |
| `.design-canvas-panel__name` | 25px of 62px visible ("C…") | fully visible at 1280, 1024, 390, 320 (scroll == client everywhere) |
| Row/list horizontal spill | list scroll/client 262/254+ (panel +7px residue) | 0 |
| Click at the row's empty middle | activated an **invisible** action button (`opacity: 0` does not disable hit testing) | reaches the select |

Root cause: five text-labelled actions (~210px) were laid out inline in every
row at `opacity: 0`, starving the select and overflowing the list, while the
opacity-only reveal left them clickable when invisible.

Fix: actions are `display: none` at rest and join the **same flex line** on
hover/focus-within, with the select yielding exactly the width they take.
Two intermediate designs were rejected by evidence: an absolute overlay made
revealed actions cover the select's centre (Playwright could not click it),
and a wrapping reveal changed row **heights**, which moved the neighbouring
row between `pointerdown` and `pointerup` — the event trace (probe12) showed
`pointerdown` on the select, `pointerup` on "Copy", `click` on the `<li>`,
so the activation was dropped entirely. The shipped same-line reveal changes
no row's height, so revealing one row can never move another row under a
pointer mid-click (probe12 re-run: down/up/click all land on the name, state
commits and stays committed).

Keyboard path: focusing the select reveals the actions (`:focus-within`),
which then become focusable in DOM order after it.

### D3 — Shell grid tracks overflowed the viewport at text enlargement — **FIXED**

| Root text (1280×800) | `grid-template-columns` sum | Chrome row right edges |
|---|---|---|
| 16px (100%) | 1280 | 1280 (unchanged by the fix — identical track values) |
| 32px (200%) before | **1324.78** (menubar/tabs/status/selinfo all 1325px wide, `.editor-shell { overflow: hidden }` clipped 45px) | 1325 |
| 32px (200%) after | **1280** (`480/320/480/0`) | 1280 |

Root cause: `var(--sidebar-width)` / `var(--inspector-width)` are rem-derived
(`clamp(14rem, …)` / `clamp(15rem, …)`) used as plain-length tracks, so their
sum is fixed while the container is not. This is D2 of
`docs/audits/text-enlargement-2026-09-30.md`, which deferred the fix for
ownership reasons; this session owns the Layers/Inspector sizing surface and
applies the recommended `minmax(0, …)` change. The panel elements themselves
are absolutely positioned by the dock geometry system (inline px, confirmed
by probe3), so the tracks only govern the full-width chrome rows — the
canvas floor (`minmax(320px, 1fr)`) and 100%-text values are unchanged.

### D4 — Inspector content clipped at text enlargement — **FIXED (wrapping contract)**

At 1280×800 with a selection and a 200% root size, before the fix:

| Surface | Spill (clipped by the rail) |
|---|---|
| `.insp-align-bar` / `.insp-align-group` / `.insp-align-section` | 144px of 203px — the Selection/Frame/Canvas reference cluster's buttons unreachable |
| `.insp-panel__node-name` | 143px (ellipsis) |
| `.insp-field__label` ("Blend mode", "Opacity (%)") | 50–58px (ellipsis) |
| `.varve-segmented__label` (Document colour profile groups) | 15–104px per label — "Linear RGB" → "Li…" (options visually indistinguishable) |

After: `clippedTextWithoutEllipsis` over the Inspector returns `[]`; the align
cluster's right edge equals its group's (overflow 0, it wraps); every
segmented label keeps its full text (the groups now wrap onto a second line);
field labels wrap under the existing rem-based `@container inspector
(max-width: 13rem)` tier — which engages exactly when the text-to-rail ratio
gets tight, because the threshold itself is rem-based while the rail is px.

Root cause detail worth recording: the segmented buttons inherit
`.varve-segmented--distribute { flex: 1 1 0 }` — a **0px flex basis** means
every button's hypothetical main size is 0, so `flex-wrap` never fires
(0×N always "fits") and the buttons share one line and shrink their labels.
`.editor-inspector .varve-segmented > .varve-segmented__btn { flex: 1 0 auto }`
restores content-based line breaking while keeping equal distribution within
each line (verified: RGB/CMYK/Grayscale went from one 55px line with clipped
labels to two full-label lines).

### D5 — "Add Design Canvas" button below the AA target floor — **FIXED**

Measured 19×22 CSS px at 100% text. Now `min-width/min-height:
var(--target-min-compact)` (24px) — measured 24×24, `audit:sizing` clean.

### D6 — Layer row controls at short heights / drawers — **VERIFIED (no defect)**

1024×600: the rail scrolls (`scrollHeight 552 > clientHeight 393`), rows and
their Hide/Lock controls keep their hit tests at the bottom of the scroll.
Drawers at 320/390/768/844: focus enters the drawer, Escape closes it, focus
returns to the FAB, filter input reachable, no horizontal spill after D1/D2.

## 4. Known-open items found during this audit (not caused by this work)

| ID | Finding | Evidence | Status |
|---|---|---|---|
| O1 | **Workspace dock panel chrome covers the document tab strip at 200% text** (D3 of the text-enlargement audit) — the dock's absolute `top: 123.25px` is computed from a header height that does not follow root-text changes, while the grid rows grow to `menubar 104 + tabs 32`; tab hit test returns `workspace-dock-panel-chrome__title` | probe8 `text200.tabCover`, baseline `1280x800@200%text` | **Blocked by ownership**: fixing it means editing the dock geometry (`useEditorDockGeometry.ts`/`dockGeometry.ts`) or `Shell.tsx`, all under active concurrent edits. Recommended fix: derive the dock's top offset from the live header box (ResizeObserver) or anchor the absolute layer to the grid rows it mirrors. Handed off below. |
| O2 | **Two competing resize systems**: the legacy `PanelResizeHandle` ("Resize layers panel", z10) sits under the committed dock splitter ("Resize dock panels", z1000, 24px band centred on the panel edge). The legacy handle is unreachable by pointer and protrudes ~7px past the rail (the +7 `scrollWidth` residue on the Layers aside) | probe3 (`allSplitters` vs `allPanelResize` rects); layers specs fail on `separator … press('End')` behavior with or without this work | **Handed off** to the dock/workspace session — either remove the legacy handle or move its behavior into the splitter. Not edited here. |
| O3 | **Six existing spec failures pre-date this work on this tree** (reproduced with every change of this task reversed): `layers-header-solo-overflow:58`, `layers-row-badge-overflow:114/144/212` (all drive the legacy resize separator), `inspector-responsive-surface-audit` ×4 (`setRail` writes `--inspector-width` but the dock's inline px width wins — expected 240px, received 584.062px, identical with/without this work), `name-labels:5` (`.editor-menubar__zoom-input` never appears), `layers-panel-real-world:41` (`#file-import-input` never appears) | attribution runs in §6 | **Pre-existing**, recorded for the failure-sweep/dock owners |
| O4 | **Stale visual baseline**: `design-canvas-navigation.spec.ts-snapshots/design-canvas-navigator-chromium-linux.png` expects 288×143, actual 316×149 — the width delta is the committed dock-ratio rail (0.22×1440), i.e. the baseline fails on `master` independent of this work; this task's row changes add the height/row delta | attribution run (fails without this task's changes); `compare -metric AE` region analysis | **Not regenerated** — regenerating would bake in another session's in-flight geometry. Hand off: regenerate this one snapshot at the integration checkpoint after reviewing the diff. |
| O5 | **`layers-panel-visual:5` bulk-bar containment fails identically with/without this work** (`bulkBottom 773.34 > panelBottom 666.61` — byte-identical numbers in both runs) | attribution run | **Pre-existing** on this tree; belongs to the dock/layers geometry owners |
| O6 | Short-height rail: the outer workspace wrapper resolves to exactly `min-height: 15rem` and its inner content clips the tree box's bottom ~44px at 1024×600. Rows remain reachable (tree has its own scroller); measured **identical before and after** this work (probe10 A/B) | probe10 post-fix vs pre-fix emulation | Pre-existing, minor; recorded |
| O7 | `docs/architecture/responsive-workspace.md` says the portrait Inspector sheet is a "25–36dvh nonmodal lower pane"; the CSS ships `height: min(72dvh, 560px)` (measured 560px = 66dvh at 390×844, 55dvh at 768×1024) | editor.css:3112 vs doc line ~197 | Doc/implementation mismatch. The file is owned by the tablet-mode session and carries their uncommitted edits — **correction text handed off**, not edited here. |
| O8 | Inspector value-side ellipses remain at 200% text (hex swatch `#39D0C6` → truncated, select values) — labels and options (the identifying information) now wrap; values keep their accessible names and the swatch colour | probe8 `text200.clippedEllipsis` | Deferred by impact; recorded |

## 5. Changes made (files)

| File | Change |
|---|---|
| `packages/editor/src/editor.css` | (D1) short-height tier scoped to `.layers-panel-workspace`; (D3) shell grid panel tracks → `minmax(0, var(--…))` — both with mechanism comments |
| `packages/editor/src/components/PagesPanel/pages-panel.css` | (D2) row actions: same-line reveal (`display: none` → `flex`), row un-changed in height; (D5) add-button 24px floor |
| `packages/editor/src/components/Inspector/inspector.css` | (D4) `.insp-align-targets` wraps; inspector segmented groups wrap + `flex: 1 0 auto` buttons; field labels wrap in the 13rem container tier |
| `tests/e2e/responsive/layers-inspector-panels.spec.ts` | **New** 7-test regression contract: filter-bar containment + hit test, canvas row name/containment/hit tests/add-button floor, shell grid + chrome-row rights at 200% text, align-cluster containment, segmented labels, inspector clipped-text sweep, compact drawer reachability + focus return, short-window rail scrolling + row control hit test |

No TypeScript production code changed (CSS + one new spec only).

## 6. Validation performed (exact commands, all through the heavy lease)

```bash
pnpm typecheck:e2e                                    # pass
npx playwright test tests/e2e/responsive/layers-inspector-panels.spec.ts
  --project=chromium --workers=1                      # 7/7 pass
npx playwright test tests/e2e/interaction/chromeos-device-matrix.spec.ts \
  tests/e2e/layers/layers-panel-visual.spec.ts \
  tests/e2e/layers/layers-panel-real-world.spec.ts
  --project=chromium --workers=1                      # 53 passed, 2 failed (O5, O3-import — both pre-existing, §6 attribution)
npx playwright test tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts \
  tests/e2e/workspace/consolidated-panels-responsive.spec.ts \
  tests/e2e/a11y/responsive-panels.spec.ts \
  tests/e2e/workspace/dock-layout-geometry.spec.ts
  --project=chromium --workers=1                      # 7 passed, 4 failed (all O3 setRail — pre-existing)
npx playwright test tests/e2e/layers/layers-header-solo-overflow.spec.ts \
  tests/e2e/layers/layers-row-badge-overflow.spec.ts \
  tests/e2e/canvas/design-canvas-navigation.spec.ts \
  tests/e2e/canvas/name-labels.spec.ts
  --project=chromium --workers=1                      # 1 passed, 8 failed → after F2 revision re-run: 10 passed / 2 failed (O3, O4 — pre-existing)
pnpm audit:sizing ; pnpm audit:spacing ; pnpm audit:radius ; pnpm audit:emoji   # all exit 0
pnpm exec biome check tests/e2e/responsive/layers-inspector-panels.spec.ts      # clean
pnpm exec stylelint <the three CSS files>             # 22 errors, ALL outside this task's edits (same set at HEAD: 23)
pnpm verify:affected                                  # see validation report (shared-tree escalation)
```

Every Playwright run used `scripts/quality/heavy-lease.mjs` with
`VARVE_E2E_PORT=1541`, `--workers=1`, isolated output dirs.

**Attribution runs** (this task's exact hunks reversed, then restored
byte-exact; markers verified absent afterwards):

| Failing test | With my changes | With mine reversed | Verdict |
|---|---|---|---|
| `design-canvas-navigation:30` (rename) | fail (hidden-action click) → **pass after F2 revision** | pass | mine → fixed |
| `name-labels:30` | fail (overlay interception; then click race) → **pass after F2 revision** | pass | mine → fixed |
| `design-canvas-navigation:54` (visual) | fail | fail | pre-existing (O4) |
| `name-labels:5` | fail | fail | pre-existing (O3) |
| `layers-header-solo:58`, `layers-row-badge:114/144/212` | fail | fail | pre-existing (O3) |
| `inspector-responsive-surface-audit` ×4 | fail (584.062px) | fail (584.062px) | pre-existing (O3) |
| `layers-panel-visual:5` | fail (773.34 vs 666.6) | fail (identical) | pre-existing (O5) |
| `layers-panel-real-world:41` | fail | fail | pre-existing (O3) |

## 7. Coverage matrix

| Surface / condition | Status |
|---|---|
| Layers rail 1024–1920 wide, default + seeded layers | **Verified** (probes + spec) |
| Layers rail short window (1024×600) scroll + row controls | **Verified** |
| Layers/Inspector drawers at 320/360/390/768/844 (portrait + landscape) | **Verified** (focus trap, Escape, focus return, reachability) |
| Text enlargement 200%: shell grid, chrome rows, filter bar, canvas name, align cluster, segmented labels, field labels | **Verified** (spec + probes) |
| 320px reflow floor / 400%-zoom equivalent (editor shell) | **Verified** — existing `reflow-floor-320x640` matrix entries pass |
| Inspector rail widths 240/280/320/400/640 (position/size contracts) | **Blocked** by pre-existing `setRail` harness failure (O3) — the underlying sections were re-measured via probes instead |
| Dock chrome vs document tab at 200% text | **Defective, open** (O1, ownership-blocked) |
| Legacy vs dock resize handles | **Defective, open** (O2, ownership) |
| Visual baselines (navigator region) | **Stale pre-existing** (O4, handed off) |
| Non-Chromium engines, screen readers, real OS text scaling, physical touch/pen, packaged app | **Not tested** (not available in this environment) |
| RTL locales | **N/A** — product ships no RTL locale |
| Website / marketing surfaces | **Not applicable** to this scope (editor panels only) |

## 8. Not established

- No screen reader was run; accessible names/roles of the changed surfaces
  were exercised only through Playwright role queries.
- Text enlargement was exercised through the repository's established stand-in
  (`documentElement.style.fontSize = '200%'`); Firefox "Zoom text only", a
  real user stylesheet, and OS text scaling were not run.
- No physical device, software keyboard, or packaged desktop-app validation.
- Chromium only; Firefox/WebKit not run for these specs.
- Screenshot review by the agent was limited by the unreliable image return
  of the read tool; geometry, hit tests, and event traces were verified
  programmatically and the captured PNGs are on disk for human review.

## 9. Coordination / handoff

See `docs/agents/responsive-layers-inspector-2026-09-30-ownership.md` for the
ownership record, the exact text proposed for `responsive-workspace.md`
(edited concurrently — not touched here), and the handoff list for O1–O5.
