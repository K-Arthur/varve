# Illustration and concept-art workflow improvements — ownership

**Task:** illustration and concept-art existing-system improvements
**Owner:** primary integration agent
**Started:** 2026-09-28
**Branch:** `master` (user-requested; no branch or worktree created)
**Base observed before implementation:** `401f1e7fd4d40c86f80fc2b36888019a4f50211b`

## Shared-worktree boundary

The shared checkout already had a large mixed index and worktree (423 changed
entries at the first status check). No reset, stash, clean, broad stage, or
whole-index commit is allowed. Work is staged and committed with explicit path
lists. A second task advanced `master` from `d51f52e40` to `401f1e7fd` during
the initial inspection; its export-sharpening commit is retained as the current
base. Re-read the branch, exact `HEAD`, and every target path before each slice.

This task is the integration owner for the illustration workflows. Initial
implementation ownership is limited to the following clean paths:

| Owned path | Scope |
|---|---|
| `packages/editor/src/tools/paintTarget.ts` | Paint destination validation and explicit refusal contract. |
| `packages/editor/src/tools/__tests__/paintTarget.test.ts` | Resolver regression coverage. |
| `packages/editor/src/tools/PaintTool.ts` | Target admission plus the narrow pointer-up/tool-switch finalization fix; do not change worker batching, input normalization or active-drag cancellation. |
| `packages/editor/src/tools/__tests__/PaintTool.test.ts` | Resolver regressions and released-stroke finalization across tool deactivation. |
| `packages/editor/src/tools/paintLayerRecovery.ts` and `.test.ts` | Active-surface pixel-layer construction for the explicit Paint recovery action. |
| `packages/editor/src/components/FloatingToolbar/PaintLayerRecoveryAction.tsx` | Paint tool-options action for creating and selecting a separate recovery layer. |
| `packages/editor/src/components/FloatingToolbar/ToolOptionsPopover.tsx` + `.css` | Compose recovery in the existing Paint options panel; no central editor hub changes. |
| `tests/e2e/paint/brush-ui.spec.ts` | Isolated real-canvas target-refusal regression and production Brush Browser visual check for the illustration starting presets. |
| `tests/e2e/canvas/raster-magic-wand.spec.ts` | Verify the existing painted raster → Magic Wand → flat-fill route, save/export/reopen; maintain the current Inspector export-tab access in the real UI. |
| `tests/e2e/canvas/selection-fill.spec.ts` | Verify selection-to-flats undo/redo, save/export/reopen; maintain the current Inspector export-tab access in the real UI. |
| `packages/editor/src/tools/MagicWandTool.ts` | Only asynchronous image-backed selection request ordering, source identity revalidation and captured settings; no sampling-source redesign. |
| `packages/editor/src/tools/__tests__/MagicWandTool.test.ts` | Deterministic stale-decode, tool-deactivation and changed-target regressions. |
| `docs/architecture/selection-system.md` | Record the image-backed Magic Wand async request contract. |
| `docs/architecture/paint-system.md` | Current target resolution, mask validation and refusal contract. |
| `apps/website/src/pages/features/strokes.astro` | Evidence-backed public description of shared raster/vector editing and target refusal. |
| `apps/website/src/pages/docs/tools/strokes.astro` | Artist-facing steps for paint destination behavior. |
| `apps/website/tests/e2e/strokes-target-copy.spec.ts` | Desktop/mobile, light/dark, accessibility, image-load and base-path regression for the updated public pages. |
| `packages/scene/src/brush.ts` | Add differentiated built-in illustration presets using existing brush fields and production stroke logic. |
| `packages/scene/src/brush.test.ts` | Check the new built-ins remain valid, stable and differentiated. |
| `packages/editor/src/components/BrushBrowser/BrushBrowser.tsx` | Classify built-ins explicitly so default smudge strength does not miscategorize airbrushes. |
| `packages/editor/src/components/BrushBrowser/__tests__/BrushBrowser.test.tsx` | Verify built-in categories and visible choices in the brush browser. |
| `docs/research/illustration-concept-art-research-2026-09-28.md` | Dated sources, complaint evidence, uncertainty, and decisions. |
| `docs/audits/illustration-concept-art-capability-matrix-2026-09-28.md` | Reproductions and verified/deferred capability status. |

## Existing ownership to preserve

- `docs/agents/drawing-input-2026-09-13-ownership.md` owns canonical pointer
  normalization, `inputPipeline.ts`, and the broad Pen/Pencil/Paint lifecycle.
  This task does not replace its sample-normalization or worker protocol. Any
  follow-up to those shared contracts must be recorded as a narrow integration
  change after rereading the current files and validation state.
- `docs/agents/photo-retouch-target-sampling-2026-09-13-ownership.md` owns
  `rasterTarget.ts`, `retouchSampling.ts`, and retouch tools. Consume the
  existing sampling APIs; do not fork or overwrite them.
