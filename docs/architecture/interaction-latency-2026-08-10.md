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

