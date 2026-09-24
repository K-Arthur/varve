# Ownership — Frequency Separation & Liquify (2026-09-13)

Task: implement non-destructive Frequency Separation and Liquify for raster
layers through the canonical document / render / export pipeline.

Baseline: `master` @ `ce2461148` (working tree contains unrelated in-flight
agent work; this task stages only the files below).

## Owned files (new)

| Area | Path |
|---|---|
| Liquify field + brush engine | `packages/engine/src/liquify/**` |
| Liquify warp/sampling | `packages/engine/src/liquify/warp.ts` |
| Frequency separation math | `packages/engine/src/frequencySeparation.ts` |
| Frequency separation scene ops | `packages/scene/src/frequencySeparation*.ts` |
| Liquify scene state | `packages/scene/src/liquify*.ts` |
| IR build integration | `packages/editor/src/render/liquifyFieldCache.ts` |
| FS dialog | `packages/editor/src/components/FrequencySeparation/**` |
| Shell integration | `packages/editor/src/components/Shell/index.ts` | Re-export `FrequencySeparationDialogHost`, already mounted by `Shell.tsx` |
| Liquify tool + overlay | `packages/editor/src/tools/LiquifyTool.ts`, `packages/editor/src/components/Liquify/**` |
| E2E | `tests/e2e/canvas/frequency-separation.spec.ts`, `tests/e2e/canvas/liquify.spec.ts` |
| Docs | `docs/architecture/frequency-separation-liquify.md`, this file |

## Shared files touched (re-read before edit; minimal diffs)

| File | Change |
|---|---|
| `packages/scene/src/types.ts` | `GroupNode.frequencySeparation?`, `RasterLayerNode.liquify?` |
| `packages/editor/src/render/sceneToEngine.ts` | decode FS group, apply liquify at IR build |
| `packages/editor/src/render/replayScene.ts` | FS group leaf replay (mirrors live-boolean) |
| `packages/editor/src/tools/toolRegistry.ts` | register `liquify` tool |
| `packages/editor/src/actions/createActionHandlers.ts` | FS command |
| `packages/editor/src/Menubar.tsx` | menu entries |
| `packages/engine/src/index.ts`, `packages/scene/src/index.ts` | re-exports |

## Contract summary

- Frequency separation persists as two ordinary raster layer children inside a
  group marker `frequencySeparation = { version, method, radius, lowNodeId,
  highNodeId }`. The high band is the signed residual encoded as
  `E = clamp(round(H/2) + 128)`; decode `H' = 2(E − 128)`. Declared reconstruction
  tolerance: `max |R − I| ≤ 1` channel LSB (8-bit working representation).
  Decode happens at band conversion in `sceneNodeToEngineNode`, so every
  render/export path shares it; bands carry a validated O(1) role reference.
- Liquify persists as a bounded displacement field on the raster node (or the
  separation group) in reference pixel units; the field is resampled during IR
  build, never baked into source tiles. Output→source inverse mapping is
  defined here: `output(x) = sample(source, x + D(x))`.
- Both features are decoded/applied at the `flattenSceneToEngine` /
  `sceneNodeToEngineNode` boundary so canvas, worker, thumbnails, and export
  agree by construction.

## Status — 2026-09-13

Implemented, tested, and visually verified on `master`:

| Commit | Content |
|---|---|
| `d6540af8e` | Engine liquify field/warp + frequency-separation math, plan, ownership |
| `0e1796dfb` | Architecture doc, CHANGELOG, website feature page |
| `699a0bb65` | Band-level decode fix, roles, clone remap, perf fixture, IR tests, E2E specs |

Verification: 167 focused unit tests across engine/scene/editor; 3 Playwright
tests green with in-page pixel oracles (separation identity, re-split, liquify
undo/redo); audits (biome staged, emoji, docs, health, secrets, boundaries)
clean. Full `pnpm verify:affected` is pending until the shared `node_modules`
install settles (pnpm currently aborts non-TTY module-dir purges).
