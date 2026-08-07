# Benchmark-gate integrity and snap-index freshness (2026-08-07)

Session scope: audit the canvas subsystem as a whole, then fix what the
evidence — not intuition — ranked first. The headline result is not a frame-time
number. It is that two of this program's own measurement instruments were
reporting on the wrong code, and that a core editing interaction had a silent
correctness defect that no timing metric would ever have surfaced.

Environment: CachyOS 7.1.5, Node 26.4, vitest 2.1.9, 8 threads. **Host load was
40-58 throughout** (concurrent agents building and testing in sibling
worktrees). Every wall-clock figure below is therefore directional; every
work-count figure is deterministic and is what the new tests assert.

## A. Architecture discovered

The canvas path, as it actually exists:

```text
pointer event
  -> CanvasArea tool context (snapPosition, findContainingFrame, ...)
  -> broad phase:  snap spatial index (queryRect)  |  HitTestEngine (queryPoint)
  -> fine phase:   filterSnapTargets -> snapPosition   |  HitTestPolicy
  -> scene mutation (immutable Document)
  -> computeInvalidationPlan(prev, next) -> { isStructural, changedIds }
  -> cache maintenance: transformCache, SubtreeIrCache, engineNodeMemo,
                        frameIndex   [<- snap index was missing here]
  -> redrawCoordinator -> dirty region -> visible-list construction
  -> engine IR -> replay (main thread or render worker) -> compositor
```

Ownership boundaries worth naming:

- `computeInvalidationPlan` is the single classifier for "what does this edit
  invalidate". Every per-document cache is meant to be maintained from its
  output, in one block in `CanvasArea`.
- Broad-phase candidate generation is spatial-index-driven and separate from
  fine-phase geometry. The fine phase always re-reads live bounds, which is why
  a stale broad phase degrades silently rather than visibly.
- `SpatialIndex` is shared by two consumers with different invalidation
  expectations: `HitTestEngine` constructs one per engine instance, while
  `CanvasArea` caches one across a whole document.

Much of what this task's brief lists as candidate work is already present and
working, and was verified rather than rebuilt:

- Dirty-region-driven visible-list construction **is** implemented
  (`CanvasArea.tsx:1631`) — nodes whose visual bounds miss every merged dirty
  rect are rejected before engine-node conversion. The prior ledger entry
  describing this as unexploited headroom (finding P3-08) is out of date.
- Clean-frame suppression, bounded dirty-rect sets with an explicit merge
  policy, conservative render bounds for miter joins/arrowheads/text, and the
  transform cache all landed after the last ledger entry.
- Snap candidates are already spatially prefiltered before `snapPosition`
  (`queryRect` + `filterSnapTargets`), which is what finding P3-18 proposed.
- The extreme-zoom spatial cliff fix (P3-17) holds: `zoom=0.01` measures
  1.88 ms mean against the 7.72 s originally recorded.

## B. Problems discovered

| # | Class | Problem | Evidence |
|---|---|---|---|
| 1 | Correctness | Snap broad phase never refreshes within a document; moved and newly created nodes stop being snap targets | pre-fix composition yields **0** candidates for a moved node |
| 2 | Testing / integrity | `pnpm bench` measured other agents' worktrees | 90 files discovered, 81 under `.worktrees` |
| 3 | Testing / availability | `pnpm bench` never completed | killed at 400 s and at 900 s |
| 4 | Measurement validity | A recorded "scale cliff" was an artefact of #2 | 1.75 s recorded vs 52.6 ms clean |
| 5 | Testing / fragility | Two wall-clock assertions flake under host load | failed once each at load 50-58, passed on rerun |

## C. Root causes

**#1 — the snap index was excluded from the one place caches are maintained.**
`CanvasArea` cached it as `{ index, parentIndex, documentId, ... }` and rebuilt
only when `documentId !== doc.id`. A document's id is stable for its entire
lifetime, so the index was built once and never refreshed. The
`computeInvalidationPlan` block immediately above it correctly refreshes the
transform cache, subtree IR cache, engine memo and the *frame* spatial index —
the snap index was simply omitted.

The failure is asymmetric, which is why it survived review. A node that moves
*out* of the query area is still returned by the stale index, but the fine phase
re-reads live bounds and drops it, so nothing looks wrong. A node that moves
*into* the query area is absent from the queried cells, so the fine phase never
sees it. The object silently stops being snappable, with no error and no visual
tell.

**#2 — the earlier fix was applied to the wrong option.** Commit `862dd38c`
added `**/.worktrees/**` to `test.exclude`. `vitest bench` does not read
`test.exclude`; it reads `test.benchmark.include` / `test.benchmark.exclude`,
whose defaults exclude only `node_modules`, `dist`, `.idea`, `.git`, `.cache`.
The guard was real but unreachable from bench mode.

