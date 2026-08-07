# Canvas Performance Findings

Shared ledger for the current performance program. A finding is not marked
fixed until a focused regression guard passes and the relevant real workload is
remeasured. `pending` means evidence is sufficient to investigate, not that the
proposed change has been approved.

| ID | Hypothesis / finding | Evidence | Owner | Status | Proposed change | Risk | Benchmark result | Commit |
|---|---|---|---|---|---|---|---|---|
| P3-01 | Existing workload corpus and soak/collector are disconnected from real app runs | source and harness audit | benchmark/QA | pending | unified metadata-stamped runner | low | no real corpus result yet | — |
| P3-02 | Full-document setup is the largest measured production phase near 1K nodes | production diagnostics and prior CPU profile | rendering | measuring | add phase/work counters, profile callers, then optimize highest caller | medium | setup p50 12.8 ms at 932 nodes | — |
| P3-03 | Periodic work or allocation causes extreme tail stalls | production p95/p99 and GC profile share | input/frontend | measuring | correlate long frames, GC, revisions, React commits, and history | medium | p95 197.2 ms, p99 633.4 ms at 932 nodes | — |
| P3-04 | Adaptive cache limits stay reduced after the profile recovers | failing test plus control-flow audit | rendering | verified | always derive current bounded limits from configured budget and active multiplier | low | constrained-to-balanced restoration and preset ceiling pass | `2def65f2` |
| P3-05 | Gradient cache hits fail to refresh frame recency | failing test plus cache audit | rendering | verified | refresh recency on `get` and add hot-entry/cold-entry tests | low | 12 hot frames retained; cold entry expires after four | `2def65f2` |
| P3-06 | Worker image bitmap creation churns decode/upload memory | one bitmap per source per render; unenforced declared budget | memory | pending measurement | count create/transfer/close and retain only if bounded evidence supports it | medium | no image stress run yet | — |
| P3-07 | Low-memory preset does not bound the whole retained/scratch memory graph | cache ownership audit | memory | partial | decoded-image cache now follows 64/256/512 MiB low/medium/high ceilings; inventory remaining owners and add pressure recovery | high | immediate shrink eviction passes; no 4 GiB run yet | decoded-image budget milestone |
| P3-08 | Partial redraw clips pixels but does not proportionally reduce production work | production code path vs simulated microbenchmark | rendering | pending measurement | add visited/built/replayed work counters for 1% dirty edits | high | no production dirty-work comparison yet | — |
| P3-09 | Raster-layer replay reconstructs all tiles and full surface | direct replay-path audit | rendering | pending measurement | benchmark dirty/visible tiles before retained tile cache | medium | no raster tile benchmark yet | — |
| P3-10 | React canvas subtree fan-out contributes to large-document drag cost | dev/prod comparison and prior CPU profile | input/frontend | pending measurement | record component commits/subscribers during drag | medium | dev 63.2 vs prod 33.2 ms p50 at 932 nodes | — |
| P3-11 | Rapid duplication or its harness fails around 1K–2K nodes | prior renderer crash plus current 932-node no-frame run | QA | reproducing | isolate document/history/memory vs probe-selection failure | high | current 932 attempt emitted no drag frames | — |
| P3-12 | Raw Canvas2D replay becomes the limit only at high visible counts | five current browser runs | rendering | measured | prioritize culling/work reduction before backend replacement | low | p50 0.7/3.6/34.7/138.0 ms at 100/1K/10K/50K | `ff4d5ea9` baseline |
| P3-13 | `pnpm bench` rediscovers benchmark suites under unrelated `.worktrees` | live benchmark run entered `.worktrees/export-infrastructure` after root suites | benchmark/QA | **reopened then verified** | the original fix set `test.exclude`, but `vitest bench` reads `test.benchmark.*`; added a `benchmark` block with the same worktree guard | low | 2026-08-07: 90 files discovered / 81 under `.worktrees` before; 0 worktree files after | see 2026-08-07 report |
| P3-14 | `pnpm bench` can hang during runner teardown after benchmark CPU work stops | isolated rerun remained attached with no matching worker or CPU process | benchmark/QA | **verified — not a teardown bug** | root cause was O(n^2) fixture construction at module scope in `spatialIndex.bench.ts` (`addNode` folded over a loop spreads `doc.nodes` + `rootChildren` per call); build fixtures in one pass | low | suite went from >300 s timeout to 55.5 s; full `pnpm bench` exit 0 | see 2026-08-07 report |
| P3-19 | Snap broad phase never refreshes its spatial index within a document, so moved/created nodes stop being snap targets | index cached under `doc.id`, which is stable for the document's lifetime; `CanvasArea`'s cache-maintenance block updated the transform cache, subtree IR cache, engine memo and *frame* index but not the snap index | scene/input | verified | retain per-node cell membership and re-index only `changedIds`; drop the index on structural edits | low | pre-fix behaviour yields **0** snap candidates for a moved node; 12 new tests, 2 shown failing without the fix | see 2026-08-07 report |
| P3-15 | Cancelled or cleared image decodes can finish late and repopulate retained cache memory | three failing async race tests | memory | verified | bind cache mutation to the current per-URL load identity | low | cancel, retry race, and clear retain zero stale bytes | `764f1eab` |
| P3-16 | Global decoded-image retention ignores the selected memory preset | ownership trace plus failing preset/shrink tests | memory | verified | expose live cache limits and bind the canvas preset to decoded-image bytes | low | 64/256/512 MiB tiers; live shrink evicts to 400-byte test ceiling | `ca682e07` |
| P3-17 | Spatial-index rectangle queries explode at extreme zoom-out | clean-worktree `pnpm bench` plus failing lookup-count test | scene/input | verified | adapt between query-cell enumeration and occupied-cell scanning | medium | 10,201 empty lookups reduced to <=2; 4K occupied-cell synthetic mean 1.55 ms vs 9.77M theoretical cells | spatial-query milestone |
| P3-18 | Snapping candidate scans scale poorly at large counts | clean-worktree `pnpm bench` | input | measured | spatially prefilter candidates before changing snap semantics | medium | 100/1K/5K mean 0.82/129/1747 ms | `ca682e07` verification |

## Rejected or constrained hypotheses

| Hypothesis | Finding |
|---|---|
| The host GPU is inherently too slow | Host GL/Vulkan acceleration is available; browser probes use SwiftShader, so the claim is unsupported |
| Canvas2D is the primary moderate-document bottleneck | Raw 1K replay is 3.6 ms p50 while the prior 932-node app frame is 33.2 ms p50 |
| A renderer rewrite is the next step | Remaining measured cost is setup, tail stalls, and UI/state orchestration; WebGPU lacks Linux WebKitGTK availability and full semantic coverage |
| Existing microbenchmarks prove production dirty redraw | The benchmark replays a synthetic one-percent subset while production still prepares the full visible list |
| Existing memory presets establish 4 GiB support | Major decoded, worker, mask, text, scratch, and GPU allocations are outside the shared budget |
