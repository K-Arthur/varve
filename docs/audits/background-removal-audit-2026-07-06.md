# Background Removal System Audit

**Date:** 2026-07-06 | **Scope:** `@varve/engine`, `@varve/editor`, `crates/strata-bgremove`, ADR-0005

---

## Executive summary

Strata ships a **local-first, non-destructive** background removal pipeline: masks stored on scene nodes, source pixels untouched, undo/redo via document ops. Dispatch order is **Worker ONNX → Tauri native (heuristic-only today) → direct ONNX → heuristic**, with explicit user consent before any model download.

This session closed cross-platform gaps: **correct AI model routing**, **IndexedDB persistence sync on startup**, **Settings → Offline Models management**, **consent-gated downloads**, and **honest fallback announcements** when AI is unavailable.

---

## 1. Research findings (industry patterns)

| Pattern | Who does it well | Strata fit |
|---|---|---|
| One-click remove + refine | Photoshop Select Subject, Canva, Adobe Express | Quick mode = one-click; AI = opt-in upgrade |
| Non-destructive mask layer | Photoshop, Affinity Photo | `backgroundRemoval.maskDataUrl` on node — correct |
| Hair/fur refinement workspace | Photoshop Select & Mask, Affinity Refine | Deferred: brush refine exists (`RefineMaskTool`), no dedicated hair matting |
| Explicit download for ML | Figma plugins, on-device apps | ADR-0005 + `ModelDownloadDialog` consent gate |
| Batch processing | Canva Pro, Lightroom | `BatchBgRemoveDialog` + context action |
| Cloud API quality | remove.bg | **Rejected** — conflicts with offline-first / privacy positioning |

**User frustrations (industry):** surprise cloud uploads, silent quality downgrade, no undo, destructive flatten, metered-connection surprise downloads.

**Emerging:** on-device segmentation (BiRefNet, MODNet), WebGPU inference, matting networks for hair.

**Over-engineered for Strata now:** cloud API dependency, trimap UI, multi-subject instance segmentation UI.

**Completed 2026-07-06 (Phases A–D):** HTTP Range resume, storage-quota UX, bundled-model integrity on Settings open, BiRefNet rembg mirror URLs, `previewMaxDimension` default 2048px, RefineMask polish + inspector CSS, WebGPU EP documented as blocked on WebKitGTK.

---

## Session 48 verification (2026-07-09) — async timeout / cancel hardening

| Gate | Result |
|---|---|
| Full `pnpm test` | **4282/4282** pass |
| Full `pnpm typecheck` | **15/15** packages pass |
| Full `pnpm lint` | **0 errors** (404 warnings, pre-existing) |
| `pnpm audit:emoji` | **0** violations |
| `pnpm audit:tokens` | **96/96** WCAG-AA pass |

Session 48 closed the remaining async-state gaps: `fetchWithTimeout` now races `fetch` against an explicit timeout so it always rejects on timeout/abort; `AbortSignal` threads through `modelManifest`, `modelLoader`, `workerPool`, and providers; `workerPool` processQueue no longer picks assigned jobs; `dispatchBackgroundRemoval` has a top-level watchdog; `BackgroundRemovalSection` has cancel/progress/error UI; regression tests cover timeout, cancel, concurrency, and OOM. Tests and verification gates pass. See `BACKGROUND_REMOVAL_MEMORY.md` for details.

---

## Session 47 verification (2026-07-08) — Strategy-pattern refactor

| Gate | Result |
|---|---|
| Focused bg-removal suite | **154/154** pass (20 files) |
| `@varve/engine` typecheck | **0 errors** |
| `cargo test -p strata-bgremove` | **8/8** pass |

Session 47 extracted the inference dispatch chain into Strategy-pattern providers:
`worker-onnx` → `tauri-native` → `direct-onnx` → heuristic fallback.
See `packages/engine/src/backgroundRemoval/providers/` and `BACKGROUND_REMOVAL_MEMORY.md`.

---

## Session 40 verification (2026-07-06) — Phase E complete

