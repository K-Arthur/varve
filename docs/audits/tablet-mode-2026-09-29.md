# Tablet editing audit — 2026-09-29

**Status:** adaptive tablet layout and scoped gesture-cancellation/rollback
changes are committed on `master`; architecture and website copy plus reviewed
screenshots are prepared in the shared worktree. Focused browser/site checks
pass for the tested flows. The complete poster round trip, current shared-tree
build, clean full-repository gate, matched performance comparison, and
physical-device acceptance remain open as described below.
**Initial audit baseline:** `master` at
`220553d97aafc4db010e8cb239c5807fead9d0c0` (`docs: record shared admission
milestone evidence`), 231 commits ahead of `origin/master` at inspection.
**Latest committed milestones:** research ledger `248b1ab9e`, adaptive tablet
presentation `f4d953eb9`, and gesture cancellation/rollback
`2cf3c2493`, all on `master`. An unrelated documentation commit
`267f852c2` landed during validation and was retained. The checkout remained
actively shared throughout validation; historical planner snapshots selected
488, 493, and 504 files, while the latest run before the pointer milestone
selected 481 files. The latest plan still emitted
`FULL-SUITE ESCALATION: YES`. No branch or index-wide operation was used.
**Hardware:** no Lenovo Duet/USI device available; physical-device claims stay
unverified.

## Baseline and workflow audit matrix

The risk column records the static baseline before implementation; the
resolution and evidence below supersede its “pending reproduction” wording.

| Workflow | Existing implementation | Initial evidence / risk | Severity | Smallest coherent fix and regression |
|---|---|---|---|---|
| Responsive shell and viewport changes | Tablet preference, adaptive presentation, keyboard-safe spacing, and drawer behavior now sit on the shared editor shell. | **Confirmed and corrected:** browser checks showed overlapping panel launchers, a title/dock collision, and clipped touch multi-select at narrow widths. The final 13-size Chromium matrix passes with no horizontal drift, no FAB/panel overlap, 44px primary targets, and a visible compact multi-select action. | P1 when editing is blocked; otherwise P2 | Retain the regression matrix and screenshots; physical viewport/scaling validation remains open. |
| Gesture cancel then fresh drag | `BaseTool` owns a reusable captured drag state; tools implement cancel hooks. | Static inspection shows `onPointerCancel` resets `drag` but does not reset private `dragStartFired`. The next gesture may skip `onDragStart`; this has not yet been reproduced on current runtime. `BaseTool.ts` also contains a concurrent pen-up endpoint patch that must be preserved. | P1 | Centralize idempotent drag cleanup and test cancel → immediate fresh drag with a tool whose start/move/end calls are observed. Add a browser pointer-cancel regression. |
| Selection cancellation/takeover | `SelectTool` uses the shared transaction/history path and supports preview positions in the current worktree. | A static review reports selection resolution can precede transaction snapshot. Current `SelectTool.ts` is concurrently modified, so inspect exact ordering and reproduce selection/geometry/dirty/history state before touching it. | P1 | Begin tentative transaction before selection mutation; cancellation restores the recorded selection/document state without global Undo. Assert exact document, selection, dirty flag, and history equality. |
| Pen plus touch / pinch ownership | `inputPolicy.ts`, normalized samples, and `inputPipeline.ts` arbitrate canvas ownership. | Static review reports suppressed touch IDs may remain in navigation bookkeeping and capture loss may dismantle a handoff. `inputPipeline.ts` is concurrently modified for camera-preview listener stability. Not a confirmed runtime failure. | P1 | Separate transfer from terminal cancel; consume suppressed IDs through lift; test both pointer arrival orders, capture, one-to-two-to-one, and fresh contacts after pinch/pen-up. |
| Tool/document switch and delayed paint | `useToolManagerSync`, per-tool activation and paint scheduling own current cleanup paths. | Static review identifies possible stale preview/abort across tool or document switches, especially if rollback targets the newly active session. Reproduce with delayed completion before adding session guards. | P1 | Retain the origin tool/session/document/generation in an interaction record; synchronously cancel before transition; ignore stale completions. Test old completion after tab switch. |
| Pressure/samples | `inputNormalizer.ts` preserves coalesced sample ordering and prediction separation; `BaseTool` now forwards a final pointer-up coordinate. | Static review reports pressure observation may count hover/up zero around constant active 0.5 as “pressure varied.” Source-only until verified. | P2 | Count variation only for active contact, preserve stationary button/pressure changes, and test constant 0.5 vs variable pressure with predictions excluded from committed geometry. |
| Inspector editing and focus | Inspector is mounted in the existing shell; panel data and document model are shared. | Existing responsive doc/test describes the sheet as modal. Target baseline screenshot from a prior disposable browser run found a portrait full-width scrim covering the canvas; that run predates this audit snapshot, so treat it as prior evidence pending rerun. | P1 | Compact nonmodal side rail in landscape and low-profile lower pane in portrait; explicit modal expansion. Verify `aria-modal`, focus ownership, canvas hit testing, selection, and panel scroll. |
| Text/precision fields with software keyboard | `keyboardInset.ts`, `KeyboardInsetPublisher`, text editors, numeric inputs, and portal geometry exist. | Existing model tests inject synthetic geometry. They do not certify a real floating OSK. Static review indicates viewport offset/intersection handling is less complete than height-only consumers. | P1 if commit controls are occluded | Extend geometry model only where browser reproduction demonstrates double-counting or occlusion; test docked and floating geometry, caret, IME composition, and reachable Done/Cancel. |
| Back and nested overlays | `TabletBackDismiss` adds a same-URL history guard and preserves pending guard cleanup. | **Confirmed:** before the fix, a registered nondismissible tooltip caused `pushState` once even though Back had no safe dismissal path. The focused regression failed with that behavior. The fix filters for connected Back-capable overlays with a close handler, uses an explicit dialog Back event, and marks guard-owned `popstate` events before deep-link routing. Unit coverage passes; nested browser Back remains in progress. | P1 | Use the shared topmost dismissible API and handled result; verify nested menus, dialog-contained overlays, close/open races, deep links, and Forward. |
| Import/save/reopen/export/offline | Browser/PWA file routes and local persistence exist; platform routes differ. | No current end-to-end poster workflow has been observed in this snapshot. Do not infer route reliability from code or documentation. | P1 | Exercise cancellation, denied/revoked access, quota/full storage, offline reopen, and interrupted recovery. Repair only reproduced gaps; compare document and export fidelity. |

