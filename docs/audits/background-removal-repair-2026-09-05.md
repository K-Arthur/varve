# Background removal repair evidence — 2026-09-05

## Starting state and scope

Work began on `master` at `bbe203d27` (one commit ahead of origin). Existing
uncommitted background-removal, history, website guidance, and tests were
present. Concurrent filter-strength edits also appeared during inspection;
these are preserved and excluded from this work's staged validation scope.
Runtime: Linux, Node 22.23.2, pnpm 11.9.0. Platform claims below require
runtime evidence, not just source inspection.

## Capability and gap matrix

| Route | Production code | Current evidence / gap |
| --- | --- | --- |
| Fast | engine heuristic, editor hook, inspector review | Existing browser tests cover preview, Apply and history; rerun pending |
| Auto / High quality | worker, native, direct ONNX dispatch | Shared deadline regression verified with deterministic providers; real artifact run pending |
| Source isolation lifecycle | SubjectIsolationService | Weak fingerprint fallback, rounded placement checks and raw-fill resolution confirmed by inspection |
| Review and Apply | useBackgroundRemoval | Existing local repairs preserve queued edits; late preview awaits still need review |
| Hair / trimap | hook, refineHairMatting, solveTrimapMatting | Reachable inspector controls; stale-result and dimension review pending |
| Mask contraction | decontaminateMask | Changes alpha only; inspector RGB correction wording is inaccurate |
| Subject selection | object-selection tools and SAM model pair | Pointer and model readiness validation pending |
| Trim | imageCrop and existing mask bounds | Geometry/no-inference verification pending |
| History / reload / export | raster-mask assets, persistent history, export consumers | Existing immutable asset identity fix; end-to-end validation pending |
| Marketing website | background-removal feature page | Needs claims aligned with measured workflow and visual review |

## Milestone 1: execution deadline

Confirmed root cause: each availability probe and inference attempt received
125 seconds (Auto) or 310 seconds (High quality), independently. A second
quality chain could start with a fresh budget. Native readiness was unbounded.
Cancellation and timeout left the deadline timer/listener alive when the
underlying provider never settled.

The dispatcher now shares one 125/310-second budget across providers and
quality fallback, limits readiness/availability probes to five seconds, aborts
the active attempt, and removes timers/listeners immediately. Errors offer
Fast mode or local model management. Worker termination is supported by the
existing pool; an AbortSignal alone does not prove native/direct computation
has stopped.

Deterministic fake-clock tests cover request exhaustion, no second quality
chain after exhaustion, stalled native readiness, and cancellation cleanup.
All four pass after the repair. This is deadline/lifecycle evidence, not an
inference speed or cutout quality benchmark.

## Validation record (in progress)

- `pnpm verify:plan`: selected affected editor/website/dependent checks;
  no full-suite escalation.
- `pnpm verify:affected`: baseline stopped at formatting errors in pre-existing
  changes (including concurrent filter-strength tests). Those files were not
  reformatted as part of the dispatcher change.
- `pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__/dispatchDeadline.test.ts`:
  four passing after repair; pre-repair failures recorded separately.
- Full suite: not run. Rust tests/global visual suite are unrelated to this
  TypeScript dispatcher milestone. Subsequent milestone evidence remains pending.


## Milestone 2: confirmed correctness defects

- Engine reconstruction stored source-combined alpha as coverage. Three new
  tests failed before repair (alpha separation, PNG-only resizing, truncated
  buffer rejection); all 21 engine entry-point tests passed after repair.
- Exact source/placement and cancellation lifecycle checks now have focused
  coverage. Full SHA-256 fingerprints and unique unverified tokens replace
  the length-only fallback. No claim is made that an external file changing
  behind an unchanged locator can be detected without reloading its bytes.
- The quick-bar default and inspector opted into alpha contraction despite
  architecture policy saying it was off. The UI incorrectly claimed RGB
  correction. All automatic defaults now opt out, and the control describes
  mask contraction and potential detail loss.
- A 3000×600 real-browser fixture committed a native mask but retained the
  background on canvas. Inspection found full-source crop coordinates used
  for the 2048-pixel render proxy. A focused cropped-proxy replay regression
  now passes; the browser rerun remains outstanding.
- Batch and pre-export callbacks wrote the legacy background-removal field.
  Their replacement native-asset path and frozen export snapshot are under
  validation. Batch now captures targets when opened instead of resetting
  its queue whenever the selection props rerender.

## Browser and visual evidence so far

The Chromium run on isolated port 1492 passed Fast preview/Apply, two Undo/Redo
cycles with byte-exact canvas screenshots, disconnected-region preservation,
Auto preview/Apply, no-crash, and the Object Selection pointer/download surface.
It failed the large-image render-proxy check; the serial mask-editor test was
therefore not run. This is a real defect report, not an accepted visual baseline.

Manually inspected `test-results/bg-repair-browser/` screenshots show both
foreground shapes retained, a small blue fringe around the red oval, and a
nearly solid-looking preview checkerboard. The checkerboard contrast has been
corrected; edge contraction remains opt-in rather than concealing fine-detail
loss with a global default.

The exported 2100×300 transparency fixture contains alpha 128 in the subject
interior, with transparent background and partially retained white fringe at
the feathered boundary. A blanket maximum-alpha assertion was inappropriate:
the original background has alpha 255. The regression now compares each output
alpha to the corresponding original source alpha and checks the subject
interior exactly. The white fringe is a quality limitation, not evidence of
physically correct matting.

## Additional command evidence

- Isolated-index `pnpm verify:affected --staged`: engine 353 test files passed,
  4,339 tests passed, three files/five tests skipped by their existing guards;
  engine typecheck passed. Dependent lanes are still running.
- `pnpm exec vitest run packages/engine/src/replay-image-fill.test.ts`:
  26 tests passed, including reduced-proxy crop mapping.
- Focused editor lifecycle/inspector/quick-bar run: 81 passed; one legacy
  feather-control synchronization test exposed a reset to 0.5 and was repaired.
- Batch/export/native-commit run: 61 passed; one error-copy expectation required
  updating from AI-only wording to the shared background-removal error.
- `pnpm typecheck:e2e`: passed after resolving PNG decoding through the engine's
  existing pngjs dependency, without adding a dependency.
- Private-index `node scripts/audit-health.mjs --staged`: passed.
- Final impact plan: no full-suite escalation; selects affected package and
  dependent checks, canvas E2E, website E2E, and the render benchmark. Its 91%
  test-file selection reflects the engine/editor dependency graph. Rust and
  the full global visual suite remain deliberately unrelated.
