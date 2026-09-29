# Toolbar system

Canonical contract for the editor's command surfaces: what each bar is for, how
its contents are composed, how it behaves when space runs out, and how it is
operated without a pointer. Related docs: `workspace-system.md` (per-mode
configuration and overrides), `spacing-system.md` and
`interface-sizing-system.md` (tokens), `menu-system.md` (the flyout and
overflow menus themselves), `focus-navigation.md` (region order).

## Surfaces and ownership

| Surface | Component | Job |
|---|---|---|
| Menubar | `Menubar.tsx` | Document/application commands; also hosts the workspace switcher, undo/redo, and zoom |
| Context bar | `components/ContextControlBar/` | Selection-following properties directly under the menubar |
| Toolbar (palette) | `components/FloatingToolbar/` | Tool switching, tool options, flyout groups, responsive overflow |
| Text quick bar | `components/FloatingTextBar/` | In-canvas typography while a text edit session is active |
| Selection quick bar | `components/SelectionQuickBar/` | Selection-anchored actions (group, boolean, image operations) |
| Status bar | `StatusBar.tsx` | Instrumentation and view controls, priority-tiered |

The palette is deliberately **not** a second Inspector. It carries tools and
their options; property editing belongs to the context bar (single selection)
and the Inspector (complete editor). When a control exists in both, both write
through the same editor command, so they cannot disagree.

## Composition

`WorkspaceConfig.toolbar` declares order, group separators, and flyouts.
`workspace/toolbarComposition.ts#composeToolbar` is the single translator from
declared config to rendered slots:

- first declaration of a tool wins; duplicates are dropped;
- a tool claimed by a flyout renders once, as the flyout anchored at its first
  declared member, inheriting that member's `groupStart`;
- flyouts whose members are not in the main row (boolean operations) are
  appended so they stay reachable;
- an empty flyout is not rendered.

Tool identity, label, icon, and shortcut come from `tools/toolRegistry.ts`;
display strings come from `workspace/toolLabels.ts` and
`shortcuts/toolShortcutLabel.ts`. Never hard-code a label or a shortcut in the
palette — remapped keybindings must flow through `getEffectiveBinding`.

## Placement

The palette is anchored to the canvas cell's bottom edge by default. A user
who finds that position hidden (macOS Dock, a laptop display edge) or too far
from the action can move it to the top:

- `View > Toolbar at Top` / `Toolbar at Bottom` are a radio pair at the root
  of the View menu, always visible and never nested.
- The choice is a **workspace preference** (`toolbarPlacement` in
  `WorkspacePreference`, merged by `getEffectiveWorkspaceConfig`) and is
  persisted through the same store as panel widths and chrome toggles, so it
  survives restarts and stays out of the document/undo history.
- `bottom` is the built-in default and is stored sparsely (absent means
  bottom), so a future default change still flows through for users who never
  chose top.
- The palette keeps `grid-area: canvas` in both positions; workspace switches
  re-resolve the effective config. Row order never reverses — a palette that
  opens upward keeps its declared order.

Research basis and the external failure evidence (Figma's UI3 docking
threads, the "Click This!" placement study) live in
`docs/research/toolbar-followup-2026-09-15.md`.

## Status bar

The status bar is tiered instrumentation, not a toolbar: `StatusBar.tsx`
renders sections chosen by `getVisibleStatusSections`, and `editor.css` drops
low-priority segments at narrow widths (diagnostic < 1180px, fit cluster <
980px, AI label and snap grid < 860px, unit select and cursor readout < 700px).

**One owner per fact.** The bottom bar is two strips sharing one row —
`SelectionInfoBar` (`grid-area: selinfo`) above `StatusBar` (`grid-area: status`)
— and a fact lives in exactly one of them:

| Fact | Owner |
|---|---|
| Selection identity, type, geometry, position, rotation, ancestor breadcrumbs, page/layer counts | `SelectionInfoBar` |
| Renderer truth, page/colour/image/cursor readouts, preflight, document health, save state, shortcut tips | `StatusBar` information cluster |
| Units, grid/view toggles, zoom, fit, on-device AI status | `StatusBar` control cluster |

