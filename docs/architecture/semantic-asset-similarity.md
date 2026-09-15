# Semantic asset similarity

Status: shipped experimental foundation (image-to-image and text-to-image
queries, document-local UI, persistent webview embedding cache,
reconstructible local index, and bounded queue primitives)

Varve's similarity workflow is local-first and deliberately separates two
different questions:

- **Similar** finds visually related images using compatible semantic vectors.
- **Near duplicates** uses exact content identity and existing perceptual
  fingerprints, with an optional semantic tie-breaker.

These lanes must not be collapsed into one `hash → embedding` pipeline. A
perceptual hash is useful for resized, recompressed, or lightly edited copies,
but using it as a hard filter would remove semantically related images whose
pixels differ substantially.

## Current data path

```text
scene image / asset
  → bounded canonical preview (RGB, neutral alpha matte)
  → versioned canonical preprocessing (math pipeline, parity-tested)
  → shared ONNX inference worker
      image lane: DINOv2-small (CLS token)
      text lane:  SigLIP image encoder + text graph
  → normalized embedding vector (space-versioned)
  → content-addressed persistent cache (IndexedDB)
  → exact local ranking for the current document
  → Similarity panel result grid
```

The current editor workflow scans up to 30 image nodes in the open document.
Inference and model loading run outside the UI thread. The model is optional,
downloaded explicitly, and verified through the existing model loader. No image
pixels, embeddings, or project metadata are sent to a remote inference service.

## Contracts and identity

The public contract lives in `@varve/engine/semanticSimilarity`:

- `EmbeddingModelSpec` describes model family, revision, source, license,
  dimension, preprocessing, pooling, runtime, and embedding space.
- `EmbeddingVector` carries model revision, preprocessing version, dimension,
  dtype, normalization, and values.
- incompatible embedding spaces are rejected before cosine comparison.
- `SimilarityCandidate` keeps exact identity and visual fingerprints separate
  from semantic vectors.

Content-addressed binary cache records are defined in
`@varve/platform` (`assetEmbeddingIndex.ts`). The browser/Tauri-webview
`IndexedDbSemanticEmbeddingStore` now persists them across launches, while
`SemanticAssetIndex` provides a reconstructible exact-search reference path
and `SemanticEmbeddingQueue` provides bounded priority, cancellation,
pause/resume, and stale-result suppression primitives. Native SQLite and
cross-project background indexing remain intentionally deferred.

## Runtime decision

**Image-to-image lane: DINOv2-small** (Xenova ONNX export of
facebook/dinov2-small, Apache-2.0, FP32, SHA-256 pinned). Selected by
measurement, not default: on the Varve corpus (see
`docs/audits/semantic-asset-similarity-evaluation-2026-08-13.md`) it
matches the SigLIP image encoder for retrieval (mAP 98.0 vs 96.9, nDCG
77.0 vs 76.7, better on UI screenshots), runs ~1.8x faster on CPU, is
2.4x smaller to download (88 vs 211 MB), and produces half the vector
dimension (384 vs 768). Reference vectors are parity-tested against the
independent onnxruntime-python build.

**Natural-language lane: SigLIP.** The text graph shares SigLIP's
embedding space, so text queries compare against SigLIP *image* vectors.
The two spaces are versioned separately and never mixed — the search
layer rejects vectors from incompatible embedding spaces.

DINOv2 base and DINOv3 are recorded as evaluation candidates, not shipped:
base offers no measured quality win for twice the dimension, and DINOv3's
access and license terms require a separate distribution review. Candle
and safetensors are not introduced without measured parity and deployment
evidence; the ONNX worker already provides a verified path on both web
and desktop.

## Preprocessing

Preprocessing is centralized and versioned in
`@varve/engine` `semanticSimilarity/preprocess.ts` — a pure-math pipeline
(neutral gray matte → resize/crop → NCHW pack → normalize) mirrored
bit-for-bit by the Python reference used to generate the committed parity
fixtures.

- DINOv2: shortest edge to 256, center crop 224×224, ImageNet mean/std
  (`dinov2-rgb-center-crop-v1`). The worker's `dinov2-image` model type
  runs exactly this pipeline.
- SigLIP: letterbox 224×224, mean/std 0.5 (`semantic-rgb-letterbox-v2`).
  The SigLIP worker path still uses the canvas letterbox; its benchmarked
  numbers apply to the canonical contract, not byte-for-byte to the
  current worker path (canvas vs math resampling differ by ~1.4e-2 cosine
  on the parity fixtures).

The preview is bounded to a 2048-pixel longest edge before entering the
shared worker (a memory bound, not a semantic transform). Changing any
preprocessing contract requires a new cache identity and reindex.

## Indexing and lifecycle boundary

Exact vector search is the reference path and is appropriate for the current
document-local limit. An ANN index is intentionally deferred until a real
library-scale corpus demonstrates that exact search is too slow. Any future
index is derived data: it must be rebuildable, atomically replaceable, and
unable to prevent a source document from opening.

The current UI cancels an in-flight query, suppresses stale results through the
existing worker request signal, reuses persisted image embeddings, and never
auto-deletes a candidate based on a similarity score. Automatic background
library indexing, cross-project UI, clustering, and native SQLite adapters are
not yet shipped; the queue and index primitives are ready for those adapters.

## User-facing limitations

Similarity is a ranking aid, not objective truth. Results can overemphasize
style, composition, background, or color. Exact duplicates, likely variants,
and semantically related images are presented as different concepts. Users
must review results before taking any destructive action.
