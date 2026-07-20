# Background Removal System — Execution Memory

**Last updated:** 2026-07-19
**Environment:** CachyOS / Arch Linux, Node 26, pnpm 11.9, Rust 1.96  
**Branch:** master (uncommitted working tree)

---

## Phase 1 — Industry Research (complete)

| Tool | Workflow | Non-destructive? | Refinement UI |
|---|---|---|---|
| **Photoshop** | Select Subject → Select & Mask → layer mask output | Yes (layer mask) | Refine Edge brush, decontaminate, feather, black/white restore brushes |
| **Figma** | One-click Remove background in image toolbar | Partial (reversible in-session) | Erase/Isolate object tools; no pixel brush mask editor |
| **Canva** | BG Remover → Erase/Restore brushes | Partial | Brush size, show-original toggle |
| **Affinity** | Selection Refine workspace | Yes (mask layer) | Hair/fur refinement, feather, choke |
| **remove.bg** | Cloud API one-click | N/A (export PNG) | **Rejected** — conflicts with Strata offline-first ADR-0005 |

**Strata positioning:** Local-first, non-destructive mask on scene node (`backgroundRemoval.maskDataUrl`). Quick heuristic always available; AI via consent-gated ONNX download. Refinement stack: brush (`RefineMaskTool`), hair matting, trimap editor, multi-subject picker.

---

## Phase 2 — Architecture (current)

```
Inspector / Batch / Export
  → context.removeBackgroundWithOptions
    → ImageCache.load → ImageData
      → engine.removeBackground (Strategy chain)
        1. quick → heuristic.ts
        2. AI → workerProvider (Worker ONNX)
        3. AI → tauriProvider (native IPC, heuristic-only in default build)
        4. AI → directOnnxProvider (main-thread ONNX fallback)
        5. fallback → heuristic.ts
      → finalizeMaskResult (multi-subject picker if needed)
      → warmMaskRenderCache(maskDataUrl)   // bounded live-canvas proxy
      → commitRasterMask(doc, nodeId, { dataUrl, ... })
CanvasArea.toEngineNode → node.alphaMask (shape IR; live proxy when available)
  → native/WASM bridge flattens nested EngineFill + alphaMask to FillIR::Image.alpha_mask
  → stub engine maps nested EngineFill + node.alphaMask to FillIR::Image.alpha_mask
replay.ts → destination-in compositing
```

### Strategy-pattern providers (Session 47)

| Provider ID | File | When used |
|---|---|---|
| `worker-onnx` | `providers/workerProvider.ts` | `Worker` available; primary AI path on all platforms |
| `tauri-native` | `providers/tauriProvider.ts` | `__TAURI__` present; fallback when Worker fails |
| `direct-onnx` | `providers/directOnnxProvider.ts` | Worker unavailable + model in IndexedDB/bundled |

Orchestrator: `providers/dispatch.ts` → `AI_PROVIDER_CHAIN`

### Model routing

| UI method | ONNX model | Bundled? |
|---|---|---|
| `quick` | (heuristic only) | n/a |
| `ai-balanced` | IS-Net General Use (179 MB), U²-Net Light fallback | Optional / fallback bundled |
| `ai-quality` | BiRefNet General Lite (224 MB) | No — explicit download required |

---

## Phase 3 — Implementation Status

| Component | Location | Status |
|---|---|---|
| Heuristic engine | `packages/engine/src/backgroundRemoval/heuristic.ts` | **Done** |
| Worker pool + ONNX | `workerPool.ts`, `worker.ts` | **Done** |
| Model loader/store | `modelLoader.ts`, `modelStore.ts` | **Done** |
| Mask ops + CC labeling | `maskOps.ts`, `finalizeMask.ts` | **Done** |
| Hair matting | `refineHairMatting.ts` | **Done** |
| Trimap editor | `trimapMatting.ts`, `TrimapEditTool` | **Done** |
| Subject picker | `SubjectPickerOverlay.tsx` | **Done** |
| Refine mask brush | `RefineMaskTool.ts` | **Done** |
| Inspector UI | `BackgroundRemovalSection.tsx` | **Done** |
| Batch dialog | `BatchBgRemoveDialog.tsx` | **Done** |
| Model consent gate | `ModelDownloadDialog.tsx` | **Done** |
| Export integration | `ExportDialog.tsx` | **Done** |
| Native Rust (heuristic) | `crates/strata-bgremove` | **Done** |
| Native Rust AI (opt-in) | `strata-bgremove` `ai` feature | **Done** — not in default CI |
| WASM postinstall | `scripts/copy-onnx-wasm.mjs` | **Done** |

### Session 46 hardening (already in tree)

- Bundled model trust (`bundled: true` skips HEAD fetch)
- Worker init timeout 10s (was 60s hang)
- Batch reprocess (no stale skip)
- `requiredModelId` for downloads

### Session 47 changes (this turn)

- Extracted Strategy-pattern provider chain from monolithic `index.ts`
- Moved `DEFAULT_PREVIEW_MAX_DIMENSION` to `types.ts`
- Added `AI_PROVIDER_CHAIN` export + strategy order test
- Fixed `directAi.telemetry.test.ts` mock for `maskToDataUrl` re-export

### Session 48 changes (this turn)

- Hardened `fetchWithTimeout` to race `fetch` against an explicit timeout so it always rejects on timeout/abort without leaking unhandled rejections.
- Added `AbortSignal` propagation through `modelManifest`, `modelLoader`, `workerPool`, and providers.
- Fixed `modelManifest`/`modelLoader` timeout and cancellation tests using fake timers.
- Fixed `workerPool` processQueue job-selection bug (unassigned jobs + busy worker clearing).
- Added `cancelBackgroundRemoval` and progress/error UI to `BackgroundRemovalSection`.
- Added a top-level watchdog timeout in `dispatchBackgroundRemoval`.
- Hardened `directOnnxProvider` and `tauriRemovalProvider` timeouts/cancellation.
- Added regression tests for timeout, cancel, concurrency, and OOM.