Anything already labelled twice elsewhere is not repeated here: the active tool
comes from the palette, and the menubar's own zoom field was removed because
`#status-zoom` is the single input. Review evidence and the external failure
record (VS Code status-bar overflow, Inkscape's optional-parts request, the
Photoshop stale-measurement bug, Illustrator's one-and-done zoom field) live in
`docs/audits/bottom-bar-review-2026-09-29.md`.

- **Clusters are fixed, order is not.** `SECTION_CLUSTERS` assigns every
  `StatusSectionId` to the information or the control cluster, and
  `getVisibleStatusSections()` sorts within it. Reordering in
  *Customize Workspace* therefore moves a section inside its own half and can
  never push an instrument onto the controls' side. The two halves are divided
  by one flex spacer — the old `—` glyphs marked neither boundary nor group.
- **Sections are exhaustive.** Every rendered control has an id
  (`renderer`, `pageInfo`, `colorMode`, `imageInfo`, `cursorPos`, `preflight`,
  `documentHealth`, `saveStatus`, `shortcutTip`, `unit`, `viewToggles`, `zoom`,
  `fit`, `aiStatus`), so the customize dialog describes the whole row.
  `saveStatus` is clamped visible by `ESSENTIAL_STATUS_SECTION_IDS` — that row
  exists to make the list complete, and its checkbox is disabled with a reason.
- The bar's height is `var(--statusbar-height)`, the same token the shell
  grid row uses (floored to 26px inside `.editor-shell` so 24px controls
  fit). A separate literal (the old `28px`) let the shell's `overflow: hidden`
  clip the bottom of the bar at every width below 1920px.
- Interactive controls are a **24px minimum** (WCAG 2.2 SC 2.5.8): every
  block-axis control height in the bar reads `--statusbar-control-height`,
  declared on `.editor-shell` next to `--statusbar-height` precisely because it
  has to fit inside it (26–28px including the bar's own 1px top border). The
  inline axis keeps `--component-compact-height`, which the row has room for.
  Do not swap either back for `--space-6`: it resolves to 22.4px at a narrow
  window and 29.6px at 1920 — below the floor at one end, taller than the row
  at the other.
- If content still exceeds the row (very narrow windows, enlarged text), the
  bar scrolls horizontally instead of silently clipping a control.
  Informational text ellipsizes first.
- **Labels are words, and an inert control is not rendered.** `Fit selection`
  appears only with a selection; the grid-spacing field carries a visible
  `Grid` label and only appears while snapping or the pixel grid can use it;
  view rotation is one control showing the angle and resetting it, not a bare
  number plus a `Reset rot` button.

## Responsive overflow

When the palette's canvas cell is too narrow for every declared slot, the row
collapses slots until it fits. The policy lives in
`workspace/toolbarRetention.ts` and is enforced in
`components/FloatingToolbar/useToolbarOverflow.ts`:

1. **Never collapsed:** slots containing an essential recovery tool
   (`select`, `hand`, `zoom`) or the active tool.
2. **Everything else is scored** by retention — higher survives longer.
   Category defaults rank navigation > creation (shapes, typography, layout) >
   editing (vector, drawing, selection) > raster > inspection > AI; explicit
   overrides cover tools whose category does not describe reachability
   (Slice, Scale, Warp, and the boolean commands at score 0).
3. **Collapse is per slot, not per declared group.** Group-level collapse was
   too coarse: pinning the Select group to keep Select also pinned Slice, Pixel
   Info, Scale, and Inspect, which forced Text, Frame, Table, Pen, Knife, and
   Shape Builder out of the row at the default window size.
4. **The More control sits at the trailing edge** of the row and is `sticky`
   to the scrollport, so it cannot be scrolled out of reach. Its accessible
   name reports how many tools are hidden.
5. **The More menu** (`getOverflowMenuItems`) lists only the collapsed tools,
   grouped by registry category, and routes through the same `activate()`
   path as the row.
6. **Collapse is one-way until the composition or container size changes.**
   Re-expanding as soon as the row happens to fit oscillates between "all
   visible → overflow → collapse one → fits → expand" on every layout pass.
   A container resize resets the collapsed set and the next pass re-collapses
   from scratch.

Surviving slots inherit a `groupStart` when the first slot of their declared
group was collapsed, so separators keep expressing the declared grouping.

## Keyboard and accessibility contract

The palette is an APG toolbar (`@varve/ui`'s `Toolbar`):

- **One tab stop.** Exactly one rendered button carries `tabindex="0"`; all
  others are `-1`. The roving index is re-applied on every commit and via a
  subtree `MutationObserver`, because the button set can appear or change after
  the first commit (workspace-config hydration, mode switches, responsive
  collapse). A focus-index-only effect silently skipped those commits and left
  every button at the browser default `tabIndex = 0`.
- **Arrows move focus** (Left/Right and Up/Down), wrapping at the ends;
  `Home`/`End` jump to the first/last enabled tool. Disabled flyout primaries
  are skipped, and the roving stop never rests on a disabled control.
- **Focus is never stolen.** Focus moves only while the toolbar already
  contains it.
- **Shortcuts are exposed** through `aria-keyshortcuts` derived from the same
  effective binding as the tooltip, and the tooltip carries the display label.
- **Buttons name the consequence.** Icon-only controls carry an `aria-label`
  that describes the action, not the glyph.

The context bar and the floating text bar are toolbars too, and use the same
`@varve/ui` `Toolbar` primitive:

- **One tab stop** across their buttons, arrows move between them, and the
  roving stop never rests on a disabled control.
- **Arrow keys yield to composite widgets.** The shared primitive skips its
  arrow handling when the event target is an input, textarea, select, or a
  combobox/textbox/spinbutton role, so the font-size field keeps native
  stepping and an open select keeps its own navigation (APG: a toolbar does
  not steal keys a contained widget owns). The size field is therefore a
  separate tab stop; that is deliberate and tested.
- **One formatting surface during a text edit session.** While the in-canvas
  editor is active, the floating text bar owns typography; the context bar
  shows a short pointer to it instead of rendering a second copy of the same
  controls (`context/textEditSession.ts` publishes the session; the selection
  quick bar suppresses itself from the same signal).
- **Confirming a field returns to the text.** Enter in the size field commits
  the value and focuses the in-canvas editor again, so editing continues.
  Blurring to `<body>` previously let the editor's deferred blur handoff
  commit and unmount the session mid-formatting, discarding the pending size.

## Capability gating

Touch-only affordances are gated rather than permanently rendered: the
"Multi-select" modifier substitute (tap to add to selection) appears only when
the device reports touch input (`useHasTouchInput`) or when it is already on,
and carries a visible label because touch devices have no hover. On a
mouse-only device it is inert chrome.

## Target and density rules

- Compact controls are 32×32 CSS px for fine pointers, promoted to
  `--touch-target-min` (44px) under `(any-pointer: coarse)`. This satisfies
  WCAG 2.2 SC 2.5.8 (minimum 24×24) with headroom and reaches the enhanced
  44×44 target on touch.
- The command surfaces follow the interface-density preference
  (`data-density`, Default Pro / Compact Pro): the palette, context bar,
  floating text bar, and selection quick bar read `--density-control-size`
  (32px comfortable / 28px compact) and compact their rows and inner
  primitives together, so both pro modes change the same chrome. The
  comfortable formulas are byte-identical to the pre-density geometry, and
  28px keeps the 24px floor with headroom. The status bar is deliberately
  density-invariant (its 24px control floor already pins the row).
- Toolbar spacing uses `--space-toolbar` / `--space-toolbar-item`; the palette,
  context bar, text bar, and quick bar share one rhythm so switching surfaces
  never moves the control centreline.
- Colours resolve to semantic roles (`--elevation-surface-raised`,
  `--color-interactive-*`); no raw hex or one-off spacing literals.

## Floating-surface placement rules

The canvas is the clipping box (`overflow: hidden`), so every surface anchored
inside it must resolve its own position against the canvas box rather than
trusting its anchor:

- **Horizontal clamp.** The selection quick bar is centred on the selection
  (`translateX(-50%)`). Its centre is clamped so both edges stay inside the
  canvas minus `QUICK_BAR_EDGE_MARGIN`
  (`components/SelectionQuickBar/selectionQuickBarPosition.ts`). Without the
  clamp, a selection at the canvas's left edge pushed the bar's *leading*
  actions — Crop first — outside the clipping canvas, where they were present in
  the DOM but unclickable, silently blocking the crop workflow.
- **Edge-band reserve.** The palette is pinned to a canvas edge
  (`bottom: var(--space-3)`, or the top when the user selects *View > Toolbar at
  Top*) at `z-index: calc(var(--elevation-z-raised) + 1)` so workflow panels
  cannot cover the tool surface. The quick bar therefore *yields*: it measures
  the palette's band from real rects — deriving which edge is occupied from the
  rects rather than assuming, so top and bottom placement both work — and places
  itself below the selection, then above it, then as high as the band allows,
  never inside a reserved band. The palette keeps priority; a bar that covered
  the palette would be the worse trade.
- **Resources exception.** The Resources panel occupies the left side of the
  canvas cell at desktop widths. When it is open, the palette moves into the
  remaining canvas width and yields the panel's stacking layer. The resize
  edge publishes the current panel width as
  `--library-panel-overlay-width`, so resizing keeps library details and
  controls clear of the palette. Below 900px Resources is a drawer or sheet;
  its overlay layer takes priority while open. Resources remains non-modal:
  focus can move to other editor chrome, and global history shortcuts continue
  to work from a focused library control.
- **Bounded width.** The quick bar's `max-width` comes from the canvas width via
  `--selection-quick-bar-max-width`, so a long action profile scrolls inside its
  own strip instead of overflowing the canvas.
- Overlay surfaces that draw over artwork in the canvas (selection overlays,
  guides, warp handles) follow the same rule with the camera transform — see the
  screen-space/world-space note in `AGENTS.md`.

## Verification

- Unit: `packages/ui/src/components/Toolbar.test.tsx` (roving tabindex
  including late-arriving children, arrow yielding to text-entry widgets,
  consumer class name), `workspace/toolbarRetention.test.ts`
  (retention ordering and per-slot collapse),
  `workspace/workspaceStore.test.ts` (toolbar placement default, merge, sparse
  storage, persistence, reset),
  `components/FloatingToolbar/FloatingToolbar.test.tsx` (per-workspace
  composition, placement class), `components/ContextControlBar/ContextControlBar.test.tsx`
  (shape fill/stroke transactions, text-edit duplication suppression),
  `components/FloatingTextBar/FloatingTextBar.test.tsx` (text formatting),
  `StatusBar.test.tsx` (tier visibility and status behavior),
  `actions/registerAll.test.ts` (placement commands persist the active
  workspace preference),
  `components/SelectionQuickBar/selectionQuickBarPosition.test.ts` and
  `SelectionQuickBar.test.tsx` (edge clamp, palette-band reserve, flip).
- Browser: `tests/e2e/canvas/toolbar-layout.spec.ts` (chrome overlap),
  `toolbar-per-mode.spec.ts`, `toolbar-followup.spec.ts` (placement radio pair
  and persistence, status-bar row/target geometry across widths, quick-bar
  keyboard contract and duplication, combined real-world journey, and
  forced-colors / 200%-text adverse rendering),
  `workspace-toolbar-visual.spec.ts` (per-workspace rendering),
  `font-toolbar-visual.spec.ts` (text quick bar),
  `selection-quick-bar.spec.ts` (leading action reachable and palette-clear at
  the canvas's left edge),
  `tests/e2e/workspace/library-panel-controls.spec.ts` (Resources/palette
  geometry and keyboard library controls), and `tests/e2e/menus/visual-integrity.spec.ts`
  (grouped View root fits without internal scrolling).
