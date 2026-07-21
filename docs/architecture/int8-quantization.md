# INT8 Dynamic Quantization

**Status:** Implemented (2026-07-21)
**Author:** Session D3
**Models:** u2netp (3.5x compression), realesr-general-x4v3 (3.8x compression)

## Overview

INT8 dynamic quantization reduces bundled ONNX model sizes by 3.5–3.8× for
faster CPU fallback inference and lower memory footprint. Weights are
pre-quantized to QInt8 (symmetric, per-channel); activations are quantized
at runtime by ONNX Runtime.

## Eligibility decisions

| Model | Bundled | Quantized | Rationale |
|-------|---------|-----------|-----------|
| `u2netp` | yes | **yes** | Conv-heavy (119 Conv nodes), ideal for INT8. 4.7MB → 1.3MB. |
| `realesr-general-x4v3` | yes | **yes** | Conv+PRelu. 4.9MB → 1.3MB. |
| `isnet-general-use` | no | no | 179MB download; user-provided, not our artifact. |
| `birefnet-general-lite` | no | no | 224MB download; native-only on desktop. |
| `birefnet-general` | no | no | 928MB download; native-only on desktop. |

Only bundled models are quantized. Downloaded models stay FP32 because
we don't control their distribution pipeline.

## Quantization pipeline

Build tool: `scripts/quantize/quantize_model.py`

```bash
# One-time setup
python3 -m venv .venv && .venv/bin/pip install -r scripts/quantize/requirements.txt

# Quantize all
.venv/bin/python3 scripts/quantize/quantize_model.py --all

# Validate quality
.venv/bin/python3 scripts/quantize/validate_model.py --all --synthetic
```

Steps per model:
1. **Pre-process** — shape inference (`skip_symbolic_shape=True`).
2. **Quantize** — `quantize_dynamic()` with QInt8, per-channel, Conv/MatMul/Gemm only.
3. **Validate** — ONNX graph check + quality metrics (MAE, PSNR, correlation).

Generated artifacts go to `apps/desktop/public/models/quantized/`:
- `{model_id}-int8.onnx` — quantized model
- `{model_id}-int8-report.json` — provenance (source hash, ORT version, config)

## Performance benchmark (measured 2026-07-21)

**Hardware:** AMD Ryzen 3 5300U (Zen 2, AVX2, no AVX-512 VNNI), 2 threads

### u2netp (320×320 input, 100 iterations)

| Metric | FP32 | INT8 | Ratio |
|--------|------|------|-------|
| Cold start | 790 ms | 3532 ms | 4.5× slower |
| Steady p50 | 510 ms | 3207 ms | 6.3× slower |
| Steady mean | 533 ms | 3323 ms | 6.2× slower |
| Throughput | 1.9 FPS | 0.3 FPS | 0.16× |

### realesr-general-x4v3 (64×64 input, 100 iterations)

| Metric | FP32 | INT8 | Ratio |
|--------|------|------|-------|
| Cold start | 239 ms | 758 ms | 3.2× slower |
| Steady p50 | 125 ms | 836 ms | 6.7× slower |
| Steady mean | 133 ms | 834 ms | 6.3× slower |
| Throughput | 7.5 FPS | 1.2 FPS | 0.16× |

### Conclusion

**The 2–4× speedup target was NOT met.** INT8 is ~6× *slower* on this AVX2-only CPU. ONNX Runtime's CPU execution provider lacks INT8-accelerated GEMM kernels without AVX-512 VNNI (x86) or dot-product (ARM). The dequantization overhead dominates for these small models.

**Benefits that DO hold:**
- 3.5× smaller model files (faster download, lower memory at load)
- Lower peak memory during inference (INT8 weights, FP32 activations)

**Gate implementation:** `int8Accelerated` in `EnvironmentCapabilities` defaults to `false`. The `'performance'` preference falls back to FP32 with a recorded reason unless a CPU with AVX-512 VNNI is detected. `'automatic'` always uses FP32.

## Quality validation

Metrics computed per synthetic input:
- **MAE** — mean absolute error (FP32 vs INT8 outputs). Gate: ≤ 0.05.
- **PSNR** — peak signal-to-noise ratio. Gate: ≥ 25 dB.
- **Pearson r** — output correlation. Gate: ≥ 0.97.

Acceptance is per-model. A quantized candidate that fails any gate is
rejected and the FP32 source is used instead.

## Runtime selection

