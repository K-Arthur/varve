# Viewport and Guides System

**Updated:** 2026-07-13

## Target Model

Varve currently has one production viewport and guide implementation in the
shared React editor package:

- `packages/editor/src/CanvasArea.tsx` owns the live canvas DOM event pipeline,
  draw scheduling, guide/ruler overlays, and tool dispatch.
- `packages/shared/src/viewport.ts` owns camera math.
- `packages/scene/src/document.ts` owns persisted document guides.
- `packages/editor/src/viewportSession.ts` owns per-tab viewport snapshot shape.
- `packages/editor/src/settings.ts` persists application-level view defaults.
- `apps/desktop` hosts the shared editor in Tauri 2. The configured Tauri app has
  one native window label, `main`; native multi-window viewport state is not
  implemented.
- `apps/web` is still a stub. The browser-runnable workflow today is the Vite
  frontend from `apps/desktop`, served in a normal browser tab for development
  and Playwright. Multiple browser tabs are independent page loads; there is no
  shared JS heap or BroadcastChannel-backed viewport synchronization.

The practical split is therefore:

| Concern | Tauri desktop | Browser dev/web |
|---|---|---|
| Viewport implementation | Shared editor DOM events inside the webview | Same shared editor DOM events |
| Window model | One configured native window today | One browser tab per load |
| In-app tabs | `EditorProvider` sessions, full viewport snapshots | Same |
| Native multi-window | Not implemented | Not applicable |
| Reserved shortcuts | OS-level list in Settings; app shortcuts via Tauri later | Browser-reserved list in Settings |
| File/fullscreen permissions | Tauri commands/capabilities available | Browser File System and Fullscreen APIs require browser permissions and user activation |

### Reserved shortcuts (browser build)

These shortcuts cannot be overridden in a normal browser tab and are surfaced
in **Settings → Keyboard Shortcuts** (see `reservedShortcuts.ts`):

| Shortcut | Browser action |
|---|---|
| `Ctrl/Cmd+W` | Close tab |
| `Ctrl/Cmd+T` / `Ctrl/Cmd+N` | New tab/window |
| `Ctrl/Cmd+Tab` | Switch tabs |
| `Ctrl/Cmd+Q` (macOS) | Quit browser |
| `F5` / `Ctrl/Cmd+R` | Reload |

The Tauri desktop build shows OS-reserved shortcuts in the same panel. App-level
global shortcuts can be registered via `tauri-plugin-global-shortcut` in the
future.

## Coordinate Spaces

The canonical camera transform lives in `@varve/shared/viewport`:

```
screen = T(pan) * T(viewportCenter) * R(rotation) * T(-viewportCenter)
       * S(zoom) * T(-floatingOrigin) * world
```

`pan` is stored in canvas-area CSS pixels. DPR is applied separately to the
Canvas2D context. The floating origin is recomputed from the camera to keep large
world coordinates numerically stable during replay.

When a caller has a real canvas viewport, it must pass that viewport to
`zoomAboutPoint`. The origin-aware path keeps the chosen world anchor stable at
the same screen coordinate across zoom changes, including view rotation. Calling
`zoomAboutPoint` without a viewport keeps the older zero-origin behavior for
legacy math tests and non-editor utility callers.

`clampCamera` is wired into `setPan` so panning cannot leave the document
entirely off-screen when content bounds are known.

## State Ownership

| State | Owner | Persistence |
|---|---|---|
| `zoom`, `pan`, `cameraRotation` | `EditorState` (active tab) | Per inactive tab in `sessionStoreRef` |
| `snapEnabled`, `pixelGridEnabled`, `rulerMode`, `gridOverlayMode`, `unitType`, `guidesVisible`, `snapGrid` | `EditorState` | Per inactive tab snapshot + `localStorage` defaults via `settings.viewport` |
| `selectedGuideId` | `EditorState` (ephemeral) | Not persisted |
| `Document.guides[]` | Document model (`pageId` per guide) | Saved with `.varve` file |
| Panel visibility | `settings.panel` | `localStorage` |

### Per-tab snapshot (`SavedViewport`)

Inactive tabs store a full `SavedViewport` via `captureViewport()`:

- `zoom`, `pan`, `cameraRotation`
- `snapEnabled`, `pixelGridEnabled`, `rulerMode`, `gridOverlayMode`, `unitType`, `guidesVisible`, `snapGrid`

Legacy snapshots containing only `zoom`/`pan` are normalized with defaults via
`normalizeSavedViewport()`.

New tabs reset camera to defaults and load view preferences from
`loadSettings().viewport`.

## Guides and Rulers

Guides are persisted on `Document.guides` with an optional `pageId` (document
format v1.7). Only guides on the active page render and participate in snapping.
Guides are not part of rendered/exported IR. Rulers and guide overlays are editor
UI layers only.

Current behavior:

- Dragging from the top ruler creates one vertical guide and moves that same
  guide during the drag.
- Dragging from the left ruler creates one horizontal guide and moves that same
  guide during the drag.
- Alt/Option while dragging a guide duplicates it (Figma convention).
- Right-clicking a guide opens the guide context menu for lock/unlock and delete.
- Locked guides cannot be dragged, but they remain visible and snap targets.
- `Ctrl+;` toggles guide visibility (`guidesVisible`); guides remain in the
  document and continue to snap when hidden.
- `Ctrl+Alt+;` locks all guides on the active page if any are unlocked,
  otherwise unlocks all on that page.
