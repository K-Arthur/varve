# Canvas interaction fluidity — 2026-08-09

Status: implementation in progress. This record is updated after each vertical
slice and distinguishes inherited measurements from evidence collected in this
session.

## Objective and interaction policy

The governing latency rule is newest-authoritative-input wins. Direct artwork
manipulation remains pointer-coupled and receives no generic easing. Viewport
navigation may continue after release only for sources where application-side
momentum is appropriate. Keyboard movement remains discrete and deterministic.

Quality priorities are therefore separate:

| Class | Priority | Continuation after input |
|---|---|---|
| Move, resize, rotate, crop, node edit, drawing | accuracy, handler latency, revision-aligned feedback | none |
| Pan, wheel, pinch, view rotation | latency, stable anchor, refresh-independent motion | source-dependent |
| Keyboard nudge and zoom | deterministic steps and transaction grouping | OS repeat only |

## Verified architecture map

The repository has one canvas input pipeline and one tool manager. No second
gesture framework is needed or permitted by this pass.

### Object drag

```text
PointerEvent on CanvasArea
  -> useCanvasInputs.handlePointerDown/Move/Up
  -> buildToolCtx (current camera, modifiers, normalized source samples)
  -> dispatchToTool / ToolManager
  -> SelectTool + InteractionSession live modifier snapshot
  -> snap spatial-index query -> filterSnapTargets -> snapPosition
  -> immutable scene mutation inside one transaction
  -> computeInvalidationPlan + cache/index maintenance
  -> redrawCoordinator
  -> keyed latest-wins frame scheduler, canvas lane
  -> dirty query -> engine IR -> main replay or bounded worker host
  -> compositor -> canvas commit -> presentation evidence
```

The handler performs tool dispatch and mutation synchronously. React owns the
document snapshot, overlays, and surrounding UI. Worker replay, when eligible,
is asynchronous and guarded by render revision; WebKitGTK uses main-thread
replay. Interaction spans cover pointer input, tool dispatch, snap phases,
render queue, main/worker rendering, and bounded presentation evidence.

### Resize, skew, rotation, and endpoint handles

```text
PointerEvent on SelectionOverlay handle
  -> pointer capture + beginTransaction
  -> interaction-local handle state
  -> live updateDoc transform mutation
  -> the same invalidation/render/presentation path as object drag
  -> pointerup/cancel -> commitTransaction + cleanup
```

This is intentionally separate from tool drag dispatch but shares document,
camera, rendering, and history ownership. Its primary accuracy risk is overlay
and artwork revisions diverging because both consume React state.

### Wheel and precision-trackpad pan

```text
native non-passive WheelEvent listener
  -> resolveWheelAction
     -> deltaMode normalization
     -> conservative source classification
     -> diagonal/Shift semantics
  -> editor.panBy against newest queued state
  -> optional mouse-wheel inertia only
  -> camera invalidation -> latest-wins canvas frame -> present
```

Trackpad-classified input retains fractional deltas and receives no additional
application inertia. Unknown sources currently inherit mouse-wheel inertia.

### Trackpad/browser pinch and touch pinch

```text
ctrl/cmd WheelEvent | WebKit gesture event | Tauri WebKitGTK pinch bridge
  -> current stateRef camera
  -> screenToWorld gesture anchor
  -> zoomAboutPoint + atomic commitCamera
  -> render -> present

two touch PointerEvents
  -> touch pointer map + navigation state machine
  -> cancel active one-finger tool when second pointer arrives
  -> centroid pan + distance scale from current stateRef camera
  -> zoomAboutPoint + atomic commitCamera
  -> cleanup on up/cancel/blur
```

The camera reference advances ahead of React commits, preventing burst deltas
from resolving against an obsolete snapshot.

### Hand, middle-button, and Space-pan

```text
PointerEvent -> ToolManager -> HandTool
  -> pointer capture -> direct setPan during drag
  -> release velocity estimate
  -> keyed input-lane momentum frame -> setPan -> render -> present
```

Middle-button and spring-loaded Space use the same HandTool semantics. The tool
tracks interaction-local pan because the context pan value is an immutable
snapshot.

### Auto-pan during drag

