# Interaction & memory hardening — session report (2026-08-02)

## 1. Repository areas inspected

- Canvas root + render hot path: `packages/editor/src/CanvasArea.tsx` (hub),
  `canvas/inputPipeline.ts`, `canvas/dirtyRegion.ts`, `canvas/invalidationPlan.ts`,
  `canvas/drawDiagnostics.ts`, `canvas/perfRuntime.ts`, `canvas/adaptiveProfile.ts`,
  `canvas/memoryBudget.ts`, `canvas/snapDiagnostics.ts` (new).
- Snapping: `tools/snapping.ts`, `tools/SelectTool.ts`, `scene/spatialIndex.ts`,
  `scene/transformCache.ts`, `shared/viewport.ts`.
- Render worker / bitmaps: `render/workerHost.ts`, `render/renderWorker.ts`,
  `render/collectImageBitmaps.ts`, `render/renderBitmapBudget.ts` (new),
  `render/faultInjection.ts` (new), `engine/src/replay.ts`, `engine/src/imageCache.ts`,
  `compositor/src/canvas2d/tileCache.ts`.
- Diagnostics: `performance/interactionTrace.ts` (new),
  `performance/performanceCollector.ts`, `canvas/inputDiagnostics.ts`.
- Infrastructure: `scripts/audit-render-perf.mjs`, `packages/editor/src/canvas/
  __benchmarks__/renderPath.bench.ts`, `move.bench.ts`, `spatialIndex.bench.ts`,
  Playwright config, `docs/perf/`.

## 2. Original interaction & rendering architecture

Input → `useCanvasInputs` (`inputPipeline`) → `ToolManager` → per-tool drag FSM →
`ctx.snapPosition` (spatial-index query + candidate filter + priority cascade) →
`setNodePosition` (document mutation) → React state → `drawContent` (per-rAF) →
cull → dirty-region → cached IR build (native/WASM) → partial/full replay
(`replaySubtreeToCtx`) or render-worker OffscreenCanvas → compositor → present.
Frames scheduled by a keyed rAF lane scheduler (input/canvas/ui/background).

## 3. Reproduction scenarios

- Dense-cluster snap: a local window of 800 small objects near the dragged
  node — measured p95 59 ms per `snapPosition` (O(k²) midpoint + spacing pair
  scans), compounded ×N selected nodes × every pointermove.
- Multi-selection drag: candidates included the other selected (moving)
  objects, so each node snapped against its own siblings.
- Worker bitmap transport: no byte accounting; `workerImageBitmaps` budget was
  dead config; stale frames completed and transferred before being dropped.

## 4. Root causes found (with evidence)

- **Quadratic snap fine-phase.** `snapping.ts` midpoint (`i<j`) and spacing
  (all ordered pairs) loops were O(k²). Measured k=100→0.42 ms, k=200→1.6 ms,
  k=400→6.0 ms, k=800→32 ms p50 (p95 59 ms) — a full frame budget in one snap
  evaluation. Fixed with sorted-centre/edge binary search (O(k log k)).
- **Multi-selection not excluded.** `filterSnapTargets` excluded only the
  dragged node; every other selected node remained a candidate.
- **Hidden nodes were snap targets** (invisible feedback).
- **Unbounded worker bitmaps.** No reservation/backpressure; over-budget
  scenes transferred arbitrarily large image maps.
- **Redraws unattributed.** Frames reported partial/full but never why, nor
  the dirty-area fraction, so redraw waste was invisible.
- **No gesture-level telemetry.** Events and frames were recorded separately;
  pointer-to-present per interaction was not measurable.

## 5. Production environment details

CachyOS Linux, kernel 7.1.3-2-cachyos, KDE / Wayland, WebKitGTK 2.52.5
(webkit2gtk-4.1), GTK 3.24.52, Mesa 26.1.6 radeonsi (AMD Lucienne/Renoir),
8 cores `performance` governor, 23.9 GB RAM, Rust 1.97.1, Node 26.4.0.
Profiler availability: gdb only (perf/valgrind not installed).
See `docs/perf/webkitgtk-profiling.md` and
`node scripts/perf/capture-webkit-env.mjs`.

## 6. Baseline latency distributions (pre-change)

- Snap fine-phase (this machine, jsdom, p50/p95): k=100 0.42 ms / 0.5 ms,
  k=200 1.6 ms / 2.8 ms, k=400 6.0 ms / 12.6 ms, k=800 32 ms / 59 ms.
- Render path (control-relative, ratios at p50): 100→0.03x, 1k→0.13x,
  10k→2.48x, 50k→9.05x full-frame (control p50 29.1 ms).

## 7. Final latency distributions (post-change)

- Snap fine-phase k=800: p95 59 ms → 1.49 ms (standalone); best-of-N median
  ratio k=800/k=100 ≈ 8.8x (quadratic would be ~64x).
- Render path unchanged (no regression): ratios within noise; 10k full-frame
  measured 2.48x → 1.79x (machine variation).
