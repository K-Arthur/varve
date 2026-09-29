# Marketing screenshot pipeline — ownership and validation (2026-09-29)

**Task:** end-to-end upgrade of the pipeline that captures the real Varve
application and delivers screenshots to the marketing website.
**Branch:** `master`, per user instruction; no new branch, no reset, no stash.
**Initial snapshot (HEAD at start):** `5313237652060fb73ebf8e8` (branch head
`531323765`), read before any edit.

## Shared-checkout rules

The checkout is heavily shared: `git status` showed 420 changed paths plus
untracked work at the start. Re-read status, the target file, and its diff
before every patch and commit. Do not switch branches, stash, reset, clean,
stage broadly, rewrite history, or kill unrelated processes. Commit only
explicitly owned paths/hunks; do not push or publish.

## Known overlaps at start (must be preserved)

| Concurrent task | Record | Overlapping paths |
|---|---|---|
| tablet editing | [`tablet-mode-2026-09-29-ownership.md`](tablet-mode-2026-09-29-ownership.md) | `scripts/screenshots/product.mjs`, `apps/website/src/data/screenshot-manifest.json`, `apps/website/src/components/ProductShowcase.astro`, `tablet-workspace-light.png`, website docs pages |
| presentation workflow | [`presentation-workflow-2026-09-29-ownership.md`](presentation-workflow-2026-09-29-ownership.md) | lists "screenshot manifests" as a shared, non-exclusive integration path |
| tonal workflows | [`tonal-workflows-2026-09-28-ownership.md`](tonal-workflows-2026-09-28-ownership.md) | `scripts/screenshots/sync-tonal-scenes.mjs`, four tonal manifest scenes |
| illustration / concept art | [`illustration-concept-art-2026-09-28-ownership.md`](illustration-concept-art-2026-09-28-ownership.md) | screenshot gallery consumers |

The tablet task owns the `tablet-workspace` scene it added and its manifest
entry. This task treats those as read-only input, preserves them, and stages
only its own hunks in the shared files.

## Paths owned by this task

| Path | Status |
|---|---|
| `docs/agents/screenshot-pipeline-2026-09-29-ownership.md` | This record. |
| `docs/research/screenshot-pipeline-2026-09-29.md` | New source ledger and decisions. |
| `docs/audits/screenshot-pipeline-defects-2026-09-29.md` | New defect matrix and acceptance evidence. |
| `scripts/screenshots/lib/image-analysis.mjs` + test | Pure PNG decode/integrity/blank heuristic shared by the validator and the Vitest mirror. |
| `scripts/screenshots/product.mjs` | Readiness, provenance, atomic writes, concurrency guard, debug-artifact location, blank guard. Tablet hunks preserved. |
| `scripts/screenshots/validate.mjs` | Stronger decode, duplicate/traversal/requested-set checks, source-asset registry, byte equality for video copies. |
| `apps/website/src/components/ProductShowcase.astro`, `FeatureVisual.astro`, `ScreenshotFigure.astro` | Crop/fit policy, intrinsic sizing, loading priority, visitor-safe missing-image handling. |
| `apps/website/src/data/screenshot-manifest.json` | Own hunks only: new provenance fields, `kind`, and the two source-asset scenes. Tablet entry preserved verbatim. |
| `apps/website/src/test/screenshots.test.ts`, `apps/website/src/test/imageAnalysis.test.ts` | Manifest and image-analysis regression tests. |
| `apps/website/src/pages/docs/settings.astro` | Replace the one hardcoded screenshot path with the manifest consumer. |
| `docs/screenshots/product/*`, `apps/website/public/screenshots/*` | Only files this task captures or promotes. |
| `scripts/screenshots/README.md` | Document the changed contracts. |

## Commit protocol

1. Recheck `git status`, the exact file diff, and the index before each commit.
2. Stage only this task's paths or exact hunks; never `git add` a whole shared
   file that contains another task's edits.
3. Run the affected validation plan for each slice; record exact commands and
   skipped unrelated work in the final Agent Validation Report.
4. Keep this ledger current.

## Milestone log

- **Recon + baseline evidence.** Reproduced `node scripts/screenshots/validate.mjs`
  failing on the shared checkout with two violations (orphan
  `performance-settings-dark.png` in `public/screenshots/`;
  `debug-workspace-shared-workflows.png` in `docs/screenshots/product/`, a debug
  artifact from a concurrent `VARVE_SHOT_DEBUG` run landing in the canonical
  output dir). Recorded in the audit doc.
- **Readiness + provenance + non-destructive output.** In progress.
- **Validation strength.** Pending.
- **Website delivery + refreshed imagery.** Pending.
- **Regression and visual validation.** Pending.