## Current dispositions

- **Layout:** the final Chromium matrix passed 13 viewport sizes, including both
  sides of the breakpoints, landscape/portrait, narrow split view, and the
  640×400 CSS viewport used to represent 200% browser zoom. It asserts no
  horizontal drift, minimum canvas dimensions, non-overlapping launchers,
  44×44 primary targets, and a visible compact multi-select action. Dark and
  high-contrast/reduced-motion captures passed and were reviewed. The capture
  represents CSS viewport reduction; browser zoom itself and physical scaling
  are not certified. After review, the compact label was raised from 9px to the
  `font-size-2xs` token and `audit:sizing` passed. A fresh browser rerun then
  hit the shared missing-export error documented below, so the corrected label
  has not received a new screenshot pass.
- **Pointer ownership and rollback:** the combined synthetic Chromium run
  passed 14 of 15 selected cases. Its only failure was the pen-success test
  expecting zero layers even though the owned pen stroke correctly created one.
  The assertion now requires exactly one surviving stroke; its focused rerun
  passed. The other cases passed for second-finger cancellation, pinch handoff,
  the post-pinch contact, both pen/palm orders, nested Back, rotation, keyboard
  geometry, numeric controls, and touch Undo/Redo. The 13-file focused unit run
  passed 224 tests.
- **Keyboard and Back:** the inset unit tests and synthetic Chromium virtual
  keyboard publication test passed. Nested submenu/parent Back dismissal and
  deep-link guard unit tests passed. Real IME composition, floating hardware
  keyboards, and OS edge gestures remain device checks.
