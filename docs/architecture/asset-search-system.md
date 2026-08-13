# Local asset search system

Status: lexical Home retrieval and an opt-in local image/text similarity lane
are implemented. Persistent browser/Tauri-webview embedding storage is now
available; native SQLite indexing and cross-project background indexing remain
separate follow-ups.

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

The Home UI labels the always-available lanes as filename, OCR, and tags. The
editor Similar panel additionally exposes image queries and natural-language
descriptions after explicit model download. Missing OCR metadata or semantic
models simply removes those optional lanes. Model downloads are opt-in,
checksum-verified, cancellable, and never required at application startup.

## Next implementation gate

Before promoting “describe an image” beyond the experimental lane, add a
labelled Varve corpus, human visual review sheet, retrieval-quality metrics,
and representative CPU/GPU memory and latency measurements. ANN indexing and
native SQLite persistence should be added only if those measurements show
that the current exact, document-local scan is insufficient.