### Session 49 — AI mask rendering fix (current)

- Defined canonical AI mask format:
  - **Storage**: `node.backgroundRemoval.maskDataUrl` — PNG data URL, RGBA channels all equal to the mask value (0 = transparent, 255 = opaque).
  - **Engine IR**: `FillIR::Image.alpha_mask` (flat) is the single source of truth for compositing.
  - **Bridge**: native/WASM `strata-bridge` now accepts the TypeScript engine's nested `EngineFill` and a node-level `alphaMask`, and flattens both into the canonical `FillIR::Image`.
- Fixed native/WASM engine dropping the alpha mask because it expected flat `FillIR` fills and had no node-level `alphaMask` field.
- Added `warmMaskRenderCache()` in `useBackgroundRemoval` so the first post-update render sees the mask already loaded and composites immediately.
- Added regression tests:
  - Rust bridge: nested image fill + node-level alphaMask → flat `FillIR` with `alphaMask`.
  - Editor: `sceneNodeToEngineNode` + `flattenSceneToEngine` → `engine.buildIr` emits `FillIR.alphaMask`.
  - Playwright E2E: deterministic pixel waits for quick-mode removal and undo/redo.

### 2026-07-19 — enhanced Balanced, aspect-ratio safety, and editing UX

- Added IS-Net General Use as the optional enhanced Balanced model with verified SHA-256.
- Added model-specific preprocessing; IS-Net uses 1024², mean 0.5/std 1, and no output sigmoid.
- Replaced square stretching with letterbox inference and soft-mask reconstruction on Web Worker,
  direct ONNX, and native Rust paths. Large images infer on a bounded preview and restore the
  matte to the original dimensions.
- Retained bundled U²-Net Light as the automatic low-memory fallback.
- Made Quick deterministic with adaptive border flooding, mask cleanup, and scene-aware confidence.
- Reworked Properties into a guided preview/review/edit flow with plain-language edge controls.
- Exposed one mask editor for Quick, Balanced, and High Quality results: checkerboard/overlay views,
  add/subtract brush, hair/fur refinement, trimap matting, and explicit Done.
- Real IS-Net native results: human IoU 0.990, vehicle 0.821, object 0.800.

### 2026-07-19 — Apply-result and large-image rendering fix

- Fixed Apply rejecting realistic embedded images: raster-mask source identity had copied the full
  image data URL into a metadata field capped at 8,192 characters. Long locators now use a stable,
  compact fingerprint while the image fill retains the authoritative source.
- Added an aspect-ratio-preserving live render proxy capped at 2,048 pixels on the longest edge.
  The full-resolution mask remains authoritative for persistence, export, and mask editing.
- Apply stays non-destructive on the selected image layer; it intentionally does not create a
  duplicate image. Edit mask, reset, undo, and redo continue to operate on the committed mask asset.
- Added browser pixel assertions for Quick and Balanced Apply, plus a 3000×600 panoramic regression
  that reproduces the former no-op and verifies a visible masked result.

---

## Phase 4 — Verification (2026-07-08)

| Gate | Result |
|---|---|
| Focused bg-removal suite | **154/154 pass** (20 files) |
| `@strata/engine` typecheck | **0 errors** |
| `cargo test -p strata-bgremove` | **8/8 pass** |
| Full `pnpm typecheck` | **15/15 pass** |
| Full `pnpm test` | **4282/4282 pass** |
| Full `pnpm lint` | **0 errors**, 404 warnings (pre-existing) |
| `pnpm audit:emoji` | **0 violations** |
| `pnpm audit:tokens` | **96/96 WCAG-AA pass** |

### Test inventory

| Suite | Count |
|---|---|
| `backgroundRemoval/__tests__/*` | 131 |
| `BatchBgRemoveDialog.test.tsx` | 17 |
| `bgRemovalFeatures.test.tsx` | 23 |
| `RefineMaskTool.test.ts` | 11 |
| `ModelDownloadDialog.test.tsx` | 5 |
| `SubjectPickerOverlay.test.tsx` | 3 |
| **Total focused** | **154** |

---

## Known limitations (environmental, not deferred code)

| Item | Reason |
|---|---|
| WebGPU EP | WebKitGTK has no `navigator.gpu` on Linux Tauri |
| BiRefNet manifest SHA-256 | `null` until release script run on 214/928 MB artifacts |
| Native AI in default desktop build | ADR-0005 Option B — opt-in `ai` Cargo feature |
| Right-click image paste on Wayland | WebKitGTK clipboard API limitation; Ctrl+V works |

---

## Next steps (if continuing)

1. Run full `just gate` after motion WIP merges
2. Populate BiRefNet SHA-256 at release: `node scripts/compute-model-checksum.mjs`
3. ~~Optional: Playwright E2E for inspector Apply → canvas alpha mask visible~~ (added deterministic pixel waits)
4. Optional: Enable native `ai` feature in dedicated CI job

---

## Key files

| File | Purpose |
|---|---|
| `packages/engine/src/backgroundRemoval/providers/` | Strategy-pattern inference backends |
| `packages/engine/src/backgroundRemoval/index.ts` | Public facade |
| `packages/editor/src/context.tsx` | `removeBackgroundWithOptions`, refine/trimap actions |
| `docs/audits/background-removal-audit.md` | Canonical audit |
| `docs/adr/0005-offline-model-bundling.md` | Offline model policy |
| `apps/desktop/public/models/manifest.json` | Bundled model registry |