- **Files and recovery:** a Chromium run passed local offline editing, first
  Save, cancelled Save As, and write/quota failure; the added permission
  revocation/retry test passed while retaining its original target. An image
  import landed, but its old screenshot expectation was 682×597 while the live
  canvas was 740×544; the displayed image and scene object were correct. The
  broader poster/panel test loaded `poster.varve` and then logged
  `Maximum update depth exceeded` during Logo/Code workspace changes. The
  active-document offline test did not exercise offline reload/reopen. Full
  poster save/reopen/export fidelity and interrupted-session recovery remain
  outstanding.
- **Keyboardless editing subflows:** a separate 10-test Chromium batch passed
  text placement, exact-value persistence, multi-select alignment, align-to-
  canvas, layer rename, grouping/ungrouping, lock, reorder, and clean SVG export.
  Each test seeds its own scene; this is subflow coverage, not one imported-image
  poster round trip. The consolidated panel run described above remains open.
- **Marketing:** the production site built in both root-path and GitHub Pages
  modes. The tablet showcase capture differed from its old baseline, was
  visually inspected, and the updated `showcase-light` baseline passed on
  rerun. Product copy now distinguishes browser editing from installed-PWA,
  Crostini/ARM64, and physical-device evidence.

## State and ownership contract

| State | Owner | Transaction and transition rule |
|---|---|---|
| Idle | No canvas pointer owns an edit | UI controls and normal panel scrolling receive input. |
| Tap candidate | One pointer and the tool instance/session that began it | No document or history mutation until the tool’s tap/drag threshold resolves. Rejection returns to idle without a synthetic click-through. |
| Editing/drawing | The active pointer plus captured tool, document, and interaction generation | One scoped transaction. Authoritative samples are committed once; predictions remain visual-only. |
| Navigation | A fresh set of canvas touch pointers accepted by the navigation owner | Transfer rolls back any tentative tool transaction first; capture loss caused by that transfer cannot terminate the pinch. A finger already down through pen-up/pinch cannot become a new edit. |
| Long press | The tap candidate’s original pointer/tool/session until the deadline | A move, cancel, tool/document transition, or modal takeover cancels the timer; a completed long press opens one context action. |
| UI interaction | The targeted control/panel/overlay, independent of canvas touch suppression | Safe noncanvas controls continue working during pen ownership. Compact inspector remains nonmodal; expanded inspector is modal. |
| Terminal cancellation | The retained interaction record, closed exactly once | Restore only that record’s document/selection/dirty/history snapshot; clear timers, previews, capture, auto-pan, and scheduled work. Never issue global Undo. |

## Validation evidence

This section is appended as current-master implementation milestones land.
Historical ChromeOS Stage 4 results are retained in
[`chromeos-stage4-input-responsive-2026-09-12.md`](chromeos-stage4-input-responsive-2026-09-12.md)
and are not presented as fresh validation of the current checkout.

### Milestone 1 — Back dismissal contract

- Changed scope: `packages/ui` overlay registry and dialog participation;
  `packages/editor` tablet Back and deep-link event ownership; nested Back E2E.
- Regression: the tooltip-only history-guard case failed before the fix and
  passes after it. Dialogs now state whether platform Back can close them;
  menus/submenus retain their owning close callbacks even though they disable
  document-level Escape handling.
- Commands: `pnpm exec vitest run --maxWorkers=1
  packages/ui/src/components/OverlayRegistry.test.ts
  packages/editor/src/navigation/TabletBackDismiss.test.tsx
  packages/editor/src/navigation/deepLinkHandler.test.ts
  packages/ui/src/components/Dialog.test.tsx` (4 files, 45 tests passed);
  focused rerun without Dialog tests (3 files, 28 tests passed);
  `pnpm typecheck:e2e` (passed).
- `pnpm verify:plan` saw 539 shared-worktree paths and escalated to the full
  suite for unrelated workspace/toolchain/validation-infrastructure and
  framework-runtime changes. Those paths are not part of this milestone.
- The final `pnpm audit:docs` result is recorded in the validation report
  below. The tablet docs are included in that audit.
- Nested-menu Chromium E2E passed. Browser emulation does not certify physical
  ChromeOS hardware.

### Milestone 2 — pointer ownership, rollback, and keyboard geometry

