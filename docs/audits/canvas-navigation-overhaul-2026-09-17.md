# Canvas navigation overhaul record — 2026-09-17

Current implementation note (2026-09-24): the initial `GtkGestureZoom`
approach was removed because it did not recognize touchpad pinches inside
Tauri. The active Linux route enables GDK's touchpad gesture event mask on the
WebKit widget tree and handles `TouchpadPinch` events directly. It forwards
`begin/update/end/cancel`, maps the event's root coordinates into webview-local
coordinates, and restores the starting camera on cancellation. The catch-all
event tracer is opt-in with `VARVE_TRACE_INPUT=1`. Physical trackpad validation
on Linux Wayland remains pending.

Status: implementation checkpoint on `master`. Covers the WebKitGTK pinch
route, middle-button navigation, wheel-classifier lifetime, and the input
diagnostics debug surface. Companion to the canonical
[`input-system-behavior-matrix.md`](../architecture/input-system-behavior-matrix.md)
(refreshed 2026-09-17) and the 2026-09-13 navigation quality record.

## Trigger

Operator report from the primary dev machine (KDE Plasma Wayland, WebKitGTK
2.52.6, ELAN touchpad): "pinching on a trackpad not performing any zoom
function on the canvas."

## Root cause — WebKitGTK pinch was never wired

The 2026-09-13 session built the `canvas://pinch-zoom` bridge on the premise
that "WebKitGTK owns the touchpad pinch gesture and applies it as page zoom",
letting the app intercept `zoom_level` changes. That premise is false for
WebKitGTK 2.52.6:

- The WebKit 2.52.6 source tree contains **no `ZoomGestureController`** and no
  pinch handling in the GTK3 `WebKitWebViewBase` (verified via the
  `webkitgtk-2.52.6` tree listing and a repo-wide code search: 0 hits).
- The installed `libwebkit2gtk-4.1.so.0.21.10` exposes only
  `ViewGestureController` (macOS-style swipe/magnification) symbols — no zoom
  gesture controller.
- GTK3 does not deliver KWin's `wp_pointer_gestures` pinch stream to a widget
  unless its GDK window opts into `GDK_TOUCHPAD_GESTURE_MASK`. The WebKitGTK
  widget tree had not enabled that mask, so no webview handler received the
  event. `zoom_level` also never changed, so the old bridge never fired.

Result: trackpad pinch did nothing in the desktop shell. The 2026-09-13
record had marked this route "device-pending"; this session resolved it as
*unimplementable as designed* and replaced it.

## Fixes implemented

| # | Change | Files |
|---|---|---|
| 1 | **Primary pinch arm (Linux)**: opt the WebKit widget tree and top-level window into `TOUCHPAD_GESTURE_MASK`, then handle GDK `TouchpadPinch` events directly inside `with_webview`. Forward phase, cumulative scale, and the gesture point mapped from root coordinates into webview-local CSS pixels. | `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/Cargo.toml` (`gtk = "0.18"`, matching the GTK3/WebKitGTK family) |
| 2 | **Fallback arm corrected**: where a WebKit build *does* page-zoom on pinch, `zoom_level` is cumulative within a gesture; the old code emitted it raw, so the frontend would compound `zoom ×= level` per notify (explosive overshoot). Now emits a per-notify **delta** against a per-gesture baseline, resets the baseline after a 250 ms quiet period, resets to 1.0 after our own page-zoom restore, and is suppressed while the direct GDK gesture is active. | `apps/desktop/src-tauri/src/lib.rs` |
| 3 | **Frontend bridge contract**: the structured gesture stream now reuses the macOS `gesturestart/change/end` handlers verbatim (one semantic path: world anchor captured at begin, `placeWorldPointAtScreen` as the centroid moves). Payload validation extracted to a pure module. | `packages/editor/src/canvas/pinchBridge.ts` (new), `packages/editor/src/canvas/inputPipeline.ts` |
| 4 | **Middle-button pan (any tool)**: ToolManager routes button 1 to the Hand tool when another tool is active — the Figma/Illustrator convention. Previously middle-drag with Select active did nothing (SelectTool rejects `button > 0`; the pipeline only preventDefaulted autoscroll). Escape/blur/pointercancel/momentum flow through the Hand tool's ordinary lifecycle; the user's tool selection never changes. | `packages/editor/src/tools/ToolManager.ts` |
| 5 | **Classifier lifetime**: the sequence-aware wheel classifier was created inside the wheel `useEffect` and silently reset on every rebind (tools re-render → effect deps change), discarding mid-gesture burst evidence and potentially toggling inertia mid-flick. Now lives in a ref, same lifetime rule as pointer ownership. | `packages/editor/src/canvas/inputPipeline.ts` |
| 6 | **Input diagnostics debug surface**: the opt-in ring was unreachable in production. `window.__varveInputDiagnostics` installs unconditionally (inert until `enable()`); `export()` returns raw + normalized records with the user agent. The pinch bridge records begin/end plus a sampled update stream. This is the capture tool for the pending hardware validation. | `packages/editor/src/canvas/inputDiagnostics.ts`, `inputPipeline.ts` |
| 7 | **Pre-existing type errors fixed in the navigation domain**: `screenToWorld` result assigned to a mutable tuple slot (inputPipeline.ts:1110), and a tautological `wheelMode !== 'zoom'` comparison (wheelClassifier.ts:168). Both predate this session; Vite builds do not typecheck, so they had gone unnoticed. | `inputPipeline.ts`, `wheelClassifier.ts` |

