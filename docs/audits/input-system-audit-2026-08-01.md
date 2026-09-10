# Input System Architecture Audit — 2026-08-01

Branch: `feat/input-system` (from `ee73a115`)

## Executive summary

The Strata input system is **substantially more mature than a greenfield
audit would assume**. The core infrastructure already exists:

- **Single viewport source of truth** (`@varve/shared/viewport.ts`) with
  correct focal-point zoom (`zoomAboutPoint`), rotation-aware affine
  transforms, `clampZoom`, `stepZoom`, and `screenDeltaToWorld`.
- **Centralized input pipeline** (`canvas/inputPipeline.ts`) handling
  pointer, wheel, keyboard, touch pinch, WebKit gesture events, and a
  Tauri pinch bridge for WebKitGTK.
- **Pointer Events-first** on the canvas (no mouse/pointer double-handling).
- **Stylus normalization** (`tools/inputNormalizer.ts`) preserving pressure,
  tilt, twist, coalesced/predicted events.
- **Non-passive wheel listener** (can `preventDefault`).
- **Narrow `touch-action: none`** scope (canvas layers only, not app-wide).
- **Context suppression** for IME, contenteditable, inputs, ARIA roles.
- **Middle-button pan** via HandTool. **Spacebar spring-loaded hand tool**.

The audit found **6 real bugs** and **~14 gaps** worth fixing. This document
inventories them; subsequent commits address them with tests.

---

## 1. Current handler inventory

### 1.1 Ownership boundaries

| Layer | Owner | Events | Attachment |
|-------|-------|--------|------------|
| Canvas pointer/keyboard | `CanvasArea.tsx:2778-2786` → `inputPipeline.ts` | pointerdown/move/up/cancel, keydown/up, dblclick, blur | React props on `<canvas>` |
| Canvas wheel/gesture | `inputPipeline.ts:429-434` | wheel, pointermove(track), pointerleave, gesturestart/change/end | `addEventListener` (non-passive wheel) |
| Tauri pinch bridge | `inputPipeline.ts:402-427` | `canvas://pinch-zoom` IPC | `@tauri-apps/api/event.listen` |
| Global shortcuts | `shortcuts/useShortcuts.ts:194` | keydown | `window.addEventListener` |
| Dialog/modal Escape | ~15 components | keydown (capture) | `window`/`document` per dialog |
| Context menu | `CanvasArea.tsx:2716` | contextmenu | React prop |

**Finding:** Listener attachment is split across CanvasArea (React props),
inputPipeline (addEventListener), and useShortcuts (window). This is
acceptable — each owns a distinct concern — but there is **no single
"input reset" function** that clears all transient state.

### 1.2 Input pipeline flow

```
DOM pointerdown
  → CanvasArea.tsx:2782 (onPointerDown)
  → inputPipeline.ts:123 (handlePointerDown)
  → inputPipeline.ts:147 (tmInst.handlePointerDown)
  → ToolManager.ts:173 → BaseTool.onPointerDown
  → ctx.setPointerCapture + drag state init

DOM wheel
  → inputPipeline.ts:429 (addEventListener, non-passive)
  → inputPipeline.ts:337 (onWheel)
  → ctrl/meta: zoomAboutClientPoint (zoom)
  → shift: horizontal pan
  → default: 2D pan + inertia
  (does NOT go through ToolManager)

DOM keydown
  → CanvasArea.tsx:2779 (onKeyDown)
  → inputPipeline.ts:447 (handleKeyDown)
  → space: springLoadTool('hand')
  → tool.onKeyDown → zoom presets / +/- / fit / escape
```

### 1.3 Viewport API (already consolidated)

`@varve/shared/viewport.ts` is the single source of truth:
- `zoomAboutPoint(cam, worldAnchor, newZoom, viewport)` — closed-form,
  absolute recomputation (no drift). Used by wheel, pinch, gesture, keyboard.
- `clampZoom` enforced at all entry points. `MIN_ZOOM=0.001`, `MAX_ZOOM=64`.
- `screenDeltaToWorld` — rotation-aware. Used by `context.tsx:3370`.
- `stepZoom` / `ZOOM_STEP_FACTOR=1.25` for discrete controls.

**One duplicate:** `ZoomTool.ts:59-69` marquee uses custom pan math instead
of `centerBoundsCamera`. Mathematically equivalent but duplicates logic and
ignores rotation.