- Commit `2cf3c2493` retains pointer, tool, session, generation, and original
  context in one interaction record. Cancellation is idempotent, resolves the
  owning tool before tool/document changes, clears capture and scheduled
  interaction work, and separates navigation transfer from terminal
  cancellation. Pen takeover consumes suppressed touch contacts until lift.
- Tentative selection moves begin their transaction before changing selection.
  Abort restores the document, selection metadata, dirty/history labels,
  session state, and selection-history snapshot without global Undo. Cancelled
  BaseTool drags reset their start flag.
- Keyboard inset publication accounts for visible-viewport offsets and
  reported keyboard rectangles. Docked keyboard intersections avoid duplicate
  subtraction; floating bounds are reported without reserving the whole bottom
  edge.
- Initial focused unit/browser coverage passed 13 files/224 tests and selected
  synthetic pointer, pinch, pen/palm, Back, and keyboard geometry checks. After
  the commit, focused Vitest passed 6 files/152 tests plus 2 transaction-history
  files/22 tests; its commit checkpoint passed 5 files/144 tests. Physical
  pressure, palm rejection, and OS edge gestures remain device checks.
- `pnpm typecheck:e2e` passed during the initial interaction run. A later
  post-commit rerun currently fails in the concurrently modified
  `tests/e2e/canvas/raster-magic-wand.spec.ts:243` because `x` and `y` may
  be undefined; this file is outside the tablet-owned scope.

### Milestone 3 — adaptive tablet presentation and product evidence

- `tests/e2e/interaction/chromeos-device-matrix.spec.ts` viewport matrix:
  **13/13 passed** at 960×600, 899×600, 900×600, 1024×640, 1025×640,
  1094×700, 1095×700, 1200×750, 1280×800, 600×960, 800×1280, 480×640, and
  640×400. The last size represents a reduced CSS viewport; it is not actual
  browser zoom.
- Dark and high-contrast/reduced-motion tablet captures passed (2/2). Reviewed
  artifacts are in `docs/screenshots/tablet-mode-2026-09-29/`; the product
  capture is `docs/screenshots/product/tablet-workspace-light.png` (1200×750,
  `poster.varve`). Chromium reported version 151.0.7922.34 on Linux.
- `pnpm build:website` and `pnpm build:website:pages` both passed (112 routes
  each). The product-showcase visual initially differed from the old snapshot;
  after visual review the snapshot was deliberately regenerated and its
  focused test passed on rerun.
- `pnpm --filter @varve/website typecheck` passed earlier in the run. The
  website build also ran Astro diagnostics: 164 files, zero errors, warnings,
  or hints.

### Milestone 5 — keyboardless editing subflows and style audits

- Under the heavy-task lease, a focused Chromium run passed **10/10** selected
  cases: area text placement; typed inspector edit persisted to the document;
  multi-select alignment and align-to-canvas; layer rename, group/ungroup,
  lock, and reorder; and clean vector SVG export. The imported JPEG test also
  confirmed the actual fixture image renders, with its screenshot dimension
  mismatch recorded above. These cases do not close the single-document poster
  acceptance flow.
- `pnpm audit:docs` passed (1,107 documents, 710 links, 177 ADRs indexed);
  `pnpm audit:emoji` passed (5,140 files); `pnpm audit:tokens` passed all 303
  pairs across three themes and the usage scan (585 properties, nine documented
  hooks). `pnpm audit:radius` and `pnpm audit:spacing` passed. `pnpm
  audit:inspector-css` passed with existing debt-inventory warnings;
  `pnpm lint:css` passed. `pnpm audit:sizing` initially caught a new 9px tablet
  caption. It now passes after the caption changed to
  `var(--font-size-2xs)` (67 ratcheted declarations across 171 files).

### Milestone 6 — bounded performance diagnostic

- The production workload runner built a dirty-tree bundle and completed 100
  `single-drag` traces on `vector-500` (500 nodes), Chromium 151 headless on
  Linux, AMD Ryzen 3 5300U, eight logical CPUs, and 22.8 GiB host memory.
  Diagnostic values: input-to-commit p95 147.8ms; input-to-next-paint p95
  64ms; frame-total p95 3.6ms; pointer-input p95 1.9ms; renderer-main p95
  3.7ms; and 100 post-GC JS heap samples all 39.6MB. The JSON is at
  `/tmp/varve-tablet-vector-500.json`.
