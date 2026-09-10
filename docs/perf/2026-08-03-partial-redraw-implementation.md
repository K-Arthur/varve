# Partial-redraw and dirty-region pruning — implementation report — 2026-08-03

Companion to the architecture audit
([`2026-08-03-partial-redraw-architecture-audit.md`](2026-08-03-partial-redraw-architecture-audit.md)).
Implements the ranked objectives: eliminate unexplained `clean` full redraws,
build the visible list from the dirty region, preserve effect correctness,
expand tracing, deterministic tests, and diagnostics.

## Verified facts

- The 56/120 `clean` drag frames came from worker round trips: every
  `frameRendered` reply ran the full `drawContent` visible-list pass (and
  bumped `redrawCount`, forcing a second). Fixed by the redraw coordinator
  (Phase 3): worker presentation is now a scene-free present path.
- The visible list was built before dirty clipping (`prunableByDirty`
  measured but never applied). Now nodes whose world render bounds miss every
  merged dirty rect are rejected before conversion and replay (Phase 6).
- Path nodes (`kind: 'path'`) returned null bounds, forcing a full redraw on
  every path edit; `nodeLocalBounds` now computes point/handle bounds.
- A 1px seam existed at the retained/redrawn boundary (clear rect exceeded
  the clip rect); found by the new visual oracle, not by inspection.
- The web build runs on the memory platform (`createWebPlatform` is never
  wired), so IndexedDB seeding cannot reach the home screen; fixture
  workloads now apply documents directly into the open editor.

## Architecture map (as implemented)

```text
mutation/input
  -> redraw coordinator (canvas/redrawCoordinator.ts)
       request(reason, source) + per-frame snapshot diff
       decision: skip | present | content   (before any scene traversal)
  -> dirty-region accumulator (canvas/dirtyRegion.ts + dirtyRegionMerge.ts)
       old/new bounds per changed node (incl. top-level z-order reorders)
       bounded rect set + two-tier merge policy + area fallback
  -> visible-list query (canvas/dirtyQuery.ts, dirtyReplay.ts)
       candidates ∩ merged rects + ancestors + mask sources + flatten deps
  -> render preparation (unchanged memo/IR pipeline, pruned list)
  -> raster/vector replay (canvas/partialPaint.ts)
       per-rect clear/fill + multi-path clip (never the gaps)
       replay-set entry check; force flag for mask/flatten subtrees
  -> presentation (canvas/presentWorkerFrame.ts)
       scene-free worker-bitmap composite (was a full clean redraw)
```

### New modules

| Module | Role |
|---|---|
| `canvas/redrawCoordinator.ts` | frame invalidation decisions, reason-preserving diffs, counters |
| `canvas/presentWorkerFrame.ts` | scene-free worker presentation |
| `canvas/dirtyRegionMerge.ts` | bounded rect-set merge policy + frame dirty computation |
| `canvas/dirtyQuery.ts` | prune gate, world→screen rect mapping, replay-set expansion |
| `canvas/dirtyReplay.ts` | dependency IR append (ancestors/flatten subtrees) |
| `canvas/partialPaint.ts` | multi-rect / union / full paint paths |
| `canvas/dirtyReplay.ts` | — |

## Phase 3 — clean redraw elimination

The coordinator decides, before any scene traversal, whether a scheduled
frame is needed: `skip` (state equals the last completed frame), `present`
(only a worker bitmap awaits compositing), or `content` (real invalidation).
Contributing reasons are preserved (`invalidationReasons`), not reduced to
one label. `requestContentDraw` no longer bumps `redrawCount`; the worker
reply path now composites the bitmap in ~1.7 ms with zero nodes replayed
instead of re-walking the whole visible list.

Counters (exposed via `window.__strataPerf.scheduler`): requested, coalesced,
duplicate-suppressed, submitted, skipped-clean, overlay-only, content,
present, full-redraw, rescheduled-during-render, stale-worker.

