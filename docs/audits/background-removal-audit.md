# Background Removal System Audit

**Date:** 2026-07-06 | **Scope:** `@strata/engine`, `@strata/editor`, `crates/strata-bgremove`, ADR-0005

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

**Over-engineered for Strata now:** cloud API dependency, trimap UI, multi-subject instance segmentation UI, HTTP Range resume for 380MB models (nice-to-have).

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
| Native Rust AI (`ai` Cargo feature) | P2 | Deferred — Worker path covers desktop |
| Bundled models in shipping build (`bundled: false` in manifest) | P2 | Packaging decision — ship u2netp in AppImage |
| Hair/fur matting refinement | P2 | Deferred — `RefineMaskTool` partial |
| HTTP Range resume on interrupted download | P3 | Deferred |
| SHA-256 in manifest (`null` today) | P2 | Add hashes when models bundled |
| Select-and-Mask style trimap UI | P3 | Over-engineered for v1 |

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
| Selection changes mid-process | Completes but skips doc update if deselected |
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
- Large images: full-res mask; preview downscale deferred
- Batch: sequential with error isolation (no abort-all on one failure)

---

## 8. Testing strategy

| Suite | Count | Covers |
|---|---|---|
| `backgroundRemoval/__tests__/*` | 62 | Dispatch, model loader, manifest, worker, heuristic, mask ops |
| `ModelDownloadDialog.test.tsx` | 4 | Consent gate |
| `bgRemovalFeatures.test.tsx` | 14 | Preview, feather, decontaminate, export toggle |
| `BatchBgRemoveDialog.test.tsx` | — | Batch UI |

**Regression guards added:** model routing per method, `syncFromStorage`, stale state cleanup, platform dispatch order (Worker before Tauri for AI).

---

## 9. Verification (this session)

```
vitest packages/engine/src/backgroundRemoval
       packages/editor/.../BackgroundRemoval
       packages/editor/.../bgRemovalFeatures.test.tsx
→ 76/76 pass (10 files)
```

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
| P2 | Enable `strata-bgremove` `ai` feature for native ONNX on desktop | 3–5d |
| P2 | WebGPU EP when WebKit ships it | 2d |
| P2 | Interrupted download cleanup (delete partial blob) | 1d |
| P3 | Dedicated hair refinement / matting pass | 1–2w |
| P3 | Multi-subject instance picker | 2w+ |

---

## 12. Technical debt

- `index.ts` direct ONNX path duplicates worker logic
- Manifest checksums null — verification noop
- `BackgroundRemovalSection` uses separate model IDs for balanced vs quality but single `loader.getState()` tracks one model
- Rust `ai` feature not in default desktop build
- Export pre-process bg removal toggle tested in inspector test file (should move)

---

## 13. Migration / rollout

No breaking schema changes. Existing documents with `backgroundRemoval` masks remain valid. Users who downloaded models before this session benefit from `syncFromStorage` on next launch.

---

## References

- `docs/adr/0005-offline-model-bundling.md`
- `docs/plans/bg-removal-deferred.md`
- BiRefNet / U²-Net model families (on-device segmentation)
- Photoshop Select Subject + Select and Mask (Adobe, industry baseline)