- This run is explicitly `dirty_build` and used headless Chromium with
  unverified hardware acceleration, so it is not a qualified regression result
  or a before/after comparison. The runner does not count React commits or
  Long Tasks, and this environment is not the requested 8GB reference or
  constrained 4GB profile. No result is extrapolated to those devices.
- The `vector-5k` run could not build: Vite reported that
  `packages/editor/src/tools/artworkSampling.ts` imports
  `MAX_AREA_SELECTION_PIXELS`, which `@varve/engine` does not export in the
  current shared checkout. A follow-up visual rerun hit the same error before
  the tablet page loaded. This integration failure is outside the tablet-owned
  paths and was left for its owner to resolve.

### Milestone 4 — browser file flows and repository gate

- Save/offline E2E command selected four tests: active-document offline
  editing, first Save, cancelled Save As, and write/quota failure — **4/4
  passed**. The revoked-permission/restore-same-target regression passed **1/1**.
- The JPEG import created a scene object and rendered the real fixture image,
  but the old screenshot baseline failed because the canvas dimensions changed
  from 682×597 to 740×544. The actual image was inspected; its 320×214 artwork
  remained present. Snapshot ownership must be resolved with the editor/layout
  change that caused the dimension change before updating this unrelated file.
- `tests/e2e/workspace/consolidated-panels-responsive.spec.ts` failed with a
  `Maximum update depth exceeded` console error while changing Logo/Code
  workspace panels after loading the poster. This shared workspace failure
  remains open; the test was not represented as a tablet pass.
- The latest recorded `pnpm verify:plan` selected 481 changed files and
  returned `FULL-SUITE ESCALATION: YES` for workspace/toolchain/
  validation-infrastructure changes and a high-risk framework/runtime
  dependency. Earlier snapshots selected 488, 493, and 504. The subsequent
  `pnpm verify:affected` exited 2 as designed and requested
  `pnpm verify:full`.
- The one-shot `pnpm verify:triage` stopped at Tier 0 because the shared,
  untracked `native-webgl2-2026-09-28T10-16-25-630Z.json` lacks its required
  final newline; it did not reach Playwright lanes. The required
  `VARVE_FULL_GATE_REASON="tablet mode integration; planner reported
  workspace/toolchain and framework-runtime escalation" pnpm verify:full`
  ran, then reported shared formatter findings and the architecture gate
  failure: 15 distinct cycles (including one new engine cycle), 73 unstable
  modules, and hub budgets over for Shell (56), Menubar (21), and context (78).
  Layer checks passed. The affected package compiler run later stopped in
  `packages/editor/src/components/Inspector/controls/CurveEditor.test.tsx`
  because its `getByRole` calls pass an unsupported `exact` option. The
  latest full gate also reports a missing `sampleSource` in a concurrent
  Magic Wand default and four `artworkSampling.ts` type errors (missing engine
  export, map mutability, `Stroke.width`, and union narrowing). The standalone
  `pnpm typecheck:e2e` passed.
- A later pre-pointer run selected 504 shared files and still emitted
  `FULL-SUITE ESCALATION: YES`; the most recent post-layout plan before the
  pointer commit selected 481. The post-pointer `node
  scripts/audit-architecture.mjs --ci` exited 0 with 14 reported cycles
  (2 engine, 11 scene, 1 editor), 41 unstable editor modules, and hub budget
  warnings for Shell (56 imports), Menubar (21), and context (78); layer
  checks passed. `pnpm audit:sizing` passed after the tablet caption
  correction. The final tablet visual rerun was attempted under the
  heavy-task lease but stopped after Vite exposed the missing engine export;
  it did not produce a new screenshot.

### Milestone 7 — mirrored controls and keyboardless editing actions

- Added a saved Appearance preference to mirror tablet drawer launchers, separate
  from density, drawing-input policy, and desktop panel docking. Updates use the
  existing contact/IME deferral so a placement change cannot move controls
  during a live gesture or text composition.
