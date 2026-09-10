# WebKitGTK render path — proof, capability findings, and the worker policy — 2026-08-07

Investigation into canvas after-images and interaction lag on the Linux/Tauri
(WebKitGTK) desktop target. This document records what was **measured**, what
was **found by code audit**, and what could **not** be established on this host.

Companion documents:
[`webkitgtk-profiling.md`](webkitgtk-profiling.md) (runbook),
[`2026-08-03-scroll-latency-and-stale-pixels.md`](2026-08-03-scroll-latency-and-stale-pixels.md)
(the surface-identity fix this work treats as a regression boundary).

---

## 1. Host contamination — read this before any latency number

Every measurement below was taken on a host in the following state:

| Field | Value |
|---|---|
| Load average (1/5/15) | **51.6 / 55.2 / 48.2**, later 63.7 |
| Logical CPUs | 8 |
| Memory available | 1.8 GB of 23.3 GB |
| **Swap in use** | **20.5 GB of 23.3 GB** |
| Competing processes | 14 `opencode` agents, 17 `chrome-headless`, 30 `helium` |
| CPU governor | performance |

`run-production-workload.mjs` classifies a run as `contended` at
`load1 > CPU_COUNT * 1.5` (= 12). This host is **4.3x above that threshold**
and actively swapping.

**Consequence:** no wall-clock latency figure taken on this host is acceptance
evidence, and none is presented as such. Per the investigation constraints, no
competing process was killed to obtain a quiet window. The correctness and
capability findings below are load-insensitive (they are categorical: does an
API work, do pixels match) and stand on their own.

---

## 2. Runtime path — proven, not inferred

Measured by loading the **production bundle** in the *system* `webkit2gtk-4.1`
(the exact library Tauri links) and reading the app's own diagnostics handle.

```
Runtime:                 WebKitGTK 2.52.5 / GTK 3.24.52, Wayland (KDE)
User agent:              AppleWebKit/605.1.15 Version/60.5 Safari/605.1.15
engine:                  webkit          (isWebKitGTK: true)
Worker available:        true
OffscreenCanvas present: true
OffscreenCanvas VERIFIED: true           (probe: transferred, pixels verified, 41 ms)
Render worker host created: true         <-- not null; creation succeeded
Worker policy allowed:   false
Fallback reason:         webkit-policy
Actual renderer:         main-canvas2d

Summary: "webkit -> main-canvas2d (webkit-policy)"
```

Two corrections to plausible assumptions:

1. **`createRenderWorkerHost` did not return `null`.** Its own
   `typeof OffscreenCanvas === 'undefined'` feature-detect passes on this
   engine. The worker is disabled purely by the *profile policy*
   (`!caps.isWebKitGTK` in `profileForTier`), one gate earlier.
2. **The UA version is useless for gating.** WebKitGTK reports the frozen
   Safari-compatibility token `605.1.15` regardless of the real library
   version (2.52.5). Any version-keyed gate would be keyed on a constant.

---

## 3. OffscreenCanvas on WebKitGTK 2.52.5 — all gates pass

Probed in the real engine with a disposable worker
(`reports/webkit-probe/offscreen-capability-2026-08-07.json`).

| # | Gate | Result |
|---|---|---|
| 1 | `Worker` supported | PASS |
| 2 | `OffscreenCanvas` defined (main + worker) | PASS |
| 3 | Constructed **inside a worker** | PASS |
| 4 | Canvas2D context acquired in worker | PASS (`OffscreenCanvasRenderingContext2D`) |
| 5 | Representative replay (rects, béziers, gradients, composite ops, text) | PASS |
| 6 | `transferToImageBitmap()` | PASS |
| 7 | Transferred back to main thread | PASS (`ImageBitmap` arrives) |
| 8 | **Pixels correct after transfer** | **PASS — exact RGBA match, 4/4 quadrants** |
| 9 | Repeated frames (1,000 across 10 batches) | PASS, no degradation |
| 10 | Resize (640x480 -> 800x600) | PASS |

Both **classic and module** workers construct. Varve's render worker is a
module worker, so this matters.

**The blanket WebKitGTK worker ban is outdated for 2.52.5.** It was a
reasonable answer to "OffscreenCanvas support is unreliable across point
releases", but it is a permanent answer to a temporary question, and nothing
re-evaluated it.

### Worker vs main-thread replay (contended host — indicative only)

| Path | replay p50 | replay p95 |
|---|---:|---:|
| Worker OffscreenCanvas | 1 ms | 3 ms |
| Main-thread Canvas2D | 1 ms | 3 ms |

