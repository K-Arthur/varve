# Image Upscaling System — Audit & Implementation Plan

**Date:** 2026-07-27
**Scope:** Comprehensive audit, repair, and enhancement of Strata's image upscaling workflow.

---

## 1. Current-State Audit Matrix

| Area | Current Implementation | Runtime Path | Model/Algorithm | Input Contract | Output Contract | Memory Strategy | UI Wiring | Test Coverage | Defect or Risk | Proposed Resolution |
|------|----------------------|--------------|-----------------|----------------|-----------------|-----------------|-----------|---------------|----------------|---------------------|
| CPU nearest | `imageEnhancement.ts:85-99` | Worker → direct | Nearest-neighbor | ImageData RGBA | ImageData RGBA | Single output buffer | Inspector Select | Unit (alpha-safe) | None | Expose as "Pixel art" mode |
| CPU bilinear | `imageEnhancement.ts:102-144` | Worker → direct | Bilinear, premultiplied-alpha | ImageData RGBA | ImageData RGBA | Single output buffer | Inspector Select | Unit (alpha-safe) | None | Expose as "Fast" mode |
| CPU bicubic | `imageEnhancement.ts:180-217` | Worker → direct | Catmull-Rom, premultiplied-alpha | ImageData RGBA | ImageData RGBA | Single output buffer | Inspector Select | Unit (alpha-safe) | None | Expose as "Balanced" mode |
| CPU lanczos3 | `imageEnhancement.ts:233-273` | Worker → direct | Lanczos-3, premultiplied-alpha | ImageData RGBA | ImageData RGBA | Single output buffer | **NOT exposed in UI** | Unit (alpha-safe) | Hidden from users | Expose as "Quality" mode |
| AI Real-ESRGAN x4 | `aiUpscale.ts:119-179` | Worker (ONNX WASM) | Real-ESRGAN x4v3 | ImageData RGBA, NCHW float32 [0,1] | ImageData RGBA, 4x dims | Tiled 256px cores + 32px padding | Inspector Select "AI detail" | Unit + E2E | None | Expose as "AI enhancement" mode |
| AI Real-ESRGAN x4 native | `crates/strata-upscale/src/ai.rs` | Tauri IPC | Real-ESRGAN x4v3 | PNG bytes → RGBA | PNG bytes → RGBA | Tiled 64px + 16px overlap, single-flight gate | Inspector (via dispatch) | Rust unit + integration | None | Already production-grade |
| Provider dispatch | `upscaleProviders/dispatch.ts` | Worker → native → direct | Chain of responsibility | ImageData + UpscaleOptions | ImageData | Per-provider | Transparent to UI | Unit (dispatch.test.ts) | None | Add capability detection UI |
| Model manifest | `upscaleModels.ts` | Bundled | Real-ESRGAN x4v3 | — | — | 4.8MB bundled ONNX | — | — | Only one model | Document contract |
| Model loader | `backgroundRemoval/modelLoader.ts` | IndexedDB + bundled | — | Model ID | Model blob/path | LRU + persistent | — | — | Shared with bg removal | — |
| Alpha handling (CPU) | Premultiplied-alpha interpolation | All CPU paths | — | RGBA premult | RGBA unpremult | — | — | Unit | None | — |
| Alpha handling (AI) | Separate bilinear alpha upscale | Worker + native | — | RGBA → RGB + A | RGB upscaled + A bilinear | Two-pass | — | Unit | None | — |
| Tiling (TS worker) | 256px cores + 32px padding | Worker | — | Arbitrary dims | 4x dims | Per-tile buffers | — | Unit (aiUpscale.test.ts) | None | — |
| Tiling (Rust native) | 64px tiles + 16px overlap | Tauri | — | Arbitrary dims | 4x dims | Per-tile buffers | — | Rust unit | None | — |
| Cancellation | AbortSignal + UpscaleCancelState | All paths | — | — | — | — | Inspector Cancel button | Unit + E2E | None | — |
| Progress | Per-tile callbacks | Worker + native | — | — | — | — | Inspector progressbar | Unit | None | — |
| History | `insertDerivedImageShape` / `findOrCreateEmbeddedAsset` | Document model | — | — | — | — | — | Unit (imageOperations.test.ts) | None | — |
| Persistence | Embedded asset in document | SQLite | — | — | — | — | — | — | None | — |
| Inspector UI | `ImageEnhancementSection.tsx` | React component | — | — | — | — | DisclosureSection | E2E (image-enhancement.spec.ts) | No preview, no modes, no lanczos | Add dialog + modes |
| Quick bar | `SelectionQuickBar` | One-click bilinear 2x | — | — | — | — | Icon button | — | Hard-coded 2x bilinear | Wire to dialog |
| Layers context menu | `LayersPanel/index.tsx:437-451` | One-click AI 4x | — | — | — | — | Menu item | — | Hard-coded AI 4x | Wire to dialog |
| Command palette | `actions/registerAll.ts:169-179` | AI 4x | — | — | — | — | Search | — | Hard-coded AI 4x | Wire to dialog |
| Keyboard shortcut | **NONE** | — | — | — | — | — | — | — | No shortcut | Add Ctrl+Shift+U |
| Preview/dialog | **NONE** | — | — | — | — | — | — | — | No before/after preview | **Build UpscaleDialog** |
| Mode system | **NONE** | — | — | — | — | — | — | — | Raw algorithm names exposed | **Build mode abstraction** |
| Capability detection | **NONE** (implicit in dispatch) | — | — | — | — | — | — | — | User can't see what will run | Add capability UI |
| Denoise+upscale | **NONE** (SCUNet exists, separate) | — | — | — | — | — | — | — | No combined workflow | Document as deferred |
| Pixel-art mode | **NONE** | — | — | — | — | — | — | — | No integer scaling | Add nearest-neighbor integer mode |
| Visual regression | **NONE** | — | — | — | — | — | — | — | No visual baselines | Add Playwright visual tests |
| Image-quality corpus | **NONE** | — | — | — | — | — | — | — | No real-image validation | Add fixtures + metrics |
| Export verification | **NONE** | — | — | — | — | — | — | — | Upscaled content not verified in export | Add E2E export test |

