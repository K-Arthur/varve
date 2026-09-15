# Input System — Behavior Matrix (cross-platform)

Canonical behavior — refreshed 2026-09-13 on `master`

This matrix is the canonical statement of *intended* input behavior for the
Varve canvas. It accompanies the dated audits in
`docs/audits/`, including
[`drawing-input-quality-audit-2026-09-13.md`](../audits/drawing-input-quality-audit-2026-09-13.md).
The navigation-specific evidence, complaint ledger, and route limitations are
tracked in [`canvas-navigation-quality-2026-09-13.md`](../audits/canvas-navigation-quality-2026-09-13.md).
It separates the browser/PWA route from the Tauri/WebKitGTK route and records
the explicit contact-ownership contract as well as the existing zoom and
diagnostics behavior.

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
| Pinch (macOS WebKit) | Native `gesturestart/change/end` → cumulative scale with a world anchor that follows the moving gesture centroid. |
| Pinch (WebKitGTK/Tauri) | `canvas://pinch-zoom` bridge re-emits the page-zoom factor onto the artwork. |
| Momentum | OS momentum flows through; app does NOT double it (trackpad-classified events skip app inertia). |

### 2.3 Touchscreen

| Input | Behavior |
|---|---|
| One finger | Routed to the active tool by default. Settings > Drawing input can reversibly switch one-finger touch to viewport navigation. |
| Two-finger pinch | Combined pan + zoom around the gesture centroid. |
| Two-finger pan | Pans the viewport; the provisional first tool interaction is cancelled for that pointer only; no global undo or history entry is created. |
| Three or more fingers | Navigation-owned or ignored; never creates a path, selection change, or paint dab. |
| Return from pinch | A remaining finger stays navigation-owned; a new contact is required before drawing resumes. |
| Pointer cancel / capture loss | Cancels only the owning interaction; gesture state is reset idempotently. |

### 2.4 Stylus / pen

| Input | Behavior |
|---|---|
| Pen draw | Routed to the active tool; pressure/tilt/twist are preserved when events provide them. Missing/default values do not prove a sensor is present. |
| Eraser tip | Active eraser state uses button 5, the active `buttons` bitfield, or an explicit eraser channel; a transition value alone is not enough. |
| Barrel button | Button state is preserved for tools/diagnostics; no universal action is claimed. |
| Pen + touch coexistence | During a pen stroke, foreign touch/compatibility contacts are ignored; hovering and between-stroke navigation remain runtime-dependent. |

### 2.5 Keyboard (canvas focused)

| Shortcut | Behavior |
|---|---|
| `+` / `=` / numpad `+` (NumLock on) | Zoom in (1.25×), center-anchored. |
| `-` / numpad `-` (NumLock on) | Zoom out (0.8×), center-anchored. |
| `Ctrl/Cmd+0` / numpad `0` | Zoom to 100%. |
| `1`–`6` (no modifiers) | Zoom presets 50/75/100/150/200/400%. |
| `Shift+1` / `Shift+2` / `Shift+3` / `Shift+4` | Fit all / fit selection / fit active page / fit active frame. |
| Numpad digits (NumLock off) | Navigation keys (arrows/End/Insert), NOT zoom presets. |
| Arrow / Shift+Arrow with Hand active | Pan the viewport by 48 / 192 CSS pixels; does not depend on zoom and does not create an artwork undo entry. |
| Arrow | Move each eligible selected transform root by the configured small nudge amount in the requested world direction. |
| `Shift+Arrow` | Move each eligible selected transform root by the configured big nudge amount in the requested world direction. |
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

Arrow movement belongs to the active canvas owner. In the explicit Hand or
temporary Space-Hand context, Arrow and Shift+Arrow pan the viewport by 48 and
192 CSS pixels. Otherwise it does not claim a key from an input,
`contenteditable`, modal/dialog, or active IME composition; focused composite
widgets and specialized tools (for example the Layers tree, direct-node, and
crop editing) receive the event before generic object movement. An idle
creation tool that declines Arrow lets the canvas fallback handle a movable
selection. A movable selection prevents browser page scrolling. A selected
locked/hidden or flow-layout-managed root does not move; in a mixed selection,
eligible roots still move. See
[Nudge and movement](nudge-and-movement.md) for the complete contract and
Settings > Nudging & Movement for the local small/big amounts.

## 3. Zoom model