Both sit at the clock's resolution floor (see §4). This says **nothing** about
whether the worker path reduces perceived latency — its value is moving work
off the main thread, which requires main-thread-blocked-time measurement on an
uncontended host to establish.

---

## 4. Measurement limitation: `performance.now()` is quantised to 1 ms

Measured directly in WebKitGTK 2.52.5:

```
minimum non-zero delta: 1.0 ms
distinct observed deltas: 1.000000, 2.000000
```

Chromium resolves to ~5 µs. **On WebKitGTK every sub-millisecond span in
Varve's interaction traces is unmeasurable**, and a reported `0 ms` or `1 ms`
means "below clock resolution", not "fast". Summing many 1 ms-quantised spans
accumulates systematic error.

This affects `pointer.input`, `interaction.dispatch`, `snap.*`, `render.main`
and the worker clock calibration. Any WebKitGTK phase attribution must either
aggregate over many samples or be labelled `lower-bound`.

### Frame pacing (idle, 1280x800)

| Metric | Value |
|---|---:|
| rAF interval p50 | 16 ms (60 Hz display) |
| rAF interval p95 | 19 ms |
| First three intervals | 158, 129, 42 ms (startup) |
| With main-thread draw every frame: p50 / p95 / max | 16 / 20 / 108 ms |

---

## 4b. After the change — worker path active on WebKitGTK

Same harness, same engine, production bundle, **no opt-in flag**, driving a
real wheel-pan plus pointer drag in the editor:

```
Summary:                   "webkit -> worker-offscreen-canvas2d"
Worker policy allowed:     true
Fallback reason:           none
Frames observed:           worker-cached 39, compositor 2
Redraw reasons:            camera-change, clean
OffscreenCanvas probe:     offscreen-supported, pixels verified, 69 ms
```

The two `compositor` frames are the warm-up before the first worker bitmap
arrives — expected, since the worker cannot present a frame it has not yet
rendered. Every subsequent interaction frame came from the worker.

---

## 5. Ghosting — findings

### Reproduced: YES, on the main-thread path

`scripts/perf/webkit/run-ghosting-oracle.py` performs a gesture, captures the
content canvas, calls `forceFullRedraw()` (same document, same camera),
captures again, and compares. Any differing pixel is one the incremental path
got wrong.

Fixture `perf-vector-100` (100 nodes, checksum `fnv1a32-a70c2c0b`), canvas
682x645, WebKitGTK 2.52.5 / Wayland:

| Gesture | Main-thread (`?webkitWorker=0`) | Worker path (default) |
|---|---|---|
| object drag | **4,800 px differ, maxDelta 202** | 0 |
| drag + auto-pan | 0 | 0 |
| pure pan | 0 | 0 |
| zoom | 0 | 0 |

The drag residue is **deterministic** — identical across three runs: 4,800
pixels, `maxDelta` 202, bounding box `{x: 420, y: 288, w: 196, h: 40}`. A
`maxDelta` of 202 is a wholly different colour, not antialiasing.

This is the reported symptom, on the reported runtime, in the code path every
Linux user was on before this change. Note that "after-image" turned out to be
the wrong mental model for it — see the root cause below, which is the reverse:
pixels were being *erased*, not retained.

**The oracle is sensitivity-checked, not merely green.** A control step paints
a 140x90 magenta rectangle directly onto the surface and forces the repaint;
the oracle detects it (12,600 px, bbox exactly `{12, 12, 140, 90}`) on every
run. Each gesture also reports how many pixels it actually moved, so a gesture
that grabbed nothing cannot masquerade as a pass — the initial run was caught
this way (`drag` moved 0 px until the hit point was computed from the fixture's
140px grid instead of guessed).

### Root cause — the prune region did not cover the cleared region

Two experiments killed the obvious hypotheses:

| Variant | Residue | Conclusion |
| --- | ---: | --- |
| drag, partial redraw | 4,800 px | baseline |
| drag, **full redraw every frame** | 3,360 px | not the partial-redraw path |
| drag in 2px steps instead of 8px | 4,800 px | not per-frame displacement |

Cropping the differing region and looking at it settled the question. The
residue is **not** a ghost — it is the *opposite*. Neighbouring rectangles were
reduced to their top and right edge slivers, interiors missing; the forced
repaint restored them as solid fills. Pixels were being **erased**, not
retained.

`computeDirtyPruneDecision` (`canvas/dirtyQuery.ts`) returned two regions:

- `screenRects` = `worldRectsToScreen(merged.rects, …, margin = 40)` — what the
  paint path **clears and clips**;
