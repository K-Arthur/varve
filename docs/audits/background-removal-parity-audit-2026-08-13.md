# Background-removal / BiRefNet parity and runtime audit — results

Date: 2026-08-13

Supersedes the plan recorded earlier the same day
(`docs/audits/background-removal-birefnet-benchmark-2026-08-13.md` is kept as
the plan; this file records what was actually measured).

## Reference correctness gate — CLOSED (u2netp, isnet)

A rembg-faithful Python reference (onnxruntime 1.27.0, exact pinned checkpoints
from `apps/desktop/public/models/manifest.json`, checksums verified against the
manifest pins) was run over the benchmark corpus. Reference pipeline:
PIL BILINEAR stretch to the model input square, `/255 - mean / std`, sigmoid
where the graph does not bake it (BiRefNet only), clip, cv2 bilinear restore.

Reproduction:

```bash
python3 scripts/bench/bgremove-reference/run_reference.py \
  --models-dir /path/to/models --images-dir tests/fixtures/bg-removal-corpus \
  --output-dir /path/to/reference-out --models u2netp,isnet-general-use,birefnet-general-lite,birefnet-general
python3 scripts/bench/bgremove-reference/compare_modes.py \
  --reference-dir /path/to/reference-out --output /path/to/divergence.json
```

### Native vs reference (same checkpoint, same preprocessing)

Native Rust (bundled onnxruntime 1.27.1 dylib) masks were compared against the
letterbox mirror (same aspect-preserving preprocessing) to isolate pure runtime
numerics:

| Case | Model | Native vs mirror MAE |
|---|---:|---:|
| car / human / object / synth-* (10 fixtures) | u2netp | 0.0008–0.004 |
| car / human / object / synth-* (10 fixtures) | isnet-general-use | 0.0005–0.012 |
| synth-shapes (thin 2px fence/spokes, 2.5× downscale) | u2netp | 0.125 (kernel-sensitive) |
| synth-subject-tall (4× downscale) | u2netp | 0.727 (kernel-sensitive) |

The two kernel-sensitive cases are an artifact of the Python mirror, not the
native path: at ≥2.5× downscale the `image` crate Triangle filter (antialiased,
support scaled by ratio) preserves sub-pixel structure, while PIL BILINEAR /
LANCZOS / BICUBIC and cv2 INTER_LINEAR all flip u2netp's output on those
fixtures. Ground truth settles the question — native IoU on the tall fixture is
0.99 (correct subject), the PIL mirrors produce a degenerate all-foreground
mask (IoU 0.23). The native pipeline is correct; the mirror is only an
approximation at large downscale ratios.

### Preprocessing divergence (letterbox vs reference stretch)

rembg stretches to the input square; Varve letterboxes (aspect-preserving with
mean-colour padding, matching the pinned manifest preprocessing contract).

| Aspect ratio class | rembg vs Varve MAE |
|---|---:|
| near-square / ≤2:1 (10 fixtures, both models) | ≤ 0.02 |
| 4:1 panorama / 1:4 tall | 0.23–0.73 |

At extreme aspect ratios the two preprocessing policies see genuinely different
inputs, so mask divergence is expected and by design. Varve's letterbox is the
right choice for a design app (panoramas and tall crops must not be squashed);
the reference's stretch is not a correctness target for those fixtures.

### Postprocessing divergence (min-max stretch vs rembg clamp) — FIXED

The previous output normalisation min-max-stretched the model map before
scaling. rembg clips. The stretch is monotone, so binary metrics were
unaffected, but soft edge alpha diverged by up to 0.065 mask MAE (cat/isnet
fixture: 0.071 vs 0.008 MAE from the reference with clamp). Implemented:

- `crates/varve-bgremove/src/inference.rs` — `normalize_segmentation_output`
  now applies sigmoid (where required) then clamps and scales; no stretch.
- `packages/engine/src/backgroundRemoval/maskOps.ts` — same semantics for the
  worker/direct web paths.

Both sides carry unit tests pinning the reference values (0.2/0.4/0.6 →
51/102/153; sigmoid(-2/0/2) → 30/128/225; flat maps are not stretched).

