# Semantic asset search benchmark

Benchmarks for the local asset search system: embedding parity, exact-search
scale, and (once the corpus harness has completed on representative hardware)
retrieval quality for the candidate models.

## 1. Embedding parity (trusted upstream vs Varve)

All measurements ran with the pinned artifacts and the canonical pipeline
(`preprocess.ts`, parity-verified against the Python reference):

| Check | Result |
|---|---|
| SigLIP tokenizer ids, 26 queries (ASCII, filenames with punctuation, CJK, emoji, accented) | 26/26 exact vs transformers `SiglipTokenizer` |
| SigLIP text embeddings (`pooler_output`) | `1 − cos < 2e-15` vs onnxruntime-python (bit-level) |
| SigLIP image embeddings (`image_embeds`) | bit-exact after the Python reference adopted JS half-up rounding |
| DINOv2-small image embeddings | `1 − cos < 1e-5` vs onnxruntime-python |

Gated tests (skipped without weights):
`packages/engine/src/semanticSimilarity/bench/parity.test.ts`,
`packages/engine/src/semanticSimilarity/bench/textParity.test.ts`.

## 2. Exact-search scale baseline

`packages/engine/src/bench/semanticSearch.bench.test.ts` (32-dim synthetic
vectors, 2026-08-13, loaded dev machine — Linux x86-64, see the machine-load
note below):

| Candidates | Scan time |
|---|---|
| 100 | 45 ms (includes JIT warmup) |
| 1,000 | 16 ms |
| 10,000 | 88 ms |
| 50,000 | 364 ms |

Real 768-dim vectors scale linearly with dimension; the reference path stays
exact. Any ANN replacement must beat this path on Recall@1/5/10, latency,
build/update cost, and memory before it becomes the default.

## 3. Corpus evaluation harness

`packages/engine/src/semanticSimilarity/bench/evaluation.test.ts` (gated on
`VARVE_RUN_SEMANTIC_EVAL=1`) evaluates the SigLIP and DINOv2-small adapters
over the 296-image Varve corpus (photo/ui/logo/illustration/poster/pattern/
render domains, labeled variant relations and hard negatives) and writes:

- `reports/semantic-similarity/evaluation-<model>.json` — R@1/5/10, mAP,
  nDCG, MRR per domain and per relation; near-duplicate hash-lane
  precision/recall/FPR; latency capture (cold load, warm p50/p95, throughput)
- HTML contact sheets and difficult-case reports for human review

### First run — SigLIP base patch16-224 (2026-08-13, int8, CPU, loaded machine)

| Metric | Overall | photo | ui | logo | illustration | poster | pattern | render |
|---|---|---|---|---|---|---|---|---|
| Recall@1 / @5 / @10 | 1.0 / 1.0 / 1.0 | 1/1/1 | 1/1/1 | 1/1/1 | 1/1/1 | 1/1/1 | 1/1/1 | 1/1/1 |
| Precision@10 | 0.973 | 1.0 | 0.9 | 1.0 | 0.9 | 1.0 | 1.0 | 0.95 |
| mAP | 0.969 | 1.0 | 0.884 | 1.0 | 0.9 | 1.0 | 1.0 | 0.933 |
| nDCG | 0.982 | 1.0 | 0.932 | 1.0 | 0.936 | 1.0 | 1.0 | 0.963 |
| MRR | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |

Near-duplicate lanes on the same corpus: exact-content lane F1 0.938
(precision 0.882, recall 1.0, FPR 0.95%); perceptual-hash lane F1 0.688
(precision 0.700, recall 0.676) — hashes remain tie-breakers, exactly as the
lane-separation design intends.

Interpretation caveats, recorded with the numbers:

- The corpus is a variant-robustness harness: relevance is defined by image
  family (exact/resized/recompressed/hue-shifted/mirrored/cropped variants of
  the same base), so these numbers measure retrieval consistency across
  transformations, not discrimination among unrelated images with similar
  descriptions. They are NOT presented as general semantic-search quality.
- ui / illustration / render domains show the first non-perfect values,
  consistent with design assets being the harder retrieval surface.
- Latency capture on this run (cold 1,019 s, warm p50 1.03 s, p95 15.9 s,
  0.32 img/s) is not representative: the machine ran under sustained
  parallel load (load average > 25) during collection. Re-run on an idle
  machine before quoting latency in release material.

### DINOv2-small comparison (same corpus, same run)

| Metric | SigLIP base | DINOv2 small |
|---|---|---|
| Recall@1 / @5 / @10 | 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 |
| Precision@10 | 0.973 | 0.987 |
| mAP | 0.969 | 0.980 |
| nDCG | 0.982 | 0.989 |
| MRR | 1.0 | 1.0 |
| Per-domain mAP (weakest) | ui 0.884, illustration 0.900, render 0.933 | ui 0.933, render 0.918 |
| Embedding dim | 768 | 384 |
| Model file | 211 MB (int8) | 88 MB (fp32) |

Interpretation: on this variant-robustness harness DINOv2-small is the
stronger image-to-image encoder (slightly higher mAP, smaller file, and a
384-dim index). It cannot power text-to-image search on its own — it has no
text tower — which is the product feature that selected SigLIP. DINOv2 stays
an evaluation candidate for a future visual-only lane or as a reranker, and
would require the same parity gate (export, reference vectors, corpus
evidence) before shipping. Latency capture for DINOv2 was equally
non-representative (warm p50 1.71 s under load).

## 4. Hardware notes

Numbers above were collected on a shared development machine under heavy
parallel load (load average > 25). p50/p95 latency and throughput figures
from the corpus harness are the authoritative measurements; re-run on an
idle machine before quoting them in release material.

## See also

- Canonical architecture: `docs/architecture/semantic-asset-similarity.md`
- Reproduction recipe: `docs/quality/semantic-similarity-benchmark.md`
- Dated evaluation snapshot: `docs/audits/semantic-asset-similarity-evaluation-2026-08-13.md`
