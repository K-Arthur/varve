# Interaction Latency & Input-Feel Work — 2026-08-10

Audit-driven pass over Varve's interactive canvas/input pipeline: measure
first, then fix only what measurements justified. This document records the
pipeline map, the measured findings, the fixes, and the validation matrix.

## Interaction pipeline map

### Object drag (move)

```
PointerEvent → inputPipeline.handlePointerMove → dispatchToTool('move')
→ ToolManager → SelectTool.onDragMove
→ world delta (drag origin + current world)
→ snap prefilter (spatial index, per-gesture) → snap evaluate (bounded targets)
→ setNodePositions (ONE document update, single nodes-map spread)
→ React render → invalidation plan → dirty region → canvas frame
→ engine IR replay → compositor → present
```

### Trackpad / wheel pan

```
WheelEvent → wheel gesture classifier (sequence-aware) → resolveWheelAction
→ panBy (stateRef advanced synchronously; React batches the commit)
→ canvas frame → replay → present
```

### Pinch zoom

```
pointer samples → centroid + distance → anchor world point (current camera)
→ zoomAboutPoint → commitCamera (stateRef + React) → canvas frame → present
```

### Keyboard nudge

```
keydown/repeat → shortcut routing → SelectTool.onKeyDown
→ one transaction per gesture (first keydown begins, keyup commits)
→ executeNudge (batched setNodePositions) → doc mutation → redraw → present
```

### Auto-pan (edge drag)

```
held pointer near edge → computeEdgeVelocity (proximity-ramped)
→ per-frame tick: panBy (stateRef) → re-dispatch held pointer against the
  NEW camera → object re-locked to the world point under the pointer
→ canvas frame → present
```

## Measured findings (baseline)

| Finding | Evidence | Fix |
| ------- | -------- | --- |
| `editor.canvasToWorld` resolved against render-closure `state`; auto-pan re-dispatch used a one-tick-stale camera | E2E probe: dragged object lagged the pan by ~17px under 50ms frame times; the §34 "drag origin on old camera" failure mode | Resolve against `stateRef.current` (context.tsx) |
| O(N·depth) snap-target walk per render in SelectionOverlay | Audit: `snapOptions` useMemo keyed on document re-ran every render, even during SelectTool drags where snap is never consulted | Build once per handle-drag gesture; release on pointerup |
| N×O(N) nodes-map spreads per sample for multi-node gestures | Audit: `setNodePosition` per node per sample; 50-node selection on 10k-node doc ≈ 500k spreads per pointermove | `setNodePositions` / `updateNodes` batch APIs — one spread per sample (SelectTool drag, nudge, ScaleTool) |
| O(N) document walk on every keydown | Audit: paint-order DFS built for Tab cycling on every keystroke | Build lazily on Tab/Enter/F2 |
| Double OS momentum on fast trackpad flicks | Wheel deltas of 60–120px land in the classifier's ambiguous band → app inertia added on top of OS momentum | Sequence-aware wheel-gesture classifier with burst/hysteresis; `applyInertia` follows the gesture |
| Nudge announced once per OS key-repeat (~30 Hz) | Audit: `announceOperation('Nudge')` per repeat | Announce once per gesture (first keydown) |
| SnapGuidesOverlay re-rendered per sample with empty guides | Audit: fresh `[]` identity per sample | Stable frozen empty array |
| Two smooth-camera RAF loops could fight | Audit: `editor.smoothZoomTo` and `useViewport().smoothZoomTo` with separate animRefs | Share `panAnimationRef` (latest input wins) |
| Stale `getByTitle` mask-badge locators | Tooltip migration removed native title attributes; two tools.spec tests failed unconditionally | Target `role=img` + aria-label |
| Crash-recovery gate blocked E2E runs after interrupted tests | Safe-mode flag + recovery dialog left by crashed runs | `navigateToEditor` clears safe mode / dismisses recovery dialog |

## Verified non-issues

- All fit-all paths (Shift+1, StatusBar button, Minimap dbl-click, fit
  selection, nested frames, decode-in-flight, multi-image) render imported
  photos correctly in Chromium (8 E2E tests). The intermittent failures seen
  during the pass were environment-driven (concurrent test load, crash-gate,
  dev-server death), not code paths.
- Auto-pan velocity is time-based; navigation physics use exponential decay
  with clamped dt (refresh-rate independent).
