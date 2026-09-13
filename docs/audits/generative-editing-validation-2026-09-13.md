# Generative editing validation — 2026-09-13

This report records the validation completed for the generative-editing
workflow slice on `master`. It is an evidence report, not a declaration that
prompt-conditioned generation has qualified for release.

## Committed slices

- `ceb6c3962` — Object Selection handoff from the modal Generative Edit
  workflow, with architecture/user/marketing documentation and updated
  website visual baselines.
- `c46d9c619` — real local inpainting model comparison and failure evidence.
- `f26e28ef0` — constrained-device preflight coverage and the validation
  ledger for the remaining qualification gates.
- `530fc67df` — official component-conversion follow-up and model evidence
  clarification.
- `60eef0f4a` — preserve NCHW LaMa output geometry for portrait contexts,
  with a regression test for the decoder dimension contract.

The E2E test source and the raw model comparison PNGs remain task-owned in the
worktree while the shared repository E2E typecheck is failing on unrelated
concurrent engine edits. They must be committed after that check is repaired;
no hook was bypassed.

## Validation performed

### Deterministic and static checks

Passed:

- `pnpm exec biome check packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx tests/e2e/caf/object-selection-mask-source.spec.ts apps/website/src/pages/docs/tools/generative-editing.astro apps/website/src/pages/features/generative-editing.astro --no-errors-on-unmatched`
- `pnpm audit:docs` — clean.
- `pnpm audit:emoji` — clean.
- `packages/engine/src/generativeEdit/generativeEdit.test.ts` — 16 tests
  passed, including the 4 GiB ARM/ChromeOS diffusion pre-allocation refusal.
- Nine focused generative test files — 74 tests passed, including mask,
  bounded context, expansion, worker-host, composition, controls, LaMa
  output-dimension, and portrait-geometry checks.

### Real-browser interaction and visual checks

Passed with one Chromium worker and isolated ports:

- `tests/e2e/caf/object-selection-mask-source.spec.ts` — 3 tests passed on
  the real `real-life-portrait.jpg` fixture. The cases cover importing a
  confirmed Object Selection candidate, launching Object Selection from the
  modal controls, and keeping that handoff disabled after a real pointer mask
  stroke. The handoff screenshot was inspected and shows the photographic
  canvas with Object Selection active.
- `apps/website/tests/e2e/generative-editing.visual.spec.ts` — the desktop
  feature page, mobile feature page, and dark documentation page passed after
  the intentional copy update. The mobile and documentation actual images were
  inspected for overflow, readability, and the expected new handoff copy; the
  same three checks passed again without snapshot updates.
- `pnpm build:website:pages` — 100 website pages built successfully.

An additional attempt to rerun the real-photo CAF Apply cases did not reach
the test body: the shared E2E global setup timed out waiting for the New
button, after an earlier two-case run reported the same startup instability.
This is recorded as a harness/resource failure, not as a generation pass or
failure. The existing real-photo CAF qualification lane remains the source of
the earlier promptless Fill/Remove evidence.

The previously blocked single-case retry for promptless Fill was rerun on an
isolated port after the shared editor bundle became loadable. It passed in
47.8 seconds. The test imported `real-life-still-life.jpg`, painted the mask
with real pointer events, applied the result, and independently decoded the
persisted overlay; it verified non-transparent output, changed pixels, and
more than eight color buckets. The captured result was inspected at the
dialog scale and retained in the Playwright output directory. This is valid
promptless reconstruction evidence, not prompt-conditioned model-quality
evidence.

The visual evidence commit remains pending because the repository hook's
`typecheck:e2e` lane still reports unrelated concurrent errors in
`backgroundRemoval/maskDecode`, `ddcolor`, `retouch`, and mockup code. No hook
was bypassed.

### Native model-quality evidence

Two actual CPU inpainting runs were loaded and executed through the isolated
local runtime, then inspected at full frame and at a 100% boundary crop:

- GenAI Archive SD 1.5 Inpainting Q4_0 — completed, but did not follow the
  frozen red-canoe prompt.
- GenAI Archive SD 1.5 Inpainting F16 — completed, but also did not produce a
  readable red canoe or convincing prompt-conditioned insertion.

The protected-source composite for the Q4 run had exact outside-region
preservation (`mean=0`, `max=0`). Raw candidates, composites, difference maps,
boundary crops, hashes, settings, runtime revisions, and the decision not to
qualify are documented in
[`generative-inpainting-model-comparison-2026-09-13.md`](generative-inpainting-model-comparison-2026-09-13.md).

## Escalated checks and outstanding gates

`pnpm verify:plan` selected the broad affected closure and reported full-suite
escalation because the concurrent worktree includes shared validation,
serialization, native, and package changes. `pnpm verify:affected` therefore
stopped with the required escalation. The explicit `pnpm verify:full` run
reached typechecking and stopped on unrelated concurrent errors:

- `packages/engine/src/canvasFontAliases.ts` references missing
  `loadAliasFaces`/`MAX_ALIAS_STYLES`/`FontFaceDisplay` symbols.
- `packages/engine/src/bench/halftone-timing.test.ts` imports a missing
  `halftone` module.
- LUT tests access `size` on the `Shaper3D` branch of `LutTransform`.
- `packages/engine/src/replay.ts:1278` invokes possibly-undefined
  `measureText`.

The full gate did not reach its browser, native-package, cross-platform,
low-memory, persistence, or model-corpus lanes. Prompt-conditioned Replace,
Fill, and Expand remain capability-gated until a model/runtime clears the
frozen photographic quality gate. Linux x86_64 promptless reconstruction is
the available local path; Windows, macOS, ARM, Chromebook, 4-GB, cancellation,
portability, and complete 24-photo/32-task evidence remain outstanding.

The official component conversion follow-up also completed its isolated
streaming conversion, but the first generated GGUF did not carry the
architecture/name form required by the standalone loader. A temporary loader
rebuild was intentionally stopped when concurrent validation work reduced the
host to about 1 GiB available memory; it did not change repository files or
qualify a model. The conversion evidence and checksum are recorded in the
[model comparison report](generative-inpainting-model-comparison-2026-09-13.md).

The attempted E2E test commit was blocked by the unrelated shared
`typecheck:e2e` errors in `packages/engine/src/mockup/cylinderWarp.ts`,
`packages/scene/src/mockup/validate.ts`, and `packages/scene/src/shapeBuilder.ts`.
