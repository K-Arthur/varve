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
  → versioned preprocessing
  → shared ONNX inference worker (SigLIP image or text encoder)
  → normalized embedding vector
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

The first shipped encoder pair is the verified `siglip-base-patch16-224` image
graph plus its matching `text_model_quantized.onnx` text graph. Both are
downloaded explicitly through the model manager and are tied to pinned
checksums. The SentencePiece Unigram tokenizer is versioned, tested, and
cached locally. Text and image outputs are normalized into the same 768-wide
embedding space before exact ranking.

DINOv2 small/base are recorded as evaluation candidates, not silently treated
as product defaults. DINOv2 weights are Apache-2.0, but a product choice still
requires a reproducible ONNX conversion, reference-vector parity, and Varve
corpus retrieval evidence. DINOv3 is not an automatic replacement: its access
and license terms require a separate distribution review, and no DINOv3
runtime or weights are shipped here. Candle and safetensors are likewise not
introduced without measured parity and deployment evidence.

## Preprocessing

The current semantic preview is bounded to a 2048-pixel longest edge before it
enters the shared worker. It uses RGB channel order, 224×224 letterbox input,
SigLIP's mean/std of 0.5/0.5, and a neutral gray matte for transparent pixels.
The preprocessing contract is versioned as
`semantic-rgb-letterbox-neutral-v1`; changing it requires a new cache identity
and reindex.

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
