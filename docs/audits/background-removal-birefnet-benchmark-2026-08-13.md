# Background-removal / BiRefNet audit and benchmark plan

Date: 2026-08-13

This is the current evidence record for the BiRefNet/runtime investigation. It
supersedes neither the dated historical audits nor the production contracts;
it records what is measured, what is inferred, and what is still unavailable.

## Current-state audit

The implementation already contains a unified inference registry, a versioned
ONNX manifest, model download/storage lifecycle, worker/direct/native provider
adapters, source-resolution mask reconstruction, non-destructive document mask
commit, optional hair/trimap refinement, and browser/native E2E coverage. The
largest defects found in this pass were:

1. quality metric code was embedded in one Playwright test and called binary
   mask error `alphaMae`;
2. the checked-in corpus was too small for a default decision and its real
   image masks are reference-model masks, not independent ground truth;
3. the BiRefNet tensor contract tests explicitly described graph inspection and
   reference parity as not yet complete;
4. Rust and TypeScript retain a compatibility-level duplicate of model IDs and
   download metadata;
5. historical website copy described BiRefNet as native-desktop-only, which was
   too absolute: unsafe bare-WASM is blocked, while accelerated browser paths
   remain capability-dependent.

The first two defects are addressed by the reusable metrics module, benchmark
report schema, and corpus hygiene README. The product copy is addressed in the
same implementation slice.

## Evidence available today

The 2026-07-19 real-image benchmark measured production browser and native
paths on portrait, animal, vehicle, and object fixtures. Its strongest evidence
is directional rather than a universal leaderboard:

- Quick is fast and useful for simple backgrounds, but is not a general
  semantic cutout model.
- Browser Balanced produced a credible portrait result but conservative
  vehicle/object masks on the measured host.
- Native BiRefNet Lite materially improved the measured vehicle/object masks,
  at a cost of roughly 16–35 seconds per image on that CPU.
- Browser Quality correctly surfaced an explicit fallback when no safe
  accelerated provider was available; it did not pretend that Balanced was
  BiRefNet.

Those results support Auto → IS-Net when installed and High quality → native
BiRefNet Lite, while keeping U²-NetP bundled for low-memory compatibility. They
do not establish that BiRefNet wins every category or that a browser GPU will
match native CPU output.

## Runtime decision matrix

| Dimension | Existing ONNX web/native | Candle + safetensors | Other runtime |
|---|---|---|---|
| Output parity | Existing contract and native corpus evidence; same-checkpoint reference parity still open | Not run; no architecture/weight loader in tree | No candidate selected |
| CPU p50/p95 | Native measurements exist for selected fixtures; browser harness now records cold/warm percentiles | Not measured | Not measured |
| GPU p50/p95 | Not measured on a supported hardware provider in this environment | Not measured | Not measured |
| Cold model load | Native smoke path and diagnostics record it; broader matrix pending | Not measured | Not measured |
| Peak RAM/GPU memory | Native session pool and WASM preflight estimates; GPU peak matrix pending | Not measured | Not measured |
| Model size | U²-NetP 4.7 MB, IS-Net 179 MB, BiRefNet Lite 224 MB, Full 928 MB | Weights/runtime not available for a fair comparison | Not measured |
| Platform coverage | Worker ONNX plus native Tauri fallback | Unknown until operators/device backends are proven | Unknown |
| Operator coverage | Shipping ONNX exports already execute on supported paths | Architecture and operator compatibility unproven | N/A |
| Maintenance/packaging | Existing dependency and model lifecycle | New architecture, conversion, device, and packaging burden | No justified proposal |
| Failure/fallback quality | Typed provider failures, preflight, cancellation, explicit method/model reporting | No implementation to fail over | N/A |

Decision: retain ONNX. Do not add Candle merely because safetensors is a weight
format or because pure Rust sounds attractive. Re-open this decision only when
a same-checkpoint Candle prototype passes contract parity, quality, CPU/GPU,
startup, memory, binary-size, platform, and maintenance gates.

## Correctness gate

Manifest checks currently verify SHA-256 and the declared tensor contract. The
native smoke and real-image runs verify that the pinned ONNX artifact produces
coherent masks through Varve's preprocessing/postprocessing path. A trusted
reference implementation comparison is still a release-blocking gap. To close
it, install the exact BiRefNet reference revision and checkpoint, then record:

```text
reference revision and license
checkpoint filename and SHA-256
input size, aspect/padding policy, RGB order, mean/std
output tensor name/shape and sigmoid/logit semantics
per-fixture max absolute error and mean absolute error
```

The comparison must use deterministic fixtures and reject material differences
before any runtime optimization is considered. The current environment lacks
the reference Python dependencies and checkpoint, so no parity number is
reported here.

## Reproduction and visual review

```bash
VARVE_BGREMOVAL_BENCH_DIR=/path/to/held-out-corpus \
VARVE_BGREMOVAL_BENCH_ITERATIONS=3 \
pnpm exec playwright test tests/e2e/canvas/background-removal-quality.spec.ts \
  --project=chromium --workers=1 --reporter=list
node scripts/bench/background-removal-report.mjs \
  --input /path/to/held-out-corpus/results.json \
  --output /path/to/held-out-corpus
```

The benchmark separates cold startup from warm inference, records actual
provider/model/fallback, and writes one mask artifact per requested method.
Open the listed masks from `visual-report.json` beside the source and target;
review on checkerboard, black, and white backgrounds. The external corpus must
contain independent masks/mattes for any claim of absolute quality.

The native harness was smoke-tested on 2026-08-13 with the bundled U²-NetP
artifact, four real-image fixtures, two iterations, and the bundled Linux
ONNX Runtime. Warm latency was 4.95–5.82 seconds per image and observed RSS
was 405–511 MB on an AMD Ryzen 3 5300U. The optional IS-Net and BiRefNet
artifacts were absent from this checkout and were skipped; no BiRefNet number
is inferred from the U²-NetP run.

Routine CI uses the small checked-in corpus and does not download large model
weights. Full quality/performance runs are manual or scheduled, with hardware,
OS, runtime, provider, model checksum, image category, resolution, latency,
and memory captured in the report.

## Recommended policy and remaining work

- Fast: Quick heuristic, no download; label its simple-background limitation.
- Auto: optional IS-Net General Use, otherwise bundled U²-NetP; show the actual
  result when a fallback occurs.
- High quality: BiRefNet Lite through native ONNX when available; refuse unsafe
  bare-WASM attempts and explain a reduced-quality fallback.
- BiRefNet Full: advanced/manual only until held-out evidence proves a useful
  gain over Lite at its memory and download cost.
- Quantized U²-NetP: keep disabled as an inference choice until the existing
  quality-failed validation report is replaced by a representative corpus pass.
- Matting: keep trimap/hair refinement optional; do not market binary masks as
  true glass/smoke alpha mattes.

Open gates are the same-checkpoint BiRefNet reference parity run, supported GPU
provider measurements, cross-platform native measurements, and a larger
independent held-out corpus. These are measurement gaps, not claims of success.

**Status 2026-08-13 (evening):** the same-checkpoint parity run is COMPLETE
for all four models — see `background-removal-parity-audit-2026-08-13.md` for
the measured numbers, the memory findings, the implemented fixes, and the
final model policy. Remaining gaps: GPU provider measurements (no GPU on the
development host), cross-platform native measurements, and the larger
held-out corpus.