| Gate | Result |
|---|---|
| Focused bg-removal suite | **163/163** pass (23 files) |
| `@varve/engine` typecheck | **0 errors** |
| `cargo clippy --workspace -D warnings` | **clean** |
| `cargo test --workspace` | **167/167** pass (+1 model metadata test) |
| Full `pnpm test` | motion WIP failures unchanged (unrelated) |

Phase E delivered: E.0 direct-ONNX `previewMaxDimension`, E.2 hair matting, E.3 multi-subject picker, E.4 trimap editor, E.1 ADR Option B + native ONNX parity.

BiRefNet release checksum (before bundling):

```bash
node scripts/compute-model-checksum.mjs \
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx" \
  birefnet-general-lite
node scripts/compute-model-checksum.mjs \
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx" \
  birefnet-general
```

---

## Session 39 verification (2026-07-06)

| Gate | Result |
|---|---|
| Focused bg-removal suite | **145/145** pass (18 files) |
| `@varve/engine` typecheck | **0 errors** |
| `cargo clippy --workspace -D warnings` | **clean** |
| `cargo test --workspace` | **166/166** pass |
| Full `pnpm test` | **11 failures** in uncommitted motion-system WIP (3731 pass / 3743 total) |
| Full `pnpm typecheck` 15/15 | **Blocked by motion WIP** (`styles.ts`, `motion.bench.test.ts`) |

BiRefNet release checksum (before bundling):

```bash
node scripts/compute-model-checksum.mjs \
  "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx" \
  birefnet-general-lite
```

---

## 2. Current architecture

```
Inspector (BackgroundRemovalSection)
  → context.removeBackgroundWithOptions
    → ImageCache.load → canvas ImageData
      → engine.removeBackground
        1. quick → heuristic.ts (flood/chroma/kMeans/edge)
        2. ai-*  → workerPool → worker.ts (onnxruntime-web WebGL/WASM)
        3. Tauri  → remove_background IPC (heuristic unless `ai` feature)
        4. direct → onnxruntime-web main thread
        5. fallback → heuristic
      → setBackgroundRemoval(doc, nodeId, { maskDataUrl, ... })
CanvasArea.toEngineNode → alphaMask on shape IR
replay.ts → destination-in compositing
```

| Layer | Location | Role |
|---|---|---|
| Scene | `packages/scene` — `backgroundRemoval` on nodes | Non-destructive mask + metadata |
| Engine | `packages/engine/src/backgroundRemoval/` | Segmentation + model I/O |
| Native | `crates/strata-bgremove` | Desktop heuristic IPC |
| UI | `BackgroundRemovalSection`, `ModelDownloadDialog`, `BatchBgRemoveDialog` | Inspector + batch + consent |
| Storage | IndexedDB (`modelStore.ts`), manifest (`public/models/manifest.json`) | Offline models ADR-0005 |

---

## 3. Cross-platform model distribution

| Environment | Inference | Storage | Consent |
|---|---|---|---|
| **Tauri desktop** | Web Worker ONNX in webview (primary for AI); native IPC fallback | IndexedDB in webview + optional bundled `/models/*.onnx` | `ModelDownloadDialog` — name, size, source host, purpose |
| **Browser dev / web** | Same Worker path | IndexedDB | Same dialog |
| **Offline** | Quick heuristic always; AI if model previously downloaded or bundled | Manifest `bundled: true` entries | No network without user action |

**Implemented this session:**
- `ModelLoader.syncFromStorage()` — restores `ready` state from IndexedDB/bundled assets after reload
- `ModelLoader.isModelAvailable(modelId)` — verifies path exists (no stale localStorage lies)
- `ModelLoader.listInstalledModels()` / `deleteModel()` — Settings → **Offline Models** tab
- `workerModelIdForMethod()` — `ai-balanced` → `birefnet-general-lite`, `ai-quality` → `birefnet-general`
- Fallback announcement when AI requested but heuristic ran
- Apply blocked in inspector when AI selected but model missing (opens download dialog)

---

## 4. Gap analysis