- `docs/agents/canvas-fluidity-2026-09-25-ownership.md` owns active canvas
  traversal, `CanvasOverlays.tsx`, portions of perspective overlays, and shared
  input/rendering paths. Do not add hub imports or silently take those paths.
- `docs/agents/gpu-rendering-2026-09-26-ownership.md` owns the active renderer,
  compositor, and pixel-reuse work. Keep this task out of those files unless
  there is a specific reviewed handoff.
- `docs/agents/guide-layouts-2026-09-21-ownership.md` owns shared scene guide
  and layout contracts. Reuse those APIs for perspective assistants.
- Marketing pages and screenshots already have unrelated staged/unstaged
  edits. Each exact website path will be checked for ownership and status
  immediately before any proposed edit.
- `CHANGELOG.md` has an active unrelated shortcut correction under the
  workspace-switcher review ownership. The illustration entries remain pending
  until that path is released so its staged/unstaged text is not captured in
  this task's commit.

## Validation and commit protocol

The initial `pnpm verify:plan` selected unrelated workspace/toolchain and
validation-infrastructure changes from the shared checkout and reported full
suite escalation. That result is not attributed to this task. Run focused tests
for each isolated slice, then plan and validate the exact committed range where
the planner supports it. Do not broaden validation over other tasks' staged
work. Browser runs use the repository heavy-task lease, one Chromium worker,
and a unique port/output directory; never reuse another task's screenshots.

Record each commit SHA and its exact paths here. A commit must include its
focused regression and the relevant current-state documentation. Save visual
evidence only after the application output has been inspected. Platform and
hardware gaps remain explicit in the final handoff.

## Commit log

- `b39129198` — `fix(paint): validate explicit raster targets` — target
  existence, page membership, ancestor visibility/locks, transform validation,
  exact mask identity, refusal regressions, and the updated paint contract.
  Focused resolver/tool tests passed 57/57; the leased Chromium refusal test
  passed and its before/after screenshots were inspected. The broad affected
  run stopped at the shared repository-wide emoji audit violation in unrelated
  `SourceChannels.tsx` and `CurveEditor.tsx` files. The commit was limited to
  owned paths with `CI=1 git commit --only` so unrelated hooks would not stage
  or modify other work.

- `e9f788745` — `feat(paint): add illustration starting brushes` — added
  Sketch Pencil, Inking Nib, Opaque Paint and Soft Shade presets; corrected
  built-in categories; updated Strokes marketing and artist docs; added a
  production preview UI check and responsive site regression. Focused brush
  tests passed 74/74; all six paint UI Chromium tests and both website base-path
  tests passed. The custom-domain and `/varve` builds succeeded, and four
  desktop/mobile light/dark captures were inspected. The exact 11-file plan
  selected no full suite. `verify:affected --staged` stopped at `audit:docs`
  because three unrelated pages link to the absent
  `docs/audits/website-navbar-audit-2026-09-28.md`; an earlier affected pass
  reached website-unit before failing on the unrelated missing screenshot
  manifest entry `performance-settings-dark.png`. `audit:tokens` passes all
  303 pairs and website typecheck passes. Root `pnpm typecheck:e2e` reports
  unrelated errors in `packages/engine/src/liveEffects/effectPreviewRunner.ts`.
  The paint preview capture is `test-results/run-171764-1420/paint-brush-ui-paint-UI-in-91069-enders-searches-and-filters-chromium/brush-browser-paint-presets.png`.

- The raster Magic Wand E2E path now uses the current Inspector Export access
  (direct tab when visible, otherwise “More inspector tabs” → Export). It
  passed twice, including save, PNG export and Home-library reopen; captures
  and its same-layer sampling limitation are recorded in the capability
  matrix. The selection-fill E2E was stale in two places: Export had moved into
  the Inspector overflow, and Rectangular Marquee is responsive. The test now
  uses current UI routes and asserts the active tool and raster target. Several
  isolated runs have not passed that assertion yet: submenu activation is
  unstable at 1280px, and the existing click/fill run left Fill pixel layer
  disabled. The queued 2400px run on isolated port 4370 was canceled before
  launch because another website run occupied the shared heavy-task lease. Do not
  count marquee fill, undo/redo, or its export/reopen as verified. The staged
  three-path plan for the Magic Wand evidence slice selects touched-file
  format/lint, emoji/docs audits, E2E typecheck and its direct spec, with no
  full-suite escalation. On the four-path plan, the affected runner passed
  format, lint, emoji, docs, E2E typecheck, and Magic Wand E2E before the
  selection-fill spec failed. A later three-path affected run passed format,
  lint, emoji, and docs, then stopped at E2E typecheck on an unrelated shared
  checkout error: `packages/engine/src/inference/inferenceWorkerHost.ts:43`
  cannot find `InferenceLease`. Standalone E2E typecheck, Biome, and
  `git diff --check` passed before that concurrent engine edit.

