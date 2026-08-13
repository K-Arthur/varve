# Object Selection validation — 2026-08-13

This is a dated validation record for the Object Selection/SAM2 integration
work. It records the checks that were run in the shared development
workspace; it is not a claim that the release model corpus is complete.

## Passed

- `pnpm audit:docs`
- `node -e "JSON.parse(...)"` against `apps/desktop/public/models/manifest.json`
- `pnpm exec tsc --noEmit -p packages/editor/tsconfig.json`
- `pnpm exec tsc --noEmit -p packages/engine/tsconfig.json`
- Biome check on the touched Object Selection/runtime files
- `pnpm vitest run packages/editor/src/tools/Sam2SegmentationTool.test.ts packages/engine/src/segmentation/embeddingCache.test.ts packages/engine/src/segmentation/maskAlgebra.test.ts`
  (16 tests passed)
- Website build: `pnpm --filter @varve/website build`
- Website Chromium/mobile visual check for
  `apps/website/tests/e2e/object-selection-feature.spec.ts`
  (1 test passed)

## Not passed / environment-limited

The editor Playwright check was run with an isolated port using
`VARVE_E2E_PORT=1422`. The repository warm-up reached Vite, but the initial
`page.goto()` exceeded the configured 180-second timeout while the shared
workspace was running several concurrent Vite, Vitest, and Playwright jobs.
The same interaction was then attempted against an already-running editor
server, which also remained in cold module transformation and was terminated
after it produced no assertion result. No Object Selection assertion failure
was observed; a real model-backed preview still requires the release corpus
and downloaded model files.

## Deferred release gates

- Real-model SAM2 quality/parity corpus and cold/warm latency measurements.
- Visual review of mask quality on hair, fur, transparency, and rotated/cropped
  image placements.
- Dedicated candidate-mask cycling control in the Inspector.