```text
active pointermove
  -> computeEdgeVelocity from screen-space edge penetration
  -> keyed input-lane frame loop
  -> relative panBy
  -> subsequent tool samples resolve through the current camera
```

### Keyboard nudge

```text
canvas keydown / OS repeat
  -> ToolManager -> SelectTool
  -> live modifier-derived nudge policy -> executeNudge
  -> one transaction retained across repeat keydown events
  -> immutable scene mutation -> invalidation -> render
  -> keyup/blur/deactivate commits the transaction
```

### Pencil and raster paint

```text
PointerEvent
  -> buildToolCtx sourceEvents
  -> collectSourceEvents (coalesced authoritative + optional predicted)
  -> PencilTool/PaintTool acquisition and lightweight preview/update
  -> final pointerup transaction work and commit
  -> render -> present
```

Predicted samples remain ephemeral input samples; document commit occurs on the
tool's authoritative completion path.

## Gap table before changes

| Interaction | Main latency risk | Accuracy/feel risk | Evidence | Planned action |
|---|---|---|---|---|
| Hand pan | momentum uses `velocity *= 0.95` once per frame | different travel and stop time by refresh rate | direct code inspection plus deterministic model below | use elapsed-time exponential decay |
| Mouse-wheel pan | inertia uses `velocity *= 0.9` once per frame; restart clears the newly assigned velocity | refresh-dependent feel and continuation is silently disabled | direct code inspection plus deterministic model below | fix restart order and share elapsed-time navigation physics |
| Auto-pan | fixed pixels per scheduled frame; camera advances without re-sampling a stationary held pointer | 144 Hz pans 4.8 times as fast as 30 Hz; dragged content can detach from the edge pointer | direct code inspection plus deterministic model below | integrate edge velocity using clamped elapsed time and re-dispatch one authoritative held sample after each camera step |
| Trackpad pan | source classifier cannot be perfect | wrong classification can add inertia | classifier corpus covers pixel/line/page and diagonals | keep uncertain behavior bounded; expand sequence tests before policy change |
| Pinch | multiple runtime entry paths | stale camera or anchor drift | current code uses `stateRef` and `zoomAboutPoint`; viewport math tests exist | add combined anchor/rotation corpus if a failure is reproduced |
| Drag/resize/rotate | synchronous immutable mutation and React fan-out | pointer/artwork or overlay phase lag under load | inherited production traces show tail stalls | preserve direct semantics; profile before transient-state redesign |
| Snapping | broad/fine phase cost under dense scenes | candidate chatter and stale targets | incremental index and sticky-session work already present | retain index; use snap spans and parity benchmarks |
| Nudge | mutation per OS repeat | excessive history or inconsistent modifier steps | code groups repeats in one transaction | add browser repeat/cancellation evidence |
| Drawing | CanvasArea eagerly collects coalesced and predicted arrays for every tool; normalized samples replace hardware timestamps with `performance.now()` | velocity/filter timing becomes input-rate dependent | direct code inspection; prediction commit paths already filter speculative samples | collect only in drawing tools and preserve trusted timestamps |
| Render worker | asynchronous replay/bitmap transfer | stale result replacing new state | host is one-in-flight plus one latest pending and revision guarded | retain latest-wins boundary; do not alter overlapping user work |

## Baseline evidence

### Existing production evidence retained

The 2026-08-03 production Chromium corpus reported, for a 121-node single-node
drag, frame-total p50 2.5 ms and p95 5.1 ms. The same report identified missing
wheel and keyboard trace coverage and showed the render worker is disabled on
the primary WebKitGTK path. The 2026-08-07 snap-index report measured an
unfiltered `snapPosition` mean of 0.53 / 6.88 / 52.6 ms for 100 / 1,000 / 5,000
candidates, versus a 5,000-node spatial query mean of 0.25 ms. These are
inherited measurements, not reruns from this session.

### Refresh-rate model captured this session

Before implementation, maximum auto-pan is 8 CSS pixels per frame. Momentum
retains a fixed fraction of velocity once per callback. The same one-second
gesture therefore produces:

| Refresh | Auto-pan px/s | Hand velocity retained after 1 s | Wheel velocity retained after 1 s |
|---:|---:|---:|---:|
| 30 Hz | 240 | 0.214639 | 0.042391158 |
| 60 Hz | 480 | 0.046070 | 0.001797010 |
| 90 Hz | 720 | 0.009888 | 0.000076177 |
| 120 Hz | 960 | 0.002122 | 0.000003229 |
| 144 Hz | 1152 | 0.000620 | 0.000000258 |

This is a correctness-level timing defect, not a subjective tuning preference.
The target is equivalent motion for equal elapsed time, with pathological frame
gaps clamped so a restored tab cannot apply accumulated movement at once.

Baseline targeted tests: 56 passed across HandTool, auto-pan, wheel
classification, and navigation state. These tests preserve current behavior
but do not assert refresh-rate independence.

## Vertical slice 1 — canonical navigation timing

Implemented in `tools/navigationPhysics.ts`, the shared policy now uses CSS
pixels per second and exact exponential integration. A retention factor tuned
at the 60 Hz reference interval is converted once to a per-second decay rate;
each scheduled callback then integrates its actual elapsed time. Hand momentum
and mouse-wheel inertia use the same units and bounded-time policy while
retaining separate decay constants. Auto-pan converts its existing edge-speed
tuning into a velocity and integrates elapsed time.

The first scheduled callback uses one reference interval. Invalid or
non-monotonic timestamps use the same fallback. Gaps over 50 ms are clamped,
preventing a hidden/restored tab or debugger pause from applying accumulated
movement in one jump. `prefers-reduced-motion: reduce` disables only inertial
continuation; direct hand drag, wheel deltas, pinch, and artwork manipulation
remain immediate.

The wheel path also contained an independent ordering defect: it assigned the
new release velocity and then called `cancelInertia`, whose cleanup zeroed that
velocity before the next frame. Cancellation now happens first, the prior
velocity is retained for the bounded blend, and the replacement continuation
starts with the intended non-zero velocity. Trackpad-classified events still
cancel application inertia, so OS momentum is not doubled.

Deterministic simulation now asserts equal position and retained velocity after
one second at 30, 60, and 144 Hz to ten decimal places. The 60 Hz edge-speed
tuning remains 8 CSS pixels per reference frame (480 CSS pixels per second),
but no longer scales with callback count.

Targeted result after the slice: 60 tests passed, including four new physics
tests plus the existing HandTool, auto-pan, wheel-classifier, and navigation
state suites. The editor package typecheck passed.

## Vertical slice 2 — complete interaction trace boundaries

Wheel processing is now timed after camera mutation and records a
`wheel.input` span with source, semantic action, and delta mode. One trace owns
an entire wheel burst and closes 150 ms after its last event. Keyboard work
records an async-safe `keyboard.input` span completed at the microtask boundary,
so early-return shortcut/tool paths remain covered, and a held key remains one
trace until keyup. Touch and WebKit gesture pinch traces close when the pointer
count drops or the gesture ends. Hover traces close after an idle boundary
instead of remaining open for the lifetime of the pointer inside the canvas.

Trace completion is kind-aware. A stale wheel/hover timer cannot close a newer
pointer drag, and modifier keys pressed during a drag contribute keyboard work
to the active pointer trace rather than replacing it. The first event after a
trace closes always starts a new trace; it is not lost to the previous
rate-limit timestamp.

Focused trace result: 60 tests passed, including the new stale-timer ownership
case. A real Chromium Playwright run passed both the existing pointer-drag
diagnostic flow and a new wheel/keyboard boundary flow. The run also found and
repaired a stale E2E assertion that expected trace schema 1 although the
production tracer emits schema 2.

## Vertical slice 3 — authoritative high-frequency drawing samples

`CanvasArea.buildToolCtx` no longer calls `getCoalescedEvents()` and
`getPredictedEvents()` for every Select, Hand, shape, hover, or handle event.
Its input-normalizer dependency is now type-only. Pencil, Paint, and Smudge are
the consumers that acquire high-frequency arrays, so the general pointer path
avoids the array creation and browser API calls while drawing retains all
authoritative coalesced points.