---

## 2. Root-Cause Analysis

### 2.1 Architectural Gaps

1. **No preview surface.** The Inspector section applies upscaling immediately with no before/after comparison. This is the single largest UX gap. Professional design apps (Photoshop, Affinity, Photopea) all provide preview.

2. **Raw algorithm names exposed to users.** "Bilinear", "bicubic", "lanczos3" are implementation details. Users think in terms of outcomes: "fast", "quality", "pixel art", "AI enhancement".

3. **Lanczos-3 hidden.** The highest-quality CPU algorithm exists in code but isn't in the UI. Users can't access it.

4. **No keyboard shortcut.** A frequent operation has no shortcut.

5. **No capability detection UI.** Users can't see whether AI will run via WASM, native, or fall back to CPU.

### 2.2 Model/Runtime Gaps

6. **INT8 quantization failed.** Both Real-ESRGAN and U2-Net INT8 variants failed quality validation (correlation loss 0.22 vs 0.05 threshold). INT8 is also slower than FP32 on CPU. The INT8 files are bundled but unused.

7. **Only one AI model.** Real-ESRGAN x4 is general-purpose. No illustration/anime model, no lightweight model for low-RAM systems.

8. **SCUNet denoise not wired to upscale.** The denoise model exists as a separate feature but can't be combined with upscale.

### 2.3 Testing Gaps

9. **No visual regression tests.** The upscale UI has no pixel-level baselines.

10. **No image-quality corpus.** No real-image fixtures for quality validation.

11. **E2E coverage thin.** `image-enhancement.spec.ts` exists but doesn't test the dialog (because there isn't one).

---

## 3. Selected Models and Algorithms

### 3.1 Deterministic Resampling

| Mode | Algorithm | Use Case | Scale Factors |
|------|-----------|----------|---------------|
| **Pixel art** | Nearest-neighbor | Pixel art, UI assets, hard edges | Integer (2x, 3x, 4x, 8x) |
| **Fast** | Bilinear | Quick previews, large images | 1.5x, 2x, 3x, 4x |
| **Balanced** | Bicubic (Catmull-Rom) | General photographs, illustrations | 1.5x, 2x, 3x, 4x |
| **Quality** | Lanczos-3 | Final output, print preparation | 1.5x, 2x, 3x, 4x |

All deterministic modes use premultiplied-alpha-safe interpolation (W3C compositing correct).

### 3.2 AI Enhancement

| Model | Scale | License | Size | Input | Output | Use Case |
|-------|-------|---------|------|-------|--------|----------|
| Real-ESRGAN General x4v3 | 4x | BSD-3-Clause | 4.8MB FP32 | NCHW float32 [0,1] RGB | NCHW float32 [0,1] RGB, 4x dims | Photos, illustrations, general purpose |