| Gap | Severity | Status |
|---|---|---|
| AI Balanced routed to u2netp / Quality to lite | P0 | **Fixed** |
| Model state lost on page reload | P0 | **Fixed** (`syncFromStorage`) |
| No settings surface for model storage | P1 | **Fixed** (Offline Models tab) |
| Silent AI→heuristic downgrade | P1 | **Fixed** (announce + store actual `result.method`) |
| Bundled models in shipping build (`bundled: false` in manifest) | P2 | **Fixed** — `u2netp.onnx` bundled with SHA-256 CI check |
| Hair/fur matting refinement | P2 | **Fixed (E.2)** — `refineHairMatting` guided filter + inspector action |
| HTTP Range resume on interrupted download | P3 | **Fixed** (Session 39) |
| SHA-256 in manifest (`null` today) | P2 | **Fixed** for `u2netp`; BiRefNet hashes via release script (documented) |
| Select-and-Mask style trimap UI | P3 | **Fixed (E.4)** — ephemeral `TrimapEditTool` + `solveTrimapMatting` |
| Direct-ONNX `previewMaxDimension` parity | P2 | **Fixed (E.0)** — `downscaleImageData` before model input |
| Native Rust `ai` Cargo feature | P2 | **Fixed (E.1)** — Option B ADR; dynamic IO, preview downscale, real confidence |
| Multi-subject instance picker | P2 | **Fixed (E.3)** — `findConnectedComponents` + `SubjectPickerOverlay` |
| Per-model gating on direct-ONNX tier | P0 | **Fixed** — `isModelAvailable(workerModelIdForMethod)` |
| Broken direct-ONNX path (hardcoded path, raw Float32Array) | P0 | **Fixed** — `getModelPath()`, `ort.Tensor`, shared maskOps |
| Batch/Export silent AI downgrade | P0 | **Fixed** — gating + `result.method` persistence + aria-live |
| `RefineMaskTool` unreachable from UI | P0 | **Fixed** — inspector button + brush controls + Escape |
| Worker pool abort/timeout dequeue bugs | P2 | **Fixed** — splice on abort/timeout; context selection-change abort |
| `batchRemoveBackground` dead code drift | P1 | **Removed** — `BatchBgRemoveDialog` is sole batch path |
| Native Rust `ai` Cargo feature | P2 | **Fixed (E.1)** — opt-in `ai` feature; Worker-first dispatch unchanged (ADR-0005) |

---

## 5. Edge cases

| Case | Behavior |
|---|---|
| 0×0 image | Throws before dispatch |
| CORS / load failure | Context announces; no doc mutation |
| No AI model + AI method | Inspector blocks apply; batch falls back with announce |
| Worker crash | Falls through chain to heuristic |
| IndexedDB unavailable | Download fails with clear error; Quick mode works |
| Checksum mismatch | Download rejected, state `error`, retry available |
| Selection changes mid-process | Aborts in-flight AI request; skips doc update if deselected |
| Offline | Quick works; AI needs prior download or bundled asset |

---

## 6. Accessibility

- `ModelDownloadDialog`: FocusTrap, `aria-modal`, consent copy, `aria-live` on progress
- Inspector: `aria-label` / `aria-describedby` on method + feather controls
- Screen reader: processing + fallback announcements via shared announcer
- Keyboard: dialog Escape, Tab cycle via FocusTrap

---

## 7. Performance

- Worker pool with session reuse (`workerPool.ts`)
- Inference off main thread (Worker + OffscreenCanvas)
- Heuristic: O(n) pixel ops — suitable for preview
- Large images: `previewMaxDimension` default 2048 (Worker, direct-ONNX, native Rust)
- Batch: sequential with error isolation (no abort-all on one failure)

---

## 8. Testing strategy

