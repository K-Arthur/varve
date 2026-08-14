# Local asset search system

Status: lexical Home retrieval and an opt-in local image/text similarity lane
are implemented, with persistent webview embedding storage, bounded background
indexing in the Asset Browser, and a reference-parity text tower. Native
SQLite indexing and cross-project background indexing remain separate
follow-ups.

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

## Natural-language lane

When the optional models are installed, the Asset Browser's search field
becomes a hybrid surface:

```text
query → lexical lanes (instant)          semantic lane (debounced 350 ms)
       filename / OCR / metadata         tokenizer → text tower → vector
              │                                   │
              └──────────────┬────────────────────┘
                             ▼
              RRF fusion + exact-name override → ranked assets
```

- Queries are debounced; stale results are suppressed via AbortController.
- Image embeddings are precomputed by a background queue
  (`SemanticAssetSearchService` in `@varve/home`), keyed by
  `contentHash + modelId + modelVersion + preprocessingVersion +
  embeddingSchemaVersion`. Renames and duplicates reuse vectors; edited bytes
  invalidate them.
- The queue is bounded (concurrency 1), cancellable, pauses on document
  visibility change, and never blocks lexical search.
- The text tower and tokenizer are parity-verified against the reference
  implementation (see `docs/quality/semantic-asset-similarity-benchmark.md`).
- Asset bytes are retained by the web/memory platform adapters
  (`getAssetBytes`) for indexing; the Tauri adapter returns null until the
  native asset commands exist. Deleting an asset removes its bytes and its
  derived embeddings on the next sync (records are content-addressed and
  rebuilt on re-import).

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
- The existing ONNX worker/model manifest is the runtime boundary. The verified
  SigLIP image graph and matching text graph now share a 768-dimensional
  embedding space. The SentencePiece Unigram tokenizer is fetched only when
  text search is explicitly enabled and is cached through the browser Cache
  API; lexical filename/OCR/metadata search remains available offline without
  either model.
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

The first local natural-language lane uses the verified Xenova SigLIP image
and text ONNX exports, with pinned SHA-256 records, matching preprocessing,
and tokenizer/model contracts. It remains opt-in and experimental: the
retrieval harness still needs a labelled Varve corpus and representative
hardware measurements before the model is presented as a quality guarantee.

OpenAI CLIP is not selected from its repository MIT license alone: its model
card describes deployed use as out of scope. Apple MobileCLIP remains an
evaluation candidate because its repository separates code, data, and model
terms. Source, checkpoint, conversion, and redistribution permissions must be
reviewed independently before a download entry is added.

## Graceful degradation

The Home UI labels the always-available lanes as filename, OCR, tags, and
visual. The editor Similar panel additionally exposes image queries and
natural-language descriptions after explicit model download. Missing OCR
metadata or semantic models simply removes those optional lanes. Model
downloads are opt-in, checksum-verified, cancellable, and never required at
application startup.

## Privacy

Semantic search is fully local: queries, tokenization, text encoding, image
encoding, embeddings, and ranking run inside the app. No artwork, query text,
OCR text, embeddings, or asset paths leave the device — no telemetry payload
includes them and no remote inference endpoint exists in the search path.
Embeddings and OCR text are stored in the same local storage as the rest of
the app's derived data (IndexedDB in the webview), are excluded from sync, and
are deleted when the asset is deleted or the index is cleared. The only
network access in the feature is the explicit, checksum-pinned model and
tokenizer download from the approved sources.

## Next implementation gate

Before promoting “describe an image” beyond the experimental lane, add a
labelled Varve corpus, human visual review sheet, retrieval-quality metrics,
and representative CPU/GPU memory and latency measurements. ANN indexing and
native SQLite persistence should be added only if those measurements show
that the current exact scan is insufficient.