- Interaction pointer-to-present is now directly measurable via
  `window.__strataPerf.interactions`.

## 8. Snapping candidate counts before/after

No broad full-scene scan existed pre-change (spatial index already narrowed
discovery to a 200 px/zoom window), but fine-phase evaluation was O(k²) over
the local window, per selected node, per move. Candidate counts are now
recorded per `snapPosition` call (`broadPhase` / `semantic` / `fine` in
`snapDiagnostics.ts`) and exposed via `__strataPerf.snap.summary()`, so
"candidate count scales with nearby objects, not scene size" is provable.

## 9. Snapping-index architecture

Uniform 64-unit spatial hash grid (`scene/spatialIndex.ts`), rebuilt once per
document id, queried via `queryRect` over the 200 px/zoom search window.
Semantic filtering (selection members, hidden nodes, explicit exclusions)
runs before evaluation; midpoint/spacing now use sorted coordinate binary
search. Priority, hysteresis, modifiers (Ctrl/Cmd bypass), guides and
nested-editing semantics preserved and parity-tested against a canonical O(k²)
reference across randomized scenes.

## 10. Bitmap ownership and budgeting model

`RenderBitmapBudget` (`render/renderBitmapBudget.ts`): RGBA byte estimates,
reservations for outbound transfers (pending + in-flight), resident returned
frame, worker OffscreenCanvas backing store, peak high-water, admission
rejections, disposals. Owner = the render worker host; the retained frame is
owned by CanvasArea; every transfer/resident is released on close/supersede/
terminate/failure. `collectImageBitmaps` enforces a per-transfer entry cap.
Budget presets: 128 MiB default, 64 MiB low / stress-4gb, 32 MiB stress-2gb.

## 11. Worker queue and cancellation design

Single render worker, latest-wins: 1 in-flight + 1 pending (pending replaced
and its bitmaps closed on supersede); stale frames dropped and closed by
revision/identity guards; over-budget renders refused up front (main-thread
fallback, images already resident in ImageCache). One stale frame can still
complete (synchronous replay cannot be interrupted) but is discarded before
presentation and its reservation released. Failure injection (worker-start /
post-message / image-bitmap-create) verifies no retry loops and graceful
degradation.

## 12. Partial-redraw instrumentation

`FrameDiagnostics` now records `redrawReason` (clean / geometry-change /
structural-change / camera-change / image-decode / font-load /
variable-change), `dirtyAreaRatio`, `dirtyRects` (rect count before merge) and
`fullRedrawReason` (structural / camera-rotation / profile-disabled /
dirty-area-limit / no-dirty-rect). DirtyRegion.partial carries `rectCount`.
The dev HUD shows reason + dirty-area %.

## 13. Full-redraw reasons discovered

Structural container changes, camera rotation, partial-redraw disabled by
adaptive profile, dirty area > 60% of viewport, and missing dirty rect. All
are now attributed per frame; an unattributed present shows as `clean`.

## 14. Raster-tile architecture

See `docs/perf/raster-tiling-decision.md`. Scene raster layers already tile at
128 px; dirty-region partial redraw bounds repaint scope; image/worker decode
memory is byte-budgeted. A spatial tile renderer is deferred with trigger
conditions (frame-budget breach on raster subtrees, worker admission refusal,
>1024-tile layers repainting >15 fps). Remaining known gap: `replay.ts`
reconstructs the full layer OffscreenCanvas from all tiles per replay.

## 15. Tile-cache and scheduling behavior

Deferred (no spatial tile cache implemented). Existing non-spatial LRUs
(`SubtreeIrCache`, `SubtreeReplayCache`, `ImageCache`, thumbnail/font/onion
caches) are unchanged and byte/entry bounded.

## 16. Constrained-memory test results

`resolvePressureBudgets('2gb' | '4gb' | 'normal')` tightens every budget
(2gb < 4gb < normal, asserted). With the stress-2gb worker budget (32 MiB), an
8192² image transfer is refused up front (`post` returns false, bitmaps
closed, `admissionRejections` incremented, no reservation leak). All
fault-injection scenarios degrade gracefully without document mutation or
throws escaping.

## 17. Failure-injection scenarios tested

worker-start → host returns null (main-thread fallback, zero retries);
post-message → host permanently failed, bitmaps closed, `onPermanentFailure`
fired; image-bitmap-create → collection returns null (caller keeps main-thread
path); clearing the fault restores normal behavior.

## 18. WebKitGTK profiling findings

Environment captured (see §5). WebKitGTK 2.52.5; `OffscreenCanvas` and
`createImageBitmap` are now explicitly capability-detected. The render worker
is disabled on WebKitGTK in `profileForTier` (requires Worker + OffscreenCanvas
+ !isWebKitGTK), matching `createRenderWorkerHost`'s existing feature-detection
fallback. Native tooling: gdb available; perf/valgrind not installed (commands
documented). Wayland frame scheduling and canvas-acceleration differences are
flagged as watch items.