- Click a guide to select it; arrow keys nudge by 1px (Shift = 10px); Delete
  removes the selected guide; Escape clears selection.
- `Ctrl+C` / `Ctrl+V` with a guide selected copies/pastes guides (10px offset)
  via `guideClipboard.ts` (`application/vnd.strata+guides+json`).
- Status bar **Snap grid** `NumberInput` sets `snapGrid` (1–256 px), persisted
  in viewport settings and per-tab snapshots.
- Objects snap to permanent ruler guides when snapping is enabled. Guide snapping
  has lower priority than the explicit snap grid and higher priority than object
  edge/center snapping.

Guide creation returns the created guide id from `editor.addGuide(...)`. This is
used by the ruler so a drag can create once, then call `moveGuide(id, position)`
for subsequent pointer movement.

Layout guides, snap overlays, and ruler ticks use rotation-aware projection via
`guideGeometry.ts` / `rulerGeometry.ts`.

## Input Pipeline

Canvas navigation is driven by DOM events in `CanvasArea`:

- Pointer events route through `ToolManager` for drawing/selection tools.
- Touch two-pointer pinch bypasses tools and updates pan/zoom directly.
- Wheel events are attached natively with `{ passive: false }` so Ctrl/Cmd-wheel
  pinch-zoom can call `preventDefault()` instead of fighting browser page zoom.
- Wheel `deltaMode` is normalized: pixel, line, and page deltas are converted to
  CSS-pixel intent before applying pan/zoom.
- Pointer capture failures are caught and logged so drag-to-create tools do not
  silently abort before entering their drag state.

Browser and Tauri currently share this pipeline because Tauri forwards webview DOM
events. Native Tauri shortcut/window APIs are not used for viewport commands yet.

## Native Tauri E2E

Optional smoke coverage lives in `tests/e2e/tauri/smoke.spec.ts`, gated by
`VARVE_TAURI_E2E=1` and `scripts/tauri-e2e.sh` (requires `tauri-driver` +
WebDriver). PR CI uses Chromium Playwright only; see `tests/e2e/tauri/README.md`.

## Research Notes

Access date: 2026-07-13.

- Adobe Illustrator docs distinguish global and artboard rulers and describe
  creating guides by dragging from the top or left ruler:
  https://helpx.adobe.com/illustrator/desktop/measure-and-align/grids-and-guides/about-rulers.html
- Figma help documents layout guides, keyboard canvas navigation, and accessible
  guide adjustment workflows:
  https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames
- MDN `wheel` event docs confirm wheel events cover wheel-like trackpad devices
  and expose `deltaMode`; this drove native non-passive wheel handling plus
  delta-mode normalization:
  https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
- W3C Pointer Events and MDN PointerEvent docs confirm pointer capture and
  coalesced/predicted event concepts:
  https://www.w3.org/TR/pointerevents/
- Tauri 2 docs confirm windows/webviews are label-addressed; native multi-window
  is possible but not wired into Varve's viewport state today:
  https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/

## Shipped (2026-07-13)

1. P0 data integrity: full per-tab viewport snapshot (rotation + view prefs + snapGrid).
2. P0 data integrity: application-level view defaults in `settings.viewport`.
3. P1 guide visibility toggle (`Ctrl+;`) without deleting guides.
4. P1 lock/unlock all guides (`Ctrl+Alt+;`) scoped to active page.
5. P1 Alt-drag guide duplication.
6. P1 keyboard guide nudge/delete when a guide is selected.
7. P1 `clampCamera` wired into `setPan`.
8. P1 view-rotation parity for layout guides, snap overlays, and ruler ticks.
9. P2 page-scoped guides (`Guide.pageId`, migration v1.7).
10. P2 guide copy/paste across documents (`guideClipboard.ts`).
11. P2 snap grid UI in status bar + persistence.
12. P1 in-app reserved shortcut documentation (Settings → Keyboard Shortcuts).
13. P2 visual regression matrix: `guides-visual.spec.ts` (light/dark/high-contrast).
14. P2 performance benchmark: `guides1k.bench.test.ts` (1000 guides < 50ms).
15. P0/P1 native Tauri E2E harness (gated smoke + README + script).

## Verification

- `packages/editor/src/viewportSession.test.ts`: snapshot capture and legacy
  normalization (includes `snapGrid`).
- `packages/scene/src/document.test.ts`: guide ops, page scope, paste.
- `packages/editor/src/settings.test.ts`: viewport defaults in `loadSettings`.
- `packages/shared/src/viewport.test.ts`: viewport-aware zoom anchoring with
  floating origin and rotation; `clampCamera`.
- `packages/editor/src/tools/__tests__/snapping.test.ts`: snap-to-guide targets
  and priority.
- `packages/editor/src/canvas/rulerGeometry.test.ts`: rotation-aware ruler tick
  projection and pointer mapping.
- `packages/editor/src/components/Ruler/Ruler.test.tsx`: ruler drag guide creation.
- `packages/editor/src/guideClipboard.test.ts`: guide clipboard round-trip.
- `packages/editor/src/shortcuts/reservedShortcuts.test.ts`: browser target list.
- `packages/editor/src/components/GuideOverlay/__benchmarks__/guides1k.bench.test.ts`.
- `tests/e2e/canvas/guides.spec.ts`: interaction regression (Chromium).
- `tests/e2e/canvas/guides-visual.spec.ts`: theme snapshot matrix.
- `tests/e2e/tauri/smoke.spec.ts`: optional native smoke (gated).
