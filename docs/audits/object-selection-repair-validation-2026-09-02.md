# Object Selection and automatic trim repair validation — 2026-09-02

This record covers the live prompt/overlay, inference recovery, automatic
object-bounds trim, and marketing-copy repair. It is separate from the
real-model quality gate in `docs/quality/object-selection-parity.md`.

## Baseline

The checked-out baseline before the repair was commit
`f12f7c22276e117cd2fc55fd3ea404896010c3ce` on branch
`validation-release-system`. The working environment was CachyOS Linux
7.2.2-1, x86_64, AMD Ryzen 3 5300U (8 logical CPUs), 22 GiB RAM, Node
22.23.2, pnpm 11.9.0, Rust 1.97.1, and WebKitGTK 2.52.6. The browser
validation used Chromium; no downloaded SAM2/DETR model was available for a
real-model run, so this record does not claim new model latency or quality
measurements.

## Confirmed findings

| Symptom | Code path | Evidence | Resolution |
| --- | --- | --- | --- |
| Drag box appeared to do nothing | `Sam2SegmentationTool` kept `pendingBox` private; the overlay only read `EditorState.objectSelectionSession` | The tool tests could observe a box, but the live canvas had no session-backed draft; the passing E2E draft frame was blank before scheduler repair | Publish draft point/box state on pointer interaction and schedule the overlay whenever the transient session changes |
| Adding a point could discard a box | Tool pointer-down reset the pending interaction without preserving the committed box | Regression test now adds a point after a box and verifies both prompts remain | Keep `box` and `draftBox` separate; point prompts append to the existing prompt set |
| Automatic trim exposed a raw 30-second timeout | `ImageCropSection` passed `timeoutMs: 30_000` to the shared inference host | Source inspection showed the caller-specific deadline was lower than the host’s model work budget | Remove the arbitrary caller override; use the model profile and a cancellable soft UI deadline |
| A timeout could poison retries | The old worker host removed the timed-out promise without terminating the worker | A controllable-worker test now verifies termination and a clean second request | Terminate/recreate the worker on hard timeout, reject other pending jobs, and clean timers/listeners |
| Detector output was silently treated as the subject | Trim took the first decoded DETR result and used approximate fill arithmetic | Ranking and transformed-placement tests cover multiple detections and source crop/rotation/flip mapping | Rank candidates explicitly, show them for review, and map through `computeImagePlacement` |

## Architecture decision

`EditorState.objectSelectionSession` is the sole transient owner for prompt
geometry, candidates, status, and preview metadata. It is never serialized or
added to document history. The tool writes a draft immediately; pointer-up
promotes it and submits one latest-wins preview. Escape, deactivation,
selection/document changes, and source changes abort the request and advance a
generation counter. Applying a ready candidate commits its existing mask
without a second model run.

The worker reports module readiness separately from lazy model/session work.
SAM2 uses a 15-second soft deadline and model-specific finite host ceilings
(180 seconds encoder, 60 seconds decoder, 120 seconds DETR/default); a hard
timeout restarts the worker. These ceilings are recovery guards, not latency
claims. New cold/warm measurements remain a release gate.

Automatic trim remains DETR bounds-only. A detector box is not marketed as a
pixel mask or semantic subject guarantee. The Inspector ranks and presents
candidate boxes, then applies a non-destructive crop only after review. A
future DETR → SAM2 → alpha-bounds pipeline requires the parity and low-spec
benchmark evidence described in the architecture and quality docs.

## Validation evidence

Passed:

- `pnpm verify:plan` — no full-suite escalation; the dirty worktree caused a
  broad affected closure, so unrelated package checks were deliberately not
  promoted to a release gate.
- `pnpm exec vitest run packages/editor/src/tools/Sam2SegmentationTool.test.ts packages/editor/src/imageCrop.test.ts packages/editor/src/tools/imageMaskCoordinates.test.ts packages/engine/src/inference/models/detr.test.ts packages/engine/src/inference/__tests__/workerHostMessages.test.ts packages/editor/src/components/Inspector/sections/__tests__/bgRemovalFeatures.test.tsx` — 6 files, 103 tests.
- `pnpm typecheck:e2e` — passed.
- `VARVE_E2E_PORT=1446 pnpm exec playwright test tests/e2e/canvas/object-selection.spec.ts --project=chromium --reporter=list` — passed.
- `VARVE_WEBSITE_E2E_PORT=4431 VARVE_WEBSITE_E2E_PORT_ROOT=4432 pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/background-removal-feature.spec.ts --project=ghpages --project=custom-domain --reporter=list` — 2 tests passed, including updated mobile visual snapshots.
- `pnpm --filter @varve/engine typecheck` — passed.
- `pnpm --filter @varve/website build` — passed; 66 pages built.
- `pnpm audit:emoji` and `pnpm audit:docs` — clean.
- `node scripts/audit-architecture.mjs --ci` — passed; the report retained the
  repository's existing baseline cycles and budget warnings without adding a
  new context/type cycle.

Visual evidence:

- The Chromium E2E artifact
  `test-results/run-114735-1446/canvas-object-selection-Ob-8d418--without-a-downloaded-model-chromium/object-selection-draft-box.png`
  was inspected directly. It shows the dark-understroke/blue dashed prompt
  rectangle over the canvas while the clean-install inference remains pending.
- The updated background-removal mobile dark snapshot was inspected directly
  in both GitHub Pages and custom-domain variants. It shows the new
  bounds-only explanation without horizontal overflow or clipping.

Not run or environment-limited:

- Real SAM2/DETR model smoke and latency/memory table: model files were not
  installed in this workspace. Use the opt-in parity job before release.
- Tauri/WebKitGTK visual run: the browser E2E validates the shared editor
  surface; the installed WebKitGTK version was recorded above, but no desktop
  window run was available in this validation pass.
- `pnpm verify:affected` was attempted. Its Tier 0/1 task-file checks, audits,
  E2E typecheck, and focused checks passed after the worker fixture repair; the
  final broad run stopped on unrelated existing formatting deltas in
  `packages/ui/src/components/Menu.tsx` and
  `tests/e2e/home/context-menu.spec.ts`. The targeted E2E and focused suite
  were rerun green. Full suite was not escalated because the planner reported
  `Full-suite escalation: NO`.
- The editor package typecheck still reports pre-existing design-system
  migration errors in `FloatingTextBar`, `PackManager`, `EmailPanel`, the
  editor test helper, and `FloatingPortal`; none is in the repair files.