| Property | Value |
|---|---|
| MIN_ZOOM / MAX_ZOOM | 0.001 / 64 (`@varve/shared/viewport.ts`) |
| Discrete step | ×1.25 / ÷1.25 (`ZOOM_STEP_FACTOR`) |
| Presets | 0.5 / 0.75 / 1 / 1.5 / 2 / 4 |
| Continuous scale | `exp(-clampedDelta * 0.01)`, delta clamped ±24 |
| Focal-point zoom | `zoomAboutPoint` for a fixed pointer; `placeWorldPointAtScreen` for a moving pinch centroid; clamp before solving translation |
| 100% | 1 document unit per CSS pixel |
| UI zoom field range | 0.1–6400% (fractional; shared `MIN_ZOOM` / `MAX_ZOOM`) |
| Rotation | Supported; all transforms rotation-aware (affine) |
| Zoom entry points | Canvas keys, ActionRegistry shortcuts, StatusBar, Menubar, wheel, trackpad pinch, touch pinch, ZoomTool, minimap — all route through `commitCamera` / `computeZoom*` |

## 4. Platform support

| Platform | Runtime | Wheel pan | Ctrl+wheel zoom | Trackpad pinch | Touch | Pen | Keyboard |
|---|---|---|---|---|---|---|---|
| Windows | Tauri/WebView2 | Yes | Yes | Yes (ctrl+wheel) | Yes | Yes | Yes |
| macOS | Tauri/WKWebView | Yes | Yes | Yes (gesture events) | Yes | Yes | Yes |
| Linux Wayland/X11 | Tauri 2 + system WebKitGTK | Yes | Yes | Via bridge where available | Route-specific; synthetic only here | Unknown until WebKitGTK/device test | Yes |
| Browser/PWA | Chromium | Yes | Yes | Yes (ctrl+wheel) | Automated PointerEvent coverage; hardware pending | Automated normalization only; hardware pending | Yes |
| Browser | Firefox | Yes | Yes | Verify event model | Route-specific | Route-specific | Yes |
| Browser | Safari | Yes | Yes | Yes (gesture events) | Route-specific | Route-specific | Yes |

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
| Keyboard panning (arrow keys move view) | Implemented only in the explicit Hand/temporary Space-Hand context: Arrow = 48 CSS px, Shift+Arrow = 192 CSS px. Select, text, fields, trees, guides, and specialized tools retain arrow ownership. |
| Pen barrel-button action customization | Not exposed in settings |
| Gesture sensitivity settings | Wheel policy (standard/always pan/always zoom), 0.25×–4× sensitivity, and optional mouse-wheel continuation are exposed in Settings > Drawing Input. |
| Interactive preview quality | Settings > Performance exposes Automatic versus Full resolution while navigating; settled frames and exports remain authoritative. |
| `zoomBy`/`zoomAtScreenPoint`/`panToWorldPoint` convenience API | Absorbed by existing `commitCamera`/`computeZoom*`; not re-exported |
| Viewport-rotation gestures (touch twist) | Not implemented; rotation via toolbar/shortcuts only |
| Diagnostics HUD toggle | Ring buffer exists; opt-in via `?perf=1` query param. Exposed as `window.__varvePerf` (see `drawDiagnostics.ts`); input diagnostics module (`inputDiagnostics.ts`) provides a ring buffer of normalized events but does not currently expose a window global |
| Real USI Pen 2 pressure/tilt/eraser/palm behavior | Hardware truth is untested in this workspace; use the open checklist in [`drawing-input-quality-audit-2026-09-13.md`](../audits/drawing-input-quality-audit-2026-09-13.md). |
| Real on-screen keyboard appearance/dismissal | Inset model and surface adaptation implemented and unit/E2E-tested with synthetic geometry; real OSK is a device check |
| ChromeOS-reserved shortcut conflicts | Documented in section 8; no app code change required (menu/palette provide alternatives) |

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
- [ ] Selected-object arrows: bare Arrow moves 1 document unit, Shift+Arrow moves 10, independently of zoom and without browser page scrolling.
- [ ] Hand tool: bare Arrow pans 48 CSS px and Shift+Arrow pans 192 CSS px; Select/text/fields still retain their arrow behavior.
- [ ] Multi-selection arrows: every eligible root moves by the same world delta; spacing and hierarchy remain unchanged.
- [ ] Held Arrow: repeat movement is responsive, creates one undo interaction, and blur/visibility loss cannot leave it open.
- [ ] Window blur mid-drag: no stuck state; pointer cancel received.

## 8. ChromeOS and browser-route constraints

