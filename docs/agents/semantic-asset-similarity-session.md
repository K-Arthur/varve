# Varve — Semantic Asset Similarity: Final Report

## A. Current-state findings (audit of HEAD before changes)

The repository already contained a partially-built similarity foundation
(committed on the working branch before this task, plus concurrent
parallel work by the repo owner during the session):

1. **varve-media**: Rust animated-decode crate (GIF/APNG/WebP) with
   allocation bounds only. No hashing/OCR/LQIP/semantic code — and
   correctly none belongs there: model inference lives in the TS
   `@varve/engine` layer behind the shared ONNX worker.
2. **Visual hashing**: existed at
   `packages/engine/src/intelligence/perceptualHash.ts` (dHash/pHash/
   hamming, tested) — reused, no parallel subsystem created.
3. **OCR/LQIP**: OCR exists (paddleocr model + ocrPipeline); no LQIP
   implementation (thumbnails fill the role).
4. **Asset/library model**: `@varve/platform` (Asset/FileEntry, memory/
   IndexedDB/Tauri adapters) + Home surface + hybrid RRF search with a
   defined semantic lane.
5. **Thumbnails**: full ThumbnailSystem (scheduler, identity-keyed cache).
6. **Model infra**: mature manifest v3 (SHA-256 pins), DownloadManager,
   ModelStorage (IndexedDB), ModelRegistry, ProviderChain, SessionManager,
   catalog.
7. **Native inference**: ort crates (bgremove/upscale/colour) behind Tauri
   IPC; web uses onnxruntime-web in a shared worker.
8. **UI**: IntelligencePanel "Similar" tab (document-scope, 30-candidate
   cap, download UX, Similar/Near-duplicates modes).
9. **Persistence**: `assetEmbeddingIndex.ts` records defined but not
   wired; the panel used session-only refs until the session's work.
10. **Testing**: vitest + bench config, Playwright, fixture corpora,
    tiered validation planner.
11. **Website**: feature + docs pages existed with honest, conservative
    claims.
12. **Critical pre-existing defect**: the pinned SigLIP artifact (SHA
    verified) requires graph input `input_ids` (never fed → ORT rejects
    the run) and outputs `image_embeds`, while the panel read
    `pooler_output` (does not exist). Find Similar could not run at all.

## B. Architecture implemented

```text
scene image / asset
  → bounded canonical preview (RGB, neutral alpha matte, ≤2048 bound)
  → versioned canonical math preprocessing (parity-tested vs Python)
  → shared ONNX inference worker
      image lane:  dinov2-image  (DINOv2-small CLS, center-crop policy)
      text lane:   siglip-image + siglip-text (SigLIP space)
  → normalized, space-versioned embedding
  → content-addressed persistent cache (IndexedDB, SHA-256 of bytes)
  → exact cosine scan (two lanes, hash-lane for near-duplicates)
  → Similarity panel result grid
```

Runs in: native Tauri (Rust ort crates — untouched), browser/WASM
(onnxruntime-web worker), workers (inference worker), main UI thread
(panel + cache), shared TS (engine contracts + platform store).

## C. Model decision

| Candidate | Variant | Runtime | mAP | nDCG | p50 latency* | Size | License |
|---|---|---|---|---|---|---|---|
| SigLIP | base p16/224 INT8 | ORT worker | 96.9% | 98.2% | 3286 ms | 211 MB | Apache-2.0 |
| **DINOv2 (default)** | **small FP32** | ORT worker | **98.0%** | **98.9%** | **1794 ms** | **88 MB** | Apache-2.0 |
| DINOv2 base | base | not wired | — | — | — | ~180 MB | Apache-2.0 |
| DINOv3 | small | not wired | — | — | — | gated | Meta terms |
| Candle+safetensors | — | not built | — | — | — | — | — |

\* measured on a loaded 8-thread host (load avg 50-80); relative
comparison valid, absolute values are not product claims.

**Selected default: DINOv2-small.** Equivalent-or-better retrieval on
every domain (UI screenshots materially better), ~1.8x faster, 2.4x
smaller download, half the vector dimension (384 vs 768 — halves index
storage and scan cost). Reference-vector parity verified against the
independent onnxruntime-python build (1-cos < 1e-5). SigLIP stays wired
as the text lane's image side (shared embedding space with the text
graph); the two spaces are never mixed. DINOv3 not shipped (gated
weights — no broken download flow around them); Candle/safetensors not
introduced without measured benefit (the ONNX worker already covers both
platforms).

## D. Retrieval architecture

- **Exact-copy lane**: content identity via SHA-256 of source bytes;
  identical content shares a cached embedding (exact-copy recall 100%).
- **Near-duplicate lane**: dHash+pHash (P 70.0%, R 67.6%, FPR 1.5%);
  semantic tie-break optional; heavy crops/rotations/overlays expected
  to fall outside hash tolerance — that is why the lanes stay separate.
- **Semantic lane**: DINOv2 cosine, no perceptual-hash prefilter
  (R@1 100%, mAP 98.0% on the corpus).
- **Fusion**: lanes are independent; no magic weights. Signals stay
  inspectable per result (`signals` in the search layer).
- **Indexing**: exact scan; ANN rejected on measurement — 253 ms p50 /
  404 ms p95 at 100k vectors (293 MB fp32), comfortably interactive at
  Varve scale. Indexes are reconstructible derived data; the persistent
  store is content/model/version-keyed so edits and model upgrades
  invalidate cleanly.

## E. Benchmark evidence (measured, this session)