**#3 — it was never a teardown bug.** The prior finding (P3-14) hypothesised
runner lifecycle. The actual cause is `spatialIndex.bench.ts` building its
fixtures by folding `addNode` over a loop *at module scope*. `addNode` spreads
both `doc.nodes` and `doc.rootChildren` on every call, so fixture construction
is O(n^2): roughly 400M property copies at the 20,000-node tier, before a single
benchmark reports a number. The run looked hung because collection never
finished.

## D. Changes implemented

### 1. Incremental snap-index maintenance

- **Problem:** moved/created nodes stop being snap targets.
- **Root cause:** index cached under a stable `doc.id`; omitted from the
  invalidation block.
- **Solution:** `SpatialIndex` now retains `cellsByNode` (each node's current
  cell footprint) and its build-time `parentIndex`. New
  `updateSpatialIndexNodes(index, doc, changedIds)` removes each changed node
  from its previous cells, re-inserts at its new ones, prunes emptied cells, and
  advances `docRef`. `CanvasArea` calls it from the existing non-structural
  branch and drops the index on structural edits (where the hierarchy, and so
  the retained parent map, may have changed). A node the index has never seen
  triggers one parent-map refresh, so an insertion inside a container is filed
  at its world position rather than its local one.
- **Files:** `packages/editor/src/scene/spatialIndex.ts`,
  `packages/editor/src/CanvasArea.tsx` (invalidation block + one symbol added to
  an existing import).
- **Tests:** `spatialIndexIncremental.test.ts` (8),
  `snapIndexFreshness.test.ts` (4).
- **Benchmark effect:** replaces "never refreshed" with at most 8 grid touches
  for one moved node — bounded by the node's cell footprint, not by document
  size. Deliberately *not* a full rebuild, which would be O(document) per
  pointer move.

### 2. Benchmark discovery excludes sibling worktrees

- **Solution:** a `test.benchmark` block in `vitest.config.ts` with the same
  worktree guard as `test.exclude`, plus includes scoped to `packages/*/src`.
- **Files:** `vitest.config.ts`, guarded by `tests/unit/benchDiscovery.test.ts`
  (4 tests).

### 3. Linear benchmark fixture construction

- **Solution:** `withRootNodes()` builds the fixture document in one pass,
  producing a document equivalent to the `addNode` fold (same `index`, same
  ascending `generateKeyBetween` order chain).
- **Files:** `packages/editor/src/scene/__benchmarks__/spatialIndex.bench.ts`.
  Test-harness only; no production code path changed.

## E. Performance comparison

| Measurement | Before | After |
|---|---|---|
| Bench files discovered | 90 (81 under `.worktrees`) | 9 root, 0 worktree |
| `pnpm bench` | never completed (400 s, 900 s) | **exit 0** |
| `spatialIndex.bench.ts` | >300 s timeout | **55.5 s**, 13 groups reporting |
| Snap candidates, node that moved | **0** | 1 |
| Snap-index maintenance, one moved node | not performed | <=8 grid touches |
| `snapPosition` 100 / 1K / 5K candidates (unfiltered) | — | 0.53 / 6.88 / 52.6 ms mean |
| `queryRect` spatial vs naive, 5K | — | 0.25 ms vs 23.5 ms mean |
| `queryPoint` spatial vs naive, 5K | — | 0.0008 ms vs 20.2 ms mean |
| `buildSpatialIndex`, 20K nodes | — | 322 ms mean (rebuild cost avoided per frame) |
| `queryRect` at zoom 0.01 | 7.72 s (2026-08-01) | 1.88 ms — P3-17 fix holds |

The 20K `buildSpatialIndex` figure is the number that justifies the incremental
design: a full rebuild on every pointer move would cost ~322 ms per frame at
that scale.

## F. Correctness evidence

16 new tests, all passing. Two were verified to be load-bearing by disabling the
fix and observing the exact predicted failure:

- Removing the incremental update reproduces the original defect:
  `expected 0 to be greater than 0` — zero snap candidates for a moved node.
- Removing the parent-map refresh reproduces the container-insertion defect:
  the child is filed at local instead of world coordinates.

Regression suites over the touched areas (`scene`, `tools`, `canvas`,
`hitTest`, `tests/unit`): **992 passed, 1 skipped**, plus one wall-clock flake
discussed below. The 30 pre-existing `spatialIndex.test.ts` tests pass unchanged.

## G. Platform status

| Platform | Status |
|---|---|
| Node / jsdom (Vitest) | Verified — all figures above |
| Chromium | **Not run this session** |
| Tauri / WebKitGTK Linux | **Not run this session** |
| Windows WebView2 | Not available |
| macOS WKWebView | Not available |

No browser or native measurement was taken. The changes are pure scene/index
logic plus test configuration, with no renderer, DPR or compositing surface
touched, but that is an argument for low risk — not evidence of platform
validation, and it is not claimed as such.

## H. Remaining bottlenecks

Ranked by expected impact against implementation risk:

1. **P3-02 — full-document setup phase** (12.8 ms p50 at 932 nodes) remains the
   largest measured production phase. Medium risk.