- Nudge transaction boundaries are correct (one undo per gesture, key-repeat
  coalesced).
- Modifiers are live during drags (ToolManager updates per key event, session
  re-frozen on the next pointer sample).

## Validation

### Unit (editor tools/canvas/commands/context)

1029 passed / 1 skipped across tools, commands, canvas, context,
SelectionOverlay, redraw-on-doc-change. All pre-commit gates passed on every
commit (format, emoji, audit-health: context.tsx 70 imports, +0).

### E2E (Chromium)

- `drag-precision.spec.ts` (new): multi-select drag lands on the exact
  pointer delta; auto-pan moves the camera (minimap signature) while the
  dragged object stays locked to the pointer (≤6px; pre-fix 15–20px) with no
  jump on release.
- `image-fit-all.spec.ts` (extended): 8 tests, all fit-all paths.
- `nudge.spec.ts`, `tools.spec.ts` (incl. mask tests): pass.

### Platform matrix

| Platform | Status |
| -------- | ------ |
| Chromium harness (Linux) | Verified (E2E above) |
| Firefox / WebKit browser | NOT RUN — environment contention |
| Native Tauri (Linux/WebKitGTK) | NOT RUN — not exercised this session |
| Windows / macOS | NOT RUN |

## Remaining limitations

- One-tick camera staleness residual (~2–6px) remains in the auto-pan
  re-dispatch because the tool context still captures the editor object per
  event; the dominant term (render-state camera) is fixed. Further reduction
  would thread the live camera directly into `buildToolContext`.
- The wheel trajectory classifier is unit-tested but not yet validated
  against real Mac trackpad / Windows precision-touchpad event streams.

## Follow-up pass (2026-08-10, evening) — remaining limitations addressed

| Item | Status |
| ---- | ------ |
| Background work yields during interaction (§50) | **Done.** The frame scheduler's interaction depth is now live: inputPipeline opens/closes it around pointer gestures and wheel bursts (150 ms quiet window) and force-resets it on blur/visibility loss. Viewport prefetch and the thumbnail scheduler re-schedule their idle work while an interaction is open (bounded deferrals, so a stuck interaction can never starve them). |
| ScaleTool per-sample parent-space recompute | **Done.** Parent space matrices cached per parent per sample (N nodes under one parent pay one ancestor-chain walk instead of N). |
| Auto-pan residual | **Measured.** Quiet-machine probe: 0.4 px residual (React-commit latency on the overlay box, not a systematic camera error). Closed as inherent to the render-driven overlay. |
| Firefox validation | **Done.** drag-precision + nudge specs pass 9/9 on Playwright Firefox. |
| WebKit validation | **NOT RUN — host limitation.** Playwright's bundled WebKit (WPE build) requires ICU 74 versioned symbols (`ureldatefmt_format_74`); the host ships ICU 78 and the system lacks WebKitGTK-6.0. Symbol shims cannot bridge a versioned-ABI break; install requires root. The Linux Tauri runtime (WebKitGTK 2.52) remains the intended validation target for WebKit semantics. |
| Native Tauri | **In progress externally** — dev server port freed for `tauri:dev`. |


## Follow-up pass (2026-08-11) — user-reported canvas feel

Triggered by a report of two symptoms on a 13-image document: images that
"only load when you zoom in on that particular image" (worst after fit-all),
and scrolling that "lags and leaves after effects". Both reproduced in the
Chromium harness with 12 spread images and were the **same** root cause, in
the render path rather than the input path.

### Findings

| Finding | Evidence | Fix |
| ------- | -------- | --- |
| A document over the worker image-transfer budget froze on the last accepted worker bitmap | 12 spread images, fit-all at 6% zoom: painted coverage 0.004, 33 distinct colours (one image of twelve). The identical run with 8 images — one under the budget of 10 — gave 0.195 / 988. | `admitWorkerImagePayload` makes every worker-refusal reason a synchronous decision shared by the paint gate and the transfer path, so a frame with no worker render coming takes the authoritative main-thread replay instead of compositing stale pixels. See `docs/architecture/render-pipeline.md` → "Reuse of already-painted pixels". |
| The source-count budget counted resident sources | A fully resident scene was refused forever: a refused frame transfers nothing, so residency could never grow past the cap. | Count only sources that still need transferring. |
| Drag threshold scaled by zoom | `BaseTool` compared `clientX/Y` deltas (CSS px) against `3 / zoom`: 50 CSS px of travel required before anything moved at 6% zoom, 0.19 px at 1600%. Affected every tool. | Screen-space constant. `zoomAwareDragThreshold` renamed `worldDistanceForCssPixels` — the maths was right, the application space was not. |
| SelectionOverlay ignored camera rotation | Handles and handle-drag pointer mapping went through `simpleScreenToWorld` / `simpleWorldToScreen`. At rotation 0 these equal the renderer's affine, so it was invisible until the view was rotated. | Shared rotation-aware `screenToWorld` / `worldToScreen` with the canvas viewport. |

