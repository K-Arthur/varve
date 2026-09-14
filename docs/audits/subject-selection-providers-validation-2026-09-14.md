# Subject-selection providers — validation record (2026-09-14)

Scope: the model-backed automatic subject-estimate routing, its admission fix,
the panel/UI integration, and the docs/website updates. The MobileSAM adapter
work in `packages/engine/src/inference/models/mobileSam.ts` and
`packages/engine/src/segmentation/promptedRouting.ts` is a **separate,
concurrent slice** and is not validated here; this record explicitly excludes
it from every claim.

Validation plan (repository planner, run on the shared working tree with
concurrent agents active): `pnpm verify:plan` reported 165 changed files and
escalated (`FULL-SUITE ESCALATION: YES — workspace/toolchain/validation-
infrastructure change`). That escalation is driven by the aggregate tree, not
by this slice; the escalation is deferred to the release-candidate checkpoint,
and the affected checks for this slice were run and recorded below instead.

## Commands actually run

| Command | Result |
| --- | --- |
| `pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__/modelSpec.test.ts packages/engine/src/backgroundRemoval/__tests__/modelSelection.test.ts` | 13 passed |
| `pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__/index.test.ts` | 21 passed (includes the new BiRefNet budget-block regression) |
| `pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__/explicitModelRouting.test.ts` | 5 passed |
| `pnpm exec vitest run packages/engine/src/intelligence/subjectProposal.test.ts packages/engine/src/intelligence/foregroundSelect.test.ts` | 23 passed |
| `pnpm exec vitest run packages/editor/src/components/Inspector/SelectionSourcesPanel.subject.test.tsx packages/editor/src/components/Inspector/SelectionSourcesPanel.test.tsx` | 4 passed |
| `pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__` (shared suite) | 553 passed, 6 failed — all six are `modelLoader.test.ts` failures caused by the concurrent MobileSAM download-verification refactor; they passed before that change and are not in this slice |
| `pnpm --filter @varve/engine typecheck` | No errors in this slice's files (pre-existing errors in unrelated in-flight files) |
| `pnpm --filter @varve/editor typecheck` | No errors in this slice's files (pre-existing errors in unrelated in-flight files) |
| `pnpm audit:docs` | clean (887 docs, 483 links, 174 ADRs) |
| `pnpm audit:emoji` | clean (4669 files) |
| `pnpm --filter @varve/website build` | 104 pages built |
| `VARVE_E2E_PORT=1425 VARVE_E2E_OUTPUT_DIR=subject-proposal3 pnpm exec playwright test tests/e2e/canvas/subject-proposal.spec.ts --project=chromium --reporter=list` | 3 passed (still life 38.9 s, portrait with hair 33.6 s, interior 29.5 s, serial worker) |

## Real-photo browser evidence

Chromium + Vite dev server + worker-backed ONNX Runtime Web (WASM), bundled
U²-Net Light, no model download, licensed fixtures
(`tests/e2e/fixtures/PROVENANCE.md`). Screenshots and hashes:
`docs/audits/subject-selection-evidence-2026-09-14/`.

- Still life on a dark background → clean cutout (verified by eye).
- Grayscale portrait with braided hair inside a scanned oval card → the card
  surround is removed and the subject kept (verified by eye).
- Cluttered interior → the estimate selects the curtain/wall region and
  excludes the framed portraits and furniture; recorded as the honest weak
  case that motivates review-before-apply.

## What was not run (and why)

- Full repository gate (`pnpm verify:full`): the planner's escalation is
  aggregate-tree driven; the shared tree currently contains a concurrent
  agent's in-flight MobileSAM refactor with failing typechecks and six failing
  `modelLoader` tests, which would make a full-gate result uninformative for
  this slice.
- MobileSAM engine/UI real-model runs: the adapter is another agent's active
  work; nothing in this record claims MobileSAM support.
- Native desktop (Tauri) runs: no environment change in this slice, and the
  native path is exercised by the existing background-removal suite.