- Added a tablet-only Editing controls popover with latched Constrain, From
  centre, and Bypass snap modes; one-shot deep selection; Duplicate; alignment;
  and layer-order commands. Commands call editor APIs directly. Selection
  Alt-drag remains duplicate, and From centre applies to creation tools and
  selection-handle resizing.
- Focused Vitest and Biome checks pass: 143/143 tests in 7 files; `biome check`
  passes on the 18 tablet implementation/test files. Website typecheck reports
  0 errors, warnings, or hints; `pnpm build:website` built 112 routes.
- Current docs, emoji, and token audits pass (1110 docs/711 links; 5148 files;
  303 contrast pairs across three themes plus the token-use scan). The current
  spacing audit fails on the concurrent `packages/editor/src/components/Inspector/selectionSources.css`
  `padding: 2px` baseline drift; that file is outside tablet ownership.
- A full `chromeos-device-matrix.spec.ts` invocation was stopped after 19 cases
  because the file also runs lengthy non-matrix gesture scenarios. Its report
  is marked interrupted and is not counted as a pass. Landscape and portrait
  screenshots from that run were visually inspected; the focused viewport
  matrix and command-popover screenshot still need a completed leased run.

### Milestone 7 continuation — modifier lifetime and visual review

- Latched Constrain, From centre, and Bypass snap settings are snapshotted at
  pointer-down. A second contact changing the controls cannot alter a live
  gesture. `SelectionOverlay` uses the same down-time snapshot for handle
  transforms; its 24px resize targets use a separation policy to avoid
  overlapping hit regions.
- The focused tablet interaction set passes **187/187 tests in 8 files**;
  the final `pnpm typecheck:e2e` also passes after the latest visual-spec
  additions.
  The dedicated tablet controls browser test passes **1/1** at 1200×750 and
  600×960, including latching across orientation change, fresh hit bounds of
  at least 44×44 CSS pixels, Escape dismissal, and popover bounds.
- The current viewport matrix passes **13/13** under the heavy-task lease at
  Chromium 151.0.7922.34 on Linux, DPR 1. Updated PNGs and JSON geometry are
  in `docs/screenshots/tablet-mode-2026-09-29/`; page scroll width equals the
  viewport at 600×960 and 480×640, panel launchers do not overlap, and the
  measured tablet controls remain 44×44. These are browser-emulation results.
- A reviewed 1200×750 poster screenshot shows the tablet popover with modifier,
  selection, alignment, and layer-order actions. Its first draft covered the
  selected headline; the product capture is being split into a clean workspace
  image plus a focused keyboardless-controls detail before it is promoted.
- `pnpm --filter @varve/website exec astro check` passes with 0 errors,
  warnings, or hints (170 Astro files). The combined website typecheck still
  fails on unrelated concurrent issues in `tests/e2e/screenshot-delivery.spec.ts`
  and `tests/e2e/visual.spec.ts`. The editor-wide typecheck similarly reports
  existing errors in presentation, CurveEditor, and artwork-sampling files;
  it reports none in the tablet-owned files.
- The product presentation now has a dedicated tablet showcase slot, but the
  rebuilt website and promoted screenshot still need final validation after the
  two-scene reviewed capture.

### Milestone 8 — tablet top bar and workspace switcher

- Coarsened the app menu, home, workspace, More, and history controls to a
  shared 44px touch-target rhythm. Portrait uses two aligned rows so application
  menus and workspace/history actions no longer compete in one compressed
  strip. Tablet workspace keyboard badges are hidden while shortcut names and
  tooltips remain available.
- The workspace overflow calculation now reads the CSS-resolved icon target
  width and budgets the same width for the More control. That keeps its visible
  tabs within the measured wrapper instead of letting the dock cover the
  document title at tablet widths. A focused layout regression passes for
  44px targets.
- Visual review caught an additional 899px landscape collision between the
  duplicate document title and the last menu item. The existing 900–1094px
  duplicate-title rule now extends through compact widths; the document tab
  retains the name. The browser assertion covers intersections with both the
  menu rail and workspace dock, and checks the title yields through 1094px.
