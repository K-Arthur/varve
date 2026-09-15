# ADR-0121: Performance and indexing strategy

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Design systems reach tens of thousands of tokens with thousands of aliases
and bound nodes, on machines with ~4 GB RAM. The current system scans
`Object.values(store.variables)` for name resolution and rebuilds dependency
maps from scratch — neither scales.

## Decisions

### D1 — Indexed token store

The canonical store maintains indexes: internal id, canonical path, source
pointer, stable extension id, incoming references, outgoing references,
bound nodes, and composite-property references (ADR-0104). All indexes are
updated incrementally by immutable ops; no full rebuilds on single edits.

### D2 — Lazy everything

- Values resolve lazily with memoized dependency invalidation.
- Resolver permutations are lazy and cached (ADR-0105 D2).
- The token tree renders virtualized; detail panels load lazily.
- Rename detection is bounded (ADR-0109 D2); diffs stream through workers.

### D3 — Worker offload

Parse, validation, semantic diff, three-way merge, and generated-output
jobs run on worker threads (existing worker infra:
`packages/editor/src/render/workerHost.ts` patterns), with cancellation,
latest-wins semantics, and stale-result rejection. Transfer costs are
measured; results are structured-clone friendly.

### D4 — Semantic hashes and cache bounds

- Base snapshots and sync states use semantic hashes (no timestamps).
- Snapshot cache, resolver cache, and worker queues are size-bounded with
  eviction; memory-pressure handling drops non-active permutations.
- Diagnostics instrument: tokens/files parsed, parse/validation/merge
  durations, reference edges, resolver permutations evaluated, diff/merge
  duration, rename candidates, tree rows rendered, search duration, watcher
  events received/coalesced, snapshot bytes, cache hit rate/bytes,
  generated-output duration, stale results discarded — without logging
  token names or values by default.

### D5 — Benchmarks

Bench harnesses follow `vitest.bench.config.ts` conventions: 100 / 1k /
10k / 50k / 100k tokens (or a documented safe limit), 1k/10k aliases, deep
chains, large composites, multi-file sources, multi-modifier resolvers,
watcher event storms, large diffs, thousands of bound nodes. Targets:
interactive parse < 250 ms at 10k tokens on low-resource hardware, merge and
diff linear-ish with bounded constants, token tree first render under a
frame budget at 10k rows.

## Alternatives

- Eager full resolution — rejected: O(tokens) churn per edit and unbounded
  permutation spaces.
- Rebuilding dependency maps per change — rejected: current O(n) full scan.
- Unbounded caches — rejected: 4 GB RAM targets require discipline.

## Consequences

- A dedicated `tokens` bench suite with recorded budgets; regressions gate
  merges (same policy as the canvas replay hot path).
- Resource limits (file size, token count, nesting depth, chain depth,
  permutation count, composite size, string size, extension payload,
  diagnostics count, image/PDF bounds, queue depth, snapshot bytes) are
  enforced with clean diagnostics instead of silent exhaustion.

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Worker isolation, bounded inputs, and cancellation prevent worker flooding
and memory exhaustion (also resource limits resource limits).

## Rejected shortcuts

- String-scan resolution paths for synchronized tokens.
- Rendering all token rows eagerly.
- Eager permutation materialization.
- Unbounded snapshot or cache growth.
