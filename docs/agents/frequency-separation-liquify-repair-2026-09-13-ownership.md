# Frequency Separation / Liquify repair ownership — 2026-09-13

## Scope

This record covers the repair and integration pass requested for the existing
Varve Frequency Separation and Liquify implementation. Work remains on the
shared `master` checkout as requested; no branch or duplicate application is
being created.

## Owned files

- `packages/engine/src/frequencySeparation.ts`
- `packages/engine/src/liquify/field.ts`
- `packages/engine/src/liquify/warp.ts`
- focused engine regression tests and retouch benchmarks added alongside those
  modules
- `packages/scene/src/frequencySeparation.ts`
- `packages/scene/src/liquify.ts`
- `packages/editor/src/tools/LiquifyTool.ts`
- `packages/editor/src/components/Liquify/LiquifyOverlay.tsx`
- `packages/editor/src/render/liquifyRenderCache.ts`
- `packages/editor/src/render/frequencySeparationRenderCache.ts`
- focused editor Liquify/cache regression tests added alongside those modules
- new retouching research/audit and user-guidance pages under `docs/` and
  `apps/website/src/pages/docs/tools/`

Existing files outside this list are treated as concurrent work unless their
owner explicitly hands them off.

## Shared dependencies / coordination points

The following are read-only dependencies for this pass unless coordinated with
their owners: scene node schema and codec, `CanvasArea.tsx`, `Shell.tsx`,
`context.tsx`, the tool dispatcher/input pipeline, render-worker admission,
retouch sampling/target files, history transactions, export adapters, and
dependency manifests/lockfiles. No changes to those hotspots are planned.

## Baseline and safety notes

- Checkout was verified as `master`; the tree contains substantial unrelated
  staged, unstaged, and untracked work from concurrent agents.
- The pre-existing retouch ownership records and prior feature commits were
  read. Their “implemented” claims are treated as audit leads until verified
  through the production UI and persistence/export paths.
- Only paths listed above will be staged for milestone commits. No reset,
  clean, stash, branch switch, or process-wide termination is permitted.
- Current repair hypotheses include malformed field/dimension handling, cache
  replacement/eviction accounting, the unreachable frequency-separation-band
  Liquify target, release-sample loss, and transform-aware brush overlay
  geometry. Each will receive a reproducible regression test before its fix.

## Milestones

1. Engine contracts and cache accounting, with failing tests first.
2. Liquify target/input/overlay repairs and focused UI regression coverage.
3. Frequency Separation session UX/persistence/export evidence and website
   guidance, subject to shared-file ownership checks.
4. Combined-workflow visual validation, performance measurements, and final
   documentation/review.