Normalized input now preserves a browser sample's timestamp when it is finite,
monotonic-domain-compatible, and within 60 seconds of `performance.now()`.
Malformed and legacy epoch-domain timestamps fall back safely. Pencil's One
Euro filter, Paint dab velocity, and Smudge dab velocity consume those sample
times rather than fabricating 16 ms per point or resampling every point at the
same handler time. Pencil's RAF preview also consumes the RAF timestamp, keeping
event and presentation clocks coherent.

Predicted samples were audited and found to already be correctly separated:
Pencil discards them, while Paint and Smudge render them only through the
preview canvas and process confirmed samples into raster tiles. This slice
preserves that contract rather than introducing a second prediction system.

Focused drawing result: 104 tests passed across normalization, Pencil, Paint,
Smudge, and Pen. New tests cover trusted coalesced timestamps and rejection of
epoch-domain timestamps. The editor package typecheck passed. Two independently
run real Chromium paint-drag tests passed (raster-layer creation and Layers
panel persistence). A broader serial brush suite was not counted as passing:
its second test timed out in the shared document-creation helper before any
brush action and the remaining serial tests did not run.

## Vertical slice 4 — camera-coupled edge auto-pan

Auto-pan now treats the camera step and active-tool step as one ordered frame.
`panBy` advances the editor's imperative state snapshot before queuing React's
functional state update; the auto-pan callback then converts the same held
pointer through that exact camera and re-dispatches the active tool. Select and
Page derive their total gesture displacement from `BaseTool`'s world-space
start/current points instead of a camera-independent raw screen delta. A
pointer can therefore remain physically stationary in the edge zone while a
dragged node, page, or drawing point continues moving through world space.

The held event is a scalar `PointerEvent` snapshot rather than a browser event
object retained beyond React dispatch, because some WebViews clear native
event accessors after the callback returns. The frame callback supplies one
freshly normalized authoritative sample with the RAF timestamp. It does not
ask the retained event for an old coalesced or predicted packet, which would
duplicate samples already processed by Pencil, Paint, or Smudge.

Pointer capture remains authoritative when hit testing crosses an SVG overlay
or the physical canvas boundary; `pointerleave` no longer cancels an active
captured drag. Edge speed is clamped at the configured maximum even outside
the canvas. Pointer release stops the loop and sends one final move sample
against the last camera snapshot before committing, removing a possible final
bounded-frame phase offset.

A Chromium interaction test holds a selected shape three CSS pixels from the
canvas edge without issuing more pointer moves. It asserts both sides of the
contract: the inspector's world X value continues changing as the camera pans,
while the rendered selection centre remains within four CSS pixels of the held
pointer.

Focused verification passed 75 Select/Page/auto-pan unit tests, touched-file
Biome checks, and the real Chromium gesture. The architecture audit completed
with the same 17 existing dependency cycles and no layer violations;
CanvasArea remains at 50 imports and complexity 435. A package-wide editor
typecheck was attempted after this slice but is presently blocked by concurrent
uncommitted image-resource work (`ThumbnailInfoDialog`,
`collectImageBitmaps`, and `sceneToEngineHandles.test`) outside this change.

## Vertical slice 5 — production corpus evidence integrity

The production-workload runner had drifted from the current home flow and
diagnostics surface: it searched only for a `Create` action while the dialog
now exposes `Create design`, and it required `window.__varvePerf` even though
the runtime handle still uses its legacy `window.__strataPerf` name. The runner
now accepts the current action and either handle, scoped to the open dialog so
an unrelated matching control cannot satisfy setup.

The workload record now includes trace-kind counts, frame-disposition counts,
dropped-sample counts, and p50/p75/p90/p95/p99/max distributions for every
span actually observed. Empty frame distributions use `count: 0` and `null`
percentiles. This is deliberately stricter than the older summary, whose
numeric zero percentiles could make an absent pointer-to-present sample look
like measured zero latency.

A production Chromium smoke corpus completed for `vector-100` across idle
pointer movement, single drag, pan, zoom, nudge, resize, and rotate (6 measured
iterations after 2 warmups). Every workload emitted traces and no trace hit a
span or frame cap. The environment was classified `contended`: load exceeded
the 8-core machine, concurrent repository TypeScript/Vite processes were
active, and an externally served build cannot be tied to the runner's captured
Git identity. These timings are therefore diagnostic only, not an after
baseline or regression claim.

