# Menubar flyouts: pointer dismissal and roving tabindex

**Date:** 2026-09-15
**Scope:** `packages/editor/src/Menubar.tsx`,
`packages/editor/src/menu/menubarSubmenu.tsx`, `packages/editor/src/Menubar.test.tsx`,
`tests/e2e/menus/flyout-dismissal.spec.ts`.
**Status:** implemented; component-level red/green verified.

---

## 1. Findings (from the menu-system diagnosis, re-verified in the tree)

1. **Hovering a plain command row left an open flyout on screen.** The
   dropdown row wrapper's `onMouseEnter` only acted when the row had a
   submenu, so moving the pointer from a submenu parent (for example
   Arrange → Align) onto a plain row (Harmonize Spacing) left the child menu
   floating over unrelated commands until an outside click or Escape. The
   UI `Menu` primitive already closes its child on a 150 ms pointer-leave
   timer; the editor menubar had no equivalent.
2. **Submenu roving tabindex desynced from keyboard focus across
   separators.** `activeSubmenuIndex` counts only focusable items
   (`menubarKeynav`: `currentSubmenuItems.filter(i => i.label !== '---')`)
   and focus moves through `MENU_ITEM_SELECTOR` buttons, but the submenu
   renderer compared it against the raw config index. With a separator
   before the active item, `tabIndex=0` landed on the wrong button or on no
   button at all. The parent dropdown had already been fixed with a
   `focusableIdx` counter and a comment explaining this; the submenu was not.
3. **The submenu caret leaked into accessible names.** The `▶` glyph was a
   bare `<span>`, so a screen reader announced "Align ▶". The UI `Menu`
   equivalent is `aria-hidden`.

## 2. Fix

- Plain rows now call `setOpenSubmenu(null)` on pointer entry; submenu rows
  keep their existing open-and-establish-parent behaviour.
- The submenu tracks a focusable index while mapping items (mirroring the
  parent dropdown) and compares `activeSubmenuIndex` against that.
- The caret span is `aria-hidden="true"`.

## 3. Verification

Red/green at the component level (`packages/editor/src/Menubar.test.tsx`,
jsdom + Testing Library):

- `hovering a plain command closes an open submenu` — hovers Arrange →
  Align, asserts the Align flyout is present, hovers Harmonize Spacing,
  asserts it is gone.
- `keeps the submenu roving tabindex on the focused item across separators`
  — selects three nodes so every Align entry is enabled, opens the flyout,
  presses ArrowDown four times (crossing the first separator), and asserts
  at each step that the element with `tabindex="0"` is exactly
  `document.activeElement`, and that focus reached the second group.

Both tests were run against the pre-fix files (`git show HEAD:` copies
restored temporarily) and **failed**; with the fix they pass. The full
Menubar suite is 23/23.

Browser E2E: `tests/e2e/menus/flyout-dismissal.spec.ts` encodes the same two
journeys through the real UI. Both pass in three consecutive isolated runs
(2/2, serial). The tabindex journey uses the real keyboard path — open
Arrange, walk to Align, press ArrowRight to enter the flyout — because a
manual `locator.focus()` races the portal's visibility frame
(`FloatingPortal` keeps the layer hidden until its positioning layout effect
lands, and `focus()` on a hidden element is a no-op). The hover journey
moves the pointer directly to the row centre: after the flyout closes the
menu can be mid-transition, and Playwright's stability gate can otherwise
retry the hover until the test times out; the direct move still dispatches
real pointer events.

### Pre-existing menu-suite failures (not introduced here)

The full `tests/e2e/menus` folder run surfaced two failures that reproduce
on `HEAD` with this change reverted (verified by restoring `git show
HEAD:` copies of both source files and running the same two tests):

- `keyboard-nav.spec.ts:315` — "disabled menu item has attribute and is not
  a tab stop": no dropdown item receives focus after opening the Object
  menu.
- `overlay-reliability.spec.ts:91` — "keeps menubar flyouts and context
  menus attached through real input": the File → Logo flyout is still open
  after Escape.

Both point at menu focus/close instability in the current master state
(the startup context-settle effect in `menubarFocus.ts` closes menus on
document/workspace change, and under heavy machine load the settle can land
after a test opens a menu). The same instability caused one intermittent
failure of the hover journey in a batch run before the direct pointer move
was adopted. Fixing the settle race is follow-up work for the menu owner.

## 4. Remaining menu work (not done here)

- Disabled submenu parents still open on hover/click (pointer and
  `ArrowRight`), while keyboard navigation skips them in the dropdown.
- `rawMenus` memo dependencies omit `bleedGuidesVisible`, master, and node
  counts, so some Page/View rows can show stale availability.
- Visible shortcut text ignores user keymap overrides while
  `aria-keyshortcuts` reflects them.
- Submenu keyboard lacks type-ahead and Home/End.
- The submenu's enabled `reason` strings computed by the declarative menu
  model are still discarded.