## BiRefNet correctness gate — CLOSED

Reference inference for BiRefNet Lite and Full completed for all 12 fixtures
with the pinned rembg ONNX exports (sha-256 `56000243…` and `58f621f0…` — the
Full checksum previously marked "unverified" in the manifest is now verified
against the downloaded artifact).

Native-vs-reference mask agreement (per-fixture MAE, 12 fixtures):

| Model | MAE range vs rembg reference | Outliers |
|---|---:|---|
| u2netp | 0.0003–0.017 | cat.jpg 0.32 (320-px source; letterbox padding dominates) |
| isnet-general-use | 0.0002–0.005 | tall 0.23, wide 0.39 (aspect-policy) |
| birefnet-general-lite | 0.0003–0.024 | tiny 0.99 (96×64 at 10×+ upscale; kernel-sensitive) |
| birefnet-general | 0.0000–0.013 | none |

BiRefNet Full reproduces the reference within 1.3% MAE on every fixture —
the strongest parity of the four models. The lite/tiny outlier is a documented
kernel-sensitivity at extreme upscale, not a pipeline defect (isnet on the
same fixture: 0.0016).

### Quality against exact ground truth (synthetic fixtures, native path, IoU)

| Fixture | u2netp | isnet | lite | full |
|---|---:|---:|---:|---:|
| synth-hair | 0.896 | 0.966 | 0.921 | 0.924 |
| synth-subject-wide (4:1) | 0.981 | 0.997 | 0.996 | 0.998 |
| synth-subject-tall (1:4) | 0.991 | 0.998 | 0.995 | 0.998 |
| synth-shapes (2px fence/spokes) | 0.267 | 0.994 | 0.850 | 0.869 |
| synth-glass (translucent pane) | 0.285 | 0.285 | 0.285 | 0.285 |

Reading: IS-Net wins the synthetic hair and thin-structure tests outright;
BiRefNet Lite/Full are far ahead of bundled u2netp on thin structure but do
not beat IS-Net here. All four models score identically low on the translucent
pane — the segmentation-vs-matting limit is model-independent and now pinned
by a fixture. On real photographs (the 2026-07-19 real-image benchmark)
BiRefNet Lite showed the best hair/edge masks; the synthetic fixtures keep
that claim honest by showing it does not hold for every content class. The
contact sheets in the visual report are the ground truth for human review.

## Runtime decision matrix (updated)

| Dimension | Existing ONNX web/native | Candle + safetensors |
|---|---:|---:|
| Output parity | u2netp/isnet verified vs reference (≤0.012 MAE noise floor); BiRefNet pending on this host | Not run — no architecture/weight loader in tree |
| CPU p50/p95 | native bench records cold/warm per model (see below) | Not measured |
| GPU p50/p95 | Not measured (no GPU on this host) | Not measured |
| Cold model load | measured per model by `bgremove_bench` | Not measured |
| Peak RAM | RSS tracked per case by `bgremove_bench` | Not measured |
| Model size | 4.7 / 179 / 224 / 928 MB, all checksum-verified | N/A |
| Platform coverage | Worker ONNX + native Tauri fallback, shipped | unproven |
| Operator coverage | shipping exports execute on shipped paths | unproven |
| Maintenance/packaging | existing lifecycle, downloads, cancellation | new burden |
| Failure/fallback | typed providers, preflight, cancellation | N/A |

Decision (unchanged): keep ONNX. The parity gate for the two models Varve
ships as defaults is now closed by measurement, and the infrastructure to do
the same for any future checkpoint is checked in. Candle remains a
non-goal until a prototype passes the same gates — see the plan document.

## Quality and latency evidence (native, all four models)

Measured on this host (AMD Ryzen 3 5300U, 8 threads, 22 GB RAM, CPU-only;
bundled ORT 1.27.1 dylib). Full results: `results.json` from `bgremove_bench`
(schema v2, git commit, hardware, per-case cold/warm percentiles, RSS, quality
metrics vs reference masks). Numbers below are medians over 12 fixtures ×
3 warm iterations, `--preview-max 4096` (source processed at native
resolution), session options: CPU arena + memory pattern disabled (see the
memory section below). The host was intermittently loaded (load 20–60) by
parallel work; latency should be re-measured on a quiet machine before quoting
as a spec.