- Evidence so far: `pnpm verify:plan` selected 701 changed shared-worktree
  files and reported `FULL-SUITE ESCALATION: YES`; the focused overflow unit
  suite passed 13/13; Biome on the changed TypeScript/E2E files passed; docs
  audit passed at 1,119 documents and 728 links; token audit passed 303 pairs
  across three themes plus the usage scan. The architecture audit exited 0
  with no layer violations, while reporting 14 existing cycles and the shared
  hub import warnings.
- Latest recheck after the compact-width correction: `pnpm verify:plan`
  selected 755 shared-worktree files and again reported `FULL-SUITE ESCALATION:
  YES`; the focused overflow and workspace-tab suites pass 21/21, and
  `pnpm audit:docs` passes at 1,121 documents, 732 links, and 178 ADRs. A fresh
  `pnpm audit:emoji` passes across 5,197 files. The
  spacing audit now reports only the unrelated legacy
  `Presentation/presentationNavigator.css` declaration; the earlier
  ProductShowcase/ScreenshotImage drift has been documented and cleared.
- Final focused browser run: **6 passed, 1 transient setup failure**, followed
  by a passing retry of that exact case, under the heavy-task lease in
  Chromium 151.0.7922.34. The 899×600 and 1095×700 landscape boundaries,
  portrait compaction at 600×960 and 800×1280, and the keyboardless modifier
  popover after orientation change all pass. The first 600×960 attempt timed
  out in shared `navigateToEditor` before tablet assertions; the same case then
  passed on retry and produced a valid capture. Final screenshots are in
  `docs/screenshots/tablet-mode-2026-09-29/topbar-review-final4/` and
  `topbar-review-retry/`.
- Visual inspection of the final 899×600, 1095×700, and 800×1280 captures
  confirms the title/menu collision is gone, the active workspace is named,
  number badges are absent, and portrait history controls align on the second
  row without covering the application menus. This remains Linux Chromium
  emulation, not physical tablet certification.
- The earlier 899px collision run was stopped after 10 passing old-CSS cases;
  its screenshots remain useful as **before** evidence only. A later queue
  attempt timed out without launching. The current run supplies the first
  post-fix browser evidence.
- The reviewed tablet workspace and editing-controls scenes were recaptured
  from committed `master` `576b7e4ff82c1aff01bc2daaf1b3c15b14002dac` and
  promoted to the website screenshot manifest. Both entries now record that
  commit in `lastValidatedAgainst`; the manifest and product/website copies
  resolve to the reviewed captures.
- Current shared-tree failures outside these top-bar files: editor typecheck in
  `CurveEditor.test.tsx` and `exportService.test.ts`; `audit:sizing`,
  `audit:radius`, and interface-sizing drift in
  `Presentation/presentationNavigator.css`; one initial 600×960 navigation
  setup timeout (its exact retry
  passed); and eight pre-existing
  editor CSS Stylelint findings. `pnpm typecheck:e2e` now passes. The inspector
  CSS audit is clean with its non-blocking debt inventory warnings.

### Final tablet top-bar and website verification

- Post-commit product capture command:
  `pnpm screenshots:product -- --scenes tablet-workspace,tablet-controls --review-dir /tmp/varve-tablet-topbar-postcommit-2026-09-29 --sync-reviewed`.
  The reviewed 1200×750 workspace capture shows the named Design pill, a
  coherent menu/workspace/history rhythm, the tablet Inspector beside the
  canvas, and a keyboardless text-edit row. The 800×600 controls detail shows
  visible tool modifiers, duplicate, alignment, and layer-order controls.
- Visual inspection of both promoted PNGs passed. The browser evidence is
  Linux Chromium emulation; it does not certify physical tablet hardware.
- `pnpm --filter @varve/website exec astro check` passed: 171 files, zero
  errors, warnings, or hints. `pnpm build:website` and
  `pnpm build:website:pages` both passed and each built 114 routes.
- The screenshot manifest records the implementation commit above as
  `lastValidatedAgainst` for both tablet scenes. Website showcase and image
  component spacing exceptions are documented inline for the scoped spacing
  audit.

## Agent Validation Report

