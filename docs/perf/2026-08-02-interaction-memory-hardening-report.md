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
terminate/failure. Canvas-side disposal calls the host's identity-aware
`releaseFrame` before `ImageBitmap.close()`, including context loss, stale
responses, replacement and duplicate disposal. `collectImageBitmaps` enforces
a per-transfer entry cap.
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
It also records the merged partial dirty rectangle in backing-store pixels and
draws that rectangle over the canvas. The diagnostics ring can be frozen and
resumed through the opt-in `__strataPerf` handle without mutating document state.

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
disabled by default. Interaction summaries now expose p50/p75/p90/p95/p99/max
distributions for total and pointer-to-present latency. Traces use schema
version 1, retain at most 50 interactions, 512 spans and 240 frames per
interaction, and count dropped samples after those caps. The real-browser
diagnostics probe can freeze the current frame for inspection.

## 22. Memory high-water marks

Worker bitmap pipeline peak is now tracked (`peakTotalBytes`); admission
refusals prevent unbounded growth. Stress-2gb profile caps outbound transfers
at 32 MiB. A deterministic ownership test confirms resident accounting returns
from 4 bytes to zero when CanvasArea closes a forwarded 1x1 frame, and a second
release is harmless. In the 24-iteration Chromium interaction soak, the worker
budget settled at zero pending/in-flight bytes, 1,440,384 resident bytes, and a
1,500,400-byte high-water mark against a 134,217,728-byte budget. ImageCache /
IR caches remain byte-bounded.

## 23. Long-duration leak-test results

A real-browser bounded soak ran 24 alternating middle-button pans over 12
canvas nodes and sampled Chromium's JS heap after forced collection every four
iterations. The previous-window median was 75,264,924 bytes and the final-window
median was 75,914,468 bytes: +649,544 bytes (0.62 MiB). The run retained 86/120
frame records and 25/50 interaction traces; the largest trace had eight spans
and three frame records. Worker pending and in-flight bytes both returned to
zero. This 26-second smoke rejects gross application-resource growth but is not
a claim of a multi-hour native RSS plateau; allocator/GPU/OS retention still
needs a headed WebKitGTK release soak.

## 24. Tests and benchmark fixtures added

- `tools/__benchmarks__/snapParity.bench.test.ts` (canonical parity + scaling).
- `canvas/__tests__/snapDiagnostics.test.ts`, `redrawReason.test.ts`.
- `performance/__tests__/interactionTrace.test.ts`.
- `render/renderBitmapBudget.test.ts`, `faultInjection.test.ts`;
  extended `workerHost.test.ts`, `collectImageBitmaps.test.ts`,
  `memoryBudget.test.ts`, `dirtyRegion.test.ts`, `adaptiveProfile.test.ts`.
- `scripts/perf/capture-webkit-env.mjs`.
- `canvas/__tests__/perfRuntimeTracing.test.ts` (one interaction ID across
  render queue, main render, and frame commit).
- Extended interaction-trace tests for schema/caps, dropped-sample counts,
  async completion, delayed presentation, slow-only retention, and percentile
  distributions.
- Extended draw-diagnostics tests for dirty-rectangle DPR conversion,
  visualization, freeze, and resume.
- `tests/e2e/canvas/performance-diagnostics.spec.ts` drives a real Chromium
  drag and verifies snap spans, bounded trace data, partial dirty-region
  capture, distribution ordering, and frame freeze.
- `tests/e2e/canvas/performance-soak.spec.ts` drives 24 real pointer pans,
  forces/samples Chromium garbage collection through CDP, asserts trace/frame
  caps and settled worker reservations, and attaches a versioned JSON sample.

## 25. Commands run and results

Earlier milestone checks: `npx vitest run` (editor 4090 passed, shared/scene
2501, engine 3062), `node scripts/audit-render-perf.mjs` (no regression), and
`node scripts/perf/capture-webkit-env.mjs` (verified). The bitmap-disposal
milestone then passed the full `pnpm test` suite: 904 files passed, one skipped;
11,091 tests passed, three skipped. The correlated-trace/dirty-overlay
milestone passed 31 focused Vitest tests and the real Chromium Playwright spec
(one passed, 12.9 s), plus scoped Biome, emoji, diff-integrity, editor
typecheck, and the architecture/pre-commit health gate. `pnpm audit:tokens`
passed 123/123 checks across all themes. The repository has no
`pnpm format-check` command, so touched files were formatted and checked with
scoped Biome. A final whole-worktree `pnpm typecheck` was blocked by active,
unrelated `packages/shared/src/colorConversion.test.ts` literal-widening errors
at lines 429–433. `pnpm lint` was likewise blocked by active Menubar debug code
and existing repository warnings; the touched performance files were clean.
The existing 50-shape create/delete Chromium pressure test passed. The new
24-iteration Chromium soak passed in 25.9 s (a repeat used to extract the JSON
sample passed in 23.5 s). A Playwright WebKit run was attempted but could not
start because the WebKit browser binary is not installed on this host; this is
separate from the native WebKitGTK environment capture/runbook.

## 26. Known limitations

- One stale worker frame can still complete (synchronous replay is not
  interruptible); it is dropped pre-presentation and released.
- Pointer-to-present accepts the first frame committed up to 250 ms after an
  interaction ends. This covers pointer-up before the next rAF, but the single
  pending slot can be superseded by a newer rapidly completed interaction.
- Worker processing and OS compositor presentation do not yet have calibrated
  cross-process spans; `render.queue` and `render.main` are correlated on the
  webview main thread.
- The dirty overlay shows the merged region, not every pre-merge region or the
  exact repainted-node set.
- No spatial tile renderer (deferred, see §14).
- No multi-hour native RSS/allocator leak run this session.

## 27. Deferred improvements and rationale

- Spatial raster-layer tile cache — bounded memory + partial redraw already
  meet the DoD; triggers documented in `raster-tiling-decision.md`.
- Worker `cancel` post — no effect with a single synchronous-replay worker;
  the stale frame is already discarded before presentation.
- Full diagnostics React panel — the `__strataPerf` handle + on-canvas HUD
  cover probes/E2E with less surface and zero overhead when closed.
- Multi-hour native RSS/allocator soak — the new Chromium test covers a short,
  deterministic application-level plateau only and the native run needs a
  GUI/headed release session.

## 28. Commit hashes and pushed milestone summary

Session commits (master): `8b397093` (snap prefilter, combined with concurrent
export work), `3c7468c0` (worker bitmap budget), `0818d96b` (redraw
attribution), `af0df423` + `84434f23` (snap scaling gates), `7374fd18`
(interaction tracing), `a3d6eed9` (pressure profiles + failure injection),
`e2b14162` (WebKitGTK profiling support), `ee3008de` (diagnostics surface),
`7acc9007` (tiling decision/report), `84434f23` (stable scaling gate),
`9ba1083f` (architecture map/budgets), `697cf59a` (disposed-frame accounting),
`734f9821` (bounded correlated traces and dirty-region overlay/E2E), and
`c4af7a21` (bounded real-browser interaction soak). `9ba1083f` was pushed to
`origin/master`. The later performance commits remain local because unrelated
collaborators' commits are ancestors on the shared `master`; pushing them would
also publish work outside this task.
Several earlier commits interleave with other agents' milestones due to
concurrent committing and pre-commit ref-lock races.

## 29. Confirmation that unrelated work was preserved

Concurrent accessibility, color-picker, focus-navigation, and editor UI work
was not modified, reverted, cleaned, stashed, or included in the performance
commits. Performance commits used explicit path lists. The shared branch's
unrelated staged and unstaged work remained present after each milestone.
