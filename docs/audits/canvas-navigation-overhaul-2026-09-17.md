# Canvas navigation overhaul record — 2026-09-17

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
- GTK3 therefore delivers the KWin `wp_pointer_gestures` pinch stream to the
  webview widget, nobody handles it, and it dies. `zoom_level` never changes,
  so the old bridge never fired.

Result: trackpad pinch did nothing in the desktop shell. The 2026-09-13
record had marked this route "device-pending"; this session resolved it as
*unimplementable as designed* and replaced it.

## Fixes implemented

| # | Change | Files |
|---|---|---|
| 1 | **Primary pinch arm (Linux)**: attach a `GtkGestureZoom` to the webview inside `with_webview`; forward `begin/update/end` + cumulative scale + gesture-centre (webview-local CSS px) as a structured `canvas://pinch-zoom` payload. GTK 3.24+ routes touchpad pinch through `GtkGesture`, and nothing else claims it, so this observes the raw stream WebKit ignores. | `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/Cargo.toml` (direct `gtk = "0.18"` matching the locked webkit2gtk family) |
| 2 | **Fallback arm corrected**: where a WebKit build *does* page-zoom on pinch, `zoom_level` is cumulative within a gesture; the old code emitted it raw, so the frontend would compound `zoom ×= level` per notify (explosive overshoot). Now emits a per-notify **delta** against a per-gesture baseline, resets the baseline after a 250 ms quiet period, resets to 1.0 after our own page-zoom restore, and is suppressed while the `GtkGestureZoom` arm owns the gesture (no double-apply in any world). | `apps/desktop/src-tauri/src/lib.rs` |
| 3 | **Frontend bridge contract**: the structured gesture stream now reuses the macOS `gesturestart/change/end` handlers verbatim (one semantic path: world anchor captured at begin, `placeWorldPointAtScreen` as the centroid moves). Payload validation extracted to a pure module. | `packages/editor/src/canvas/pinchBridge.ts` (new), `packages/editor/src/canvas/inputPipeline.ts` |
| 4 | **Middle-button pan (any tool)**: ToolManager routes button 1 to the Hand tool when another tool is active — the Figma/Illustrator convention. Previously middle-drag with Select active did nothing (SelectTool rejects `button > 0`; the pipeline only preventDefaulted autoscroll). Escape/blur/pointercancel/momentum flow through the Hand tool's ordinary lifecycle; the user's tool selection never changes. | `packages/editor/src/tools/ToolManager.ts` |
| 5 | **Classifier lifetime**: the sequence-aware wheel classifier was created inside the wheel `useEffect` and silently reset on every rebind (tools re-render → effect deps change), discarding mid-gesture burst evidence and potentially toggling inertia mid-flick. Now lives in a ref, same lifetime rule as pointer ownership. | `packages/editor/src/canvas/inputPipeline.ts` |
| 6 | **Input diagnostics debug surface**: the opt-in ring was unreachable in production. `window.__varveInputDiagnostics` installs unconditionally (inert until `enable()`); `export()` returns raw + normalized records with the user agent. The pinch bridge records begin/end plus a sampled update stream. This is the capture tool for the pending hardware validation. | `packages/editor/src/canvas/inputDiagnostics.ts`, `inputPipeline.ts` |
| 7 | **Pre-existing type errors fixed in the navigation domain**: `screenToWorld` result assigned to a mutable tuple slot (inputPipeline.ts:1110), and a tautological `wheelMode !== 'zoom'` comparison (wheelClassifier.ts:168). Both predate this session; Vite builds do not typecheck, so they had gone unnoticed. | `inputPipeline.ts`, `wheelClassifier.ts` |

## Decision log (evidence-based)

```text
Decision: WebKitGTK pinch is delivered by a GtkGestureZoom attached to the
webview, not by intercepting WebKit page zoom.
Evidence: WebKitGTK 2.52.6 has no pinch-to-zoom implementation (source tree +
installed library verified); GTK 3.24+ routes touchpad pinch through
GtkGesture; gtk-rs exposes safe GestureZoom bindings (no unsafe, per
workspace policy).
Alternative considered: keep waiting on zoom_level notify.
Why rejected: the notify never fires on this WebKit — dead code; and GDK's
raw pinch stream carries more information (phase, centre) than a page-zoom
level.
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
  clean; 128/128 tests pass. No new warnings in the pinch block.
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