```text
Changed scope: editor pointer ownership/transactions, tablet layout/settings, keyboard inset and Back routing; architecture/user docs, marketing pages and screenshot manifest/assets; focused E2E and unit regressions.
Validation plan: latest `pnpm verify:plan` selected 755 shared-worktree files, Tier 0–4 affected closure, and FULL-SUITE ESCALATION: YES (workspace/toolchain/validation-infrastructure and high-risk framework/runtime dependency).
Commands actually run: `pnpm verify:plan` (488, 493, 504, 481, 701, 748, then 755 shared-worktree files); `pnpm verify:affected`; `pnpm verify:triage`; the stated-reason `pnpm verify:full` (run twice); focused Vitest (13 files, 224 tests); `pnpm typecheck:e2e`; tablet viewport/theme/gesture and editing-subflow E2E under heavy-lease; save/offline/file-import/panel E2E under heavy-lease; production workload `vector-500` single-drag (100 samples); attempted `vector-5k` production workload (build blocked); `pnpm screenshots:product -- --scenes tablet-workspace,tablet-controls --review-dir /tmp/varve-tablet-topbar-postcommit-2026-09-29 --sync-reviewed`; `pnpm --filter @varve/website exec astro check`; `pnpm build:website`; `pnpm build:website:pages`; website showcase visual E2E; `pnpm --filter @varve/website typecheck`; focused interaction Vitest (6 files/152 tests plus 2 transaction files/22 tests); commit checkpoint (5 files/144 tests); `pnpm typecheck:e2e` (failed on concurrent raster-magic-wand coordinate narrowing); architecture `--ci` audit; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm audit:tokens`; `pnpm audit:radius`; `pnpm audit:spacing`; `pnpm audit:sizing`; `pnpm audit:inspector-css`; `pnpm lint:css`.
Passed: 152 focused interaction tests, 22 transaction/history tests, and 144 commit-hook tests; 224 earlier focused unit tests; 13/13 viewport matrix before the final typography correction; 2/2 theme/reduced-motion screenshots; corrected focused pointer assertion; nested Back/gesture/pointer checks; 10/10 keyboardless editing subflows; 4/4 save/offline cases; 1/1 revoked-permission retry; standalone E2E typecheck on the final retry; focused top-bar E2E (6/7 on first run, with the sole setup timeout passing on exact retry); 2/2 reviewed post-commit tablet captures; website Astro diagnostics (171 files, zero diagnostics); both website builds (114 routes each); focused product-showcase visual; docs, emoji, token, inspector-CSS, architecture, and health audits.
Failed or blocked: an earlier `pnpm typecheck:e2e` invocation hit possibly-undefined coordinates in concurrently edited `tests/e2e/canvas/raster-magic-wand.spec.ts:243` and passed on a later standalone retry; `audit:radius`, `audit:sizing`, interface-sizing, and `audit:spacing` report unrelated legacy findings in `Presentation/presentationNavigator.css`; `lint:css` reports eight existing editor CSS findings; `verify:affected` required full-gate escalation; triage stopped on shared generated-JSON formatting; latest full gate reported shared formatting, 15 cycles including a new engine cycle, 73 unstable modules, hub import budgets over, and unrelated editor type errors in `CurveEditor.test.tsx`, Magic Wand defaults, and `artworkSampling.ts`; `vector-5k` performance build and final visual rerun stopped on the shared missing engine export; JPEG import screenshot baseline size mismatch; shared Logo/Code E2E update-depth error.
Skipped as unrelated or unavailable: physical Lenovo Duet/USI, physical Windows-touch, Android and iPadOS checks; installed-PWA file launch and physical OSK/IME; actual browser zoom versus equivalent CSS viewport; offline reload/reopen and interrupted recovery; constrained 4 GB and reference 8 GB hardware profiles; full poster save/reopen/export fidelity; 5k performance profile, React commit counts, Long Task counts, and a clean matched before/after performance comparison.
Escalations: full repository gate required by planner; executed with the stated tablet integration and workspace/toolchain/framework reason.
Full suite run: yes (escalated gate attempted; blocked before completion by shared formatter/architecture/typecheck failures).
If yes, reason: planner explicitly emitted FULL-SUITE ESCALATION: YES.
```