## Decision log (evidence-based)

```text
Decision: handle GDK `TouchpadPinch` events directly after opting the WebKit
widget windows into the matching event mask; keep page-zoom delta handling as
a guarded compatibility fallback.
Evidence: WebKitGTK 2.52.6 has no pinch-to-zoom implementation (source tree +
installed library verified); GTK3 requires `GDK_TOUCHPAD_GESTURE_MASK` on
the receiving GDK window; the WebKit widget tree did not set it, and
`GtkGestureZoom` did not recognize the stream inside Tauri.
Alternative considered: a `GtkGestureZoom` attached to the webview.
Why rejected: it did not recognize touchpad pinches in Tauri. Handling the
GDK event directly preserves phase, cumulative scale, and gesture position.
Varve-specific reason: the desktop shell must zoom the artwork, not the page;
the canvas already has a moving-anchor pinch implementation to reuse.
Validation method: cargo check/clippy/test; unit-tested payload contract
(pinchBridge.test.ts); hardware lane pending (see below).
```

```text
Decision: middle button pans with the Hand tool's semantics under any active
tool.
Evidence: Figma/FigJam, Penpot, tldraw, and Excalidraw all implement
middle/wheel-button canvas navigation independent of tool (competitor
research, 2026-09-17); SelectTool explicitly rejects button > 0, so Varve's
old behavior was "middle-drag does nothing"; the behavior matrix already
claimed middle-drag pans (doc-code drift).
Alternative considered: spring-loading the Hand tool (Space contract).
Why rejected: springLoadTool is KeyboardEvent-shaped with a 150 ms activation
delay — the button is already down, so the drag would miss its owner.
Varve-specific reason: HandTool already implements drag pan + release
momentum + cancel; routing to it reuses the whole lifecycle for ~40 lines.
Validation method: ToolManager.middlePan.test.ts (6 cases);
middle-button-pan.spec.ts E2E with real pointer events.
```

```text
Decision: no new navigation settings in this slice.
Evidence: competitor research shows Figma/Excalidraw/tldraw ship no zoom
sensitivity sliders — their failure modes were fixed by delta engineering
(clamps, normalization), not user tuning; Varve already exposes wheel policy,
sensitivity, and inertia (Settings > Drawing Input) with runtime mirrors.
Alternative considered: invert-zoom-direction toggle.
Why rejected for now: Varve's zoom deltas follow the OS natural-scroll sign
via ctrl+wheel semantics; no user request exists yet, and a per-device-class
split (the tldraw lesson) would need device classification that cannot be
reliable. Revisit if operator feedback asks for it.
```

## Validation

- `cargo check` / `cargo clippy` / `cargo test --lib` (varve-desktop):
  clean at the original implementation checkpoint; the 2026-09-24 rerun
  passed `cargo fmt --check` and all 130/130 desktop library tests.
- `tsc --noEmit -p packages/editor`: navigation modules clean. 47 pre-existing
  errors remain in files owned by concurrent sessions (Menubar, Inspector
  sections, component tests) — untouched by this slice.
- vitest: wheelClassifier/wheelGesture/navigationState/inputDiagnostics/
  HandTool (65), pinchBridge + ToolManager middle pan + HandTool (23) — all
  pass.
- Playwright (chromium, isolated port): new `middle-button-pan.spec.ts` 2/2;
  regression `input-navigation.spec.ts` + `zoom-stability.spec.ts` 13/13
  (wheel pan, shift+wheel, ctrl+wheel focal point, keyboard zoom, hand pan,
  edge auto-pan, fit/zoom paint stability, trackpad burst accumulation).
- A trusted-input probe (CDP `Input.synthesizePinchGesture`) confirmed the
  Chromium touch-pinch pipeline zooms the canvas about the anchor (2.48×
  observed for a 2× request, drift < 1 px) — that route exercises Varve's
  touch pointer pinch, not ctrl+wheel.
- Current native-bridge regression run (2026-09-24): frontend input-pipeline
  and pinch-bridge unit tests passed 17/17; Tauri library tests passed 130/130;
  `cargo fmt --check` passed. These checks compile and exercise the bridge
  contract, but do not replace the pending physical Linux trackpad run.

## Direct-handler attempt and corrected diagnosis (2026-09-19 to 2026-09-24)

An earlier trace suggested that `TouchpadPinch` events reached the webview,
leading to the diagnosis that only `GtkGestureZoom` recognition failed under
Tauri. That conclusion was premature: a later fresh-app probe established
that the WebKit widget tree had not enabled `GDK_TOUCHPAD_GESTURE_MASK`, so
GTK did not deliver the pinch stream to its handlers. The plain-GTK probe had
the mask enabled and therefore did not match the Tauri setup.

