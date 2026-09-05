/**
 * Menubar focus lifecycle effects — extracted from Menubar.tsx (over its
 * complexity ceiling; see docs/audits/focus-navigation-audit-2026-08-02.md).
 *
 * - Dropdown/submenu roving focus: moves focus into the portaled menus one
 *   frame after open (FloatingPortal keeps its layer visibility:hidden until
 *   the positioning layout effect lands; focus() on hidden elements is a
 *   no-op). Never lands on a disabled item — focus() on disabled buttons
 *   silently no-ops, stranding focus outside the menu.
 * - Focusin sync: pointer or programmatic focus on a menu item updates the
 *   roving index, so Enter/ArrowRight act on the focused item.
 * - Focus restoration: captures the element focused before the dropdown
 *   opened and restores it on close, unless focus moved elsewhere
 *   deliberately (Escape already refocused the trigger, outside click
 *   focused the clicked target, Tab walked the tab order past the trigger).
 */

import { firstEnabledIndex, walkFocus } from '@varve/ui/utils/focusMovement';
import type React from 'react';
import { useEffect } from 'react';

const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

export interface MenubarFocusDeps {
  openMenu: string | null;
  openSubmenu: number | null;
  activeItemIndex: number;
  activeSubmenuIndex: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
  dropdownMenuRef: React.RefObject<HTMLDivElement | null>;
  submenuRef: React.RefObject<HTMLDivElement | null>;
  restoreFocusRef: React.MutableRefObject<HTMLElement | null>;
  prevOpenMenuRef: React.MutableRefObject<string | null>;
  tabWalkDirRef: React.MutableRefObject<1 | -1 | null>;
  setActiveItemIndex: React.Dispatch<React.SetStateAction<number>>;
  setActiveSubmenuIndex: React.Dispatch<React.SetStateAction<number>>;
}

