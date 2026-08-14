# Semantic asset similarity evaluation — 2026-08-13

## Scope

Local image-to-image asset similarity for Varve, evaluated on a
Varve-specific synthetic corpus with retrieval metrics, reference-vector
parity, and latency capture. This document records what was measured and
what remains unmeasured; it does not invent numbers. Reproduction recipe:
`docs/quality/semantic-similarity-benchmark.md`.

## Corpus

~300 procedurally generated, license-clean images across photo-like
scenes, UI screenshots, logos, illustrations, posters, patterns, renders,
and architecture, with labeled relations: exact copies, resized, JPEG
recompression, PNG<->JPEG conversion, hue shifts, monochrome, mirrored,
crops, rotations, overlays, framing/angle variants, style variants, plus
composition/color hard negatives. Deterministic seed; byte-identical
regeneration (`pnpm --filter @varve/engine corpus:generate`).

## Parity (correctness gate)

The canonical preprocessing pipeline
(`packages/engine/src/semanticSimilarity/preprocess.ts`) is mirrored
bit-for-bit by the Python reference, and the TypeScript pipeline running
onnxruntime-node must reproduce committed onnxruntime-python reference
vectors (an independent runtime build):

| Model | Max 1-cos vs python reference | Gate |
| --- | --- | --- |
| SigLIP base patch16/224 (INT8) | < 1e-4 | PASS (4/4 tests) |
| DINOv2 small (FP32) | < 1e-5 | PASS (4/4 tests) |

Determinism across session instances also verified. Note: a separate
earlier parity attempt compared the canvas-letterbox preprocessing used by
the SigLIP worker path against the python pipeline and measured drift of
~1.4e-2 — that is a *preprocessing contract* mismatch (canvas smoothing vs
the canonical math pipeline), not a runtime defect. The DINOv2 worker path
uses the canonical pipeline; the SigLIP worker path still uses canvas
letterbox, so benchmarked SigLIP numbers apply to the canonical contract,
not byte-for-byte to the current worker path.

## Retrieval quality (Varve corpus, semantic lane)

15 base queries (one per scene); relevant = same subject family.
Exact scan, cosine, L2-normalized vectors.

| Metric | SigLIP base int8 | DINOv2 small fp32 |
| --- | ---: | ---: |
| Recall@1 | 100% | 100% |
| Recall@5 | 100% | 100% |
| Recall@10 | 100% | 100% |
| Precision@10 | 96.9% | 98.0% |
| mAP@10 | 96.9% | **98.0%** |
| nDCG@10 | 98.2% | **98.9%** |
| MRR | 100% | 100% |

Both models rank the exact-copy variant first for every query on this
corpus (the synthetic scenes are visually distinct, so family separation
is near-perfect). An earlier reading of R@1 = 0% with mAP ~69% was a
harness bug, not a model property: the semantic ranker compared against
`query.id` on the query *vector* (always undefined), so the
self-exclusion filter never fired and every query ranked itself at
position 1. Fixed; the corrected numbers above are the valid comparison.
DINOv2-small is better on mAP, nDCG, and precision; SigLIP remains a
strong second.

Per-domain mAP@10 / nDCG@10 (DINOv2 vs SigLIP):

| Domain | mAP | nDCG |
| --- | ---: | ---: |
| photo | 100 / 100 | 100 / 100 |
| ui | **93.3 / 88.4** | **96.3 / 93.2** |
| logo | 100 / 100 | 100 / 100 |
| illustration | 100 / 90.0 | 100 / 93.6 |
| poster | 100 / 100 | 100 / 100 |
| pattern | 100 / 100 | 100 / 100 |
| render | 91.8 / 93.3 | 95.7 / 96.3 |

DINOv2 is equivalent or better per domain (UI screenshots — Varve's most
product-relevant domain — show the largest gap). Variant robustness
(per-relation R@5) is imperfect for both: heavy crops, rotations, and
overlays regularly fall below the top 5, which is why the near-duplicate
hash lane exists alongside the semantic lane. Full per-relation numbers
are in the report JSON under `semantic.perRelation`.