| Suite | Count | Covers |
|---|---|---|
| `backgroundRemoval/__tests__/*` | 93 | Dispatch, CC labeling, hair matting, trimap, preview downscale, mask ops |
| `SubjectPickerOverlay.test.tsx` | 3 | Multi-blob picker confirm/cancel |
| `bgRemovalFeatures.test.tsx` | 23 | Preview, feather, Phase E inspector actions |
| `BatchBgRemoveDialog.test.tsx` | 16 | Batch UI, AI gating, fallback announce |
| `RefineMaskTool.test.ts` | — | Escape/V, cancel-restore, per-stroke commit |
| `ToolManager.test.ts` | 2 | `getTool()` accessor |

**Regression guards added:** model routing per method, `syncFromStorage`, stale state cleanup, platform dispatch order (Worker before Tauri for AI).

---

## 9. Verification (hardening session, 2026-07-06)

```
Focused suite (bg-removal pipeline):
  packages/engine/src/backgroundRemoval/**          → 57/57 pass
  BatchBgRemoveDialog.test.tsx                      → 16/16 pass
  RefineMaskTool.test.ts + ToolManager.test.ts      →  8/8  pass
  bgRemovalFeatures.test.tsx                        → 20/20 pass
                                          focused   → 113/113 pass

Full regression (see AGENTS.md session entry for complete gate output)
```

Regression guards added this session:
- Per-method `isModelAvailable` gating on direct-ONNX tier (`index.test.ts`)
- Tauri IPC `method` never trusted as AI (`index.test.ts:243`)
- Worker-first dispatch even when `__TAURI__` present (`index.test.ts:87`)
- WASM EP fallback + non-zero `processingTimeMs` (`directAi.telemetry.test.ts`)
- Bundled `u2netp.onnx` SHA-256 integrity (`bundledModel.test.ts`)
- Batch/Export AI gating + `result.method` persistence (`BatchBgRemoveDialog.test.tsx`, `bgRemovalFeatures.test.tsx`)
- Worker pool abort dequeues job (`workerPool.test.ts`)
- Model download checksum mismatch + cancel (`modelLoader.test.ts`)

---

## 10. Risk assessment

| Risk | Mitigation |
|---|---|
| 380MB download on metered connection | Consent dialog shows size + source |
| WebGL unavailable (Linux WebKit) | WASM EP fallback in worker |
| Stale model in IndexedDB | Checksum when manifest populated |
| User expects native AI on desktop | Worker ONNX is primary; document in UI |
| Heuristic quality on hair/product | Steer users to AI download |

---

## 11. Roadmap (prioritized)

| Priority | Item | Effort |
|---|---|---|
| P0 | Ship u2netp bundled in desktop builds (`bundled: true` + sha256) | 1d |
| P1 | Populate manifest SHA-256 checksums | 0.5d |
| P1 | Per-method model availability in batch dialog | 1d |
| P2 | Enable `strata-bgremove` `ai` feature for native ONNX on desktop | **Done (E.1)** — opt-in; separate CI job |
| P2 | WebGPU EP when WebKit ships it | 2d — **blocked:** WebKitGTK has no WebGPU |
| P3 | Dedicated hair refinement / matting pass | **Done (E.2)** |
| P3 | Multi-subject instance picker | **Done (E.3)** |
| P3 | Trimap editor (Select-and-Mask lite) | **Done (E.4)** |

---

## 12. Technical debt

- BiRefNet manifest SHA-256 still null (remote-only; run `scripts/compute-model-checksum.mjs` at release — commands in Session 40 verification)
- Native `ai` feature opt-in only — not in default CI/release (ADR-0005 Option B)
- WebGPU EP deferred until WebKitGTK exposes `navigator.gpu` on Linux Tauri webviews

---

## 13. Migration / rollout

No breaking schema changes. Existing documents with `backgroundRemoval` masks remain valid. Users who downloaded models before this session benefit from `syncFromStorage` on next launch.

---

## References

- `docs/adr/0005-offline-model-bundling.md`
- `docs/plans/bg-removal-deferred.md`
- `docs/plans/archived/bg-removal-phase-e-prompt.md` — Phase E agent prompt + stub inventory
- BiRefNet / U²-Net model families (on-device segmentation)
- Photoshop Select Subject + Select and Mask (Adobe, industry baseline)
