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
| `packages/editor/src/tools/PaintTool.ts` | Only target admission/recovery behavior; preserve the stroke worker, transaction and input lifecycle. |
| `packages/editor/src/tools/__tests__/PaintTool.test.ts` | Only fixtures/assertions affected by stricter target admission. |
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
