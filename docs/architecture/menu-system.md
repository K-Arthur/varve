# Menu system

Status: current architecture (2026-09-02).

Varve has one menu contract for command surfaces. The shared implementation is
in `packages/ui/src/components/Menu.tsx`; editor command definitions live in
`packages/editor/src/menu/defs.ts` and are adapted by
`packages/editor/src/menu/renderer.ts`. The implementation is intentionally
small and semantic: it does not turn every floating control into a menu.

## Surface taxonomy

| Surface | Use for | Canonical primitive |
|---|---|---|
| Command menu | A short list of actions, optionally grouped by separators | `Menu` |
| Checkbox menu | Independent toggles such as visibility or snapping | `MenuEntry` with `type: 'checkbox'` |
| Radio menu | One choice from a named group | `MenuEntry` with `type: 'radio'` |
| Submenu | A stable, discoverable branch of related commands | `SubmenuItem` |
| Rich menu | A chooser with a second line of explanatory text | `Menu` with `size="rich"` |
| Overflow menu | Secondary actions behind a compact “More” control | `Menu` with a compact trigger |
| Context menu | Actions for the invocation target at a pointer/keyboard location | `ContextMenu` |
| Select/listbox | Choosing a value, not invoking a command | `Select`/listbox primitive |
| Combobox | Filtering or entering a value | `Combobox` |
| Popover | A form, inspector, colour editor, binding editor, or other rich control | `Popover`/`FloatingPortal` |
| Dialog | A modal task or confirmation that needs a larger focus boundary | `Dialog` |

Use a menu when the user is choosing an operation. Use a select or combobox
when the user is choosing or entering a value. A colour picker, gradient
editor, adjustment controls, and similar stateful editors remain popovers or
dialogs even when they are opened from a button.

## Shared visual contract

`Menu` and `ContextMenu` use the same surface, item, indicator, content, and
trailing slots. The `size` prop selects a semantic width rather than a
call-site pixel value:

| Size | Width token | Intended content |
|---|---|---|
| `compact` | `--menu-compact-width` (12rem) | Short command and overflow menus |
| `default` | `--menu-default-width` (15rem) | Grouped commands with ordinary labels |
| `rich` | `--menu-rich-width` (22rem) | Descriptions, chooser details, and longer labels |

The surface is clamped by `FloatingPortal` to the viewport with
`--menu-viewport-gutter`. Items use the menu-item height and compact control
radius tokens. The surface uses the floating/surface radius and overlay
elevation tokens. Hover, keyboard focus, checked state, disabled state, and
destructive state all use theme tokens; no menu may introduce a hard-coded
colour or shadow.

Each action entry may provide:

- `icon`: a decorative `IconName` in the leading lane;
- `description`: a second line, intended for rich menus;
- `shortcut`: display text in the trailing lane;
- `ariaKeyshortcuts`: the normalized keyboard grammar for assistive technology;
- `destructive`: restrained danger styling for irreversible actions;
- `badge`: status or capability information in the trailing lane.

The leading and trailing lanes have reserved space so icons, checkmarks,
shortcuts, badges, submenu arrows, and dialog ellipses do not make sibling
labels jump when those lanes are used. Empty lanes collapse for plain command
menus so their labels receive the full semantic width; `default` and `rich`
labels wrap rather than being visually ellipsized when viewport clamping makes
their available width tight. Labels are presentation headings (`MenuLabel`),
not focusable items. State-dependent lists are normalized to remove leading,
trailing, and duplicate separators before they are painted.

Use `compact` for genuinely short command/overflow menus and `default` for
target-relative menus whose actions include ordinary descriptive labels. The
Home file context menu is an example of the latter.

## Command metadata and shortcuts

`MenuItemDef.accelerator` remains the one definition-side shortcut value. The
renderer formats it for the active platform with the same glyph conventions as
the menubar and also emits `aria-keyshortcuts`. Contextual menus therefore show
the actual registered shortcut instead of maintaining a second hand-written
shortcut list. Adding an accelerator to a menu definition requires the command
integrity test to remain in agreement with `ShortcutManager`.

Menu definitions also own `group`, `enabled`, `visible`, `contexts`,
`capabilities`, `workspaces`, `kind`, and `destructive`. The renderer filters
those facts before creating UI entries. A disabled action remains visible when
its explanation helps the user understand what is unavailable; it is never
made clickable by styling alone.

## Interaction and overlay contract

Menus implement the APG menubar/menu interaction model: roving `tabIndex`,
initial focus on the first enabled item, type-ahead, Home/End, ArrowUp/Down,
ArrowRight/Left submenu traversal, Escape, and Tab exit. Checkbox and radio
items retain their menu roles and `aria-checked`; submenu triggers expose
`aria-haspopup="menu"` and `aria-expanded`.

`FloatingPortal` owns fixed positioning, owner-document resolution, collision
handling, portal roots, and overlay registration. It does not provide menu
keyboard semantics. Submenus anchor to their rendered parent item. Context
menus may use a viewport point or an element anchor; their command set is an
invocation snapshot, not an implicit copy of the current inspector state.

The editor menubar keeps its specialized top-level focus and native-menu
integration in `packages/editor/src/Menubar.tsx`. It shares this document’s
geometry, radius, spacing, elevation, focus, and theme tokens. Its separate
renderer is a deliberate boundary because a top-level menubar is a composite
navigation widget, not a normal anchored action menu. Its labels wrap when
shortcuts reduce the available command-label width; they are not silently
ellipsized.

## Repository application

The canonical menu path is:

```text
MenuItemDef[]
  -> filter by context/capability/workspace
  -> renderMenuItems()
  -> MenuEntry[]
  -> Menu / ContextMenu
  -> FloatingPortal + OverlayRegistry
```

The path is used by editor command menus and context menus, including layers,
pages, canvas, timeline, guides, inspector command groups, selection quick
actions, and toolbar overflow. Existing select/listbox, combobox, popover,
dialog, and form surfaces remain in their own semantic families. A visible
“More” affordance is an overflow candidate only when its actions are secondary
and stable; it is not a license to hide a primary workflow or to create a
second route to the same command.

The home file context menu is also a real context menu because it is anchored
to a project/file target. The marketing site has a separate Astro navigation
contract: desktop grouped navigation uses native website controls and
accessible `role="menu"` behavior, while the application menu component is not
imported into the static site bundle.

## Validation contract

Every menu-system change requires:

1. the focused `Menu` and renderer tests;
2. the menu snapshot and command-integrity tests when definitions or renderer
   metadata change;
3. affected validation from `pnpm verify:plan` and `pnpm verify:affected`;
4. keyboard, overlay, and visual Playwright coverage for interaction changes;
5. direct inspection of captured screenshots in light, dark, and
   high-contrast themes when surface styling changes.

The fixture in `packages/ui/src/components/Menu.stories.tsx` is the component
state matrix for compact, rich, checkbox, radio, submenu, dark-theme, and
overflow states. The editor visual specs cover real menubar, submenu, context
menu, and toolbar surfaces; website navigation has its own desktop/mobile
coverage.
