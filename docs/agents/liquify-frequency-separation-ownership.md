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
  `E = round(H/2 + 127.5)`; decode `H' = 2E − 255`. Declared reconstruction
  tolerance: `max |R − I| ≤ 1` channel LSB (8-bit working representation).
- Liquify persists as a bounded displacement field on the raster node in
  normalized layer units; the field is resampled during IR build, never baked
  into source tiles. Output→source inverse mapping is defined here:
  `output(x) = sample(source, x + D(x))`.
- Both features are decoded/applied at the `flattenSceneToEngine` boundary so
  canvas, worker, thumbnails, and export agree by construction.