## Phase 4 — dirty-region representation

`mergeDirtyRects` keeps several independent rectangles while their combined
cost is beneficial (two distant 20 px invalidations stay two rects instead of
one gap-filled rect — the measured 67% empty-area amplification), merges
overlapping/nearby pairs (two tiers: free merges that never amplify cost,
budget merges that never force an expensive merge), and falls back to one
viewport-sized rect past a per-rect area threshold. The merged-set union
always equals the input union (no dirty pixels lost). NaN/Infinity/zero-size
inputs are dropped and counted; the collector is capped at 64.

## Phase 5 — conservative render bounds

`appearancePaddingLocal` is shape-aware: rect/frame miter spikes bounded by
one stroke weight (90° corners), general paths get the full Canvas2D cap
`weight × (miterLimit − 0.5)`; round/bevel joins and rounded rects skip miter
expansion; arrowheads on line/arrow shapes add up to 6× weight; text gets a
font-size-proportional glyph margin. The bounds taxonomy (local geometry /
local render / world render / viewport-space render) is documented in
`visualBounds.ts`.

## Phase 6 — dirty-region-driven visible list

The prune gate mirrors the paint path exactly (profile tier, rotation,
viewport-clamped union under the area threshold, merged set not fallen back)
and disables pruning when the render worker will draw the whole frame (its
bitmap must contain every pixel — a documented limitation on Chromium; the
pruning applies on WebKitGTK and all main-thread fallbacks). Replay respects
the set: candidates + ancestors + mask sources + full subtrees of included
flatten groups; mask/flatten rendering force whole-subtree replays. Paint
clears and clips exactly the merged rects (multi-path clip), so the gaps
between distant invalidations keep their retained pixels, and the clear
region never exceeds the clip (the 1px-seam fix).

## Phase 7 — mutation-aware invalidation

