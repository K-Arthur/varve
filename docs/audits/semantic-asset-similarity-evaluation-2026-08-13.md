# Semantic asset similarity evaluation — 2026-08-13

## Scope

This is the first implementation checkpoint for local image-to-image asset
similarity. It records what is measured and what is still unmeasured; it does
not invent model quality or latency numbers.

## Candidate decision matrix

| Candidate | Runtime in Varve | License/access | Product status |
| --- | --- | --- | --- |
| SigLIP base patch16/224 ONNX | Existing shared worker | Apache-2.0 source/export; checksum-pinned catalog entry | Selected first runtime |
| DINOv2 small | No validated adapter | Apache-2.0 weights; export/parity still required | Evaluation candidate |
| DINOv2 base | No validated adapter | Apache-2.0 weights; larger resource cost requires evidence | Evaluation candidate |
| DINOv3 small | No validated adapter | Gated Meta terms; distribution review required | Not shipped |
| Candle + safetensors | No implementation | Runtime and weight format are separate decisions | Deferred |

SigLIP was selected for the first slice because it already has a verified
ONNX graph, shared worker registration, model download/integrity handling, and
an existing image-to-image UI path. This is an integration decision, not a
claim that it is the best possible visual backbone for every Varve workload.

## Validation actually run

- `pnpm exec vitest run packages/engine/src/semanticSimilarity/search.test.ts packages/engine/src/inference/models/siglip.test.ts`
  — 11 tests passed.
- `pnpm --filter @varve/engine typecheck` — passed.
- `pnpm --filter @varve/editor typecheck` — passed after the Similar panel
  lane split.
- `pnpm exec vitest run packages/platform/src/assetEmbeddingIndex.test.ts packages/platform/src/assetSearch.test.ts`
  — 6 tests passed for content-addressed record encoding and hybrid ranking.
- `pnpm exec vitest run packages/platform/src/semanticAssetIndex.test.ts packages/platform/src/semanticEmbeddingQueue.test.ts packages/engine/src/semanticSimilarity/metrics.test.ts packages/engine/src/semanticSimilarity/search.test.ts packages/engine/src/inference/models/siglip.test.ts`
  — 19 tests passed for exact indexing, queue lifecycle, metrics, lane
  separation, and the SigLIP contract.
- `pnpm exec vitest run packages/engine/src/bench/semanticSearch.bench.test.ts`
  — exact-search scale baseline passed at 100/1k/10k/50k candidates.
- `pnpm --filter @varve/platform typecheck` — passed.

The editor panel test was started during a period of concurrent repository
validation and did not produce a completed reporter result; it is explicitly
not counted as passed here.

## Quality gaps

No Varve-specific labeled corpus or held-out model-quality metrics have been
run yet. The metrics helper and exact-search scale baseline cover evaluation
plumbing, not model quality. Recall@K, mAP, nDCG, duplicate precision/recall,
CPU p50/p95, peak RAM, batch throughput, and exact-vs-ANN scale curves still
require a legally usable Varve corpus and representative hardware before
selecting DINOv2 or replacing SigLIP. The visual review sheet and real-model
ranking audit are also pending.

The current implementation therefore makes no marketing claim about model
quality, automatic clustering, text search, or whole-library organization.