### Measurements (Chromium harness, 12 images, 1280x800)

| Metric | Before | After |
| ------ | ------ | ----- |
| Painted coverage after fit-all | 0.004 | 0.294 |
| Distinct colours after fit-all | 33 | 4252 |
| Stale pixels after wheel scroll (4 bursts) | not measured before the fix | 0 — surface hash identical to a forced full redraw at the same camera in all 4 bursts |
| Wheel input-to-present | — | p50 0.9 ms, p75 1.7 ms |

The stale-pixel oracle (hash → `__strataPerf.forceFullRedraw()` → hash) is the
check to run when touching pixel-reuse logic; it is what proves the "after
effects" are gone rather than merely less visible.

### Note on the scroll complaint

The perceived scroll lag was not input latency — the wheel path was already
fast (p50 0.9 ms input-to-present) and its physics were already time-based.
It was the reprojected stale bitmap: content that does not track the camera
reads as lag no matter how quickly the input is processed. Frame-rate and
handler-time metrics alone would never have found this, which is why the
oracle compares *pixels* against an authoritative redraw.

### Validation

| Item | Status |
| ---- | ------ |
| Unit: `admitWorkerImagePayload`, drag threshold across 9 zoom levels, overlay/renderer camera agreement across 5 cameras | PASS. The overlay test fails 4/6 against the old transform and passes 6/6 after; the 2 that pass either way are the unrotated cases the old code got right. |
| E2E `many-image-render.spec.ts` (Chromium) | PASS |
| Workspace typecheck (15 packages + e2e) | PASS — 0 errors (was 7, all pre-existing) |
| Native Tauri / WebKitGTK | NOT RUN. The user's report came from that runtime; the fix is renderer-path logic shared by both, but the WebKitGTK worker-eligibility path differs and remains unverified here. |
| Firefox / WebKit browser | NOT RUN this pass |

## Follow-up pass (2026-08-16) — trace metadata enrichment

The interaction trace recorded frame timing but lacked metadata about
what *kind* of frame was committed and which render revision produced
it. This made it impossible to distinguish a full scene replay from a
scene-free worker bitmap composite in the trace, or to detect stale-frame
presentation.

### Changes

| Item | Status |
| ---- | ------ |
| `FrameDiagnostics` gains `renderRevision` and `frameDecision` fields | **Done.** `drawDiagnostics.ts` — optional fields so pre-existing frame records stay valid. |
| `recordFrame` passes `frameDecision` as frame disposition | **Done.** `perfRuntime.ts` — the coordinator's `skip`/`present`/`content` decision is forwarded through `notifyFrameCommit` as the `FrameDisposition` on each `InteractionFrameSample`. |
| Content and present paths carry disposition | **Done.** `renderPipeline.ts` (content frames) and `presentWorkerFrame.ts` (worker-present frames) both pass `frameDecision: decision.kind`. |
| Render revision available in present path | **Partial.** `renderRevision` is passed when present in `FrameDiagnostics`; the worker-present path does not yet surface the worker's render revision at the `recordFrame` call site (the revision is tracked in `workerHost.ts` but not threaded through `PresentWorkerFrameArgs`). The `docVersion` is already tracked and serves a coarser staleness signal. |
| Tests | **Done.** Two new tests in `perfRuntimeTracing.test.ts` verify disposition and render revision propagation. 107 tests pass across performance and canvas modules. |

### Trace schema change

Each `InteractionFrameSample` in the trace ring now optionally carries:
- `disposition?: 'caused' | 'coalesced' | 'superseded' | 'cancelled' | 'dropped' | 'replaced' | 'reused' | 'background'` — the coordinator's frame decision kind, telling consumers whether the frame was a full content replay, a scene-free worker bitmap composite, or suppressed
- `renderRevision?: number` — when available, the render revision at commit time