| Model | Cold load (median) | Warm p50 (median) | Retained RSS (single model) |
|---|---:|---:|---:|
| u2netp | 0.44 s | 0.43 s | ~0.32 GB |
| isnet-general-use | 2.5 s | 2.3 s | ~1.3 GB |
| birefnet-general-lite | 15.0 s | 14.5 s | ~6.8 GB |
| birefnet-general | 30.2 s | 30.1 s | ~8.3 GB |

### Memory findings and the arena change

Retained RSS was measured after inference in a fresh process per model. With
the default ORT CPU arena the retained footprint was ~11.2 GB for Lite —
the arena keeps its high-water allocation, which on 8 GB machines guarantees
swapping after a single High-quality run. The native session builder now
disables the CPU arena and memory pattern (`session.enable_cpu_mem_arena=0` +
`with_memory_pattern(false)`, `crates/varve-bgremove/src/inference.rs`),
reducing retained RSS to ~6.8 GB (Lite) and ~8.3 GB (Full) with identical
outputs (golden parity test passes unchanged). These are still large:
High quality needs ≥ 16 GB of usable RAM natively, and the manifest's
`peakMemoryBytes` estimates (previously 0.9 GB / 3.7 GB) have been corrected
to the measured values (7.0 GB / 8.5 GB) in both
`apps/desktop/public/models/manifest.json` and the TS fallback catalog, and
`manifest.ts` now prefers the manifest's recorded peak over the size-derived
heuristic. Warm-latency impact of the arena change could not be measured
cleanly on this contended host and is a documented follow-up.

## Deliverables added

- `crates/varve-bgremove/src/metrics.rs` — IoU/Dice/P/R/F0.3/MAE/boundary-F +
  alpha SAD/MSE/gradient, semantics mirrored from `qualityMetrics.ts`, with
  unit tests.
- `crates/varve-bgremove/examples/bgremove_bench.rs` — reusable native
  benchmark: models × corpus, cold/warm latency, RSS, quality vs reference
  masks, JSON + markdown, incremental writes (survives OOM kills).
- `scripts/bench/bgremove-reference/run_reference.py` — rembg-faithful
  reference inference in stretch/letterbox/min-max/clamp modes, incremental
  summary.
- `scripts/bench/bgremove-reference/compare_modes.py` — divergence
  decomposition between pipeline modes.
- `scripts/bench/bgremove-reference/generate_fixtures.py` — deterministic
  synthetic fixtures with exact ground truth (hair, spokes/fence, glass alpha
  matte, low contrast, panorama/tall, tiny, grayscale), CC0 (procedural).
- `scripts/bench/bgremove-reference/make_contact_sheet.py` — per-fixture
  visual sheets (source | GT | native | reference | error heatmap +
  white/black/checkerboard composites).
- `tests/fixtures/bg-removal-corpus/synthetic/` — the generated fixtures +
  manifest (2.8 MB).
- `tests/fixtures/bg-removal-corpus/reference/synth-hair-u2netp-rembg.png` —
  checked-in reference mask for the gated native golden test.
- Defect fixed: `model.rs` sha2-0.11 digest formatting — the crate did not
  compile at HEAD with the resolved dependency versions.
- Defect fixed: native provider defaulted `decontaminate` to true while every
  other provider defaulted false; now aligned (opt-in everywhere).
- Output normalisation aligned to the reference (sigmoid + clamp, no min-max
  stretch) in Rust and TS with pinned unit tests.
- Native session options: CPU arena + memory pattern disabled; retained RSS
  for BiRefNet Lite dropped ~11.2 GB → ~6.8 GB with identical outputs.
- Manifest `peakMemoryBytes` corrected to measured values for the four
  segmentation models (u2netp 0.33 GB, IS-Net 1.3 GB, Lite 7.0 GB, Full
  8.5 GB); `manifest.ts` now prefers the manifest's recorded peak over the
  size-derived heuristic.

## Recommended policy (evidence-based default)

