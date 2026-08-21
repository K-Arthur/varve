# Input System — Behavior Matrix (cross-platform)

Branch: `feat/input-system` — 2026-08-01

This matrix is the canonical statement of *intended* input behavior for the
Varve canvas. It accompanies `docs/audits/input-system-audit-2026-08-01.md`
(the "as-was" audit) and records the behavior after the Milestone 2–4/7 work:
physical-key zoom matching, wheel-action classification, anchored viewport
zoom, and the input diagnostics surface.

## 1. Conventions

| Term | Meaning |
|---|---|
| Canvas | The artwork surface (`.editor-canvas__content-layer`). |
| Pan | Translate the viewport; world content moves under a fixed cursor. |
| Zoom anchor | The world point kept stationary under a fixed screen point. |
| Cmd | On macOS `Meta`; on Windows/Linux `Ctrl`. |
| NumLock-off numpad | Numpad keys read as navigation (arrows/Insert/End). |

## 2. Expected action per device × modifier

### 2.1 Mouse

| Input | Behavior |
|---|---|
| Wheel (vertical) | Pan canvas vertically. Direction follows the OS natural-scroll setting via `deltaY`. |
| Wheel (horizontal / Shift+vertical) | Pan canvas horizontally. |
| Ctrl/Cmd + wheel | Zoom around the cursor (focal point preserved). |
| Middle-button drag | Pan (Hand tool accepts button 1). Browser autoscroll suppressed. |
| Right-click | Native context menu suppressed on canvas; custom context menu shown. |
| Side buttons (back/forward) | Intercepted on canvas; never trigger browser history. |
| Alt+click (Zoom tool) | Zoom out around the cursor. |
| Mouse wheel momentum | App-side inertia applies to mouse-classified input only. |

### 2.2 Precision trackpad

| Input | Behavior |
|---|---|
| Two-finger scroll | Pan 2D (vertical + horizontal + diagonal). |
| Pinch (Chromium/WebView2) | ctrl+wheel signal → zoom around cursor. |
| Pinch (macOS WebKit) | Native `gesturestart/change/end` → zoom around gesture point. |
| Pinch (WebKitGTK/Tauri) | `canvas://pinch-zoom` bridge re-emits the page-zoom factor onto the artwork. |
| Momentum | OS momentum flows through; app does NOT double it (trackpad-classified events skip app inertia). |

### 2.3 Touchscreen

| Input | Behavior |
|---|---|
| One finger | Routed to the active tool (draw/select/edit). |
| Two-finger pinch | Combined pan + zoom around the gesture centroid. |
| Two-finger pan | Pans the viewport; does not draw or select objects. |
| Three fingers | Ignored by navigation (no spurious zoom). |
| Pointer cancel | Cancels pinch; gesture state reset; tool receives `pointercancel`. |

### 2.4 Stylus / pen

| Input | Behavior |
|---|---|
| Pen draw | Routed to the active tool; pressure/tilt/twist preserved. |
| Eraser tip | Detected via button 5. |
| Barrel button | Secondary action (configurable in future). |
| Pen + touch coexistence | Touch navigation can run while a pen is hovering; touch does not merge into a pen stroke. |

### 2.5 Keyboard (canvas focused)

| Shortcut | Behavior |
|---|---|
| `+` / `=` / numpad `+` (NumLock on) | Zoom in (1.25×), center-anchored. |
| `-` / numpad `-` (NumLock on) | Zoom out (0.8×), center-anchored. |
| `Ctrl/Cmd+0` / numpad `0` | Zoom to 100%. |
| `1`–`6` (no modifiers) | Zoom presets 50/75/100/150/200/400%. |
| `Shift+1` / `Shift+2` / `Shift+3` / `Shift+4` | Fit all / fit selection / fit active page / fit active frame. |
| Numpad digits (NumLock off) | Navigation keys (arrows/End/Insert), NOT zoom presets. |
| `Space` | Spring-loaded Hand tool. |
| `Escape` | Cancel active drag, then clear selection / exit isolation. |
| `Tab` | Cycle selection. |
| `Enter` / `F2` | Rename selected node. |

### 2.6 Keyboard (global, canvas not focused)

| Shortcut | Behavior |
|---|---|
| `Ctrl/Cmd+=` | Zoom in (via ActionRegistry). |
| `Ctrl/Cmd+-` | Zoom out. |
| `Ctrl/Cmd+0` | Zoom to 100%. |
| `Shift+1..4` | Fit all / selection / page / frame. |
| Bare `1`–`6` | Zoom presets. |

All keyboard zoom entry points resolve through the physical key
(`KeyboardEvent.code`), so `Shift+1` matches on layouts where it prints `!`,
and numpad works under any NumLock state (see `input/physicalKey.ts`).

## 3. Zoom model

