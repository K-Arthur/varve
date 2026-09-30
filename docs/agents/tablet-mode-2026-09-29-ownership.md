# Tablet editing completion — ownership and validation

**Task:** tablet-mode completion requested 2026-09-28.
**Branch:** `master`, per user instruction; do not create a branch.
**Initial snapshot:** `220553d97aafc4db010e8cb239c5807fead9d0c0`.
**Scope:** current-master diagnosis, safe input/document cancellation, adaptive
tablet controls and inspector, keyboard/Back/file workflow checks, docs,
marketing claims, and visual/E2E evidence.

## Shared checkout rules

The checkout is actively shared and has concurrent staged, unstaged, and
untracked work. Re-read status, the target file, and its diffs before every
patch and commit. Do not switch branches, stash, reset, clean, stage broadly,
rewrite history, or kill unrelated processes. Commit only explicitly owned
paths/hunks; do not push or publish.

Current known overlaps: `BaseTool.ts` (pen-up endpoint work), `SelectTool.ts`
(preview-position work), `inputPipeline.ts` (camera-preview listener work),
`context.tsx` (renderer/effects state work), `settings.ts` (renderer
setting), `Shell.tsx` and `editor.css` (workspace/dock work), screenshot
generation, website content/screenshots, and the behavior matrix. Preserve
those changes. Tablet changes below are limited to recorded hunks in the shared
files.

Existing ownership docs for drawing input, canvas fluidity, illustration,
low-end effects, and design-system work are authoritative for their recorded
files. This task does not take over their broad scopes. Current baseline risks
and the interaction contract are recorded in
[`../audits/tablet-mode-2026-09-29.md`](../audits/tablet-mode-2026-09-29.md);
fresh product/standards research is in
[`../research/tablet-mode-2026-09-29.md`](../research/tablet-mode-2026-09-29.md).

## Files owned by this task

| Path | Status |
|---|---|
| `docs/agents/tablet-mode-2026-09-29-ownership.md` | This record. |
| `docs/research/tablet-mode-2026-09-29.md` | New source ledger and decisions. |
| `docs/audits/tablet-mode-2026-09-29.md` | New audit matrix and acceptance evidence. |
| `packages/ui/src/components/OverlayRegistry.ts` and its test | Explicit topmost escape-dismissible overlay selection for platform Back. |
| `packages/ui/src/components/Dialog.tsx` | Narrow integration hunk: expose whether a Dialog participates in platform Back and handle the explicit Back-dismiss event. Existing focus-restoration edits are preserved. |
| `packages/editor/src/navigation/TabletBackDismiss.tsx` and its test | Only dismissible top surfaces hold the guard; Back returns an explicit handled result and resolves dialog-contained overlays first. |
| `packages/editor/src/navigation/overlayGuardFlag.ts`, `deepLinkHandler.ts` and its test | Shared per-event traversal ownership so guard pops do not replay deep links; ordinary Back/Forward remains routable. |
| `packages/editor/src/lifecycle/TerminationDialogHost.tsx`, `packages/editor/src/components/{BatchBgRemoveDialog,Export/ExportDialog}.tsx` | Mark explicitly non-dismissible in-progress/termination dialogs; each file will be rechecked before edits. |
| `packages/editor/src/settings.ts`, `settings/layoutPresentation.ts`, `components/Settings/{SettingsContext,SettingsDialog}.tsx`, `components/Settings/layoutPresentation.css` | Persist the mirrored tablet control preference and defer presentation updates through the existing contact/IME controller. `settings.ts` and `SettingsDialog.tsx` also contain concurrent renderer-setting work; only tablet hunks are owned here. |
| `packages/editor/src/tools/{InteractionContext,ToolManager,SelectTool}.ts` and matching tool tests | Latched tablet modifiers are captured at pointer-down for the full gesture, creation-tool centre constraint, and one-shot deep selection. `SelectTool.ts` and its tests also contain concurrent position-preview work; preserve it. |
| `packages/editor/src/SelectionOverlay.tsx` and test | Carry captured tablet modifiers into selection-handle transforms and enforce nonoverlapping 24px resize targets. Preserve concurrent transform-preview work in the same files. |
| `packages/editor/src/components/FloatingToolbar/{FloatingToolbar,TabletTouchControls}.tsx` and matching CSS/test | Tablet-only 44px touch command popover, including the compact Gestures reference. `FloatingToolbar.tsx` also has concurrent placement-style work; preserve it. |
| `tests/e2e/interaction/tablet-keyboardless-workflow.spec.ts` | Integrated touch-only round trip: tool choice, authoring, select, multi-select, align, reorder, undo/redo. Reads the serialized document, not the chrome. |
| `tests/e2e/helpers/tabletControls.ts` | Shared `readEditorState` fiber reader and the touch-only `dismissTabletPanel` popover close (with a non-click-through assertion). |
| `tests/e2e/interaction/tablet-poster-round-trip.spec.ts` | Single-document file round trip: import a real raster, edit by touch, save, reopen from the written bytes, export SVG; asserts content fidelity on both sides of the save. |
| `docs/architecture/{responsive-workspace,input-system-behavior-matrix}.md`, `apps/website/src/pages/docs/{touch-and-pen,browser-demo,chromebook,settings}.astro`, `apps/website/src/pages/support/troubleshooting.astro`, `apps/website/src/components/ProductShowcase.astro`, `apps/website/src/data/screenshot-manifest.json`, `scripts/screenshots/product.mjs`, tablet product screenshots | Document verified tablet presentation and editing paths, qualify browser versus hardware evidence, and regenerate the tablet product visual. Several website, manifest, and screenshot files contain concurrent edits; commit only the tablet-owned hunks/assets. |
| Additional code/tests/docs/website paths | Record one at a time after checking ownership/status. |