Old/new bounds already covered create/delete/move/resize/rotate/stroke/
effect/visibility/opacity edits; top-level z-order reorders now produce a
partial region (moved nodes' old+new bounds) instead of `dirty: none` →
full redraw. Nested reorders change a container's children array and stay
structural. Undo/redo flow through the document diff.

## Phase 8 — overlay separation

Verified: hover/selection/snap overlays render on the overlay canvas and
never touch the content canvas (`hoveredNode`/`snapGuides` are not content
deps). Constraint documented: the selection overlay's pointer-events:auto
handles intentionally intercept canvas input at handle positions (correct for
interaction, relevant for automated drags — see the runner's resolve logic).

## Phase 9 — interaction tracing

Wheel, pinch, keyboard and hover now begin interaction traces (burst
rate-limited at 150 ms / 800 ms so instrumentation does not alter behaviour).
`InteractionKind` gains `hover`. The corpus gap (zoom/undo/hover produced
zero traces) is closed: the production runner records traces for
single-drag, nudge, zoom, undo-redo and pointer-move-idle.

## Phase 10 — diagnostics

HUD shows contributing invalidation reasons and the individual merged dirty
rects (cyan) when a frame was pruned; `window.__strataPerf.scheduler` exposes
the coordinator counters; `nodeWork` exposes pre/post-merge dirty statistics
(beforeCount, afterCount, amplification, fallback) and the prune screen
rects.

## Phase 11 — correctness tests

- Unit: 14 coordinator, 15 dirtyQuery, 14 merge, 27 bounds, 11 dirty-region,
  7 corpus, 19 z-order/recorder tests.
- Visual oracle (`tests/e2e/visual/partial-redraw-oracle.spec.ts`): five
  scenarios render a scene through the full-redraw path, then through the
  pruned multi-rect partial path on top of retained pixels, and require
  pixel-identical output — including a sensitivity test proving a dropped
  candidate is detected. The oracle found the 1px seam.

## Phase 12 — production evidence

Machine: CachyOS, 8 cores, production build (vite preview), Chromium,
`--fixture=vector-1k` (1000 nodes). The runner classifies this run
`background_activity` (70 repo-adjacent processes from concurrent agents) —
structural counters remain load-independent; wall-clock numbers are
informational only.

| Workload | Traces | Notes |
|---|---|---|
| single-drag | 50 | drag latency measured; frame capture pending the drag-target follow-up |
| nudge | 35 | keyboard traces |
| zoom | 17 | p2p p50 27.6 ms / p95 71.5 ms; 120 frames |
| undo-redo | 35 | keyboard traces + 120 frames |
| pointer-move-idle | 12 | hover sampling |

Zoom frame split: 60 `camera-change` content frames (worker path) + 60
`worker-present` presentation frames — the latter replay **0 nodes in
~1.7 ms** with `frameSource: worker-reply`. Before this work, worker replies
replayed the entire visible list with `redrawReason: 'clean'`.

### Before/after structural counters

| Metric | Before (2026-08-03 obs. report) | After |
|---|---|---|
| `clean` frames with full visible-list replays | 56/120 drag frames | 0 — presentation is scene-free (0 nodes, ~1.7 ms) |
| nodes replayed for a localized edit | 121 of 161 (100%) | candidates = dirty-region ∩ render bounds; unit/oracle-verified |
| wasted replays (prunableByDirty) | 40–89% of replayed nodes | rejected before conversion (unit-verified) |
| dirty region | single union rect (67% empty-area case) | bounded rect set, no forced gap merges |
| path edits | forced full redraw (null bounds) | partial bounds |
| reorder edits | `dirty: none` → full redraw | partial region |
| 1px seam at retained boundary | present | removed (oracle-verified) |
| z-order / hover / wheel / undo tracing | zero traces | traced (burst-limited) |

### Remaining fallbacks (documented)

- Worker-rendered frames are never pruned (the worker bitmap must be
  complete). The pruning win lands on WebKitGTK and main-thread fallbacks.
- Structural compositing (adjustments, container edits, nested reorders)
  stays a full redraw with a recorded reason.
- Merged-set area fallback degrades to a viewport-sized redraw past the
  threshold (recorded as `viewport-area`).
- The visual oracle covers rects at the IR level; the full
  CanvasArea/mask/group orchestration remains covered by the existing
  replay suites, not the oracle.

## Known limitations and follow-up backlog

1. Production drag frame capture: the fixture drag target selection (first
   layers-panel row) resolves a box that can drift between drags; nudge and
   single-drag workloads record traces but no frames. Re-resolve from the
   node's own world bounds (via `window.__strataPerf.nodeWork`) instead of
   the selection-box handles.
2. Home-screen IndexedDB seeding is dead while the web build runs on the
   memory platform; wire `createWebPlatform` (or a persistence upgrade path)
   and re-enable `fixtures.seed`.
3. A/B the 302-node fixture back-to-back on an idle host (the 21× claim
   remains unverified; the runner now carries validity classification and
   alternating A/B instructions).
4. Native WebKitGTK sampling (worker disabled → the pruning path) — blocked
   on `perf`/`ptrace_scope` per the earlier report.
5. Pinch tracing exists but is untested on trackpads; WebKitGTK consumes the
   pinch natively (the bridge re-emits it) — verify traces on-device.
6. The `clean` label persists in `FrameDiagnostics.redrawReason` for
   present frames' legacy classifier output; the new
   `invalidationReasons`/`frameSource` fields are the primary attribution.

## Commits

`7bda3477` audit · `daa7a9dd` fixtures · `b998eeee` coordinator ·
`751db205` dirty merge · `288f9818` render bounds + path-bounds fix ·
`4e263a00` dirty-driven visible list · `a289e895` restore after concurrent
revert + tracing · `0ce62e97` z-order + oracle + seam fix ·
`90611e3b` fixture apply path · `b87fc681` runner drag-target fixes.
