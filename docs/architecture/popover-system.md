# Popover system

Status: current architecture (2026-09-15). Owner of record for the app-wide
popover review is `docs/agents/popover-review-2026-09-15-ownership.md`; the
evidence ledger is `docs/research/popover-review-2026-09-15.md`; the audit and
repair record is `docs/audits/popover-review-2026-09-15.md`.

A popover is a **transient, anchored, non-modal surface for rich content** —
filters, tool settings, colour and binding editors, section managers. It is
not a menu, a select, or a dialog:

| Surface | Use for | Canonical primitive |
|---|---|---|
| Popover | Rich control clusters anchored to a trigger (filters, tool options, colour/binding editors) | `Popover` (native Popover API + Floating UI) |
| Popover-shaped dialog | Same content but focus-contained (colour picker, variable modifier, focused effect editor) | `FloatingPortal` + `FocusTrap` |
| Command menu / context menu | Choosing an operation | `Menu` / `ContextMenu` (see `menu-system.md`) |
| Select / combobox / listbox | Choosing or entering a value | `Select`, `Combobox`, `MultiSelect` |
| Dialog | A task that needs a full focus boundary | `Dialog` |

The shared geometry/ownership layer for every floating surface is
`FloatingPortal` + `OverlayRegistry`; the popover contract below is built on
top of it and does not duplicate it.

## Trigger contract

- The trigger keeps its native semantics. `Popover` respects a consumer's
  `aria-haspopup` (`listbox` stays `listbox`); it adds `aria-expanded` and
  `aria-controls` and does not force `dialog` on value-selection triggers.
- A trigger activation toggles: open when closed, close when open. Closing
  through the trigger never re-opens because of native light dismiss — the
  React state is the single owner of the open flag and both dismissal paths
  are idempotent.
- Pointer activation must not move focus. Keyboard activation (`Enter`,
  `Space`, and `ArrowUp`/`ArrowDown` for listbox-style triggers with
  `openOnArrowKeys`) is a navigation intent and moves focus into the panel.

## Dismissal contract

| Gesture | Behaviour |
|---|---|
| `Escape` | Always closes the open popover — including when focus is still on the trigger, where the browser's native popover handling does not act. Focus returns to the trigger when the close was initiated from the popover or the trigger. |
| Outside pointer press | Closes (native light dismiss plus the registry fallback, so the behaviour is identical in browsers without the Popover API and in tests). Focus is not stolen from the pressed destination. |
| `Tab` / `Shift+Tab` past the last/first control | Closes and continues sequential focus around the trigger rather than from the portaled body end. |
| Window blur | Closes (configurable per surface). |
| Anchor detached | Closes; a deleted or recycled row can never leave an orphaned surface. |

Nested surfaces are registered as descendants through `OverlayParentContext`,
so one outside press closes the deepest branch first, and Escape closes one
level at a time. A nested surface opened from inside a popover must be a
`FloatingPortal` descendant (registered ancestry) so the parent is not treated
as outside.

## Focus contract

- Pointer open: focus stays on the trigger. The trigger and the panel controls
  are all reachable by pointer.
- Keyboard open: focus moves to the first focusable control, or to the panel
  itself when it has none.
- `FocusTrap` surfaces (colour picker, variable modifier, focused editor)
  contain Tab and return focus to the invoking control on close.
- Mouse users are never required to know the focus policy; keyboard users are
  never required to use the mouse to reach the panel content.

## Geometry and lifecycle

`FloatingPortal` owns fixed positioning with Floating UI
(`offset` + `flip` + `shift` + `size` + `hide`), visual-viewport clamping for
on-screen keyboards, portal-root selection (dialog top layer, detached
windows), overlay registration, anchor-detached detection, and cleanup of
observers/listeners on close. Popovers inherit all of it. `Popover` adds the
native Popover API rendering path and a small arrow.

Surfaces with lazy content (tool options sections) may observe for the first
control only while their explicit keyboard-open handoff is pending; the
observer is disconnected as soon as a control is focused. No popover may hold
an observer, listener, or timer after it closes.

## Deliberate deviations

- **`InspectorColorPopover` keeps `aria-modal="true"` without a dimming
  scrim.** Focus is contained (`FocusTrap`), outside pointer input is consumed
  by light dismissal, and `ShortcutManager` treats it as modal, but the canvas
  must stay visible under the picker so the user can judge the colour. Visual
  dimming is therefore intentionally omitted; the alternative (a scrim) would
  make colour judgement worse. Recorded as a documented exception, not an
  accessibility claim.
- **Native light dismiss cannot be cancelled from script.** When a popover
  uses the native Popover API and a nested overlay is portaled outside its DOM
  subtree, the browser may close the parent on the nested press. The repository
  keeps such nested editors as registered `FloatingPortal` descendants, which
  the registry protects; do not add a raw portal child to a native popover.

## Consumers

| Consumer | Kind | Focus entry |
|---|---|---|
| Home `FilterDropdown` (filters dialog) | Popover primitive | Keyboard open |
| Home workspace-filter listbox, `WorkspaceSwitcher` | Popover primitive + listbox keyboard helper | Keyboard open / arrows |
| Floating text bar colour picker | Popover primitive | Keyboard open |
| `ToolOptionsPopover` | FloatingPortal popover | Explicit keyboard/command open only; implicit tool-change opens never take focus |
| Floating text bar "More" | FloatingPortal popover | `initialFocus` |
| `SectionManagerTrigger` | FloatingPortal popover | On open (settings panel) |
| `AlignDistributeBar` distribution/tidy | FloatingPortal popovers | `initialFocus` |
| `VariableModifierPopover` | FloatingPortal + `FocusTrap` | Trap entry/return |
| `InspectorColorPopover` | FloatingPortal + `FocusTrap` | Trap entry/return |

## Validation contract

Every popover change requires:

1. the focused `Popover`, `FloatingPortal`, `focusOrder`, and Home listbox
   unit tests;
2. the rendered contract spec
   `tests/e2e/popovers/popover-contract.spec.ts` (keyboard entry, Escape,
   toggle, outside press, Tab exit, listbox arrows/type-ahead, implicit-open
   focus policy);
3. visual inspection of the captured open states in light and dark themes
   when surface styling changes;
4. affected validation from `pnpm verify:plan` / `pnpm verify:affected`.
