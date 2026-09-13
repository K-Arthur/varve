# Responsive workspace and viewport contract

Applies to the editor shell on every surface (browser tab, installed PWA,
Tauri desktop). Canvas rendering, adaptive profiles, and input semantics stay
in their own documents; this one covers how the shell reflows and how
viewport-changing conditions (on-screen keyboard, browser zoom, DPR) are
handled.

## Breakpoints

| Condition | Behavior |
|---|---|
| `> 899px` width | Desktop grid. Layers, inspector, and library are docked columns; panel widths are user-resizable and persisted per workspace. |
| `<= 899px` width | Drawer mode. Layers/library/inspector become fixed drawers translated offscreen; the canvas takes the full grid width. Drawer triggers are the three `.editor__fab` buttons. |
| `<= 640px` width | Compact menubar: the document title center block is hidden, menu items compress, and the menubar zoom controls move to the status bar. |
| `html { min-width: 320px }` | Absolute floor only. 320 CSS px is the WCAG 1.4.10 reflow width; the shell must never force horizontal page scrolling at supported viewport sizes, including split-screen. |

The former `min-width: 600px` floor predated drawer mode and caused horizontal
drift in split-screen; it was removed in `f76d98eb1`.

## Drawers and focus

- Drawers are modal surfaces: opening one moves focus inside, Tab is trapped,
  Escape and the backdrop close it, and focus returns to the trigger
  (`Shell.tsx`). Hidden drawers stay mounted (`visibility: hidden`) so panel
  state, scroll position, and selection survive breakpoint changes.
- Drawers carry `role="dialog"` and `aria-expanded`/`aria-controls` on their
  triggers.
- Desktop panel visibility (`Ctrl+B` / `Ctrl+Shift+B`) and per-workspace panel
  configuration remain the source of truth; drawer visibility is local UI
  state layered on top.

## Lower-edge geometry

The status bar, selection info strip, floating toolbar, and drawer FABs all
live near the viewport bottom. The FABs must never cover toolbar controls:

- `FloatingToolbar` publishes its rendered height as
  `--floating-toolbar-height` on the document element (ResizeObserver; removed
  on unmount). This covers drawing mode's extra brush-controls block and
  responsive overflow changes.
- At `<= 899px`, `.editor__fab` bottom is
  `statusbar + 28px (selection info strip) + space-3 + toolbar height + space-2 + keyboard inset`.
- The regression is asserted in
  `tests/e2e/interaction/chromeos-device-matrix.spec.ts`
  ("bottom chrome clearance"), which checks Design and Draw modes.

## Virtual keyboard / visual viewport

`packages/editor/src/canvas/keyboardInset.ts` publishes three custom
properties on the document element; `KeyboardInsetPublisher` (mounted once in
`apps/desktop/src/App.tsx`) owns the subscription:

| Property | Meaning |
|---|---|
| `--keyboard-inset-bottom` | Keyboard height in CSS px, `0px` when closed or unknown |
| `--visual-viewport-height` | Current visual viewport height in CSS px |
| `--visual-viewport-offset-top` | Visual viewport offset from the layout viewport top |

Signal order: `navigator.virtualKeyboard.boundingRect` when the API reports a
nonzero rect, otherwise the layout-minus-visual height delta. Pinch-zoom is
excluded from the derivation (`scale > 1.05` or a width collapse is not a
keyboard). The page never sets `overlaysContent`, never calls
`preventDefault` on viewport events, and never disables page zoom.

Consumers:

- Dialogs: `max-height` uses `var(--visual-viewport-height, 100dvh)` so the
  sticky footer stays reachable while the keyboard is open.
- Toasts and drawer FABs subtract `--keyboard-inset-bottom` from their bottom
  offsets.
- `FloatingPortal` clamps a placed popover into the visual viewport (unzoomed
  case) and caps its height when the popover is taller than the visible area;
  under pinch zoom it keeps the layout-viewport clamp.

Real on-screen keyboard behavior (installed PWA vs tab, caret visibility,
restore after dismissal) remains a Duet hardware check — the automated tests
inject synthetic geometry.

## Portrait and landscape presentation

Platform guidance (Apple HIG and WWDC inspector/sidebar sessions; ChromeOS
large-screen guidance) treats orientation as a width change, not a separate
screen: adapt non-destructively, present inspectors as sheets in compact
widths, and keep navigation as an overlay.

| Condition | Supplementary panels (inspector, library, logo) | Layers |
|---|---|---|
| `<= 899px` + portrait | Bottom sheet: full width, `min(72dvh, 560px)` tall, rounded top, safe-area padded; slide up from the bottom | Left side drawer |
| `<= 899px` + landscape | Right side drawer | Left side drawer |
| `> 899px` | Docked column (unchanged) | Docked column |

Open panel state survives rotation: the panel stays mounted and adapts its
presentation between sheet and drawer/docked forms. Bottom-anchored chrome
(FABs, toasts) adds `env(safe-area-inset-bottom)` so standalone PWA landscape
never sits under the gesture bar.

## Platform back gesture (ChromeOS tablet mode)

ChromeOS tablet mode maps a left-edge swipe to a browser Back navigation.
`packages/editor/src/navigation/TabletBackDismiss.tsx` (mounted once in
`apps/desktop/src/App.tsx`) turns that into native-app behavior:

- While any registered overlay or native `<dialog>` is open, one same-URL
  history entry (the guard) is pushed.
- A back gesture pops the guard and dismisses the topmost layer by dispatching
  an Escape key press on the focused element — the exact same path a physical
  Escape takes, so menubar keynav, the overlay registry, and dialog
  dismissible/nested rules all stay authoritative.
- If layers remain, one guard is re-pushed per layer, so each back gesture
  closes exactly one surface.
- Closing the last layer from the UI removes the guard, leaving no dead
  history entry. Deep links skip guard entries via `OVERLAY_GUARD_FLAG`.
- Registry count changes are exposed by `subscribeToOverlayCount`; native
  dialogs are observed through their `open` attribute.

The OS gesture itself cannot be prevented and starts at the extreme left edge;
a canvas gesture that intersects it receives `pointercancel`, which the tool
layer already rolls back without leaving an undo entry or stuck drag.

## Panel recovery

- View menu: **Reset Window Layout** (`resetPanelWindowLayout`) restores panel
  docking placement after a multi-display change.
- **Bring All Panels to Current Display** handles detached panel windows.
- Desktop panel visibility toggles are `Ctrl+B` (left) and `Ctrl+Shift+B`
  (right) on desktop routes; in the browser, `Ctrl+Shift+B` is the ChromeOS
  bookmarks-bar shortcut and the View menu and command palette remain the
  reliable paths.

## Test coverage

- `tests/e2e/interaction/chromeos-device-matrix.spec.ts` — 21 Chromium tests:
  viewport matrix (960x600, 1200x750, 1280x800, 600x960, 800x1280, 480x640,
  640x400 as the 200%-zoom equivalent), fractional DPR 1.25, coarse-pointer
  target floor, one-finger touch, tap-does-not-move, two-finger pinch,
  synthetic pen pressure, keyboard-inset publication, bottom-chrome
  clearance, system-back menu dismissal, guard cleanup, portrait bottom
  sheets, landscape side drawers, rotation presentation switching, and
  rotation mid-gesture.
- `tests/e2e/a11y/responsive-panels.spec.ts` — drawer focus trap and return.
- `packages/editor/src/canvas/__tests__/keyboardInset.test.ts` — pure model
  and subscription behavior.
- `packages/ui/src/components/overlayGeometry.test.ts` — visual-viewport
  clamp rect.