The diagnostic sample nevertheless confirms the intended phase visibility:
pointer input, dispatch, snapping, render queue, main render, worker render,
estimated composite, and presentation feedback all appeared in real traces.
Zoom supplied 50/50 presentation samples (p95 8.3 ms); pan supplied 12/17 and
rotate 16/25. Idle hover, single drag, nudge, and resize supplied no correlated
frame sample in this run even though their input/queue/presentation-feedback
spans were present. That absence remains explicitly visible and must be
resolved before those workloads can support authoritative input-to-present
budgets.

## Vertical slice 6 — remove hover queries from active manipulation

The scale corpus then replayed single drag, pan, zoom, and nudge against
`vector-1k`, `vector-5k`, and `flat-10k` (2 measured iterations after 1 warmup).
All 12 workload/scale combinations completed and no interaction trace dropped
a span or frame. As with the 100-node corpus, concurrent repository activity
classified every result as contended, so the figures below locate scaling work
but are not release SLO measurements.

The traces exposed a direct-manipulation cost that does not belong in the drag
path. `inputPipeline` resolved the Select/Inspect hover target on every pointer
move even when a mouse button was held. That invokes document hit testing
before dispatching the already-owned drag. The diagnostic pointer-input p95
rose with the fixture from 15.0 ms at 1k, to 78.7 ms at 5k, to 219.5 ms at 10k
for single drag. The selected tool does its own gesture work, so this extra
hover result is informational only and cannot affect the manipulation.

Hover resolution is now restricted to button-free Select/Inspect movement.
Direct drag samples proceed immediately to tool dispatch, while idle hover
behavior remains unchanged. A focused policy test covers idle Select/Inspect,
button-held Select/Inspect, and another tool. This removes one document-scale
query from every active pointer sample without adding caching, throttling, or
pointer lag.

The equivalent after-production trace is not yet available. During rebuild,
unrelated concurrent import/color/export work failed both TypeScript and Vite
(`profileFromBytes` is currently imported but not exported, alongside other
incomplete contracts). The before trace and structural removal are recorded;
no numerical improvement is claimed until the identical production corpus can
be rerun from a buildable tree.

## Validation ledger

| Validation | Status |
|---|---|
| Targeted baseline unit tests | PASS — 56 tests |
| Time-based navigation unit tests | PASS — 60 targeted tests total |
| Trace lifecycle unit tests | PASS — 60 targeted tests total |
| Drawing/input unit tests | PASS — 104 targeted tests total |
| Auto-pan coupling unit tests | PASS — 75 Select/Page/auto-pan tests |
| Active-drag hover policy unit test | PASS — 1 focused policy test |
| Drawing Canvas Playwright | PASS — 2 independently run Chromium paint drags; broader serial suite stopped on startup-helper timeout |
| Targeted Canvas Playwright | PASS — Chromium, 2 tests |
| Auto-pan Canvas Playwright | PASS — Chromium stationary-pointer edge drag; world travel continues and released artwork remains within 4 CSS px of the pointer |
| Production interaction corpus | PASS as smoke only — 7/7 workloads produced traces; timing invalidated by contention, and four workloads exposed missing correlated-frame evidence |
| Production scale corpus | PASS as smoke only — 1k/5k/10k, 12/12 workload/scale combinations completed with no dropped trace samples; timing invalidated by contention |
| Production rerun after hover fix | BLOCKED by unrelated concurrent import/color/export build failures; no after-number claimed |
| Editor package typecheck | PASS for slices 1–3; slice 4 attempt blocked by unrelated concurrent image-resource changes |
| Full regression protocol | PENDING |
| Architecture audit | PASS — completed; 17 existing cycles reported, no layer violations, CanvasArea 50 imports / complexity 435; this slice converts one runtime import to type-only |
| Native Tauri / WebKitGTK | NOT RUN |
| Windows WebView2 | NOT AVAILABLE |
| macOS WKWebView | NOT AVAILABLE |