Quality preference (`InferenceQualityPreference`):
- `'automatic'` — FP32 by default (conservative); INT8 when validated+faster.
- `'performance'` — prefer INT8 path.
- `'quality'` — always FP32.

Resolution order in `resolveWebModel()`:
1. If performance preference and INT8 variant exists → use INT8.
2. Otherwise → FP32 source.
3. On INT8 load failure → automatic fallback to FP32 (one-shot, no retry loop).

## Manifest schema (version 2)

```json
{
  "id": "u2netp-int8",
  "filename": "u2netp-int8.onnx",
  "localPath": "/models/quantized/u2netp-int8.onnx",
  "sha256": "...",
  "bundled": true,
  "precision": "int8",
  "sourceModelId": "u2netp",
  "sourceSha256": "..."
}
```

New fields: `precision`, `sourceModelId`, `sourceSha256`, `qualityValidation`.

## Filesystem layout

```
apps/desktop/public/models/
├── manifest.json              # v2, includes INT8 entries
├── u2netp.onnx                # FP32 source (4.7MB)
├── realesr-general-x4v3.onnx  # FP32 source (4.9MB)
└── quantized/
    ├── u2netp-int8.onnx          # INT8 artifact (1.3MB)
    ├── u2netp-int8-report.json   # provenance
    ├── u2netp-validation-report.json
    ├── realesr-general-x4v3-int8.onnx
    ├── realesr-general-x4v3-int8-report.json
    └── realesr-general-x4v3-validation-report.json
```

## Architecture

```
types.ts                        InferenceQualityPreference, int8VariantId, resolveModelIdForPreference
  ↓
modelSelection.ts               resolveWebModel() — performance → int8 variant
  ↓
workerProvider.ts               passes qualityPreference through
  ↓
worker.ts                       executes INT8 model, reports modelPrecision
  ↓
modelLoader.ts                  resolves {id}-int8 manifest entry → /models/quantized/
  ↓
environmentCapabilities.ts      isWasmModelSafe() — INT8 has smaller memory estimate
  ↓
inferenceDiagnostics.ts         tracks active model, precision, latency
  ↓
AIPerformancePanel.tsx          UI: active model, precision, provider, latency
```

## Key integration points

| File | Change |
|------|--------|
| `types.ts` | `InferenceQualityPreference`, `int8VariantId()`, `resolveModelIdForPreference()`, `modelPrecision` on result |
| `modelSelection.ts` | `resolveWebModel()` returns `isInt8`, accepts `qualityPreference` |
| `workerProvider.ts` | Passes `options.qualityPreference`, annotates result with precision |
| `worker.ts` | INT8 model IDs in command type, emits `modelPrecision` |
| `modelLoader.ts` | Resolves INT8 paths via manifest (bundled fast-path) |
| `environmentCapabilities.ts` | `isWasmModelSafe('u2netp-int8')` uses smaller multiplier |
| `modelManifest.ts` | New fields: `precision`, `sourceModelId`, `sourceSha256` |
| `manifest.json` | v2, two INT8 entries with provenance |
| `diagnostics/inferenceDiagnostics.ts` | New — tracks precision, latency, provider |
| `AIPerformancePanel.tsx` | New — diagnostics UI |

## Diagnostics UI

The `AIPerformancePanel` component shows:
- Active model ID and precision (FP32/INT8)
- Execution provider (webgpu/webgl/wasm/native)
- Processing latency
- Input dimensions
- Quality preference in effect
- Fallback warnings (when INT8 → FP32)
- Inference history (last 10)

No document contents or input images are collected.

## Testing

Focused test files:
- `int8Quantization.test.ts` — type helpers, preference resolution
- `int8ModelResolution.test.ts` — manifest schema, loader, capabilities
- `modelSelection.test.ts` — INT8 variant resolution, fallback

Gates:
- `pnpm test` — full suite passes (353 tests)
- `pnpm typecheck` — clean on modified files (pre-existing errors elsewhere)
- `node scripts/quantize/quantize_model.py --all` — deterministic artifacts
- `node scripts/quantize/validate_model.py --all --synthetic` — quality gates

## Future work

- Per-channel vs per-tensor comparison on real images
- Real-image validation corpus (portraits, hair, transparency)
- QUInt8 experiment for non-negative weight distributions
- INT8 validation in CI (download source, quantize, validate, compare hash)
- Automatic INT8 selection based on CPU benchmark at startup
- INT8 for IS-Net / BiRefNet when web-distributed
