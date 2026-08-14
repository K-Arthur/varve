# ADR-0221: Local asset search ranking and model gate

- Status: Accepted; Phase 1 model selection closed 2026-08-13 (see
  Resolution below)
- Date: 2026-08-13

## Context

Varve needs a natural-language asset search experience that improves discovery
without weakening exact filename, OCR, or metadata queries. The repository has
an Asset Browser and platform facade, but asset records are currently mostly
metadata and the existing SigLIP integration exposes only image-to-image
similarity. The assistant package is not the right owner for ordinary asset
retrieval.

## Decision

1. Keep search in the platform/asset-browser boundary, separate from
   `@varve/ai` chat orchestration.
2. Normalize the query and retrieve independent filename/path, OCR, metadata,
   and optional semantic lanes.
3. Fuse ranks with Reciprocal Rank Fusion. Do not sum raw cosine, fuzzy, OCR,
   or BM25-like scores. Exact filename/stem matches receive an explicit stable
   ordering guarantee.
4. Store future vectors as binary records keyed by content hash, model
   identity, preprocessing version, and embedding schema version.
5. Benchmark exact vector scans before adding an ANN index.
6. Do not ship or automatically download a checkpoint until source license,
   checkpoint terms, redistribution rights, conversion provenance, tokenizer,
   preprocessing, parity, and Varve-corpus quality are all recorded.

## Consequences

The Home browser works today with deterministic local metadata lanes and can
accept OCR/semantic signals later without changing its result contract. A
semantic model is not falsely implied by the search box. The short-term cost is
that descriptive visual queries do not yet retrieve images without semantic
embeddings; this is preferable to shipping an unvalidated model or routing
search through an LLM.

## Rejected alternatives

- Raw score summation: scales are incomparable and exact matches regress.
- Chat/LLM-owned search: adds latency, privacy risk, and an unnecessary network
  or assistant dependency to a local retrieval path.
- Path-only embedding keys: renames and duplicates waste indexing work, while
  edits can reuse stale vectors.
- OpenAI CLIP selected from repository MIT alone: the model card contains
  deployment limitations, and code/model terms are not interchangeable.
- Immediate ANN adoption: the normal designer library size and exact-scan
  breakpoint have not been measured.

## Resolution (2026-08-13): model and runtime

Phase 1 gate closed with a measured selection.

**Model: google/siglip-base-patch16-224** (Apache-2.0 weights and code),
deployed through the Xenova ONNX exports (same license) that ship both
towers in one verified embedding space:

| Artifact | Bytes | SHA-256 |
|---|---|---|
| `model_quantized.onnx` (image tower, int8) | 210,977,441 | `9171eb00…c9a99` |
| `text_model_quantized.onnx` (text tower, int8) | 111,475,220 | `ad0329b1…dbce2` |
| `tokenizer.json` (google, SentencePiece Unigram) | 2,399,357 | `c6e405cb…e920` |

**Runtime: the existing shared ONNX worker** (onnxruntime-web in the
webview/desktop, onnxruntime-node in the dev bench). No new runtime is
introduced; provider fallback and the manifest-driven verified download
path are reused as-is. Candle/safetensors were evaluated and rejected:
they would add a second runtime with no measured inference or quality
benefit over the already-verified ONNX graphs.

**Parity (trusted upstream vs Varve):**
- Tokenizer: 26 representative queries (ASCII, punctuation-heavy
  filenames, CJK, emoji, accented text) reproduce the transformers
  `SiglipTokenizer` ids exactly, 1:1.
- Text embeddings: `1 − cos < 2e-15` against onnxruntime-python on the
  same graph (bit-level agreement).
- Image embeddings: exact match after aligning the Python reference
  pipeline's rounding to the TypeScript pipeline (JS `Math.round`
  half-up vs Python banker's rounding was the one divergence; the
  Python reference now mirrors the TS pipeline bit-for-bit).
- Both runtimes agree on the same int8 graphs, so retrieval quality is
  preserved end-to-end.

**Alternatives assessed (not selected, not silently discarded):**
- SigLIP2 (google/siglip2-base-224): same family, better multilingual and
  aspect-ratio handling on paper. Requires a new verified ONNX export,
  new preprocessing, and re-run of the parity gate and Varve corpus
  before adoption; recorded as the next bake-off candidate.
- OpenAI CLIP: model-card deployment limitations make it unsuitable
  without legal review.
- OpenCLIP ViT-B/L: weights exist under MIT-ish terms but were not
  measured against the Varve corpus; same runtime path is available if a
  bake-off justifies the swap.
- MobileCLIP: attractive size/latency profile; the checkpoint terms are
  Apple sample-code licensed and were not cleared for redistribution;
  re-evaluate only with a cleared artifact.
- DINOv2 small/base: Apache-2.0 image encoders measured as harness
  candidates, but they are image-to-image only — they cannot power
  text-to-image queries on their own.

**Retrieval evidence:** the labeled Varve corpus harness (296 images,
photo/ui/logo/illustration/poster/pattern/render domains) runs both the
semantic and near-duplicate lanes; metrics (R@1/5/10, mAP, nDCG, MRR,
per-domain and per-relation) and the visual review sheets are recorded
in `docs/quality/semantic-asset-similarity-benchmark.md` and the dated
evaluation audit. The exact-search scale baseline (100/1k/10k/50k
candidates) remains the reference for any future ANN work.

