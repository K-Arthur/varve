# AI Model Recovery — Implementation Progress

> Scoped implementation plan for restoring colourisation and font-identification
> capabilities that are currently disabled due to unavailable model artifacts.

Started: 2026-07-27
Branch: master (commit f0669631)

---

## Phase 0 — Baseline

| Check | Result | Pre-existing |
|-------|--------|-------------|
| `pnpm --filter @varve/engine test` | 13 failed / 2812 passed | Yes — 12 contractVersion-undefined + 1 BiRefNet-SHA mismatch in `manifestContracts.test.ts` |
| Git status | 13 modified files + 1 untracked (unrelated concurrent work) | Preserved |

Pre-existing failures:
- `manifestContracts.test.ts`: 11 models fail "has consistent validation fields" because `contractVersion` is undefined despite `contractVerified: true`
- `manifestContracts.test.ts`: "BiRefNet Full has no SHA-256" fails because it now HAS a SHA-256
- `bundledModel.test.ts`: 1 failure

---

## Phase 1 — Architecture Map

### Colourisation capability

| Layer | File | Status |
|-------|------|--------|
| UI entry | `packages/editor/src/components/Inspector/sections/ColorizeSection.tsx` | Exposes 4 classical workflows (recolor, palette, transfer, harmonise). NO photo-colorize entry. |
| UI settings | `packages/editor/src/components/Settings/ColorizationModelsTab.tsx` | Filters catalog for `ddcolor`/`ddcolor-tiny`, shows "Unavailable" |
| Pipeline dispatch | `packages/engine/src/colorization/pipelineDispatch.ts` | Routes classical synchronously, photo-colorize through ONNX worker |
| Classical algorithms | `recolor.ts`, `transfer.ts`, `harmonize.ts`, `pipeline.ts` | Fully implemented, no model needed |
| DDColor ONNX path | `runtimeResolver.ts` → `dispatchOnnxWorker` → `inferenceWorker.ts` | Implemented but unreachable (no model file) |
| DDColor model code | `packages/engine/src/inference/models/ddcolor.ts` | Tensor spec + decode implemented |
| Worker registration | `inferenceWorker.ts:200-204` | `ddcolor` registered with 512x512 input |
| Catalog | `modelCatalog.ts` FALLBACK_ENTRIES | ddcolor/ddcolor-tiny NOT present |
| Manifest | `apps/desktop/public/models/manifest.json:680-773` | Both entries have `remoteUrl: ""`, `sha256: null` |

### Font detection capability

| Layer | File | Status |
|-------|------|--------|
| UI entry | — | **NONE** — no inspector section, no menu, no command |
| Model code | `packages/engine/src/inference/models/fontDetect.ts` | Stub: preprocessing + ink-density heuristic, no ONNX inference |
| Worker registration | `inferenceWorker.ts` | **NOT registered** — `font-detect` not in `WorkerModelType` union |
| Catalog | `modelCatalog.ts` | NOT present |
| Manifest | `manifest.json:846-859` | `remoteUrl: ""`, `sha256: null` |
| Exports | `packages/engine/src/index.ts` | Re-exports fontDetect helpers (dead code) |

### Key insight

The colourisation feature already has 4 functional classical (non-ML) workflows. The DDColor
ONNX path is fully implemented but unreachable. Font detection is an unwired scaffold with no UI,
no worker registration, and a stub model module that never runs real inference.

---

## Phase 2 — Research Matrix

### Colourisation candidates

| Candidate | Source | License | ONNX | Verdict |
|-----------|--------|---------|------|---------|
| DDColor official (piddnad/ddcolor_modelscope) | piddnad/DDColor (ICCV 2023) | Apache-2.0 | PyTorch only, official export script exists | **PRIMARY — reproducible conversion path** |
| DDColor official (piddnad/ddcolor_paper_tiny) | piddnad/DDColor | Apache-2.0 | PyTorch only | Tiny variant |
| Diogo122333/ddcolor-512-fp16-v6.onnx | Community upload | **None stated** | Yes (112MB) | **REJECT** — no model card, no license, no provenance |
| Faridzar/manga-colorization-v2-onnx | Community upload | Unknown | Yes | REJECT — manga-only, untrusted |
| Classical algorithms (existing) | Strata | — | N/A | **ALWAYS AVAILABLE — no model needed** |