- `worldRects` = `merged.rects`, **unexpanded** — what selects nodes for
  **replay**.

So a 40-screen-pixel band was cleared on every partial frame but never
replayed. A node inside that band was erased outright; a node straddling its
boundary kept only the sliver lying outside the cleared area — exactly the edge
slivers observed.

This is the same invariant the module's own header states ("pruning without a
partial paint … erases every node outside the dirty region"), violated in the
other direction: the paint cleared *more* than the prune replayed.

**Fix:** `worldRects` is now expanded by the world-space equivalent of the same
margin, derived from `worldToScreen` itself so the two cannot disagree about
the camera, with the margin hoisted to a shared `DIRTY_SCREEN_MARGIN` constant.
Over-inclusion replays a few extra nodes; under-inclusion destroys pixels.

**Verified after the fix**, same harness, same fixture, main-thread path:

| Gesture | Before | After |
| --- | ---: | ---: |
| object drag | 4,800 | **0** |
| drag, full redraw per frame | 3,360 | **0** |
| drag, small steps | 4,800 | **0** |
| drag + auto-pan / pan / zoom | 0 | 0 |

Corroboration: `gestureMovedPixels` for the drag fell from 10,944 to 6,144 — a
drop of exactly 4,800, the residue count. 6,144 is 2 x (64x48), one object's
old plus new footprint, which is precisely what a clean move should touch.

### Why the existing Chromium oracle never caught it

`tests/e2e/visual/partial-redraw-oracle.spec.ts` computes its pruned subsets
**in the spec**, with its own copy of the bounds rule — by design, so it
validates the pruning *contract* rather than the query implementation. It
therefore never executes `computeDirtyPruneDecision` and could not observe the
margin mismatch. The new unit tests in
`canvas/__tests__/surfaceValidity.test.ts` call the production function
directly, including at 2x and 0.5x zoom where the world-space margin scales.

The existing surface-identity fix (`9d47771b`) was audited and is treated as a
regression boundary; nothing here weakens it.

### Finding G1 (code audit, not yet reproduced): reprojected worker frames claim an authoritative painted surface

`CanvasArea.tsx` composites a **stale worker bitmap reprojected by the camera
delta** when the camera has moved but the bitmap's surface dimensions still
match — the "smooth pan at last-rendered quality" path
(`workerBitmapDelta`, `CanvasArea.tsx` ~2758). At the end of that same content
frame, `paintedSurfaceRef.current = currentSurface` is assigned
unconditionally (~2839).

That assignment asserts "the backing store shows an authoritative render at
this exact camera". After a reprojection it does not: it shows a resampled
older frame, and regions newly exposed by the pan contain stretched edge
content rather than scene content.

The next frame therefore sees `surfaceMatch === 'match'`, permits a partial
redraw, and composites fresh dirty rects over non-authoritative pixels —
the same class of failure `9d47771b` fixed for the main-thread path, on the
worker path.

**Reachability:** requires the worker path to be active. Before this pass that
made it unreachable on WebKitGTK and reachable on Chromium/WebView2 — so it was
*not* the cause of the originally reported Linux symptom. Enabling the worker
on WebKitGTK makes it reachable there, which is why it is fixed here rather
than deferred.

### G1 — fixed

`paintedSurfaceAfterFrame(surface, authoritative)` (`canvas/dirtyRegion.ts`)
now decides what a completed frame records. `CanvasArea` clears
`surfaceIsAuthoritative` on the reprojection branch, so a frame that only
*approximated* the camera records `null` instead of `currentSurface`. The next
frame then sees `never-painted`, which both the paint gate and the prune gate
already treat as "full redraw, no pruning".

Cost: exactly one full redraw after a reprojected frame. That is the trade the
repo already committed to — correct-but-slower beats stale pixels — and it
leaves the authoritative-frame path untouched (an exact camera match still
retains its pixels, pinned by test).

---

## 6. What changed in this pass

| Change | File |
|---|---|
| Verified OffscreenCanvas probe (disposable worker, known pixels, transfer, main-thread re-verify, 4 s timeout, session-cached) | `render/offscreenCapabilityProbe.ts`, `render/offscreenProbeWorker.ts` |
| Capability-gated worker eligibility replacing the blanket UA ban, with an attributable reason per refusal | `render/workerEligibility.ts` |
| Render-path diagnostic (`CanvasRenderPath`, fallback reasons, pull-based, zero per-frame cost) | `render/renderPathDiagnostics.ts` |
| Profile gate now calls `resolveWorkerEligibility`; probe kicked off once on first capability read | `canvas/adaptiveProfile.ts` |
| `renderPath()`, `probeOffscreen()`, `offscreenProbe()`, `forceFullRedraw()` on the diagnostics handle | `canvas/perfRuntime.ts` |
| Painted-surface invalidation seam for the full-redraw oracle | `CanvasArea.tsx` (existing import extended; hub budget unchanged) |

