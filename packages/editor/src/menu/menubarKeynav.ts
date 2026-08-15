/**
 * Menubar keyboard navigation — extracted from Menubar.tsx (the component is
 * over its complexity ceiling; this module is the navigation switch).
 *
 * Implements the APG menubar pattern:
 * - Top level: Left/Right move between items; Down/Up/Enter/Space open the
 *   focused menu. Disabled items are skipped.
 * - Dropdown/submenu: arrows with disabled-skipping, Home/End, typeahead,
 *   ArrowRight/Left submenu traversal, Escape, Tab (closes and walks the
 *   tab order past the trigger), Enter/Space with disabled guards.
 */

import { nextEnabledIndex } from '@varve/ui/utils/focusMovement';
import {
  getTypeAheadResetMs,
  isResetKey,
  matchMenuTypeAhead,
  shouldTypeAhead,
} from '@varve/ui/utils/menuTypeAhead';
import type React from 'react';

export interface MenuItemDef {
  label: string;
  shortcut?: string;
  action?: string;
  disabled?: boolean;
  ariaKeyshortcut?: string;
  items?: MenuItemDef[];
}

export interface MenubarKeyContext<MenuIdDef extends string = string> {
  menuRef: React.RefObject<HTMLDivElement | null>;
  dropdownMenuRef: React.RefObject<HTMLDivElement | null>;
  topLevelRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  openMenu: MenuIdDef | null;
  openSubmenu: number | null;
  focusedIndex: number;
  activeItemIndex: number;
  activeSubmenuIndex: number;
  menus: { id: MenuIdDef; items: MenuItemDef[] }[];
  currentSubmenuItems: MenuItemDef[];
  tabWalkDirRef: React.MutableRefObject<1 | -1 | null>;
  typeaheadRef: React.MutableRefObject<string>;
  typeaheadTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  handleAction: (action: string) => void;
  setOpenMenu: React.Dispatch<React.SetStateAction<MenuIdDef | null>>;
  setOpenSubmenu: React.Dispatch<React.SetStateAction<number | null>>;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  setActiveItemIndex: React.Dispatch<React.SetStateAction<number>>;
  setActiveSubmenuIndex: React.Dispatch<React.SetStateAction<number>>;
}

const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/**
 * Translate a filtered item index (separators removed, used by roving
 * navigation) into the config index (separators present, used by the
 * submenu-open comparison `openSubmenu === itemIdx` in the render).
 */
function filteredToConfigIndex(items: readonly MenuItemDef[], filteredIdx: number): number {
  let seen = -1;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || item.label === '---') continue;
    seen += 1;
    if (seen === filteredIdx) return i;
  }
  return filteredIdx;
}