export function useMenubarFocusEffects(deps: MenubarFocusDeps): void {
  const {
    openMenu,
    openSubmenu,
    activeItemIndex,
    activeSubmenuIndex,
    menuRef,
    dropdownMenuRef,
    submenuRef,
    restoreFocusRef,
    prevOpenMenuRef,
    tabWalkDirRef,
    setActiveItemIndex,
    setActiveSubmenuIndex,
  } = deps;

  // Dropdown roving focus: focus the item at the active index when the
  // dropdown opens or the index moves (keyboard navigation). Skips disabled
  // items, which focus() silently refuses.
  useEffect(() => {
    if (!openMenu) return;
    const ownerDocument =
      menuRef.current?.ownerDocument ?? dropdownMenuRef.current?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView;
    let frame: number | undefined;
    let observedMenu: HTMLDivElement | null = null;

    const handleFocusIn = () => {
      const menu = dropdownMenuRef.current;
      const active = ownerDocument.activeElement;
      if (!menu || !active || !menu.contains(active)) return;
      const items = menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
      const idx = Array.from(items).indexOf(active as HTMLButtonElement);
      if (idx >= 0 && idx !== activeItemIndex) setActiveItemIndex(idx);
    };

    const focusWhenMounted = () => {
      const menu = dropdownMenuRef.current;
      if (!menu) {
        // The portal host is resolved in a layout effect after the first
        // open render. Keep the focus handoff pending until that commit has
        // produced the actual menu node instead of abandoning focus.
        frame = ownerWindow?.requestAnimationFrame(focusWhenMounted);
        return;
      }
      if (observedMenu !== menu) {
        observedMenu?.removeEventListener('focusin', handleFocusIn);
        observedMenu = menu;
        observedMenu.addEventListener('focusin', handleFocusIn);
      }
      const items = menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
      const target = items[activeItemIndex];
      if (target?.hasAttribute('disabled')) {
        const next = firstEnabledIndex(
          items.length,
          (i) => items[i]?.hasAttribute('disabled') ?? true,
        );
        if (next >= 0 && next !== activeItemIndex) setActiveItemIndex(next);
        return;
      }
      if (!target) return;
      // FloatingPortal keeps its layer visibility:hidden until the positioning
      // effect lands; focus after the portal's first mounted frame.
      target.focus({ preventScroll: true });
    };

    frame = ownerWindow?.requestAnimationFrame(focusWhenMounted);
    if (frame === undefined) focusWhenMounted();
    return () => {
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
      observedMenu?.removeEventListener('focusin', handleFocusIn);
    };
  }, [openMenu, activeItemIndex, dropdownMenuRef, menuRef, setActiveItemIndex]);

  // Submenu roving focus: move focus into the submenu only when the user is
  // navigating by keyboard (focus is already inside the dropdown/submenu) —
  // mouse hover must not yank focus out of the dropdown. Skips disabled.
  useEffect(() => {
    if (openSubmenu === null) return;
    const ownerDocument =
      submenuRef.current?.ownerDocument ?? dropdownMenuRef.current?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView;
    let frame: number | undefined;
    const focusWhenMounted = () => {
      const menu = submenuRef.current;
      if (!menu) {
        frame = ownerWindow?.requestAnimationFrame(focusWhenMounted);
        return;
      }
      const active = ownerDocument.activeElement;
      if (active && !dropdownMenuRef.current?.contains(active) && !menu.contains(active)) return;
      const items = menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
      const target = items[activeSubmenuIndex];
      if (target?.hasAttribute('disabled')) {
        const next = firstEnabledIndex(
          items.length,
          (i) => items[i]?.hasAttribute('disabled') ?? true,
        );
        if (next >= 0 && next !== activeSubmenuIndex) setActiveSubmenuIndex(next);
        return;
      }
      if (!target) return;
      target.focus({ preventScroll: true });
    };
    frame = ownerWindow?.requestAnimationFrame(focusWhenMounted);
    if (frame === undefined) focusWhenMounted();
    return () => {
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
    };
  }, [openSubmenu, activeSubmenuIndex, dropdownMenuRef, submenuRef, setActiveSubmenuIndex]);

  // Focus restoration: capture on open, restore on close.
  useEffect(() => {
    const opening = openMenu !== null && prevOpenMenuRef.current === null;
    const closing = openMenu === null && prevOpenMenuRef.current !== null;
    const ownerDocument =
      menuRef.current?.ownerDocument ?? dropdownMenuRef.current?.ownerDocument ?? document;

    if (opening) {
      const active = ownerDocument.activeElement;
      if (active instanceof HTMLElement && active !== ownerDocument.body) {
        restoreFocusRef.current = active;
      }
    } else if (closing) {
      const active = ownerDocument.activeElement;
      const insideMenus =
        active !== ownerDocument.body &&
        (menuRef.current?.contains(active) ||
          dropdownMenuRef.current?.contains(active) ||
          submenuRef.current?.contains(active));

      if (tabWalkDirRef.current !== null) {
        const dir = tabWalkDirRef.current;
        tabWalkDirRef.current = null;
        const anchor = restoreFocusRef.current;
        if (anchor?.isConnected) {
          (walkFocus(anchor, dir) ?? anchor).focus({ preventScroll: true });
        }
      } else if (
        (active === ownerDocument.body || !active || insideMenus) &&
        restoreFocusRef.current?.isConnected
      ) {
        // Do not steal focus from a dialog, popover, or another deliberate
        // destination opened by the menu action. Cleanup may run after that
        // surface's focus effect, so body/inside-menu are the only states that
        // still belong to this menubar.
        restoreFocusRef.current.focus({ preventScroll: true });
      }
      restoreFocusRef.current = null;
    }

    prevOpenMenuRef.current = openMenu;
  }, [
    openMenu,
    menuRef,
    dropdownMenuRef,
    submenuRef,
    restoreFocusRef,
    prevOpenMenuRef,
    tabWalkDirRef,
  ]);
}