2. **P3-03 — tail stalls** (p95 197 ms / p99 633 ms at 932 nodes in a production
   build). Cause not isolated; correlate GC, React commits and history.
3. **P3-10 — React canvas subtree fan-out during drag.** Dev-vs-prod delta
   suggests real commit cost independent of the dev-mode tax.
4. **P3-07 — low-memory preset does not bound the whole retained graph.** Worker,
   mask, shaping, scratch and GPU allocations remain outside shared ownership;
   no 4 GiB run has passed.
5. **Interaction tracing gap** — `beginInteraction` fires only on pointerdown, so
   wheel, keyboard and hover interactions produce no traces at all.
6. **Fragile wall-clock gates** — see below.

## I. Architecture impact

| Aspect | Change |
|---|---|
| `CanvasArea.tsx` imports (Ce) | **unchanged at 82 by this session** — one symbol (`updateSpatialIndexNodes`) added to an existing `./scene/spatialIndex` import statement, so no new module edge. Note a concurrent session independently added a `totalEffectExpansion` import to the same file during this work; that edge is theirs, not this session's, and was left untouched. |
| `CanvasArea.tsx` complexity | +1 branch in the existing invalidation block; measured at 468, well under its 630 ceiling |
| New modules | none — the new function lives in the existing leaf module `scene/spatialIndex.ts` |
| Dependency cycles | none introduced; no new package edges |
| Layer violations | none |
| New interfaces | `SpatialIndex` gained two fields (`cellsByNode`, `parentIndex`); both consumers unaffected |

`AGENTS.md` records `CanvasArea` complexity as 780 against a 630 ceiling. The
audit now measures **468**, and `context.tsx` at **877** against a recorded 833
(ceiling 847). Those table values are stale relative to concurrent refactoring
work; they were not edited here because that file is contended.

## J. Final verification

| Command | Status |
|---|---|
| `npx vitest bench --run --pool=forks` | **PASS** (exit 0; was never completing) |
| `npx vitest run packages/editor/src/{scene,tools,canvas,hitTest} tests/unit` | **PASS** — 992 passed, 1 skipped, 1 load-induced flake |
| `npx biome check` on all 6 changed files | **PASS** |
| `npx biome format --write` on changed files | applied |
| `pnpm --filter @varve/editor typecheck` | **FAIL — 89 pre-existing errors, 0 in files touched here.** All are in `src/workspace/*`, `src/auxiliary/*`, `src/components/*` and test files owned by concurrent sessions. Verified by filtering the error list for the changed files: no matches. |
| `node scripts/audit-architecture.mjs --ci` | **DID NOT COMPLETE** — killed at 600 s under host load ~50. Partial output captured the complexity section quoted above; cycle and layer sections did not finish. |
| `pnpm test` (full suite) | **NOT RUN** — the targeted subset above took 232 s at load 58; the full ~10.9k-test suite was not attempted in this window |
| `pnpm audit:emoji` | **PASS** — clean, 2981 files scanned |
| `pnpm audit:docs` | **FAIL — 10 pre-existing violations, 0 from this session.** All are `docs/README.md` missing index entries for ADRs 0204-0213 (the concurrent multi-window workspace work). Not fixed here: writing index entries for ADRs this session did not author and has not read would be speculative, and the file is contended. |
| `pnpm audit:tokens` | **NOT RUN** — no token, colour or theme surface touched |
| Playwright E2E (`snap-after-move.spec.ts`) | **WRITTEN, NOT PASSING, CHECKED IN AS `describe.skip`.** Two attempts; the scaffolding works (both rects created, real pointer events dispatched) but the assertion compares Inspector document coordinates against `dragOnCanvas` world coordinates, so the drag delta is wrong (expected 416, landed 194.9). Skipped rather than loosened, with the blocker and the fix documented in the file. It is not evidence for the fix. |
| Rust / native tests | **NOT RUN** — no Rust code touched |

### What remains unverified

- **No passing Playwright E2E covers the snap fix.** AGENTS.md requires real
  `PointerEvent` verification for canvas/pointer behaviour. The defect is proven
  at the composition level (`queryRect` -> `filterSnapTargets`, driven by the
  real `computeInvalidationPlan`), which is the narrowest test that reproduces
  it, but that is not the same as driving a real drag in a browser.
  `tests/e2e/canvas/snap-after-move.spec.ts` exists and is checked in as
  `describe.skip`: it creates both rects and dispatches real pointer events, but
  its assertion mixes Inspector document coordinates with `dragOnCanvas` world
  coordinates. The file documents the exact blocker and the intended fix (read
  world bounds via `page.evaluate` instead of the Inspector). It is skipped, not
  passing, and must not be counted as evidence.
- **The full validation gate did not run.** Host load of 40-58 from concurrent
  sessions made the long-running commands unreliable; the architecture audit was
  killed at 600 s. These must be re-run on a quiet machine before merge.
- **No browser or native platform measurement** was taken (section G).
