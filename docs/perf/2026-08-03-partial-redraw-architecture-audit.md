# Partial-redraw architecture audit and clean-redraw root cause — 2026-08-03

Task: partial-redraw and dirty-region pruning architecture. This document is
the architecture map and the root-cause analysis for the unexplained `clean`
full redraws measured in
[`2026-08-03-interaction-observability-report.md`](2026-08-03-interaction-observability-report.md)
(Gate D satisfied, 56/120 drag frames `redrawReason: 'clean'`, 40–89% of
replayed nodes missing the dirty region). The follow-up implementation records
are in `docs/perf/2026-08-03-partial-redraw-implementation.md`.

## Evidence state

Verified facts:

- Dirty area falls to 2.7% of the viewport while replayed nodes stay at 121 of
  161 — `rejectedByDirty` is structurally zero because the visible list is
  built before dirty clipping (`CanvasArea.tsx`, pre-loop counter
  `prunableByDirty`).
- 56 of 120 drag frames present with `redrawReason: 'clean'`: no document
  change, no camera change, no decode, no font load — yet every visible node
  is traversed and replayed.
- `beginInteraction` fires only from pointerdown (`inputPipeline.ts:177`), so
  wheel, hover, pinch and keyboard paths produce no traces at all
  (`InteractionKind` declares `'wheel' | 'pinch' | 'keyboard'`).
- The 302-node / 129 ms p50 figure was recorded under load 23 host contention
  and is **not** evidence of a superlinear regression. It is only reproduced
  by a controlled back-to-back A/B.

## Architecture map (verified against code, 2026-08-03)

```text
mutation/input
  -> invalidation source                       React state in context.tsx (setState/
                                                patch/updateDoc/commitCamera/setPan),
                                                image/font decode subscribers, worker
                                                replies, canvas context lifecycle
  -> dirty-region accumulator                  canvas/dirtyRegion.ts
                                                (computeDocumentDirtyRegion: single
                                                union rect over changed node ids;
                                                per-frame, inside drawContent)
  -> frame scheduler                           performance/frameScheduler.ts keyed
                                                lane scheduler; no invalidation
                                                metadata; CanvasArea effect + imperative
                                                triggers both schedule the same key
  -> visible-list query                        walkNodes(activePageNodes(doc)) — full
                                                DFS of the active page; container culling
                                                (containerCulling.ts); per-node loop with
                                                viewport cull + engine-node memo
  -> render preparation                        engineNodeMemo + NodeHashMemo +
                                                SubtreeIrCache; eng.buildIr()
  -> raster/vector replay                      replaySubtreeToCtx / worker host
                                                (render/workerHost.ts) / compositor
  -> backing-store update                      partial clear+fill+clip(dirtyRectRef)
                                                or full board fill
  -> presentation                              recordFrame -> drawDiagnostics ring +
                                                interaction trace; worker bitmap composite
```

### Stage inventory (files)

| Stage | File | Notes |
|---|---|---|
| Input (pointer/wheel/pinch/key) | `canvas/inputPipeline.ts` | `beginInteraction('pointer-drag')` only on pointerdown; wheel → `setPan`/`commitCamera`; inertia loop via `scheduleCanvasFrame(inertiaFrameKey, 'input')` |
| Tool FSM / dispatch | `canvas/toolDispatcher.ts`, `performance/dispatchSpan.ts` | dispatch span exists |
| Scene mutation | `context.tsx` `updateDoc`/`patch`/transactions | immutable documents, structural sharing |
| Invalidation | `canvas/dirtyRegion.ts` | union rect only; `RedrawReason` includes `'clean'`; `resolveFullRedrawReason` for fallbacks |
| Scheduling | `performance/frameScheduler.ts` + `performance/editorFrameRuntime.ts` | keyed latest-wins; lanes input/canvas/ui/background; no reason metadata |
| CanvasArea triggers | `CanvasArea.tsx:2606-2630` | RAF-scheduling effect on `drawContent` identity + `requestContentDrawRef` (schedules AND bumps `redrawCount`) |
| Visible list | `CanvasArea.tsx:1316-1495` | `walkNodes`; container culling; viewport cull; `prunableByDirty` measurement only |
| IR build | `CanvasArea.tsx:1543-1628` | per-node hash + SubtreeIrCache; `buildIr` |
| Replay | `CanvasArea.tsx:1722-2445` | dirty clip applied at paint time only; worker full-frame path; compositor path |
| Worker | `render/workerHost.ts`, `render/frameLifecycle.ts`, `render/renderWorker.ts` | latest-wins; `frameRendered` reply calls `requestContentDrawRef` |
| Diagnostics | `canvas/drawDiagnostics.ts`, `canvas/perfRuntime.ts`, `performance/interactionTrace.ts`, `performance/workloadCorpus.ts` | `?perf=1` handle `window.__strataPerf` |
| Diagnostics UI | `components/Settings/InteractionTracePanel.tsx`, `PerformanceSettingsTab.tsx`, HUD in `renderDrawDiagnostics` | |

