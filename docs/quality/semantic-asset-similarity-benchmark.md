# Semantic asset similarity benchmark

This benchmark is split into two layers:

1. `packages/engine/src/bench/semanticSearch.bench.test.ts` measures the
   deterministic exact-search reference path at 100, 1,000, 10,000, and
   50,000 candidate vectors.
2. A future legally usable Varve corpus will feed `evaluateRetrieval()` with
   held-out relevance labels. Synthetic vectors must not be presented as
   product retrieval quality.

Run the scale baseline with:

```bash
pnpm exec vitest run packages/engine/src/bench/semanticSearch.bench.test.ts
```

The exact path is the reference for any future ANN implementation. A
replacement must report Recall@1/5/10, mAP, query latency, build/update cost,
and memory against the same rankings before it can become the default.

The current benchmark does not claim DINOv2, DINOv3, or SigLIP quality. Model
bake-off results require fixed preprocessing, a held-out corpus, model
provenance, and real hardware measurements.
