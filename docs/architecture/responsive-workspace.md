# Responsive workspace and viewport contract

Applies to the editor shell on every surface (browser tab, installed PWA,
Tauri desktop). Canvas rendering, adaptive profiles, and input semantics stay
in their own documents; this one covers how the shell reflows and how
viewport-changing conditions (on-screen keyboard, browser zoom, DPR) are
handled.

## Breakpoints

| Condition | Behavior |
|---|---|
| `> 899px` width, desktop presentation | User-sized Layers and Inspector columns remain docked; panel widths persist per workspace. |
| `> 899px` width, tablet presentation | The tablet shell reserves a stable Inspector rail and opens Layers as a dismissible side drawer. User-customized floating docks remain in place. |
| `<= 899px` width | Compact drawer layout. Layers and Resources use dismissible drawers; the canvas fills the available grid width. Primary panel controls remain separate, at least 44×44 CSS px. |
| `<= 899px` + portrait | Two-tier top bar: application menus stay on the first line, with the workspace switcher and undo/redo grouped on the second line. The active workspace keeps its name when it fits, then compacts to its icon in the narrowest strips. Menu, home, workspace, and history actions use a consistent 44px target rhythm; the menu strip can scroll rather than clip. The duplicate document title and zoom controls are hidden. Inspector uses a shallow nonmodal lower pane; Resources remains a modal sheet. |
| `<= 1094px` width | Hide the duplicate menubar document title so the application menu rail and workspace/history controls never compete for the same space; the document tab retains its name. |
| `<= 640px` width | Compact menu labels and hide menubar zoom controls. Portrait keeps the two-tier navigation/control grouping; landscape retains one row and allows the menu rail to scroll. |
| `html { min-width: 320px }` | Absolute floor only. 320 CSS px is the WCAG 1.4.10 reflow width; the shell must never force horizontal page scrolling at supported viewport sizes, including split-screen. |

Tablet presentation removes the dock's tiny numbered keyboard badges to keep
the switcher visually quiet. Workspace shortcuts remain registered and
discoverable through each switcher's tooltip and accessible shortcut names.

`appearance.layoutPreference` is persisted as `auto`, `tablet`, or `desktop` and
is independent of density and the one-finger drawing policy. Auto uses viewport
width, pointer capabilities, and observed touch/pen contacts: through 899 CSS px
it selects tablet controls on touch-capable surfaces; through 1280 px it prefers
tablet presentation when touch is available; at wider sizes it keeps tablet
presentation for coarse-only input or observed touch/pen use. Manual choices
remain authoritative while the CSS still reflows to fit. The browser cannot
reliably detect whether a detachable keyboard is physically attached, so Varve
does not claim to detect keyboard attachment or an operating-system tablet-mode
switch. Presentation changes wait until active contacts and IME composition end.

The View menu and Appearance settings expose the same preference. Changing it
does not remount panels or discard their selection, scroll position, active
tool, camera, or history. Tablet controls target 44×44 CSS px; the separate
WCAG 2.2 AA target-size minimum is 24×24 CSS px, with spacing exceptions for
dense controls. Geometry regressions check target size and overlapping hit
regions at the viewport matrix in `tests/e2e/interaction/chromeos-device-matrix.spec.ts`.

Appearance also stores `tabletControlsMirrored` independently from the layout
choice. It mirrors the Layers, Inspector, and Resources launchers for alternate
reach; it does not change desktop dock ownership or panel visibility. The
tablet toolbar's Editing controls popover supplies latched Constrain, From
centre, and Bypass snap modifiers, plus a one-shot deep-select action for the
next canvas tap, Duplicate, alignment, and layer-order commands. From centre
applies to creation tools and selection-handle resizing. The existing
Alt-drag duplicate gesture remains unchanged while Select is active. Modifiers
remain latched until explicitly toggled off.

The former `min-width: 600px` floor predated drawer mode and caused horizontal
drift in split-screen; it was removed in `f76d98eb1`.

### Workspace switcher across the breakpoints

The switcher changes surface treatment exactly once, at the same `899px`
boundary the drawers use
(`docs/audits/workspace-switcher-design-review-2026-09-29.md` F2):

- `> 899px`: a raised card inside the single-row menubar — the card is what
  groups the segmented control against undo/redo and the zoom field.
- `<= 899px`: a flat part of the top bar (transparent container, no shadow), in
  both orientations. In landscape the card's 8px shadow spread painted over the
  last application-menu label; in portrait the card reproduced the floating
  toolbar's surface on the row above it. Only the container flattens — the
  active pill keeps its opaque accent fill, so the current workspace stays the
  most prominent item in the strip.

The active workspace is named at every width where the measurement can fit it,
including phone-width landscape. `computeWorkspaceLayout` reads *rendered* tab
widths, so no width query may collapse the active label: a CSS-collapsed label
measures as zero and the pill then never compacts for the right reason (the
masked form of this bug hid the name at 640×400 while the row held 96px of
unused space — F5). Below the fit threshold the pill compacts to its icon and
the name stays in the tooltip and the accessible name.

The same tier constrains the application menu rail
(`.editor-menubar__left { min-width: 0; flex-shrink: 1; overflow-x: auto }`,
hidden scrollbar). `.editor-menubar__side` and `.editor-menubar__controls` are
both `flex: 1 1 0` so the document title sits on the bar's true midpoint; below
900px the title is hidden but the symmetry still gives the menus half the bar,
which is less than their min-content width between 641px and ~750px. Without
`min-width: 0` the rail painted outside its own box and, because the controls
follow it in the DOM, the switcher won hit-testing — the last 50px of the Help
label activated a workspace at 641px (F6). The menu strip now scrolls rather
than spilling, matching the portrait rule.

