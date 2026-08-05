# ADR-0154: Performance and memory limits

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

4 GB RAM target (§34); existing caches are bounded (SubtreeReplayCache,
thumbnail LRU, VersionThumbnailQueue). Multipage adds placement indexing,
master projections, story composition, thumbnails, and export volume.

## Decision

D1 — Budgets (benchmarked per milestone, `vitest.bench.config.ts`): off-screen
pages never compose; Pages panel opening never composes every page; thumbnails
lazy ≤ 512 px with LRU ≤ 64 MB; master projection cache ≤ 128 MB;
composition ≤ 300 ms per story segment in worker, cancellation beyond;
worker concurrency ≤ 2.

D2 — Limits (validated on load and on write): pages ≤ 10,000; spreads ≤
10,000; masters ≤ 500; master layers ≤ 16/page; master depth ≤ 8 (future,
ADR-0135); story ≤ 10M graphemes; frames per story ≤ 5,000; columns ≤ 64;
guides ≤ 10,000; coordinates |v| ≤ 1e7 px; bleed ≤ min(page)/2; slug ≤
min(page)/4; thumbnail 512 px; import bytes ≤ 1 GB compressed; model request
≤ 5 MB.

D3 — Benchmarks instrument: frame time, input latency, main-thread blocking,
worker time, composition time, pages projected, nodes replayed, dirty area,
memory, cache/thumbnail bytes, open/save/export time, page navigation, page
reorder, spread rebuild, master edit across hundreds of pages, history
restore, semantic diff, three-way merge. Corpus scales: 1/10/100/500/1,000
pages, 500-frame story, many mixed sizes (workloadCorpus.ts extension).

D4 — Low-memory mode reduces thumbnail/preview budgets; worker/GPU resource
loss recovers; browser storage quota errors surface cleanly (ADR-0153 D4).

D5 — The `replaySubtreeToCtx` hot-path rule (AGENTS.md §"clean version is not
always fast") applies to any new per-node/per-page dispatch: benchmark
before merge.

## Alternatives

- Unbounded caches — rejected (4 GB target).
- Page-count cap far below spec needs — rejected: spec requires thousands
  of pages.

## Consequences

- New perf corpus gates merges for the multipage milestones; regressions
  block.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Limits double as security bounds (D2 list is the threat-model numbers from
the audit §14).

## Rejected shortcuts

- Lazy composition deferred (status quo is no composition at all).
- Infinite page/thumb/cache growth.
