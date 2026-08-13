# Local asset search system

Status: Phase 1 retrieval contract and Home integration implemented; local
image/text model indexing is intentionally not advertised as complete.

## Product boundary

Asset search belongs to the asset browser and platform layer. It is not a
chat-assistant feature and it must not call `@varve/ai` chat/session APIs.
The search surface is useful with no model installed:

```text
query → normalization → filename/path + OCR + metadata lanes
                       ↘ optional semantic rank lane
                         → reciprocal-rank fusion → stable asset results
```

Exact filename and identifier queries remain a first-class path. A semantic
score is never added directly to BM25/fuzzy/OCR scores because those channels
do not share a calibrated numeric scale. The platform ranking contract uses
Reciprocal Rank Fusion and applies an explicit exact filename/stem ordering
override.

## Repository audit

- `@varve/home/src/AssetBrowser.tsx` is the user-facing Asset Browser.
- `@varve/platform` is the persistence port with memory, IndexedDB, and Tauri
  adapters. Its existing asset record is metadata-oriented.
- Existing `searchAssets(query)` implementations were filename substring
  filters. The Home browser now scopes with `listAssets()` and applies the
  shared ranker locally so query updates are immediate and portable.
- Scene document assets (`@varve/scene`) are embedded document resources and are
  separate from the Home asset library. They must not be conflated with the
  platform asset index.
- OCR is already available in the editor through PaddleOCR detection and
  recognition workers. Search accepts normalized `Asset.ocrText` when a future
  indexing adapter persists that result; it does not rerun OCR in the query
  loop.
- The existing ONNX worker/model manifest is the natural runtime boundary, but
  the current SigLIP integration is image-to-image only. It does not yet wire a
  tokenizer and text encoder, so it cannot honestly power natural-language
  image retrieval.
- There is no complete native Home asset command implementation in the current
  Rust storage path. Native asset indexing therefore remains a follow-up rather
  than a silently partial SQLite feature.

## Index identity and storage

`assetEmbeddingIndex.ts` defines the storage-neutral record contract. A vector
is keyed by:

```text
contentHash + modelId + modelVersion + preprocessingVersion
             + embeddingSchemaVersion
```

The vector payload is a binary `Float32Array` buffer, suitable for IndexedDB or
a SQLite BLOB. Asset/location identity is separate from content identity, so a
rename or duplicate path can reuse an embedding while edited bytes cannot.
The index is derived data: it must be rebuildable and deleting it must never
delete source assets or prevent lexical/OCR search.

The current exact scan is deliberate. Before introducing HNSW, IVF, PQ, or
another ANN index, benchmark exact dot-product scans at 100, 1k, 10k, and 100k
assets on supported desktop tiers. If ANN becomes necessary, retrieve a
candidate set and exact-rerank it in the same embedding space.

## Model/runtime decision status

No checkpoint is selected for product distribution yet. Google SigLIP is a
credible candidate because it has separate image and text encoders, but a
production selection requires a trusted conversion, tokenizer/preprocessing
parity tests, end-to-end ranking agreement, and a verified checkpoint license.
The current Xenova SigLIP entry is retained as an image-only evaluation
contract, not as a natural-language search claim.

OpenAI CLIP is not selected from its repository MIT license alone: its model
card describes deployed use as out of scope. Apple MobileCLIP remains an
evaluation candidate because its repository separates code, data, and model
terms. Source, checkpoint, conversion, and redistribution permissions must be
reviewed independently before a download entry is added.

## Graceful degradation

The current Home UI labels the available local lanes as filename, OCR, and
tags. Missing OCR metadata simply removes that lane. Missing semantic model or
index must leave filename/OCR/metadata search and saved projects working. A
model download is opt-in, checksum-verified, cancellable, and never required
at application startup.

## Next implementation gate

Before enabling “describe an image” as a semantic product claim, add:

1. a dual-encoder adapter with text tokenizer and image preprocessing;
2. upstream/runtime embedding parity goldens and top-K agreement tests;
3. persistent incremental indexing with cancellation, retry, progress, and
   transactional replacement;
4. a labelled Varve asset corpus covering descriptive, OCR, filename, and
   design-specific queries;
5. latency, throughput, memory, model-size, license, and cross-platform
   benchmark results;
6. a model manager entry only after the provenance gate passes.