### Every place that can schedule a frame

1. `CanvasArea.tsx:2621` — `useEffect([drawContent])` schedules on every
   `drawContent` identity change (doc, camera, canvas size, DPR, theme,
   motion, `redrawCount` bump).
2. `CanvasArea.tsx:2606` — `requestContentDrawRef` (engine init, compositor
   init, worker `frameRendered` reply, worker error/stop, context restore):
   schedules AND bumps `redrawCount`.
3. `CanvasArea.tsx:2594` — `requestRedraw` bumps `redrawCount` (identity
   change → effect fires).
4. `CanvasArea.tsx:2561` — `drawPendingRef` reschedule after an in-flight draw
   (runs the newest state once more).
5. `inputPipeline.ts:434` — wheel inertia rAF loop (`wheel-inertia` key).
6. `inputPipeline.ts` auto-pan (`auto-pan` key).
7. `TimelineEngine.ts:164` — its own `_scheduleFrame` for playback.
8. `context.tsx:2462` — prototype-presentation rAF loop.
9. Minimap, thumbnails, autosave and inference providers request their own
   work (not via the content key).

### Every place that clears/replaces/expands dirty state

- `dirtyRectRef.current = null` — `CanvasArea.tsx:1382` (full redraw) and
  `:1712` (after consuming).
- `lastRenderedDocRef.current = doc` — advanced only when the frame rendered
  the state's document (`CanvasArea.tsx:2540`).
- `prevCameraForRedrawRef` / `prevImageCacheStampForRedrawRef` /
  `prevFontLoadStampForRedrawRef` — advanced at `CanvasArea.tsx:2498-2504`.
- `transformCache` — `invalidateAll` on document identity change
  (`context.tsx:2128`); `nodeVisualWorldBounds` reads through it.
- `engineMemo.beginFrame` / `nodeHashMemo.beginFrame` — per-frame.
- `subtreeIrCache` — bounded LRU with adaptive byte budget.

## Root-cause analysis: where the 56/120 `clean` frames come from

The drag loop on a worker-enabled platform (Chromium/WebView2/WKWebView):

```text
pointermove -> updateDoc -> drawContent identity change -> RAF job A (geometry)
  A: doc dirty -> partial/full redraw -> posts render to worker (when bitmap stale)
worker replies frameRendered -> requestContentDrawRef()
  -> schedule job B (same key, coalesced) + setRedrawCount (new identity -> effect
     schedules job B again; coalesced by the keyed scheduler)
  B: lastRenderedDoc === doc, camera equal, stamps equal -> redrawReason 'clean'
     -> dirty 'none' -> full board clear + full visible-list traversal + full replay
```

Every worker round trip therefore produces one full-cost `clean` frame.
On WebKitGTK (worker disabled) the same `requestContentDraw`-style triggers
land directly on the main-thread replay.

Contributing causes, in order of measured impact:

1. **Worker presentation goes through the full content render path.** The
   `frameRendered` handler calls `requestContentDrawRef`, which re-enters
   `drawContent` — full `walkNodes`, dirty diff, per-node bounds, memo, hash
   and IR loop — when the only work is *compositing the already-current
   bitmap*. `resolveRedrawReason` then correctly reports `clean` (nothing was
   invalidated) but the frame still does the complete visible-list pass.