Research basis: ChromeOS Help "Chromebook keyboard shortcuts" and "Use your
Chromebook touchpad" (Google, accessed 2026-09-12; ChromeOS stable 152).
Reserved combinations are owned by the OS/browser and cannot be intercepted by
page code. These are discovered from the documentation and observed on Chrome
for desktop; they are not yet re-verified on the Duet.

### 8.1 Reserved by the browser/OS (do not rely on these in the browser route)

| Reserved input | Consequence for Varve |
|---|---|
| `Ctrl+1` … `Ctrl+8` | Switches browser tabs. Varve workspace shortcuts deliberately use `Ctrl+Shift+1`…`7`/`9`, which is not reserved. |
| `Ctrl+T`, `Ctrl+N`, `Ctrl+W` | Browser tabs/windows. Varve's "New tab"/"Close Document" bindings only resolve inside Tauri; in the browser use the tab strip, File menu, or command palette. |
| `Ctrl+H`, `Ctrl+J` | History/Downloads. Not bound by Varve. |
| `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C` | Developer Tools. `Ctrl+Shift+I` (Invert Selection) is unreachable in the browser; use Edit > Invert Selection or the palette. |
| `Ctrl+P`, `Ctrl+S`, `Ctrl+O`, `Ctrl+D`, `Ctrl+F` | Print/Save/Open/Bookmark/Find-in-page. Varve's own Print/Save/Open/Find actions must be invoked from the menu, palette, or toolbar in the browser route; the app cannot guarantee the page handler wins for these. |
| `Ctrl+Shift++` / `Ctrl+Shift+-` / `Ctrl+Shift+0` | Changes the ChromeOS screen resolution. Varve's zoom uses `Ctrl+=` / `Ctrl+-` / `Ctrl+0` (no Shift). |
| `Alt+=` / `Alt+-` / `Alt+[` / `Alt+]` | Maximize/minimize/dock. Not bound by Varve. |
| `Ctrl+Space` / `Ctrl+Shift+Space` | Keyboard-language switch / emoji picker. Not bound by Varve. |
| `Alt+Backspace` | Forward delete in text fields. Varve's canvas Delete is bare `Backspace`, which text inputs consume normally. |
| `Search`/`Launcher` combinations | OS shortcuts (e.g. Search+L lock, Search+Alt caps lock). Varve binds none. |
| Three-finger swipes | Browser tab switching / overview. Varve navigation must never require three fingers; canvas gestures use one or two. |
| Two-finger tap on the touchpad | Right-click. The canvas context menu is reachable by right-click and by touch/pen long-press. |
| `Alt`+click on the touchpad | Right-click. Two Varve interactions assume `Alt` as a modifier: the Zoom tool's Alt+click zoom-out and BaseTool's Alt-drag "draw from centre". On a Chromebook touchpad these arrive as right-clicks and open the context menu instead. Keyboard-free alternatives: the status-bar zoom stepper / zoom field for zoom-out, and the Inspector geometry fields for centre-anchored sizing. |

### 8.2 Touch and pen policy (as implemented and tested in emulation)

| Input | Behavior | Evidence |
|---|---|---|
| One-finger touch | Follows the persisted Drawing input preference: draw by default, or viewport navigation | `inputPolicy` unit tests + `tests/e2e/interaction/drawing-input.spec.ts`; physical touch pending |
| Two-finger touch | Pan + zoom about the centroid; second contact cancels only the first pointer’s provisional tool interaction | `inputPolicy` unit tests + `drawing-input.spec.ts`; physical touch pending |
| Touch long-press | Opens the deep-selection menu (SelectTool, `LONG_PRESS_MS`) | unit tests + implementation |
| Touch multi-select | Toolbar toggle (`state.touchMultiSelect`) with marquee suppression | E2E and unit tests |
| Pen | Pressure/tilt/twist normalized when reported; missing data falls back to constant pressure, never dropped; observed capabilities remain separate from API availability | `inputNormalizer` unit tests; synthetic E2E; physical pressure pending |
| Pen + touch | Foreign contacts cannot cancel or merge into an active pen stroke | `inputPolicy` unit tests + synthetic E2E; real arbitration is a device check |
| Eraser tip | Active state uses button 5 or the active button/channel state | `inputNormalizer` unit tests; hardware behavior pending |
| Palm touches | The runtime’s palm rejection is not claimed; ignored-contact heuristics are scoped and recoverable | device checklist |

### 8.3 Coarse-pointer target policy