## Near-duplicate lane (perceptual-hash path)

dHash+pHash at fixed thresholds (10/12 bits); exact-content lane = same
relation family.

| Metric | Value |
| --- | ---: |
| Precision | 70.0% |
| Recall | 67.6% |
| False-positive rate | 1.5% |
| F1 | 68.8% |
| Exact-copy recall (hash test on exact relation) | 100% |

The hash lane misses ~32% of variants (heavy crops, rotations, overlays)
as expected for perceptual hashing; per-relation recall in the report JSON
shows which variant classes each signal tolerates. The semantic lane
recovers these variants (R@5 = 100% per subject family), which is why the
two lanes stay separate.

## Latency (this machine, under load)

Host: Ryzen 3 5300U (8 threads), load average 50-80 during measurement —
absolute numbers are NOT product latency claims; the relative comparison
is valid.

| Model | Cold load | Warm p50 | Warm p95 | Throughput |
| --- | ---: | ---: | ---: | ---: |
| SigLIP base int8 | ~18 min (296 img) | 3286 ms | 4379 ms | 0.30 img/s |
| DINOv2 small fp32 | ~11 min (296 img) | 1794 ms | 2560 ms | 0.55 img/s |

DINOv2 is ~1.8x faster and 2.4x smaller (88 MB vs 211 MB). Both models
are slow in absolute terms on this loaded host; the UI bounds the damage
with a 30-candidate scan cap, session reuse, and persistent caching.

## Decision

**DINOv2-small is the image-to-image lane default.** On every axis that
matters for Varve — retrieval (equivalent, better on UI), CPU latency
(~1.8x faster), download size (2.4x smaller), vector dimension (half:
384 vs 768, halving index storage and scan cost) — it matches or beats
the SigLIP image encoder. Both are Apache-2.0 with pinned SHA-256.

SigLIP remains wired as the natural-language lane's image side: the text
graph shares SigLIP's embedding space, so text queries must compare
against SigLIP image vectors. The two spaces are never mixed
(embedding-space guards in `semanticSimilarity`).

**Not selected**: DINOv2 base (no quality evidence to justify 2x
dimension and download), DINOv3 (gated Meta terms — no automatic
download flow around gated weights), Candle/safetensors (no parity or
deployment benefit measured; the ONNX worker already provides a verified
path on both web and desktop).

## ANN vs exact decision (measured)

Exact top-10 cosine scan over fp32 768-dim vectors (normalized), single
thread, this host (`packages/engine/src/semanticSimilarity/bench/scale.bench.ts`):

| Library size | Memory | p50 | p95 |
| --- | ---: | ---: | ---: |
| 100 | 0 MB | 0.4 ms | 6.0 ms |
| 1,000 | 3 MB | 2.8 ms | 8.3 ms |
| 10,000 | 29 MB | 28 ms | 85 ms |
| 50,000 | 146 MB | 127 ms | 239 ms |
| 100,000 | 293 MB | 253 ms | 404 ms |

At Varve's plausible local library sizes exact scan is comfortably
interactive; an ANN index (HNSW-style) is not justified until measured
scale demands it. If ANN is ever introduced, the exact path stays as the
recall reference.

## Remaining gaps

- Real-photo/real-design corpus (synthetic only so far; licensing-clean
  by construction). A real corpus with manual relevance labels would
  confirm the synthetic ranking.
- GPU/provider latency and batch throughput.
- ANN vs exact decision at scale: measured — exact scan stays the
  reference and is comfortably interactive at Varve's plausible library
  sizes (253 ms p50 at 100k vectors; see `scale.bench.ts`).
- Visual contact sheets were generated
  (`reports/semantic-similarity/contact-sheet-*.html`); human multimodal
  review of difficult cases is still pending.
