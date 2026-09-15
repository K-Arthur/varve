# AI selection routing ownership and handoff (2026-09-15)

**Task:** MODNet portrait matting, EfficientSAM production routing, and
Grounding DINO text-conditioned discovery through the existing Object
Selection/Background Removal systems.
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree was created).
**Base HEAD at start:** `e81ddb4eb`.
**First implementation commit:** `42480fc48`.

## Why this record exists

The working tree contains several other writers' in-flight changes. This record
names the paths this task owns and the paths where another writer's
uncommitted code was preserved rather than committed.

## Owned paths (this task)

| Path | Contract |
|---|---|
| `packages/engine/src/backgroundRemoval/modnetPortrait.ts` (+ tests) | MODNet input/output contract, area resize, constraint fusion |
| `packages/engine/src/backgroundRemoval/{types,modelSpec,modelContract,modelSelection,modelInfo,modelLoader,worker,workerPool,protocol}.ts` | `portrait` method, `modnet-portrait` model id, worker branch |
| `packages/engine/src/backgroundRemoval/providers/dispatch.ts` | Portrait uses a worker-only chain, no silent fallback |
| `packages/engine/src/discovery/groundingDino.ts` (+ tests) | BERT WordPiece tokenizer, five-feed preprocessing, thresholded postprocess, dedupe |
| `packages/engine/src/inference/{inferenceWorker,modelCatalog,manifest,index}.ts` | EfficientSAM + Grounding DINO worker registrations, catalog, manifest |
| `packages/engine/src/index.ts` | Public exports for the new adapters |
| `packages/engine/src/segmentation/{promptedRouting,providerValidation}.ts` | EfficientSAM provider id, preference union, measured record |
| `packages/editor/src/components/Inspector/sections/TextDiscoveryPanel.tsx` | Find-by-description panel |
| `packages/editor/src/backgroundRemoval/SubjectIsolationService.ts`, `packages/editor/src/context/useBackgroundRemoval.ts` | Portrait method plumbing |
| `apps/desktop/public/models/manifest.json`, `.gitignore` | New artifacts, model directory ignore |
| `docs/audits/selection-ai-routing-real-world-2026-09-15.md` | Evidence ledger |
| Website `features/object-selection.astro`, `features/background-removal.astro`, `docs/tools/object-selection.astro` | Verified copy only |
| This record | Ownership + handoff |

## Shared-file coordination

Four editor files and two scene files also carried another writer's
uncommitted refactor (candidate ranking moved into `promptedMaskValidation.ts`,
selection score plumbing, subject-proposal state). Committing the files
wholesale would have included that writer's work. Instead, the first commit
staged **HEAD plus only this task's hunks** for:

- `packages/editor/src/context/useSam2Segmentation.ts`
- `packages/editor/src/context/promptedSegmentationProvider.ts`
- `packages/editor/src/context/promptedSegmentationProvider.test.ts`
- `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
- `packages/scene/src/masks.ts`
- `packages/scene/src/types.ts`
- `packages/editor/src/backgroundRemoval/commitRasterMask.ts`

The working tree still contains the other writer's hunks in those files,
uncommitted; nothing was reverted, restaged, or reformatted away. Only
biome-driven whitespace changes were applied to those working files to satisfy
the pre-commit format gate.

## Uncommitted in other writers' hands

- `packages/editor/src/context/promptedMaskValidation.ts` (+ test) — ranking
  refactor, untouched by this task.
- `packages/editor/src/components/Inspector/subjectProposalStore.ts`,
  `SelectionSourcesPanel.subject.test.tsx`,
  `packages/editor/src/components/Inspector/subjectProposalTarget.ts` —
  subject-proposal work, untouched.
- Other font/generative/integration worktree changes, untouched.

## Remaining verification (exact commands)

```bash
VARVE_MODNET_MODEL=/path/to/model.onnx \
  pnpm exec vitest run packages/engine/src/backgroundRemoval/modnetPortraitRealModel.test.ts

VARVE_GROUNDING_DINO_MODEL=/path/to/model_int8.onnx \
VARVE_GROUNDING_DINO_VOCAB=/path/to/vocab.txt \
  pnpm exec vitest run packages/engine/src/discovery/groundingDinoRealModel.test.ts

VARVE_EFFICIENT_SAM_MODEL_DIR=/path/to/efficientsam \
VARVE_EFFICIENT_SAM_COMBINED_MODEL=/path/to/efficientsam_ti.onnx \
  pnpm exec vitest run packages/engine/src/segmentation/quality/efficientSamRealModel.test.ts
```

Browser gates still to run: a Playwright pass that applies a Portrait mask and
reopens the document, cycles candidates on a boundary click, and runs one
in-app text query through the Find-by-description panel with a screenshot
review.