- WCAG 2.2 SC 2.5.8 floor: every interactive control must be at least
  24x24 CSS px, or satisfy the spacing exception.
- The project goal is 44 CSS px (`--touch-target-min`) for primary controls:
  drawer FABs, workspace dock, floating text bar, and shared form controls.
- Compact chrome (menubar items, status bar toggles/zoom stepper, tabs, save
  badge, debt badge) keeps its 36px/28px bar heights but grows every control
  to a 24px minimum hit box under `@media (pointer: coarse), (any-pointer:
  coarse)`.
- Automated check: `tests/e2e/interaction/chromeos-device-matrix.spec.ts`
  (`primary chrome meets the 24 CSS px target floor`) measures every button in
  the menubar, status bar, floating toolbar, and FAB cluster at 800x1280 with
  a coarse pointer and fails on any visible control below 24px.
- Portrait menubar: the workspace switcher is icon-only (32px, 44px under a
  coarse pointer), the menu strip scrolls instead of clipping options, and the
  document title and menubar zoom are hidden because the tab strip and status
  bar already expose them. Asserted by the `portrait menubar compaction` E2E.

### 8.4 Virtual keyboard

- The editor publishes `--keyboard-inset-bottom`, `--visual-viewport-height`,
  and `--visual-viewport-offset-top` (see
  [`responsive-workspace.md`](./responsive-workspace.md)).
- Dialogs, toasts, and drawer triggers adapt; the canvas itself continues to
  receive visual-viewport resize events through `canvasSurface.ts`.
- No page zoom is disabled, and no `preventDefault` is called on viewport
  events, so OS-reserved gestures and accessibility zoom keep working.
- Real OSK verification (caret, commit controls, restore after dismissal) is
  on the Duet checklist.

### 8.5 System back gesture and orientation (tablet mode)

| Input / condition | Behavior | Evidence |
|---|---|---|
| Left-edge swipe with a menu, popover, or dialog open | Dismisses the topmost layer with Escape semantics; the document is not left and the URL does not change; a second swipe dismisses the next layer | E2E `system back dismisses an open menu instead of leaving the editor`; guard cleanup test |
| Back with no layers open | Normal browser/deep-link history behavior; no guard is pushed | `TabletBackDismiss` + deep-link guard skip |
| Portrait compact width | Inspector/library/logo present as bottom sheets; layers stays a side drawer | E2E portrait sheet test; screenshots inspected |
| Landscape compact width (`<=899px`) | Supplementary panels stay right side drawers | E2E landscape test |
| `>899px` | Regular docked columns | viewport matrix + rotation test |
| Rotation mid-gesture | `pointercancel` rolls the gesture back; no stuck tool, no partial undo entry; the next gesture works | E2E `rotation mid-gesture does not leave a stuck interaction` |
| Rotation with a panel open | Panel stays open and re-presents (sheet ↔ drawer/docked); document, selection, and scroll state are untouched | E2E rotation presentation test |

The OS back gesture starts in a narrow left-edge inset and cannot be claimed
by page content; a canvas stroke that intersects it receives `pointercancel`
and is rolled back. ChromeOS-reserved combinations remain documented in
section 8.1.

### 8.6 Keyboard-free alternatives (WCAG 2.2 SC 2.5.7)

Every drag- or modifier-dependent core action has a single-pointer or
field-based equivalent:

| Function | Pointer path | Non-drag / keyboard-free alternative |
|---|---|---|
| Move | drag the object | Inspector Position & Size X/Y fields; Arrow / Shift+Arrow nudge |
| Resize | drag a handle | W/H fields; the **Constrain proportions** lock preserves the aspect ratio while typing |
| Context actions | right-click | touch/pen long-press deep-selection menu |
| Multi-select | Shift/Ctrl+click | touch multi-select toggle in the floating toolbar |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Edit menu items (also the menubar icon buttons); E2E verified at 800x1280 |
| Canvas navigation | drag / wheel | status-bar zoom stepper and field; Hand tool; keyboard zoom |
| ChromeOS function keys | top-row keys are actions (F1 = Back) | `Search`/`Launcher` + key, or the Help menu; Delete is `Backspace`, forward-delete is the OS `Alt+Backspace` and is not required by any Varve action |
| Text editing | double-tap/double-click into a text node | FloatingTextBar fields; Inspector Typography fields |

E2E evidence: `numeric inspector fields move and constrain a selection without
dragging`, `undo and redo are reachable and effective without a keyboard`,
`a tap selects without moving the object`.