2. **`requestContentDrawRef` always bumps `redrawCount`.** The bump is a React
   state write that re-renders and re-fires the scheduling effect, so even a
   fully coalesced scheduler still ends up running `drawContent` once for the
   bump alone. With no dirty state, that single run is a full clean redraw.
3. **No suppression decision exists.** The scheduler carries no invalidation
   metadata, so nothing can distinguish "this job is a no-op" from "this job
   carries a real dirty region" before `drawContent` runs. The keyed
   scheduler coalesces duplicates; it does not decide whether a frame is
   needed at all.
4. **`drawPendingRef` reschedule re-runs the whole pass** when a trigger lands
   during an in-flight draw — usually the same worker reply already handled by
   (1), producing one more full traversal.
5. **`resolveRedrawReason` classifies rather than prevents.** `'clean'` is
   treated as a legitimate outcome ("no invalidation was needed to present
   the frame") and is recorded after the fact. The evidence shows it is used
   as a disguise for *presentation of a previously prepared frame* — which
   must not re-traverse the scene.

This matches the measured pattern: ~47% of drag frames `clean`, evenly
interspersed with `geometry-change` frames, and the clean frames disappear
only when the worker is not round-tripping (WebKitGTK shows fewer clean frames
but more main-thread cost — both observations from the runner metadata, not
new claims).

### Secondary suspect list (investigated, not implicated)

- Unconditional rAF loops: inertia and auto-pan loops are bounded and stop;
  prototype-presentation loop is gated on `state.isPresenting`.
- Hover/selection reaching the content renderer: `hoveredNode`/`snapGuides`
  are not `drawContent` deps; overlays draw on the separate overlay canvas.
- ResizeObserver churn: only fires on material size change; `canvasSize` is a
  numeric dep pair.
- Stale animation flags: `state.motion.*` deps change only during playback.
- React state subscriptions: `precomputedStyles`/`precomputedVariantCaches`
  are `useMemo`-stable per document identity.
- Unstable camera comparisons: `prevCameraForRedrawRef` compares numbers.

## Design consequences for the implementation milestones

1. **Phase 3 (scheduler):** frame requests carry structured invalidation
   metadata; the coordinator coalesces within a scheduling window, keeps all
   contributing reasons, and decides *before* `drawContent` whether a frame is
   needed. Worker presentation becomes a distinct, scene-free path. Counters:
   requested/coalesced/submitted/skipped-clean/overlay-only/content/full/
   rescheduled/stale/duplicate.
2. **Phase 4 (dirty region):** replace the single union rect with a bounded
   rect set + merge policy so two distant 20 px invalidations do not merge
   into one viewport-wide rect (the measured 67% empty-area case).
3. **Phase 6 (dirty-driven visible list):** query candidates from dirty
   regions; `prunableByDirty` becomes `rejectedByDirty` for real.
4. **Phase 9 (tracing):** `beginInteraction` must fire for wheel, pinch,
   keyboard, hover, undo/redo — the corpus gap (`pointer-move-idle`, `zoom`,
   `undo-redo` produced zero traces).
5. **Scroll path (user-reported):** wheel pan goes through `setPan` → React
   render → next-frame draw; the worker path paints a delta-compensated stale
   bitmap leaving edge streaks until the fresh frame lands; WebKitGTK
   replays everything on the main thread. Phase 3's scheduler (input lane,
   viewport-invalidation semantics) plus Phase 6's query are the fixes;
   measured in Phase 12.

## Constraints honoured

- Hub-file budgets: `CanvasArea.tsx` 3076/3162 lines, 44/47 imports;
  `context.tsx` 8131/8916 lines, 65/68 imports. New logic goes into new
  modules; `drawContent` gets a wrapper, not a growth in body.
- No second scene graph or invalidation system; the dirty-region query reuses
  `transformCache` + `visualBounds` + the existing parent index.
- No wall-clock evidence from contended runs; structural counters first.
