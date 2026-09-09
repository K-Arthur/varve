# Generative editing capability matrix — 2026-09-09

## Evidence-based root-cause report

The repository contains a partial Content-Aware Fill implementation rather
than a general Generative Fill system. The useful pieces are real and tested:
PatchMatch is deterministic and offline; LaMa has a verified optional model
path and native desktop adapter; context extraction is bounded; image assets,
raster masks, history, save/reopen, and export already have canonical owners.

The incomplete behavior comes from four boundaries:

1. The modal owns a painted mask and result only in React state. It does not
   derive or persist the user's canonical selection/mask recipe.
2. The apply path inserts a new image layer outside the normal transaction
   boundary, so the runtime warns that persistent history capture was bypassed.
3. The engine contract is named Content-Aware Fill and has only `fast`/`ai`
   quality. It has no operation mode, prompt/provenance record, variation
   identity, or stale-job state machine.
4. LaMa is image-conditioned, not text-conditioned. Treating its output as
   prompt-driven Replace would be misleading; Expand has no provider at all.

## Capability matrix

| Capability | Existing implementation | Model/provider | Engine | Frontend | Mask behavior | Undo/redo | Serialization | Offline | Browser | Tauri | Export | Tests | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Raster selection to mask | Area selection, painted selection, source-pixel mapping | None | `selectionMask`, area-selection algebra | Selection tools and quick mask | 0 preserve / 255 selected | Selection history | Saved selections; derived masks | Yes | Yes | Yes | Existing raster paths | Unit + E2E | Large masks | partial, reusable |
| Object removal | Painted CAF mask + bounded context | PatchMatch or LaMa | `contentAwareFill` | CAF dialog | User-painted edit region | Apply is currently outside transaction | Output layer only; no recipe | Fast yes; LaMa after download | Worker path | Native LaMa | Ordinary image asset | 31 unit + 13 E2E | Mask fidelity, memory | partial |
| Generative Fill | Same as removal, no prompt mode | LaMa does not consume prompt | No generative edit record | Labeled Content-Aware Fill | Painted mask only | New layer, history warning | No provenance/session record | Fast yes | Yes | Yes | Yes | Existing CAF tests | Misleading product semantics | disconnected |
| Generative Replace | No provider | None verified | No | None | — | — | — | — | — | — | — | None | Licensing/model gap | missing |
| Generative Expand | Crop/bounds and image resize exist independently | None | No outpaint adapter | Crop/resizes only | No exposed-region generation mask | Existing crop history | Crop persisted | Yes | Yes | Yes | Existing export | Crop tests | Spatial semantics | missing |
| Variations | Single result preview | Provider result only | No variation contract | No gallery | One transient mask | Preview should not write history | Not persisted | N/A | N/A | N/A | N/A | None | Memory/cache | missing |
| Job orchestration | AbortController per dialog action | Worker/native calls | No shared generative job state | Generating/error only | No stale mask revision | Cancel leaves modal state | No recovery record | Local only | Yes | Yes | N/A | Provider cancellation tests | Stale results | partial |
| Model lifecycle | Verified manifest + IndexedDB partials | ONNX models | Background-removal model store | Download dialog | N/A | N/A | Model not document data | Explicit download | Yes | Yes | N/A | Manifest/store tests | Quota/large model | complete for existing models |
| Source preservation | Derived image insertion | N/A | Existing asset dedup | Apply creates sibling | Existing source untouched | Current apply needs transaction repair | Asset survives codec | Yes | Yes | Yes | Existing image export | Image/codec tests | Asset bloat | partial |
| Color/alpha | Existing ICC and alpha pipelines | Models are sRGB-like | CAF uses ImageData | No generative-specific status | Alpha convention implicit | N/A | Source metadata persists | Yes | Yes | Yes | Existing export | Color/alpha tests | Halos/profile mismatch | partial |
| Privacy | Local-first model policy | No remote generative provider | No upload path | AI model download copy | N/A | N/A | No credentials in docs | Yes | Yes | Yes | N/A | Offline/model tests | Future provider consent | complete boundary |

## Baseline evidence

- `pnpm verify:plan` — no changed files detected.
- `pnpm verify:affected` — no changed files detected.
- `pnpm exec vitest run packages/engine/src/contentAwareFill` — 3 files,
  31 tests passed.
- `pnpm --filter @varve/engine typecheck` — passed.
- `pnpm --filter @varve/editor typecheck` — passed.
- `VARVE_E2E_PORT=1421 pnpm exec playwright test
  tests/e2e/caf/caf.spec.ts --project=chromium --reporter=list` — 13 tests
  passed. The run emitted the existing `updateDoc called outside transaction`
  warning on Apply/Undo flows.

No real model-quality corpus or peak-memory measurement was claimed in this
baseline: the existing browser path exercises the deterministic Fast provider,
and no licensed prompt-conditioned Replace/Expand model is installed or
verified in this environment.