**Contract:**
- Input: `[1, 3, H, W]` float32, values [0, 1], RGB planar
- Output: `[1, 3, 4H, 4W]` float32, values [0, 1], RGB planar
- Dynamic H/W axes supported
- Alpha handled separately (bilinear upscale + reattach)
- Tiled processing: 256px cores + 32px padding (TS), 64px tiles + 16px overlap (Rust)

**Limitations:**
- Fixed 4x scale factor (no arbitrary dimensions)
- RGB only (alpha separate)
- May hallucinate detail in low-quality inputs
- Not suitable for pixel art or text-heavy images
- ~17MB peak memory for FP32 model

---

## 4. Runtime Architecture

### 4.1 Provider Chain

```
dispatchUpscale()
  ├─ workerUpscaleProvider    (Web Worker, WASM/ONNX) — tried first
  ├─ nativeUpscaleProvider    (Tauri IPC → Rust crate) — desktop only
  └─ directUpscaleProvider    (main-thread CPU) — last resort
```

### 4.2 Capability Detection

| Environment | CPU Methods | AI Methods |
|-------------|-------------|------------|
| Browser (worker available) | Worker CPU | Worker ONNX (WASM) |
| Tauri desktop | Worker CPU → Native CPU | Worker ONNX → Native ONNX |
| Browser (no worker) | Direct CPU | Unavailable |

### 4.3 Fallback Policy

1. Worker available → use worker (CPU or AI)
2. Tauri + native AI ready → use native (faster, lower memory)
3. Worker CPU → use worker CPU
4. Direct CPU → use main-thread CPU (non-AI only)
5. AI unavailable → inform user, offer deterministic fallback

---

## 5. Implementation Plan

### Phase 1: Audit + Specification (this document)
- Audit matrix ✓
- Root-cause analysis ✓
- Acceptance criteria ✓

### Phase 2: Mode System + Contracts
- Define `UpscaleMode` type (pixel-art, fast, balanced, quality, ai-enhance)
- Map modes to engine methods
- Add mode descriptions and use-case hints

### Phase 3: Upscale Dialog with Preview
- Build `UpscaleDialog` component
- Before/after split preview
- Mode + scale selection
- Output options (new layer / replace / new asset)
- Memory estimate + capability indicator
- Progress + cancellation
- Keyboard accessible (FocusTrap, aria-live)

### Phase 4: Accessibility + Keyboard
- Add Ctrl+Shift+U shortcut
- Focus management in dialog
- Screen reader announcements
- High-contrast support

### Phase 5: Testing
- E2E tests for dialog workflows
- Visual regression baselines
- Image-quality fixtures

### Phase 6: Documentation
- Model contract docs
- Known limitations
- User-facing help text

---

## 6. Acceptance Criteria

- [ ] At least one deterministic resize path works reliably (EXISTS)
- [ ] At least one validated ML upscale path works end to end (EXISTS)
- [ ] Model contracts documented and tested (EXISTS)
- [ ] Missing models handled through clear download/fallback (EXISTS)
- [ ] Browser and Tauri paths explicitly distinguished (EXISTS)
- [ ] Large images use safe tiling (EXISTS)
- [ ] Tile seams not visible in representative fixtures (EXISTS)
- [ ] Transparency preserved without obvious halos (EXISTS)
- [ ] Cancellation works at every major processing stage (EXISTS)
- [ ] Memory released after completion/cancellation/failure (EXISTS)
- [ ] **NEW:** Before/after preview available before applying
- [ ] **NEW:** User-facing modes (not raw algorithm names)
- [ ] **NEW:** Lanczos-3 exposed in UI
- [ ] **NEW:** Keyboard shortcut for upscale
- [ ] **NEW:** Output options include "new asset"
- [ ] **NEW:** Capability indicator shows execution path
- [ ] **NEW:** E2E tests for dialog workflows
- [ ] **NEW:** Visual regression baselines

---

## 7. Known Limitations (Documented)

1. **AI upscale is fixed 4x.** Real-ESRGAN x4v3 only supports 4x. For other scales, use deterministic resize.
2. **INT8 quantization not used.** Quality validation failed; FP32 is the only production variant.
3. **No illustration/anime AI model.** Real-ESRGAN is general-purpose. Illustrations may show minor artifacts.
4. **No denoise+upscale combination.** SCUNet denoise is a separate feature.
5. **AI may hallucinate detail.** Low-quality or heavily compressed inputs may show artifacts.
6. **No cloud inference.** All processing is local. No network upload of user images.
7. **Large images (>64MP output) blocked.** Memory safety ceiling enforced.
