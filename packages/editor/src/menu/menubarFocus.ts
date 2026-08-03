/**
 * Menubar focus lifecycle effects — extracted from Menubar.tsx (over its
 * complexity ceiling; see docs/audits/focus-navigation-audit-2026-08-02.md).
 *
 * - Dropdown/submenu roving focus: moves focus into the portaled menus one
 *   frame after open (FloatingPortal keeps its layer visibility:hidden until
 *   the positioning layout effect lands; focus() on hidden elements is a
 *   no-op).
 * - Focus restoration: captures the element focused before the dropdown
 *   opened and restores it on close, unless focus moved elsewhere
 *   deliberately (Escape already refocused the trigger, outside click
 *   focused the clicked target, Tab walked the tab order past the trigger).
 */

import { walkFocus } from '@strata/ui/utils/focusMovement';
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
  } = deps;

  // Dropdown roving focus: focus the item at the active index when the
  // dropdown opens or the index moves (keyboard navigation).
  useEffect(() => {
    if (!openMenu) return;
    const menu = dropdownMenuRef.current;
    if (!menu) return;
    const items = menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    const target = items[activeItemIndex];
    if (!target) return;
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [openMenu, activeItemIndex, dropdownMenuRef]);

  // Submenu roving focus: move focus into the submenu only when the user is
  // navigating by keyboard (focus is already inside the dropdown/submenu) —
  // mouse hover must not yank focus out of the dropdown.
  useEffect(() => {
    if (openSubmenu === null) return;
    const menu = submenuRef.current;
    if (!menu) return;
    const active = document.activeElement;
    if (active && !dropdownMenuRef.current?.contains(active) && !menu.contains(active)) {
      return;
    }
    const items = menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    const target = items[activeSubmenuIndex];
    if (!target) return;
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [openSubmenu, activeSubmenuIndex, dropdownMenuRef, submenuRef]);

  // Focus restoration: capture on open, restore on close.
  useEffect(() => {
    const opening = openMenu !== null && prevOpenMenuRef.current === null;
    const closing = openMenu === null && prevOpenMenuRef.current !== null;

    if (opening) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        restoreFocusRef.current = active;
      }
    } else if (closing) {
      const active = document.activeElement;
      const insideMenus =
        active !== document.body &&
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
      } else if (!insideMenus && restoreFocusRef.current?.isConnected) {
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