## Drawers and focus

- Layers and Resources drawers are modal surfaces: opening one moves focus
  inside, Tab is trapped, Escape and the backdrop close it, and focus returns to
  the trigger. The tablet Inspector is nonmodal, so its controls and the
  uncovered canvas remain interactive together. Hidden surfaces stay mounted
  where their state must survive a breakpoint or orientation change.
- Modal drawers carry dialog semantics and `aria-expanded`/`aria-controls` on
  their triggers. The nonmodal Inspector does not claim `aria-modal` or trap
  focus.
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

`packages/editor/src/canvas/keyboardInset.ts` publishes viewport and keyboard
geometry on the document element; `KeyboardInsetPublisher` (mounted once in
`apps/desktop/src/App.tsx`) owns the subscription:

| Property | Meaning |
|---|---|
| `--keyboard-inset-bottom` | Keyboard height in CSS px, `0px` when closed or unknown |
| `--visual-viewport-height` | Current visual viewport height in CSS px |
| `--visual-viewport-offset-top` | Visual viewport offset from the layout viewport top |
| `--visual-viewport-offset-left` | Visual viewport offset from the layout viewport left |
| `--virtual-keyboard-x/y/width/height` | Clipped reported bounds in layout-viewport CSS px; zero when unavailable |

When `navigator.virtualKeyboard.boundingRect` is available, the controller
intersects that rectangle with the visible viewport. A docked keyboard that
the browser has already excluded from the visible viewport adds no second
bottom inset. A floating or split keyboard reports its bounds and sets
`data-virtual-keyboard-floating="true"` without reserving its full height at
the bottom. Browsers without keyboard bounds use the layout-minus-visible
viewport height delta. Pinch-zoom is excluded from that fallback (`scale >
1.05` or a width collapse is not a keyboard). `data-virtual-keyboard-open`
reflects reported or inferred keyboard presence. The page never sets
`overlaysContent`, never calls
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
| `<= 899px` + portrait | Inspector is a 25–36dvh nonmodal lower pane; Resources remains a 40–80dvh modal sheet | Left side drawer |
| `<= 899px` + landscape | Right side drawer | Left side drawer |
| `> 899px`, desktop presentation | Docked column (unchanged) | Docked column |
| `> 899px`, tablet presentation | Reserved Inspector rail | Dismissible left side drawer |

Open panel state survives rotation: the panel stays mounted and adapts its
presentation between sheet and drawer/docked forms. Bottom-anchored chrome
(FABs, toasts) adds `env(safe-area-inset-bottom)` so standalone PWA landscape
never sits under the gesture bar.

## Platform Back action

When the browser or platform maps a system Back action to history traversal,
`packages/editor/src/navigation/TabletBackDismiss.tsx` (mounted once in
`apps/desktop/src/App.tsx`) routes it through an explicit topmost-surface
dismissal API:

- While any registered overlay or native `<dialog>` is open, one same-URL
  history entry (the guard) is pushed.
- A Back traversal pops the guard and asks the overlay registry or dialog for
  its topmost eligible dismissible surface. Nested menus close one at a time;
  tooltips and nondismissible surfaces do not consume Back. This does not
  synthesize a keyboard event.
- If layers remain, one guard is re-pushed per layer, so each back gesture
  closes exactly one surface.
- Closing the last layer from the UI removes the guard, leaving no dead
  history entry. Deep links skip guard entries via `OVERLAY_GUARD_FLAG`.
- Registry count changes are exposed by `subscribeToOverlayCount`; native
  dialogs are observed through their `open` attribute.

A canvas gesture that receives `pointercancel`, loses capture, or is taken over
by navigation uses the same scoped rollback path. It clears pending gesture
work and restores selection, dirty state, and history without invoking global
Undo. Tool and document changes resolve the active session before switching.
Browser history emulation does not certify the platform's physical edge
gesture; ChromeOS hardware behavior remains a device-validation item.

## Panel recovery

- View menu: **Reset Window Layout** (`resetPanelWindowLayout`) restores panel
  docking placement after a multi-display change.
- **Bring All Panels to Current Display** handles detached panel windows.
- Desktop panel visibility toggles are `Ctrl+B` (left) and `Ctrl+Shift+B`
  (right) on desktop routes; in the browser, `Ctrl+Shift+B` is the ChromeOS
  bookmarks-bar shortcut and the View menu and command palette remain the
  reliable paths.
- When a docked panel is collapsed, `SelectionInfoBar` renders a compact
  restore chip ("Layers" / "Inspector"; `data-testid="restore-left-panel"` /
  `restore-right-panel`). The chip anchors inside the canvas grid cell's top
  corners — `position: absolute` + `grid-area: canvas`, below the 20px ruler
  overlay (`.editor__panel-restore-btn` in `editor.css`), the same
  absolutely-positioned grid-area mechanism as the floating toolbar. Do not
  replace this with viewport-fixed offsets computed from header tokens:
  `--menubar-total-height` arithmetic has drifted under the tab strip / top
  toolbar whenever the real header height moved. Geometry is asserted in
  `tests/e2e/layers/layers-panel-visual.spec.ts`.

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