**One rotation bug:** `ViewportContext.tsx:231` `canvasDeltaToWorld` does
`dx/zoom` without rotation, unlike the shared `screenDeltaToWorld`. (The
tools receive the correct version from `context.tsx:3370`, but the
ViewportContext surface is wrong.)

---

## 2. Confirmed bugs

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B1 | `+` key zoom is dead code: `e.key === '+'` gated on `!e.shiftKey`, but `+` requires Shift | `inputPipeline.ts:567` | Pressing `+` (Shift+=) does not zoom in |
| B2 | `canvasDeltaToWorld` ignores rotation | `ViewportContext.tsx:231` | Wrong delta when view is rotated |
| B3 | ZoomTool marquee duplicates pan math, ignores rotation | `ZoomTool.ts:59-69` | Marquee zoom wrong when rotated |
| B4 | No window-blur modifier reset | (missing) | Stuck Ctrl/Shift after alt-tab |
| B5 | Escape does not cancel active tool drag globally | `inputPipeline.ts:512` | Drag stuck if tool doesn't handle Escape |
| B6 | Mouse side buttons (3/4) not intercepted | (missing) | Browser back/forward nav on canvas |

## 3. Gaps

> Status legend (2026-08-01, Milestones 2–4/7): `FIXED` items are resolved by
> the commits listed in §7; `OPEN` items remain.

| # | Gap | Status |
|---|-----|--------|
| G1 | No `overscroll-behavior` on scrollable panels | FIXED (`global.css:17` + panel `contain`) |
| G2 | No `-webkit-touch-callout` / `-webkit-tap-highlight-color` | FIXED (`global.css:18-19`) |
| G3 | No trackpad vs mouse-wheel classification | FIXED — `resolveWheelAction` classifies and adapts (inertia only for mouse; focal-point zoom for ctrl+wheel) |
| G4 | `fitActivePage`/`fitActiveFrame` shortcuts have no canvas handlers | FIXED — physical-key matching makes global `Shift+3`/`Shift+4` work on any layout |
| G5 | No numpad zoom support | FIXED — numpad `+`/`-`/`0`/`1-6` zoom with NumLock on; NumLock-off keys navigate |
| G6 | No `lostpointercapture` listener | FIXED (commit `a835f273`) |
| G7 | No `visibilitychange` reset | FIXED (commit `a50204cd`) |
| G8 | Platform detection duplicated 6+ locations | FIXED (commit `a835f273` → `@varve/platform`) |
| G9 | Coalesced events only used by brush tools | OPEN (pen/brush path; low priority) |
| G10 | No formal interaction state machine | PARTIAL — navigation layer is a documented explicit state machine (§5 of the behavior matrix); tools still own their own drag state |
| G11 | No input diagnostics surface | FIXED — `inputDiagnostics.ts` bounded ring buffer (dev-only opt-in) |
| G12 | Pen/touch grouped for long-press in SelectTool | OPEN |
| G13 | Gesture event listeners don't specify `{ passive: false }` explicitly | FIXED (commit `3a16a0c6`) |
| G14 | React rerenders on every wheel/pinch event | PARTIAL — `commitCamera` writes `stateRef` synchronously; full ref-based gesture path is follow-up |

---

## 4. Behavior matrix (current state)