| Property | Value |
|---|---|
| MIN_ZOOM / MAX_ZOOM | 0.001 / 64 (`@varve/shared/viewport.ts`) |
| Discrete step | ×1.25 / ÷1.25 (`ZOOM_STEP_FACTOR`) |
| Presets | 0.5 / 0.75 / 1 / 1.5 / 2 / 4 |
| Continuous scale | `exp(-clampedDelta * 0.01)`, delta clamped ±24 |
| Focal-point zoom | `zoomAboutPoint` — closed-form, drift-free |
| 100% | 1 document unit per CSS pixel |
| UI zoom field range | 1–1000% |
| Rotation | Supported; all transforms rotation-aware (affine) |
| Zoom entry points | Canvas keys, ActionRegistry shortcuts, StatusBar, Menubar, wheel, trackpad pinch, touch pinch, ZoomTool, minimap — all route through `commitCamera` / `computeZoom*` |

## 4. Platform support

| Platform | Runtime | Wheel pan | Ctrl+wheel zoom | Trackpad pinch | Touch | Pen | Keyboard |
|---|---|---|---|---|---|---|---|
| Windows | Tauri/WebView2 | Yes | Yes | Yes (ctrl+wheel) | Yes | Yes | Yes |
| macOS | Tauri/WKWebView | Yes | Yes | Yes (gesture events) | Yes | Yes | Yes |
| Linux Wayland | Tauri/WebKitGTK | Yes | Yes | Via pinch bridge | Yes | Yes | Yes |
| Linux X11 | Tauri/WebKitGTK | Yes | Yes | Via pinch bridge | Yes | Yes | Yes |
| Browser | Chromium | Yes | Yes | Yes (ctrl+wheel) | Yes | Yes | Yes |
| Browser | Firefox | Yes | Yes | Verify event model | Yes | Yes | Yes |
| Browser | Safari | Yes | Yes | Yes (gesture events) | Yes | Yes | Yes |

Known limitation: Firefox and WebKitGTK pinch support depends on the browser
emitting ctrl+wheel or gesture events; where neither is emitted the reliable
fallback is `Ctrl/Cmd+wheel` and the on-screen zoom controls. This is
documented in `docs/audits/input-system-audit-2026-08-01.md` (G13, manual
hardware checklist).

## 5. Interaction state (navigation layer)

The canvas navigation is a small explicit state machine owned by
`canvas/inputPipeline.ts`:

| State | Enters | Exits |
|---|---|---|
| Idle | — | pointerdown, wheel, keydown |
| Tool drag | pointerdown (button 0/2/pen) | pointerup / pointercancel / Escape / blur |
| Pan (wheel) | wheel (plain) | wheel idle, momentum decay |
| Zoom (wheel) | ctrl/meta+wheel | wheel idle |
| Touch pinch | second touch pointer down | pointerup below 2 pointers / pointercancel |
| Space-hand | Space keydown | Space keyup / blur |

Cancellation is explicit: window `blur`, `visibilitychange`, `pointercancel`,
`lostpointercapture`, and Escape all reset transient state so a lost key/pointer
cannot leave the editor stuck.

## 6. Remaining gaps / unsupported cases

| Area | Status |
|---|---|
| Keyboard panning (arrow keys move view) | Not implemented (arrows nudge selection) — accessible alternative via Hand tool + keyboard is WIP |
| Pen barrel-button action customization | Not exposed in settings |
| Gesture sensitivity settings | Not exposed (defaults follow platform) |
| `zoomBy`/`zoomAtScreenPoint`/`panToWorldPoint` convenience API | Absorbed by existing `commitCamera`/`computeZoom*`; not re-exported |
| Viewport-rotation gestures (touch twist) | Not implemented; rotation via toolbar/shortcuts only |
| Diagnostics HUD toggle | Ring buffer exists; opt-in via `?perf=1` query param. Exposed as `window.__strataPerf` (see `drawDiagnostics.ts`); input diagnostics module (`inputDiagnostics.ts`) provides a ring buffer of normalized events but does not currently expose a window global |

## 7. Manual hardware checklist (release gate)

Before shipping an input milestone, verify on each available device:

- [ ] Detented mouse wheel: pan, shift+wheel horizontal, ctrl+wheel zoom (focal point held).
- [ ] High-resolution (smooth-scroll) mouse wheel: pan is smooth, no jumps.
- [ ] Precision trackpad: two-finger scroll + pinch; pinch keeps the point under the fingers.
- [ ] Trackpad under Linux Wayland: pinch works or falls back without page zoom.
- [ ] Touchscreen: one-finger tool action, two-finger pinch/pan, no accidental select/draw.
- [ ] Pen display/tablet: stroke pressure, palm rejection (no stray strokes).
- [ ] Numpad with NumLock on: +/-/0/digits zoom; with NumLock off: navigation, no zoom.
- [ ] International layout: `+` requires Shift; `=` zoom-in; Shift+1 fit-all resolves physically.
- [ ] Text fields/dialogs: typing never triggers canvas zoom; Escape closes dialogs first.
- [ ] Window blur mid-drag: no stuck state; pointer cancel received.