**Decision**: DDColor via reproducible conversion from official weights. The official
`scripts/export_onnx.py` (opset 12) is verified — input "input" [1,3,H,W], output "output" [1,2,H,W].
Apache-2.0 permits redistribution with attribution. Classical workflows remain as the always-available
default.

### Font detection candidates

| Candidate | Source | License | Classes | Size | Verdict |
|-----------|--------|---------|---------|------|---------|
| storia/font-classify-onnx | Storia AI (HuggingFace) | MIT | 3473 (Google Fonts) | 64.1 MB | **PRIMARY** — ready ONNX, fonts_mapping.yaml |
| font-detect-resnet (original) | Unknown | Unknown | — | — | **REJECT** — no public source, no ONNX |

**Decision**: storia/font-classify-onnx. EfficientNet B3, MIT licensed, complete with font file
mapping. 3473 Google Fonts classes covers the vast majority of use cases.

---

## Phase 3 — Registry Schema Redesign

Redesign `ModelManifestEntry` to use an explicit acquisition discriminator.

Status: **complete**

Changes:
- Added `ModelAcquisition` discriminated union to `inference/types.ts` (5 variants: bundled, remote, generated, manual-import, unavailable)
- Added `ModelSource`, `ModelUnavailableReason` types
- Added `acquisition?` field to both `ModelManifestEntry` types (inference + core)
- Added `deriveAcquisition()` and `resolveAcquisition()` helpers in `core/types.ts`
- Added `deriveAcquisition()` in `manifest.ts` for raw manifest normalization
- Exported all new types from `inference/index.ts` and engine root index

---

## Phase 4 — DDColor Conversion

DDColor ONNX artifacts generated and bundled.

Status: **complete**

| Model | Size | Input | Output | SHA-256 |
|-------|------|-------|--------|---------|
| ddcolor-tiny | 220 MB | 256x256 | [1,2,256,256] | `cb8996ef...` |
| ddcolor | 980 MB | 512x512 | [1,2,512,512] | `69ba2e3d...` |

- Source: piddnad/ddcolor_modelscope + ddcolor_paper_tiny (Apache-2.0)
- Export: official `scripts/export_onnx.py` (opset 12) via `tools/ddcolor-export/` recipe
- Verified: ONNX checker, shape inference, simplification, ORT smoke test
- Storage: Git LFS (`*.onnx` tracked)

---

## Phase 5 — Colourisation Fallbacks

Classical workflows already implemented. Wire them as the primary always-available path.

Status: **pending**

---

## Phase 6 — Font Detection Pipeline

Complete pipeline built by concurrent agent + this session.

Status: **complete**

- `packages/engine/src/fontDetection/` — full pipeline (classifier, local-match, hybrid)
- `FontDetectSection.tsx` — Inspector UI entry point
- `storia/font-classify-onnx` — MIT model, 3473 classes, 320x320 input, SHA-256 pinned
- Tests: `fontDetectionPipeline.test.ts` (9 tests)

---

## Phase 7 — Frontend UX

Model cards, state display, colorization/font UI states.

Status: **pending**

---

## Phase 8 — Security

Integrity verification, HTTPS-only, hash validation.

Status: **pending**

---

## Phase 9 — Quality Validation

Fixture corpus + benchmarks.

Status: **pending**

---

## Phase 10 — Tests

Registry, acquisition, inference, workflow tests.

Status: **pending**

---

## Phase 11 — Documentation

Update model registry docs, architecture docs, attributions.

Status: **pending**

---

## Phase 12 — Progressive Commits

Milestone-based commits and pushes.

Status: **pending**

---

## Files Changed

TBD

## Risks

1. DDColor conversion requires Python/PyTorch — cannot be done in-browser, must be pre-generated
2. storia model is 64MB — needs memory gating
3. Font detection is a net-new feature — significant surface area
4. Pre-existing test failures must not be made worse