| Device | Action | Status | Notes |
|--------|--------|--------|-------|
| Mouse wheel | Pan (2D) | ✅ | With inertia, deltaMode normalized |
| Mouse Ctrl+wheel | Zoom at cursor | ✅ | Exponential curve, clamped |
| Mouse Shift+wheel | Horizontal pan | ✅ | No inertia |
| Mouse middle-drag | Pan | ✅ | Via HandTool |
| Mouse right-click | Context menu | ✅ | Native suppressed, custom shown |
| Mouse side buttons | — | ❌ B6 | Not intercepted |
| Trackpad 2-finger scroll | Pan | ✅ | Via wheel, pixel mode |
| Trackpad pinch (Chromium) | Zoom at cursor | ✅ | ctrlKey+wheel signal |
| Trackpad pinch (WebKit) | Zoom at gesture point | ✅ | gesturestart/change/end |
| Trackpad pinch (WebKitGTK) | Zoom via Tauri bridge | ✅ | Rust intercepts page zoom |
| Touch 1-finger | Tool action | ✅ | Routed to active tool |
| Touch 2-finger pinch | Zoom + pan | ✅ | Centroid + distance |
| Touch 3+ finger | Ignored | ⚠️ | `size > 2` returns early |
| Pen draw | Tool action | ✅ | Pressure/tilt preserved |
| Pen eraser | Detected | ✅ | button === 5 |
| Pen barrel button | — | ⚠️ | Not configurable |
| Keyboard +/- | Zoom | ⚠️ B1 | `+` (Shift+=) dead |
| Keyboard 0 | 100% | ✅ | Ctrl/Cmd+0 |
| Keyboard 1-6 | Presets | ✅ | 50/75/100/150/200/400% |
| Keyboard Shift+1 | Fit all | ✅ | |
| Keyboard Shift+2 | Fit selection | ✅ | |
| Keyboard Shift+3/4 | Fit page/frame | ❌ G4 | No canvas handler |
| Keyboard Space | Hand tool | ✅ | Spring-loaded, 150ms delay |
| Keyboard Escape | Cancel | ⚠️ B5 | Only isolation/selection, not drag |
| Numpad +/-/0 | Zoom | ❌ G5 | Not handled |

---

## 5. Platform detection duplication

| Location | Check | Should use |
|----------|-------|------------|
| `ShortcutManager.ts:666` | `navigator.platform.includes('mac')` | `@varve/platform` |
| `InteractionContext.ts:84` | `/Mac\|iPod\|iPhone\|iPad/.test(navigator.platform)` | `@varve/platform` |
| `Menubar.tsx:1339` | `navigator.platform.includes('mac')` | `@varve/platform` |
| `SelectionOverlay.tsx:668` | Mac detection | `@varve/platform` |
| `inputNormalizer.ts:88` | `/AppleWebKit/.test(ua) && !/Chrome/.test(ua)` | `@varve/platform` |
| `adaptiveProfile.ts:83` | WebKitGTK detection | `@varve/platform` |

`@varve/platform` already has `detectOs()` and `detectRuntimeKind()` but
does not expose an `isMac()` or `isWebKitGTK()` helper for input code.

---

## 6. What already works well (do not break)

- `viewport.ts` math — correct, consolidated, rotation-aware, drift-free.
- Wheel zoom focal point — correct at cursor for all zoom paths.
- Touch pinch — centroid + distance, combined pan+zoom.
- WebKit gesture events — macOS trackpad pinch.
- Tauri pinch bridge — WebKitGTK page-zoom interception.
- Stylus pressure/tilt/twist — preserved through `inputNormalizer`.
- Pointer Events on canvas — no mouse double-handling.
- Non-passive wheel listener — `preventDefault` works.
- `touch-action: none` scope — narrow (canvas layers only).
- Context suppression — IME, contenteditable, inputs, ARIA roles.
- Spring-loaded hand tool — spacebar with 150ms delay, blur releases.
- Auto-pan — edge velocity during drag, frame-scheduled.
- Wheel inertia — velocity smoothing, capped, decays.

---

## 7. Implementation record (2026-08-01)

| Commit | Milestone | Contents |
|--------|-----------|----------|
| `1212313e`, `a50204cd` | M3 pre-work | B1 `+`/`=` zoom, rotation-aware `canvasDeltaToWorld`, ZoomTool marquee, window-blur modifier reset, Escape drag cancel, side-button intercept |
| `3a16a0c6`, `a835f273` | M3/M4 pre-work | Wheel classification module, overscroll/touch CSS, explicit gesture passive flags, `lostpointercapture`, platform detection consolidation |
| `83a16aa6` | M2 + M3 + M4 | Physical-key shortcut matching (`input/physicalKey.ts`), `resolveWheelAction` in the live wheel path, anchored `ViewportContext.setZoom` |
| `555817e1` | M7 | Input diagnostics ring buffer (`inputDiagnostics.ts`) + wheel-handler integration |
| `b57c2eb3` | M3 follow-up | NumLock-off numpad navigation correctness; E2E `input-navigation.spec.ts` |

Companion documents:
- `docs/architecture/input-system-behavior-matrix.md` — intended behavior per device × modifier.
- `docs/architecture/input-system-behavior-matrix.md#7-manual-hardware-checklist-release-gate` — manual hardware checklist (release gate).