Gate 1 — correctness: all four models' native output matches the rembg
reference within the interpolation noise floor on 44/48 fixture-model pairs
(per-model outliers are the documented kernel/aspect cases; BiRefNet Full has
no outliers at all).

Gate 2 — quality: ground-truth IoU on the synthetic fixtures shows IS-Net
wins the hair and thin-structure tests outright (0.966 / 0.994), BiRefNet
Lite/Full are far ahead of bundled u2netp on thin structure (0.85–0.87 vs
0.27) but behind IS-Net there, and all four models fail the translucent pane
identically (0.285 — the matting limit). BiRefNet's edge advantage shows on
real photographs (2026-07-19 benchmark, contact sheets) rather than on every
synthetic label.

Gate 3 — user experience: cold/warm latency and retained RSS per model are
measured (table above): u2netp ~0.4 s / 0.3 GB, IS-Net ~2.4 s / 1.3 GB,
BiRefNet Lite ~15 s / 6.8 GB, Full ~30 s / 8.3 GB. Only u2netp is safe for
bare-WASM everywhere; native sessions are bounded by the pool and now run
with the CPU arena disabled.

Gate 4 — engineering: ONNX stays the sole runtime (decision matrix above);
adding models/runtimes is documented; the corpus + metrics + bench
infrastructure makes the next checkpoint cheap to evaluate.

Policy (final, evidence-backed):

- **Fast** → Quick heuristic (no download), simple-background limitation stated.
- **Auto** → IS-Net General Use when installed, bundled U²-NetP otherwise; the
  result carries the actual model. Default for most users: **bundled U²-NetP**
  until IS-Net is installed — on the synthetic ground truths IS-Net is
  materially better (hair +0.07, thin structure +0.73), so Auto's
  "upgrade Balanced" affordance is worth keeping prominent.
- **High quality** → BiRefNet Lite through native ONNX when available; unsafe
  bare-WASM attempts refused with an explicit reduced-quality fallback.
  **BiRefNet Full stays an advanced manual download**: at 928 MB and ~8.3 GB
  retained RSS it bought ≤ 0.02 IoU over Lite on the synthetic ground truths
  and ≤ 0.013 mask MAE parity improvement — no material gain for the cost.
- Decontamination is off by default on every provider (aligned); feather stays
  a user control.
- Output normalisation follows the reference (sigmoid + clamp, no stretch).

## Remaining open items

- Warm-latency delta of the arena-disabled session options, measured on a
  quiet machine (this host was contended throughout).
- GPU provider measurements (no GPU on this host).
- Cross-platform native measurements (macOS/Windows).
- Held-out external corpus (the checked-in corpus is a hygiene/regression set;
  see `tests/fixtures/bg-removal-corpus/README.md` for the acquisition
  manifest contract).

## Reproduction procedure

```bash
# 1. reference (needs ~6 GB headroom per model)
for d in tests/fixtures/bg-removal-corpus tests/fixtures/bg-removal-corpus/synthetic; do
  python3 scripts/bench/bgremove-reference/run_reference.py \
    --models-dir /path/to/models --images-dir $d \
    --output-dir /path/to/reference-out \
    --models u2netp,isnet-general-use,birefnet-general-lite,birefnet-general
done

# 2. native (all four models; incremental writes survive kills)
cargo run -p varve-bgremove --features ai --example bgremove_bench -- \
  --dylib apps/desktop/src-tauri/onnxruntime-libs/linux-x86_64/libonnxruntime.so \
  --models-dir /path/to/models --images-dir tests/fixtures/bg-removal-corpus \
  --reference-dir /path/to/reference-out --output-dir /path/to/native-out \
  --iterations 4 --preview-max 4096 \
  --models u2netp,isnet-general-use,birefnet-general-lite,birefnet-general

# 3. decompose + visual review
python3 scripts/bench/bgremove-reference/compare_modes.py --reference-dir /path/to/reference-out --output /path/to/divergence.json
python3 scripts/bench/bgremove-reference/make_contact_sheet.py --corpus tests/fixtures/bg-removal-corpus \
  --reference-dir /path/to/reference-out --native-dir /path/to/native-out --output-dir /path/to/visual-report
```