- `b239d6922` — `fix(selection): discard stale Magic Wand requests` —
  invalidates pending image decodes on later pointer actions and tool
  deactivation, captures settings at request time, and refuses to apply a
  result if the live source node changed. Three focused unit regressions pass;
  the selection contract and capability matrix are updated. The selection-fill
  browser test remains unverified. No marquee-fill or separate linework-to-flats
  claim is made.

  For the five owned paths, `pnpm verify:plan --staged` selected touched-file
  format/lint, emoji/docs/radius audits, the exact new test, and the editor and
  desktop unit/typecheck closures; it reported no full-suite escalation. The
  affected run passed format, lint, emoji, docs and radius, and the new test
  (3/3), then reported 837 editor test files passed, two skipped and five
  unrelated files failed seven tests: workspace config/registry/dock and the
  concurrent drawing-input `inputNormalizer` changes. It stopped before the
  downstream package typechecks. A direct editor typecheck after correcting
  this test's call found only two existing unrelated `CurveEditor.test.tsx`
  overload errors. The touched files pass Biome; `pnpm audit:tokens` passes all
  303 pairs across three themes and the token-usage scan. Full suite was not
  run.

- The released-stroke/tool-switch defect is repaired in `PaintTool`: the real
  selection-fill E2E showed a `Brush Layer` after pointer-up, then it
  disappeared when switching to Marquee because `onDeactivate` aborted while
  `BrushWorkerHost.endStroke` was still draining. The narrow fix preserves a
  released session and still aborts a held gesture. The new unit regression
  verifies both sides of that boundary; the full `PaintTool.test.ts` file
  passes 39/39.

- Post-fix visual evidence from `test-results/illustration-selection-fill-20260928-4378/`
  shows the Brush Layer retained after tool change, a visible brush stroke,
  marquee coverage crossing that stroke, and the selected fill changing the
  artwork. `test-results/illustration-selection-fill-20260928-4375/` reached
  undo, redo, save, PNG export and document reopen. The 640×480 exported PNG
  contains 11,134 opaque black pixels. Its reopened canvas pixel assertion
  initially failed because the saved camera showed an off-page region; the E2E
  now fits the reopened page before checking the pixels.

- Latest `pnpm verify:affected --staged` used an isolated temporary index and
  selected six owned paths. Format, lint, emoji/docs/radius audits, E2E
  typecheck and the focused PaintTool test passed. The selection-fill E2E then
  failed after a live Vite reload caused by unrelated shared-worktree edits:
  `packages/scene/src/index.ts` reported conflicting `isContainer` star
  exports, and `packages/engine/src/backgroundRemoval/modelLoader.ts` had a
  duplicate `getModelStorage` declaration. The browser returned to Home before
  the undo assertion. The later run 4375 had completed undo/redo, save/export
  and reopen before the off-page camera assertion; full post-reopen pixel
  verification remains pending in a stable source tree.

- `pnpm audit:tokens` passes all 303 pairs across three themes and the token
  usage scan. Full suite was not escalated or run. The latest affected command
  stopped at the E2E failure before package-level downstream checks.

- `5b68b6822` — `fix(paint): preserve released strokes across tool changes` —
  commits the pointer-up/tool-deactivation lifecycle repair, the focused
  PaintTool regression, the paint-system contract note, and the selection-fill
  E2E camera/interaction updates. The affected run's non-E2E gates passed; the
  live browser interruption and remaining reopen-pixel check are recorded
  above. Commit remains local on `master`.

- The Paint tool now offers a visible **Create paint layer** action for an
  explicitly selected non-pixel object. It creates a page- or Design
  Canvas-scoped raster at the document's painting resolution, commits as one
  undo operation, selects the new layer, and leaves the refused gesture
  untouched. Paint target validation now uses the active Design Canvas when
  present and resolves descendants against surface roots; publishing-page
  validation remains page-scoped. A regression with a page and Design Canvas
  in the same document covers the scope mismatch.

- The leased Chromium refusal → create/select → repaint journey passes. I
  inspected `test-results/illustration-paint-recovery-20260929-4386/paint-brush-ui-paint-UI-in-7e966-g-into-another-raster-layer-chromium/paint-layer-recovery-available.png`
  and `.../paint-layer-recovery-stroke.png`: the action is visible beside the
  brush controls; the after-state shows the new stroke on the selected Paint
  Layer while the prior raster and selected vector remain unchanged. Focused
  PaintTool, resolver and layer-construction tests pass 62/62. E2E typecheck
  passes. `pnpm audit:tokens` passes all 303 pairs across three themes and the
  token-usage scan.

- Latest exact 12-path `pnpm verify:plan --staged` reports no full-suite
  escalation. `pnpm verify:affected --staged` passes touched format/lint,
  emoji, docs, radius and spacing, then stops at an unrelated new
  `packages/editor/src/components/Settings/layoutPresentation.css` 9px font
  size in `audit-interface-sizing`. Direct editor typecheck has no errors from
  this change but remains blocked by two existing overload errors in
  `CurveEditor.test.tsx`. Website-wide pages and screenshots, separate
  linework-to-flats sampling, undo/reopen/export for this recovery scenario,
  and the other planned illustration workflows remain pending. Full suite was
  not run.