## Commit boundary (why this task did not commit)

**Outcome (2026-09-30): committed as `301806b45`** — 146 files, the whole-file
set plus the hunk-selected set below, with `SelectionOverlay*`, `tools/types.ts`,
`Menubar.tsx` (find-replace), `ui/Dialog.tsx` (dialog focus), `Shell.tsx`,
`context.tsx`, `canvas/inputPipeline.ts`, `menu/defs.ts` and
`platform/src/web.ts` left uncommitted for their owners.

Built on an isolated index (`GIT_INDEX_FILE` seeded with `git read-tree HEAD`,
never the shared index) and verified before committing by extracting the
resulting tree and comparing typecheck error sets against a plain `HEAD` tree:
**editor 5 errors in both, e2e 1 error in both, and no error present in the
staged tree that is absent from `HEAD`** — i.e. the change adds none. (Those
pre-existing errors are the botched `SpecPanel/export.ts` merge in `HEAD` and
`packages/scene/src/auditAdapter.ts:365`; the working tree already carries the
`export.ts` fix, uncommitted, from its owner.) The committed tree then ran its
own unit tests from the extracted checkout: **6 files / 51 tests passed**.

The analysis below is retained because it is what the hunk selection was
derived from, and because the same boundary applies to any follow-up.


The tablet slice cannot be committed safely from this checkout without hunk-level
selection, because several tablet-owned files also carry another task's
uncommitted work (canvas-fluidity's render-only transform previews). Committing
a file wholesale would capture that work; committing only the tablet hunks needs
the resulting `HEAD` to be type-checked, which a shared dirty worktree cannot do
in place. The precise boundary is recorded here for the coordinator.

**Stage whole-file (entire diff is tablet):**

- `packages/editor/src/tools/InteractionContext.ts` and
  `packages/editor/src/tools/__tests__/InteractionContext.test.ts` — latched
  modifiers, `getControlSnapshot`, `consumeDeepSelect`, `armDeepSelect`.
- `packages/editor/src/tools/ToolManager.ts` — pointer-down latch capture and
  the latched-modifier pointer proxy.
- `packages/editor/src/settings/layoutPresentation.ts` and
  `packages/editor/src/settings/layoutPresentation.test.ts` — controls mirroring.
- `packages/editor/src/components/Settings/SettingsContext.tsx` — mirroring wiring.
- `packages/ui/src/components/Dialog.tsx` — platform-Back participation.
- `packages/editor/src/Menubar.tsx` — tablet keyboard-badge suppression (2 lines).
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` — only the
  `TabletTouchControls` import and its render slot.
- New files: `components/FloatingToolbar/TabletTouchControls.{tsx,css,test.tsx}`,
  `menu/menubarTabletLayout.test.ts`,
  `tests/e2e/helpers/tabletControls.ts`,
  `tests/e2e/interaction/tablet-{keyboardless-workflow,poster-round-trip,editing-controls}.spec.ts`,
  `docs/agents/tablet-mode-2026-09-29-ownership.md`,
  `docs/screenshots/tablet-mode-2026-09-29/**`,
  `docs/audits/tablet-mode-2026-09-29.md`,
  `docs/architecture/{responsive-workspace,input-system-behavior-matrix}.md`.

**Stage named hunks only:**

- `packages/editor/src/settings.ts` — stage the `AppearanceSettingsStore`
  `tabletControlsMirrored` field, `DEFAULT_APPEARANCE_SETTINGS`, and
  `normalizeAppearanceSettings`. Exclude every `RenderSettingsStore` hunk
  (`preferWebGpu` → `renderer`) and the `codegenWorkspace` comment edit.
- `packages/editor/src/components/Settings/SettingsDialog.tsx` — stage the
  `AppearanceSection` "Mirror tablet controls" `SwitchField`. Exclude the
  `GeneralSection` "Canvas renderer" select.
- `packages/editor/src/tools/SelectTool.ts` — stage
  `const tapToDeepSelect = interactionSession.consumeDeepSelect();`, the
  `!tapToDeepSelect` guard on `selectedLeafHit`, and
  `this.pointerDownCtrl = e.ctrlKey || tapToDeepSelect;`. Exclude
  `moveBaseDocument`, `previewAffectedIds`, `latestMovePositions`,
  `collectPreviewAffectedIds`, the `committedParentIndex` import, the
  `initialWorldBounds` snap anchoring, and the `previewNodePositions` /
  `clearNodePositionPreview` calls.
- `packages/editor/src/SelectionOverlay.tsx` and
  `packages/editor/src/SelectionOverlay.test.tsx` — **not separable.** Read on
  2026-09-30: the tablet hunks are co-edited inside the same hunks as the
  canvas-fluidity transform preview. `renderDocument` (fluidity) is threaded
  through nearly every hunk, and the tablet additions sit inside those hunks —
  `dragRef.current = { …, tabletModifiers }` is in a hunk whose context is
  `renderDocument`, `e.shiftKey || g.tabletModifiers.constrain` is inside a hunk
  that also switches `state.document` → `renderDocument`, and the
  `HANDLE_TARGET_HALF` rename shares a hunk with the `visibleHandles` rewrite.
  Hunk-level `git apply --cached` therefore cannot split them; line-level
  surgery would be required, and the result could not be type-checked without a
  node_modules-complete worktree.

Because of that, `SelectionOverlay.tsx` (and the interleaved
`SelectTool.ts` move-gesture region) must land **with** the canvas-fluidity work
or be committed by the coordinator who owns both. The tablet slice is otherwise
ready as listed above.

**Do not stage (other tasks' in-progress work):**

- `packages/editor/src/tools/types.ts` — the render/navigation preview
  callbacks (`getCurrentDocument`, `getCurrentAreaSelection`,
  `previewNodePositions`, `clearNodePositionPreview`, `previewPan`,
  `commitPan`) are canvas-fluidity work, not tablet.
- `packages/editor/src/Shell.tsx`, `packages/editor/src/context.tsx`,
  `packages/editor/src/canvas/inputPipeline.ts` — workspace/dock, renderer, and
  camera-preview work respectively.
- `packages/platform/src/web.ts` — Home workspace ids.

Note: excluding `packages/editor/src/tools/types.ts` is only safe if the
`SelectTool.ts` hunks above are the tablet ones; the tablet feature does not use
the preview callbacks.

## Validation report

### 2026-09-29 — keyboardless workflow completion

- **Gate repair.** `TabletTouchControls.test.tsx` failed because the tablet
  presentation gate (`data-layout-mode`) is published by `SettingsProvider`'s
  mount effect, so the trigger appears one microtask after first render; the
  test now awaits it. Deleted the leftover `zz-debug.test.tsx` debug dump.
- **Focused unit:** 11 files / 119 tests passed —
  `pnpm exec vitest run --maxWorkers=2` over
  `components/FloatingToolbar/{TabletTouchControls,FloatingToolbar}.test.tsx`,
  `menu/menubarTabletLayout.test.ts`,
  `navigation/{TabletBackDismiss.test.tsx,deepLinkHandler.test.ts}`,
  `SelectionOverlay.test.tsx`,
  `settings/{layoutPreferenceCommands.test.tsx,layoutPresentation.test.ts}`,
  `tools/__tests__/InteractionContext.test.ts`,
  `packages/ui/src/components/{OverlayRegistry.test.ts,Dialog.test.tsx}`.
- **Integrated browser:** `tests/e2e/interaction/tablet-keyboardless-workflow.spec.ts`
  passed 1/1 in the official configuration under the heavy-task lease
  (`VARVE_E2E_PORT=4436`, Chromium, `--workers=1`, 1.7m), and
  `tablet-editing-controls.spec.ts` passed 1/1 in the same lease window. After
  the post-review tidy-up (a type annotation and helper extraction) the spec
  was re-validated against the already-warm shared dev server (`:1499`,
  `--workers=1`) — 1 passed in 32.7s. Two further attempts to re-acquire the
  heavy lease failed inside `global-setup`'s warm-up navigation (Home and
  `.editor-shell` waits of 180s) because of concurrent shared-machine load,
  not the spec; `verify:plan` selects the spec and `tablet-editing-controls`
  for its `e2e:file:` tier. Iteration used a temporary local Playwright config
  pointed at the warm server; it was deleted.
- **Static:** `pnpm typecheck:e2e` passed; `biome check` passed on
  `tablet-keyboardless-workflow.spec.ts` and `TabletTouchControls.test.tsx`.
- **Inspected artifact:**
  `test-results/run-*/interaction-tablet-keyboar-*/keyboardless-workflow.png`
  (1200×750; aligned left edges at x=193, tablet Inspector rail, tablet
  controls trigger present).
- **Still unverified:** physical USI pressure/palm rejection, real OSK/IME,
  ChromeOS/Windows/Android/iPadOS hardware, and the full import→save→reopen
  poster file round trip.

### 2026-09-30 — poster round trip

- Added `tests/e2e/interaction/tablet-poster-round-trip.spec.ts` and closed the
  "full import→save→reopen poster file round trip" item above: unbound document
  → real JPEG import → touch Duplicate through the tablet controls → File > Save
  with the picker stubbed → reopen the written bytes → File > Export SVG…, with
  a per-node content signature compared across the save boundary and `<image`
  required in the exported SVG.
- `pnpm typecheck:e2e` and `biome check` pass on all three tablet specs.
- Observed and reported (not patched — another agent owns the file): the browser
  File > Export SVG… path announces "SVG export cancelled" with the real
  `showSaveFilePicker` present, because `saveBinaryFile` maps the post-await
  `SecurityError` to a user cancel. Evidence: unstubbed-picker probe reading
  `#strata-canvas-announcer-polite` = "SVG export cancelled", zero download
  events, `showSaveFilePicker` present.
- Also observed: `tests/e2e/fixtures/flower.jpg` is a 29-byte HTML file, so the
  import correctly rejects it with "0 layers inserted, 1 file failed". Use
  `photo-fixture.jpg` for a real raster.
- **Still unverified:** physical USI pressure/palm rejection, real OSK/IME,
  ChromeOS/Windows/Android/iPadOS hardware, and the real (unstubbed) browser
  file-picker handshake for save and export.

### 2026-09-30 — remaining-work triage

- **Commit:** not possible without including the canvas-fluidity work; the web
  hunks are co-edited in `SelectionOverlay.tsx` and the `SelectTool.ts` move
  region. See "Commit boundary" above for the exact map.
- **Export fix:** left to the owner of `packages/platform/src/web.ts` (active
  edit). Mechanism and evidence in the audit's Milestone 10.
- **Crash recovery:** 15–18 s of idle on a modified unbound document left
  `varve-recovery` empty and `varve-backups` empty while `varve-history` was
  populated and `.save-status` stayed `--dirty`. Cause unestablished; the two
  remaining candidates and everything ruled out are recorded in the audit's
  Milestone 12. No recovery E2E was added, because there is no point to restore
  through the UI and seeding the store directly would test a fixture rather than
  the product.
- **Performance:** `pnpm bench:canvas` passed 6 bench tests (8.0 s), including
  the `replay.p95 < 50` and `replay.p95 < 500` assertions. The matched
  production-workload run stays open (needs a production build; a dirty tree is
  non-authoritative).

### 2026-09-30 — gesture guide

- Added the compact **Gestures** reference to `TabletTouchControls` (the tablet
  brief's "compact gesture/help surface"), covering one finger, two fingers,
  long press, Multi, and pen. Every statement matches documented, tested
  behaviour, and each named gesture also has a visible control in the panel.
- `TabletTouchControls.test.tsx` now has 2 tests (gate/latched state and the
  gesture guide) and passes; `biome check`, stylelint on the stylesheet, and
  `audit:sizing` pass. The stylesheet adds only existing design tokens.
- Unrelated audit failures observed on this shared tree and NOT caused by this
  task: `audit:tokens` (undefined `--name` reference in
  `packages/codegen/src/tailwind.ts:685`), `audit:radius`
  (`Presentation/presentationNavigator.css:581`, documented legacy),
  `audit:spacing` (`Minimap/minimap.css` `margin: 0 auto`).
- Browser evidence in this pass: an official three-spec lease run returned
  **2 passed / 1 failed**; the failure was this task's own popover-close tap
  losing Playwright's actionability race against the palette re-render, not a
  product defect (both other specs and every earlier step of the failing spec
  passed). After moving the dismissal into
  `tests/e2e/helpers/tabletControls.ts`, the two affected specs passed **2/2**
  in 1.0m, and the final official three-spec run under the heavy lease
  (`VARVE_E2E_PORT=4442`, Chromium, `--workers=1`, `--timeout=300000`) passed
  **3/3 in 1.5m**:
  `tablet-editing-controls` 13.9s, `tablet-keyboardless-workflow` 21.9s,
  `tablet-poster-round-trip` 31.1s.

Append exact commands, environment, results, inspected artifact paths,
performance measurements, unrelated skips, and unresolved hardware checks as
the work proceeds. Physical USI/palm/keyboard/ChromeOS certification is not
available in this environment.