The final route opts every current widget in the WebKit subtree and the
toplevel window into `TOUCHPAD_GESTURE_MASK`, then handles
`GdkEventTouchpadPinch` in the webview's `::event` handler. It forwards
`begin/update/end/cancel` and cumulative scale. The event's root coordinates
are translated into the webview's local coordinate system because GDK event
coordinates belong to the window that received the event, which can be a
descendant surface. The frontend reuses the macOS world-anchor behavior;
cancellation restores the camera to the gesture's starting anchor. The
handler stops the event from propagating into WebKit, and the `zoom_level`
compatibility fallback is suppressed while the direct gesture is active.
The coordinate contract follows the GDK [`EventTouchpadPinch`](https://docs.gtk.org/gdk3/struct.EventTouchpadPinch.html)
fields and GTK's [`translate_coordinates`](https://docs.gtk.org/gtk3/method.Widget.translate_coordinates.html)
mapping between widget allocations.

First-pinch confirmation line in `varve.log`:
`touchpad pinch handled directly from TouchpadPinch events`.

## Follow-up (2026-09-19): why pinch was still dead on the operator's machine

After the gesture bridge landed, the trackpad pinch still did nothing on the
primary dev machine. Two independent causes, both fixed:

1. **The running instance predated the fix and loaded stale assets.** The
   operator's app was a `target/debug/varve-desktop` process started before
   the change, launched *directly* (not via `tauri dev`), so it rendered the
   **embedded frontend bundle** from `apps/desktop/dist` — last built two
   days earlier, before the pinch-bridge payload handler and diagnostics
   existed. A fresh binary with stale embedded assets would also have been
   dead: the old frontend ignores the new `{phase,…}` payloads. Launching
   raw cargo binaries requires rebuilding the dist (`beforeBuildCommand`'s
   `pnpm build`, or at minimum `vite build`) *before* `cargo build`.
2. **GTK3 did not deliver touchpad-pinch events to the webview.** In GTK3,
   touchpad gesture events reach a widget only when its GDK event mask includes
   `GDK_TOUCHPAD_GESTURE_MASK`. The bridge now opts the webview subtree and
   toplevel window in recursively, and the direct handler writes
   `touchpad pinch handled directly from TouchpadPinch events` on the first
   recognized pinch so the delivery path is observable on real hardware.

Verified: fresh dist build (vite), fresh `cargo build` (both fixes embedded —
native log string present in the binary, dist bundle contains the bridge and
`__varveInputDiagnostics`), and a clean isolated-data smoke launch. Physical
trackpad confirmation remains the manual lane; after the handler log appears,
`window.__varveInputDiagnostics.enable()` → pinch over canvas → `export()`
confirms the frontend gesture path.

## Open findings (discovered this session)

1. **The input-diagnostics ring records the PRE-mutation viewport**
   (`inputPipeline.ts` wheel handler captures `stateRef.current` into `s`
   before applying the action and writes `viewport: { zoom: s.zoom, … }`).
   That makes the last record lag one event behind the live camera, which
   initially masqueraded as several navigation defects during scenario
   testing ("first zoom-in after a settle applies a stale camera", "canvas
   wheel dead after a panel visit"). With an authoritative probe
   (a zero-delta wheel appends a record without mutating anything) every
   suspected defect resolved as correct behavior: zoom applies, navigation
   resumes after panel visits, inertia terminates. The ring's semantics are
   fine for what it documents (classification + pre-state), but anyone
   building assertions on it should snapshot via a zero-delta probe wheel or
   the status-bar zoom field, not the last record. Worth a one-line doc note
   on `InputDiagnosticRecord.viewport` in a follow-up.
2. **Perf probe `probe-latency.mjs` crashed mid-run under machine
   contention** (page context destroyed at iteration ~1584 of the 256-node
   seed loop while concurrent agent E2E suites were running; a later
   scenario run crashed the same way under load, and succeeded once the
   machine freed up — evidence for environmental memory pressure rather
   than an application defect). Not retried to a clean number; the committed
   latency evidence in `docs/architecture/interaction-latency-2026-08-10.md`
   (wheel input→present p50 0.9 ms / p75 1.7 ms) remains the last stable
   measurement. The probe's stale `Create` locator was fixed this session
   (the dialog copy is now "Create design").

## Hardware validation still pending

- Trackpad pinch in the **Tauri desktop shell on KDE Wayland** (the reported
  case): requires rebuilding/relaunching the desktop binary, then
  `__varveInputDiagnostics.enable()` → pinch over the canvas → `export()`.
  If the gesture stream arrives, the canvas zooms; if nothing arrives, KWin
  is not delivering `wp_pointer_gestures` to GTK3 and the fallback is
  Ctrl/Cmd+wheel + zoom controls (documented in the matrix).
- Linux Chromium trackpad pinch (crbug 40332613: pinch-to-wheel conversion is
  historically unreliable there) and Firefox Wayland pinch — browser-route,
  device-level.