### Policy: eligibility is not activation

`resolveWorkerEligibility` distinguishes two questions deliberately:

- **Eligible** — the engine can run the path correctly. On WebKitGTK this
  requires the *verified* probe result, never an API-presence check and never a
  UA match. Not bypassable in either direction.
- **Activated** — the path is used. Verified engines are active **by default**;
  `?webkitWorker=0` or `localStorage['varve.webkitRenderWorker'] = 'off'`
  forces the main-thread path for bisecting a suspected renderer regression
  without a rebuild.

While the probe is in flight the capability is `offscreen-unknown`, which
resolves to *not verified*, so the opening frames of a session take the safe
main-thread path rather than racing the probe.

**Non-WebKit engines are untouched**: Chromium, WebView2 and WKWebView keep the
exact `hasWorker && hasOffscreenCanvas` gate they always had, pinned by test.

Verified end to end in the real engine — see §4b: 39 of 41 interaction frames
rendered through the worker, with `fallbackReason: none`.

---

## 7. Not established — explicit gaps

1. **Quiet production latency baseline.** Not obtainable; host contended 4.3x
   over the gate threshold and swapping (§1). **No before/after latency table
   is offered, and none should be inferred from this work.** The worker path is
   enabled because it is correct and moves replay off the main thread, not
   because a measured latency win was demonstrated on this host. Re-run
   `scripts/perf/run-production-workload.mjs` on an idle machine to quantify
   it; the `?webkitWorker=0` opt-out exists to make that an A/B.
2. **Root-caused and fixed** (§5) — the prune/paint margin mismatch. Both the
   worker and main-thread paths now report zero residue on every gesture.
3. **The oracle runs one gesture sequence per launch with no document reset**,
   so a gesture can be invalidated by the one before it (this is exactly how
   the `dragSlow` variant became vacuous). Per-gesture reset is needed before
   the sequence can be trusted as a suite rather than read gesture-by-gesture
   alongside its `gestureMovedPixels` count.
4. **G1 fixed but never reproduced.** Found by audit, closed by construction
   plus unit tests. No visual regression test exercises partial redraw after a
   reprojected worker frame.
5. **Transient/per-frame capture not implemented.** The oracle compares settled
   frames; a one-or-two-frame after-image that resolves before settling would
   not be caught.
6. **Not tested:** WebView2, WKWebView, X11-vs-Wayland comparison, context loss
   and fault injection on the newly-active WebKitGTK worker path, and memory
   behaviour over a long session with the worker enabled.

---

## 8. Repository state encountered (not caused by this work)

`master` (`7db2342e`) **does not build**. Commit `b262c3bd` added imports of
`./liveEffects/*` to `packages/engine/src/filterCompositor.ts` without
committing `packages/engine/src/liveEffects/`, which exists only as untracked
files in the working tree. A clean clone cannot typecheck or build the engine.

To obtain a production bundle, the untracked `liveEffects/` directory and the
uncommitted `packages/{engine,scene,shared}` modifications were copied into the
build worktree. This is recorded because it means the measured bundle includes
in-flight work, not a pristine tagged state. The canvas render path is not
touched by that work, so the render-path proof is unaffected.

Pre-existing typecheck failures at HEAD, unrelated to this work:
`engine/src/halftone.ts`, `scene/src/document-pages.ts`,
`editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx`,
`editor/src/components/WorkspaceCustomizeDialog.tsx`, and others.

---

## 9. Reproducing this

```bash
# Environment provenance
node scripts/perf/capture-webkit-env.mjs --json

# OffscreenCanvas capability in the real engine (needs PyGObject + webkit2gtk-4.1)
python3 run-probe.py          # -> reports/webkit-probe/offscreen-capability-*.json

# Render path of the real app in the real engine
python3 run-app.py <dist-dir> --query='?perf=1'
python3 run-app.py <dist-dir> --query='?perf=1&webkitWorker=1'
```

In a running app with `?perf=1`:

```js
window.__strataPerf.renderPath()      // { actualBackend, fallbackReason, summary, ... }
await window.__strataPerf.probeOffscreen()
window.__strataPerf.forceFullRedraw() // authoritative repaint, for the oracle
```