## 19. WebKitGTK-specific fixes and fallbacks

Explicit `hasOffscreenCanvas` / `hasCreateImageBitmap` capability flags;
`enableWorker` now requires both Worker and OffscreenCanvas; capability family
+ WebKit version reported for diagnostics; runbook + env capture added.

## 20. Scheduler and priority changes

None required beyond existing lane scheduler + adaptive profile (background
lane already deferred during interaction settle; `constrained` tier already
disables worker/prefetch/partial-redraw). Worker admission control is the new
backpressure on the interaction path.

## 21. Diagnostics frontend changes

`window.__strataPerf` (under `?perf=1`) now exposes snap metrics/summary,
interaction traces + slow-capture controls, frame budget, capabilities
(incl. WebKitGTK flags), and the live worker bitmap budget via a host
registry. The on-canvas HUD gained a second panel with the same data. All
disabled by default.

## 22. Memory high-water marks

Worker bitmap pipeline peak is now tracked (`peakTotalBytes`); admission
refusals prevent unbounded growth. Stress-2gb profile caps outbound transfers
at 32 MiB. ImageCache / IR caches remain byte-bounded. No long-duration
leak run was performed this session (tooling exists via `soakHarness.ts`).

## 23. Long-duration leak-test results

Not run this session; deferred. The budget/accounting unit tests assert
reservations never go negative and are released on terminate, supersede and
failure, which is the deterministic pre-condition for leak safety.

## 24. Tests and benchmark fixtures added

- `tools/__benchmarks__/snapParity.bench.test.ts` (canonical parity + scaling).
- `canvas/__tests__/snapDiagnostics.test.ts`, `redrawReason.test.ts`.
- `performance/__tests__/interactionTrace.test.ts`.
- `render/renderBitmapBudget.test.ts`, `faultInjection.test.ts`;
  extended `workerHost.test.ts`, `collectImageBitmaps.test.ts`,
  `memoryBudget.test.ts`, `dirtyRegion.test.ts`, `adaptiveProfile.test.ts`.
- `scripts/perf/capture-webkit-env.mjs`.

## 25. Commands run and results

`npx vitest run` (editor 4090 passed, shared/scene 2501, engine 3062),
`pnpm --filter @strata/editor typecheck` (clean), `biome check` on touched
files (clean), `node scripts/audit-render-perf.mjs` (no regression),
`node scripts/perf/capture-webkit-env.mjs` (verified). Full `pnpm test` was
not run end-to-end because `packages/engine` is being edited concurrently by
another agent; the flaky snap scaling gate was reworked (median + best-of-N)
and re-verified.

## 26. Known limitations

- One stale worker frame can still complete (synchronous replay is not
  interruptible); it is dropped pre-presentation and released.
- Context-loss frame closure on the CanvasArea side is not reflected in the
  host resident accounting until the next forward or terminate (single-frame
  transient over-count during a rare recovery path).
- Pointer-to-present is measured by time-window correlation; a frame commit
  in a different rAF cycle near the gesture boundary can be attributed to an
  adjacent interaction.
- No spatial tile renderer (deferred, see §14).
- No long-duration leak run this session.

## 27. Deferred improvements and rationale

- Spatial raster-layer tile cache — bounded memory + partial redraw already
  meet the DoD; triggers documented in `raster-tiling-decision.md`.
- Worker `cancel` post — no effect with a single synchronous-replay worker;
  the stale frame is already discarded before presentation.
- Full diagnostics React panel — the `__strataPerf` handle + on-canvas HUD
  cover probes/E2E with less surface and zero overhead when closed.
- Long-duration leak soak — needs a GUI/headed session.

## 28. Commit hashes and pushed milestone summary

Session commits (master): `8b397093` (snap prefilter, combined with concurrent
export work), `3c7468c0` (worker bitmap budget), `0818d96b` (redraw
attribution), `af0df423` + `84434f23` (snap scaling gates), `7374fd18`
(interaction tracing), `a3d6eed9` (pressure profiles + failure injection),
`e2b14162` (WebKitGTK profiling support), `ee3008de` (diagnostics surface),
plus `docs/perf/raster-tiling-decision.md` (this session). Not pushed to
origin (18 commits ahead); pushing is left to the maintainer's workflow.
Several commits interleave with the other agent's export milestones due to
concurrent committing and pre-commit ref-lock races.

## 29. Confirmation that unrelated work was preserved

The other agent's in-progress work (`packages/engine/src/exportPipeline/*`,
`packages/scene/src/export/*`, `packages/shared/src/exportContracts.ts`,
`docs/architecture/alpha-aware-shadows.md`, `tests/e2e/effects/...`) was never
modified, reverted or committed by this session except where a concurrent
`git commit -am` swept staged editor files into one of their commits; the
editor files' content was verified intact in HEAD. All editor-only changes
were committed via explicit path lists.