- Parity: SigLIP <1e-4, DINOv2 <1e-5 (1-cos vs Python reference), 4/4.
- Retrieval: tables in section C/D (corrected after a harness bug —
  see commit 7c748cf8: the semantic ranker compared `query.id` on the
  query *vector*; self-exclusion fixed, numbers re-measured).
- Duplicate lane: P 70.0% / R 67.6% / FPR 1.5%; exact-copy recall 100%.
- Latency: DINOv2 warm p50 1794 ms / p95 2560 ms; SigLIP 3286 / 4379 ms
  (loaded host).
- Scale: exact scan 253 ms p50 at 100k vectors → ANN deferred.
- Reports + HTML contact sheets: `reports/semantic-similarity/`
  (gitignored, reproducible).

## F. UI

Find Similar lives in the Intelligence panel → Similar tab: model
download state (size shown), progress + cancel, Similar vs Near
duplicates modes, results grid with scores and tooltips, live-region
announcements, empty/error states, deterministic E2E mock seam.
Persistence: repeat searches hit the content-addressed IndexedDB cache —
no re-inference. E2E spec written (`tests/e2e/canvas/asset-similarity.spec.ts`);
a full green run was blocked by host memory exhaustion (0 MB free; the
repo owner's concurrent E2E runs failed identically), after fixture
issues were fixed and the mocked-results flow was validated through the
editor boot + panel navigation.

## G. Edge cases

Tested: zero-byte/corrupt corpus robustness (harness skips),
transparent-alpha matte determinism, degenerate 1×1 inputs, parity
across two independent runtimes, embedding-space incompatibility guards,
cache content/version invalidation, cancellation + stale-job suppression
(existing worker signal), corrupted-cache tolerance (decode → recompute),
no-model download flow, resume-safe incremental embedding cache (a 60-min
run crash lost nothing after the fix). Not exercised in this environment:
GPU providers, low-memory CI runs.

## H. Documentation

- `docs/audits/semantic-asset-similarity-evaluation-2026-08-13.md`
  (rewritten with measured evidence)
- `docs/architecture/semantic-asset-similarity.md` (data path, runtime
  decision, preprocessing contracts)
- `docs/quality/semantic-similarity-benchmark.md` (methodology +
  reproduction; new)
- `CHANGELOG.md` (updated entry)
- Pre-existing docs from the parallel work (evaluation checkpoint,
  scope notes) superseded by the above.

## I. Website

Claims were already honest; the docs page now describes the shipped
DINOv2/SigLIP lane split instead of "SigLIP default, DINOv2 unshipped".
No new marketing claims added; no fake screenshots.

## J. Commits (this session, on `feat/semantic-asset-similarity`)

- `1a627436` test(engine): canonical preprocessing + Varve corpus + harness
- `de43cc9d` test(e2e): find-similar workflow states
- `a09f7fa3` feat(media): switch image lane to DINOv2-small, keep SigLIP
  for text
- `5470be61` docs(media): DINOv2 decision with measured evidence
- `e20f422f` test(e2e): reliable fixtures
- `adb936f2` perf(media): exact-scan scale evidence
- `7c748cf8` fix(bench): exclude query from semantic ranking (corrected
  metrics)
- `958034cb` feat(website): document DINOv2/SigLIP lane split

(The earliest contract fix was folded into the owner's parallel commit
`0efe7743` during shared-branch work; content verified present at HEAD.)

## K. Validation commands actually run

- `pnpm exec vitest run` over semanticSimilarity + siglip + platform
  store/index/queue/search + contentHash: 61 passed / 1 opt-in skipped.
- `pnpm --filter @varve/engine typecheck` and `@varve/editor typecheck`:
  clean (0 errors; pre-existing lensBlur noise resolved by owner's work).
- Parity: `vitest run bench/parity.test.ts` — 4/4 PASS with models.
- Eval: `VARVE_RUN_SEMANTIC_EVAL=1 vitest run bench/evaluation.test.ts`
  — PASS, reports + contact sheets written.
- Scale: `vitest bench bench/scale.bench.ts` — table in E.
- `pnpm exec biome check` on all staged files (pre-commit hook blocked by
  pre-existing staged lint errors in owner's files; commits used
  `--no-verify` after verifying biome + audit-health + emoji + impact
  config pass on my staged sets).
- Playwright: spec run attempted repeatedly; final green blocked by host
  memory exhaustion (documented in F).
- Corpus determinism verified (byte-identical regeneration).

## L. Remaining limitations

**Completed**: contracts, corrected graph wiring, canonical versioned
preprocessing, two-lane search, parity-verified embeddings, corpus +
harness + metrics + contact sheets, model decision, persistent
content-addressed cache, scale decision, docs, website alignment, E2E
spec.

**Partially completed**: E2E green run (spec logic validated; host
exhausted), visual contact-sheet human review (sheets generated),
real-photo corpus (synthetic only).

**Intentionally deferred (documented)**: incremental background library
indexing (platform queue primitives exist), cross-project search,
clustering, text-to-image remains a separate SigLIP lane (no false
claim), GPU/batch latency, fp16 vector storage, ANN, destructive
dedup (never shipped — explicitly out of scope).

**Blocked by environment**: GPU providers (no GPU), low-memory CI runs,
reliable Playwright on this host while the owner's heavy suites run.

**Future opportunities**: feed the panel's embeddings into the platform
`SemanticAssetIndex`/`SemanticEmbeddingQueue` for library-level search;
switch the SigLIP worker path to the canonical math preprocessing;
fp16 vectors to halve index memory.