This does not change the trace schema version (still v2) because both
fields are optional and backward-compatible.

### Validation

| Item | Status |
| ---- | ------ |
| Unit: interaction trace (20 tests) | PASS |
| Unit: perfRuntime + tracing (3 tests, incl. 2 new) | PASS |
| Unit: drawDiagnostics (18 tests) | PASS |
| Unit: renderPipeline baseline (2 tests) | PASS |
| Format/lint (Biome) | PASS |
| Emoji audit | PASS |
| Health audit | PASS |
| Native Tauri / WebKitGTK | NOT RUN |
| Visual regression | No visual change — pure instrumentation |

## Follow-up pass (2026-08-16) — DOM layout read caching + cursor scheduling

Two structural performance improvements targeting the input→visible pixel
latency path.

### 1. Canvas rect caching (commits `b6f876a8`, `74920f2b`)

The single highest-frequency DOM layout read in the application was
`getBoundingClientRect()` inside `canvasToWorld()`, called on every
pointer-move for every tool. Additional uncached reads existed in the
touch pinch handler, auto-pan edge velocity, wheel zoom, and Tauri
pinch bridge.

| Call site | Before | After |
|-----------|--------|-------|
| `toolContext.ts:163` — `canvasToWorld` (every pointer-move) | `getBoundingClientRect()` per call | Cached `canvasRectRef.left/top` |
| `inputPipeline.ts:324` — touch pinch (every touch-move) | `getBoundingClientRect()` per call | Cached |
| `inputPipeline.ts:407` — auto-pan edge velocity | `getBoundingClientRect()` per call | Cached |
| `inputPipeline.ts:543` — wheel zoom | `getBoundingClientRect()` per call | Cached |
| `inputPipeline.ts:755` — Tauri pinch bridge | `getBoundingClientRect()` per call | Cached |

The cache is updated by `ResizeObserver` (canvas resize) and refreshed
at gesture start (`pointerdown` / `buildToolCtx`). The canvas position
is stable during gestures — it only changes on resize or window move.

`CanvasRect` type and `canvasRectRef` added to `ToolContextDeps` and
`UseCanvasInputsOptions`.

### 2. Cursor position frame scheduling (commit `907d7c9a`)

The cursor position (`StatusBar` coordinates, collab presence) was
updated at ~31 Hz via a fixed 32ms throttle regardless of display
refresh rate. On a 120 Hz display this meant cursor updates lagged
3-4x behind the actual display cadence.

Replaced with `requestAnimationFrame`-scheduled updates: latest pointer
world position wins, at most one `setCursorPos` per animation frame.
This matches the display refresh rate (60/120/144 Hz) and eliminates
the fixed-time bottleneck.

`cursorPos` feeds `StatusBar` coordinates and `useCollabPresence` —
neither needs sub-frame accuracy. Frame scheduling is the correct
semantic for this kind of latest-state update (task brief §6).

### 3. Multi-select Ctrl+drag fix (commit `32e0f04c`)

The Ctrl+Click deep-select handler (C3 in SelectTool) replaced the
entire selection with just the clicked node whenever Ctrl was held,
even when the clicked node was already selected. This broke multi-select
drags where Ctrl is held to bypass snapping — only the clicked node
moved.

Fix: when the deep target is already selected AND the selection has
more than one node, preserve the current multi-selection. Single-select
Ctrl+click on an already-selected child still re-asserts selection
authoritativeness (fixes container-hit layers-panel staleness).

Condition: `!isSelected(target) || selection.length <= 1`

| Scenario | Before | After |
|----------|--------|-------|
| Single-select + Ctrl+click on already-selected | Replaces (authoritative) | Replaces (unchanged) |
| Multi-select + Ctrl+drag on already-selected | Replaces (breaks drag) | Preserves (moves all) |

### Validation

| Item | Status |
| Unit: canvas + tools + performance (916 tests) | PASS |
| Unit: SelectTool (58 tests) | PASS |
| E2E: drag-precision multi-select + auto-pan (2 tests) | PASS |
| Format/lint (Biome) | PASS |
| Emoji audit | PASS |
| Health audit | PASS |
| Native Tauri / WebKitGTK | NOT RUN — user to verify |
| Visual regression | No visual change — interaction fix |