export function handleMenubarKey<MenuIdDef extends string = string>(
  e: React.KeyboardEvent,
  ctx: MenubarKeyContext<MenuIdDef>,
): void {
  const {
    menuRef,
    dropdownMenuRef,
    topLevelRefs,
    openMenu,
    openSubmenu,
    focusedIndex,
    activeItemIndex,
    activeSubmenuIndex,
    menus,
    currentSubmenuItems,
    tabWalkDirRef,
    typeaheadRef,
    typeaheadTimerRef,
    handleAction,
    setOpenMenu,
    setOpenSubmenu,
    setFocusedIndex,
    setActiveItemIndex,
    setActiveSubmenuIndex,
  } = ctx;

  // Only handle keys from the menubar's own menu items (or the container
  // itself). The menubar region contains no other focusable controls, but
  // this guard keeps future siblings (rename input, radios, zoom field,
  // undo/redo buttons) from being hijacked by menu navigation.
  const target = e.target as HTMLElement;
  if (target !== menuRef.current && !target.getAttribute('role')?.startsWith('menuitem')) {
    return;
  }

  const openIdx = openMenu ? menus.findIndex((m) => m.id === openMenu) : -1;

  if (openSubmenu !== null) {
    // Submenu is open
    const subItems = currentSubmenuItems.filter((i) => i.label !== '---');
    const subDisabledAt = (i: number) => !!subItems[i]?.disabled;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setActiveSubmenuIndex((prev) =>
          nextEnabledIndex(subItems.length, prev, dir, subDisabledAt),
        );
        return;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = subItems[activeSubmenuIndex];
        if (item?.action && !item.disabled) handleAction(item.action);
        return;
      }
      case 'ArrowLeft':
      case 'Escape': {
        e.preventDefault();
        setOpenSubmenu(null);
        setActiveSubmenuIndex(0);
        // Focus returns to the parent menu item (the submenu unmounts).
        const parentItems =
          dropdownMenuRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
        parentItems?.[activeItemIndex]?.focus();
        return;
      }
      case 'Tab': {
        e.preventDefault();
        tabWalkDirRef.current = e.shiftKey ? -1 : 1;
        setOpenMenu(null);
        setOpenSubmenu(null);
        setActiveItemIndex(0);
        setActiveSubmenuIndex(0);
        return;
      }
    }
    return;
  }

  if (openIdx >= 0 && openMenu) {
    // Dropdown is open — navigate items
    const menu = menus[openIdx];
    if (!menu) return;
    const items = menu.items.filter((i) => i.label !== '---');

    function resetTypeahead() {
      typeaheadRef.current = '';
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = null;
      }
    }

    if (shouldTypeAhead(e, typeaheadRef.current)) {
      clearTimeout(typeaheadTimerRef.current ?? undefined);
      typeaheadRef.current += e.key;
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = '';
      }, getTypeAheadResetMs());

      const matchIdx = matchMenuTypeAhead(
        typeaheadRef.current,
        items.map((item) => ({
          label: item.label,
          disabled: item.disabled ?? false,
        })),
        activeItemIndex,
      );
      if (matchIdx !== null) {
        e.preventDefault();
        setActiveItemIndex(matchIdx);
        setTimeout(() => {
          const menuEl = dropdownMenuRef.current;
          if (!menuEl) return;
          const targetItems = menuEl.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
          targetItems[matchIdx]?.scrollIntoView({ block: 'nearest' });
        }, 0);
      }
      return;
    }

    if (isResetKey(e)) {
      resetTypeahead();
    }

    const disabledAt = (i: number) => !!items[i]?.disabled;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setActiveItemIndex((prev) => nextEnabledIndex(items.length, prev, dir, disabledAt));
        return;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items[activeItemIndex];
        if (item?.items) {
          setOpenSubmenu(filteredToConfigIndex(menu.items, activeItemIndex));
          setActiveSubmenuIndex(0);
        } else if (item?.action && !item.disabled) {
          handleAction(item.action);
        }
        return;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const item = items[activeItemIndex];
        if (item?.items) {
          setOpenSubmenu(filteredToConfigIndex(menu.items, activeItemIndex));
          setActiveSubmenuIndex(0);
        } else {
          const next = (openIdx + 1) % menus.length;
          setOpenMenu(menus[next]?.id ?? null);
          setActiveItemIndex(0);
          setFocusedIndex(next);
        }
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (openSubmenu === null) {
          const prev = (openIdx - 1 + menus.length) % menus.length;
          setOpenMenu(menus[prev]?.id ?? null);
          setActiveItemIndex(0);
          setFocusedIndex(prev);
        }
        return;
      }
      case 'Escape': {
        e.preventDefault();
        setOpenMenu(null);
        setOpenSubmenu(null);
        setActiveItemIndex(0);
        setActiveSubmenuIndex(0);
        topLevelRefs.current[openIdx]?.focus();
        return;
      }
      case 'Home': {
        e.preventDefault();
        setActiveItemIndex((prev) => {
          for (let k = 0; k < items.length; k += 1) {
            if (!disabledAt(k)) return k;
          }
          return prev;
        });
        return;
      }
      case 'End': {
        e.preventDefault();
        setActiveItemIndex((prev) => {
          for (let k = items.length - 1; k >= 0; k -= 1) {
            if (!disabledAt(k)) return k;
          }
          return prev;
        });
        return;
      }
      case 'Tab': {
        e.preventDefault();
        resetTypeahead();
        tabWalkDirRef.current = e.shiftKey ? -1 : 1;
        setOpenMenu(null);
        setOpenSubmenu(null);
        setActiveItemIndex(0);
        setActiveSubmenuIndex(0);
        return;
      }
    }
  } else {
    // Top-level navigation (APG menubar): Left/Right move between items;
    // Down/Up/Enter/Space open the focused menu, focusing its first item.
    switch (e.key) {
      case 'ArrowRight': {
        e.preventDefault();
        const next = (focusedIndex + 1) % menus.length;
        setFocusedIndex(next);
        topLevelRefs.current[next]?.focus();
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const prev = (focusedIndex - 1 + menus.length) % menus.length;
        setFocusedIndex(prev);
        topLevelRefs.current[prev]?.focus();
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ': {
        e.preventDefault();
        setOpenMenu(menus[focusedIndex]?.id ?? null);
        setActiveItemIndex(0);
        setActiveSubmenuIndex(0);
        return;
      }
      case 'Home': {
        e.preventDefault();
        setFocusedIndex(0);
        topLevelRefs.current[0]?.focus();
        return;
      }
      case 'End': {
        e.preventDefault();
        setFocusedIndex(menus.length - 1);
        topLevelRefs.current[menus.length - 1]?.focus();
        return;
      }
    }
  }
}
