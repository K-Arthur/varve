# Semantic similarity benchmark — methodology and reproduction

Local image-to-image similarity for Varve is evaluated with a Varve-specific
corpus, retrieval metrics, reference parity checks, and latency capture.
This document is the reproduction recipe; the measured results live in
`docs/audits/semantic-asset-similarity-evaluation-2026-08-13.md` and the raw
per-query JSON + contact sheets under `reports/semantic-similarity/`.

## Corpus

`packages/engine/scripts/generate-semantic-corpus.mjs` procedurally draws a
deterministic corpus (`tests/fixtures/semantic-corpus/`, ~300 images, seeded
PRNG — byte-identical on any machine) covering the domains Varve actually
handles:

- photo-like scenes (landscape, portrait, product, food, vehicle)
- UI screenshots (dashboard, mobile)
- logos (geometric mark, wordmark)
- illustration, poster, patterns, 3D-style renders, architecture

Each base image gets labeled relation groups: exact copy, resized up/down,
JPEG recompression, PNG↔JPEG roundtrip, hue shifts, monochrome, mirrored,
crops, rotation, badge/text overlays, framing variants, angle variants,
style variants — plus hard negatives (composition twins, color twins).

Nothing in the corpus is downloaded or copyrighted; it is generated.

```bash
pnpm --filter @varve/engine corpus:generate
```

## Reference embeddings (correctness gate)

The canonical preprocessing pipeline
(`packages/engine/src/semanticSimilarity/preprocess.ts`) is mirrored
bit-for-bit by the Python reference
(`scripts/semantic-corpus/reference-embeddings.py`), which computes
embeddings with the official ONNX Runtime Python build — an independent
runtime from the one Varve ships.

```bash
# one-time environment (dev tooling only)
python3 -m venv /tmp/opencode/ort-venv
/tmp/opencode/ort-venv/bin/pip install onnxruntime pillow

# model weights (SHA-256 pinned; never committed to git)
scripts/semantic-corpus/fetch-models.sh   # → ~/.cache/varve/models

# regenerate committed reference vectors when the corpus changes
VARVE_MODEL_CACHE=$HOME/.cache/varve/models /tmp/opencode/ort-venv/bin/python \
  scripts/semantic-corpus/reference-embeddings.py
```

The parity test (`bench/parity.test.ts`) re-runs the TS pipeline with
onnxruntime-node against those fixtures and fails if cosine similarity
drops below the tolerance (1e-4 for the INT8 SigLIP export, 1e-5 for the
FP32 DINOv2 export). It skips automatically when weights are absent; CI
does not need them.

## Retrieval evaluation

```bash
VARVE_RUN_SEMANTIC_EVAL=1 pnpm exec vitest run \
  --fileParallelism=false \
  packages/engine/src/semanticSimilarity/bench/evaluation.test.ts
```

Metrics (reported per model):

- **Semantic lane** — Recall@1/5/10, mAP@10, nDCG@10, MRR, overall and
  per-domain; per-relation recall shows variant robustness (does the model
  rank a resized copy above an unrelated image?).
- **Near-duplicate lane** — precision, recall, false-positive rate,
  false-negative rate, F1 for the perceptual-hash path (dHash+pHash at
  fixed thresholds) and an exact-content-only lane, per-relation recall.
- **Latency** — cold session load, warm p50/p95 inference time,
  throughput (images/sec).

Outputs land in `reports/semantic-similarity/`: per-model JSON
(`evaluation-<model>.json`), embedding caches (resume-safe), and HTML
contact sheets (semantic rankings, duplicate rankings, difficult cases).
The contact sheets are the visual-review artifact: query image, top-10
rankings, relevance highlighted, distractors outlined.

## Exact-vs-ANN decision

`bench/scale.bench.test.ts` measures exact top-10 cosine scan latency and
memory at 100 / 1k / 10k / 50k / 100k vectors (768-dim fp32, normalized).
The decision rule: keep exact search while p95 query latency stays
comfortably interactive at the largest plausible local library; introduce
an ANN index (HNSW-style) only if measurements justify it, and always
keep the exact path as the reference for recall checks.

## Machine conditions

Latency numbers are sensitive to host load. The audit records `nproc`,
`uptime` load, and CPU model alongside every run; comparisons between
models are only meaningful under the same load conditions, and absolute
numbers from a loaded machine are not product latency claims.
