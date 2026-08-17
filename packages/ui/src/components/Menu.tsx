import * as React from 'react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon';
import {
  firstEnabledIndex,
  nextEnabledIndex,
  TABBABLE_SELECTOR,
  walkFocus,
} from '../utils/focusMovement';
import { getTypeAheadResetMs, matchMenuTypeAhead, shouldTypeAhead } from '../utils/menuTypeAhead';
import { FloatingPortal } from './FloatingPortal';

// ============================================================
// Types
// ============================================================

export interface MenuItem {
  id: string;
  label: string;
  onAction: () => void;
  disabled?: boolean;
  /** When true, shows a trailing "…" indicating a dialog follows. */
  dialog?: boolean;
  /** Optional badge count/text shown after the label. */
  badge?: string;
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export interface MenuItemCheckbox {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  type: 'checkbox';
  badge?: string;
}

export interface MenuItemRadio {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  type: 'radio';
  group: string;
  badge?: string;
}

export interface SubmenuItem {
  id: string;
  label: string;
  submenu: readonly MenuEntry[];
  disabled?: boolean;
  type: 'submenu';
  badge?: string;
}

export type MenuEntry = MenuItem | MenuSeparator | MenuItemCheckbox | MenuItemRadio | SubmenuItem;

export interface MenuProps {
  items: readonly MenuEntry[];
  /** The element that opens the menu (receives focus-back on close). */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
}

export interface ContextMenuProps {
  items: readonly MenuEntry[];
  /** Where to position the menu (page coordinates). */
  position: { x: number; y: number } | null;
  onClose: () => void;
  label?: string;
}

export interface MenuButtonProps {
  label: string;
  menuId: string;
  expanded: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

// ============================================================
// Type guards
// ============================================================

function isSeparator(e: MenuEntry): e is MenuSeparator {
  return 'separator' in e && e.separator === true;
}

function isCheckbox(e: MenuEntry): e is MenuItemCheckbox {
  return 'type' in e && e.type === 'checkbox';
}

function isRadio(e: MenuEntry): e is MenuItemRadio {
  return 'type' in e && e.type === 'radio';
}

function isSubmenuItem(e: MenuEntry): e is SubmenuItem {
  return 'type' in e && e.type === 'submenu';
}

function itemLabel(entry: MenuEntry): string {
  if (isSeparator(entry)) return '';
  return (entry as MenuItem | MenuItemCheckbox | MenuItemRadio | SubmenuItem).label;
}

// ============================================================
// MenuButton trigger component
// ============================================================

export const MenuButton = React.forwardRef<HTMLButtonElement, MenuButtonProps>(function MenuButton(
  { label, menuId, expanded, onClick, disabled, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-controls={menuId}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  );
});

// ============================================================
// MenuInternal — shared menu logic
// ============================================================

interface MenuInternalProps {
  items: readonly MenuEntry[];
  open: boolean;
  onClose: () => void;
  closeAll: () => void;
  label: string;
  level: number;
  triggerRef?: React.RefObject<HTMLElement | null>;
  menuClassName: string;
  menuStyle?: React.CSSProperties;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  maxVisibleItems?: number;
  /**
   * Top-level Tab handler: closes the whole tree and walks the tab order
   * from the top-level anchor. Submenus delegate Tab to it so the anchor is
   * always the element focused before the menu tree opened.
   */
  topTabHandler?: (shift: boolean) => void;
}

const MENU_PERF_ENABLED = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

function capturePostPaint(markName: string): void {
  if (!MENU_PERF_ENABLED || typeof performance === 'undefined' || !performance.mark) return;
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      performance.mark(markName);
      channel.port1.close();
    };
    channel.port2.postMessage(null);
  });
}

function MenuInternal({
  items,
  open,
  onClose,
  closeAll,
  label,
  level,
  triggerRef,
  menuClassName,
  menuStyle,
  containerRef: externalRef,
  maxVisibleItems = 30,
  topTabHandler,
}: MenuInternalProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const menuRef = externalRef ?? internalRef;
  const [focusIdx, setFocusIdx] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // "Show all" expands the truncated list in place. It previously only called
  // closeAll(), so activating it dismissed the menu without ever revealing
  // the hidden items — the control named an action it did not perform.
  const [showAllItems, setShowAllItems] = useState(false);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  // Element focused before this menu took focus; restored on close/unmount.
  const restoreRef = useRef<HTMLElement | null>(null);
  // True while focus has been inside this menu — the restore may only run
  // when the menu owned focus at close time. The focused element is removed
  // from the DOM before effect cleanups run, so the check cannot rely on
  // document.activeElement at cleanup time.
  const focusInsideRef = useRef(false);
  // Non-null when Tab/Shift+Tab closed the menu: restore must walk the tab
  // order past the anchor instead of returning focus to it.
  const tabDirectionRef = useRef<1 | -1 | null>(null);

  const flatItems = useMemo(
    () => items.filter((i): i is Exclude<MenuEntry, MenuSeparator> => !isSeparator(i)),
    [items],
  );

  const isItemDisabled = useCallback(
    (i: number) => {
      const item = flatItems[i];
      return !item || ('disabled' in item && item.disabled === true);
    },
    [flatItems],
  );

  // Top-level Tab handler shared with submenus: close the tree, then walk
  // the tab order from the element focused before the tree opened.
  const handleTopTab = useCallback(
    (shift: boolean) => {
      tabDirectionRef.current = shift ? -1 : 1;
      closeAll();
    },
    [closeAll],
  );

  // Navigation range: only rendered items are reachable by arrow keys.
  const navLength = showAllItems ? flatItems.length : Math.min(flatItems.length, maxVisibleItems);

  useEffect(() => {
    if (!open) return;

    // Capture the previously focused element so every close path can restore
    // it. Runs on first mount too (ContextMenu mounts with open=true).
    const prior = document.activeElement;
    if (
      prior instanceof HTMLElement &&
      prior !== document.body &&
      !menuRef.current?.contains(prior)
    ) {
      restoreRef.current = prior;
    } else if (triggerRef?.current && !menuRef.current?.contains(triggerRef.current)) {
      // Nothing focused before open (e.g. mouse-open in Firefox) — fall back
      // to the trigger so Escape/action/Tab still restore predictably.
      restoreRef.current = triggerRef.current;
    }

    // Track whether focus has been inside the menu (see focusInsideRef).
    const menuEl = menuRef.current;
    const handleFocusIn = () => {
      focusInsideRef.current = true;
    };
    menuEl?.addEventListener('focusin', handleFocusIn);

    const initialIdx = firstEnabledIndex(navLength, isItemDisabled);
    const safeIdx = Math.max(0, initialIdx);
    setFocusIdx(safeIdx);
    setOpenSubmenu(null);

    const timer = setTimeout(() => {
      const el = menuRef.current?.querySelector<HTMLElement>(`[data-focusable-idx="${safeIdx}"]`);
      el?.focus();
    }, 0);

    if (MENU_PERF_ENABLED && typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`menu:open:${label}`);
      performance.mark(`menu:open:${label}:state-updated`);
    }
    capturePostPaint(`menu:open:${label}:painted`);

    return () => {
      window.clearTimeout(timer);
      menuEl?.removeEventListener('focusin', handleFocusIn);
      const target = restoreRef.current ?? (triggerRef?.current as HTMLElement | null) ?? null;
      const active = document.activeElement;
      const focusWasInside = focusInsideRef.current;
      // Only restore when this menu owned focus at close time and no other
      // surface took it afterwards (activeElement is body when the focused
      // element was removed with the menu).
      if (!focusWasInside || (active !== document.body && !menuEl?.contains(active))) return;
      if (!target?.isConnected) return;

      // Tab closed the menu: walk the global tab order from the anchor.
      if (tabDirectionRef.current !== null) {
        const next = walkFocus(target, tabDirectionRef.current);
        tabDirectionRef.current = null;
        next?.focus({ preventScroll: true });
        return;
      }

      if (MENU_PERF_ENABLED && typeof performance !== 'undefined' && performance.mark) {
        performance.mark(`menu:close:${label}`);
      }
      if (target.matches(TABBABLE_SELECTOR) || target.hasAttribute('tabindex')) {
        target.focus({ preventScroll: true });
      }
    };
  }, [open, menuRef, triggerRef, label, navLength, isItemDisabled]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-focusable-idx="${focusIdx}"]`);
    el?.focus();
  }, [focusIdx, open, menuRef]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeAll();
      }
    }
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [open, closeAll, menuRef]);

  useEffect(() => {
    return () => window.clearTimeout(typeaheadTimerRef.current ?? undefined);
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (shouldTypeAhead(e, typeaheadRef.current)) {
        window.clearTimeout(typeaheadTimerRef.current ?? undefined);
        typeaheadRef.current += e.key;
        typeaheadTimerRef.current = window.setTimeout(() => {
          typeaheadRef.current = '';
        }, getTypeAheadResetMs());

        const typeAheadItems = flatItems.map((item) => ({
          label: itemLabel(item),
          disabled: 'disabled' in item && item.disabled,
        }));
        const matchIdx = matchMenuTypeAhead(typeaheadRef.current, typeAheadItems, focusIdx);
        if (matchIdx !== null) {
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(Math.min(matchIdx, navLength - 1));
          setTimeout(() => {
            const el = menuRef.current?.querySelector<HTMLElement>(
              `[data-focusable-idx="${Math.min(matchIdx, navLength - 1)}"]`,
            );
            el?.scrollIntoView({ block: 'nearest' });
          }, 0);
        }
        return;
      }

      function resetTypeahead() {
        typeaheadRef.current = '';
        window.clearTimeout(typeaheadTimerRef.current ?? undefined);
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          setFocusIdx((i) => nextEnabledIndex(navLength, i, 1, isItemDisabled));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          setFocusIdx((i) => nextEnabledIndex(navLength, i, -1, isItemDisabled));
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          setFocusIdx(Math.max(0, firstEnabledIndex(navLength, isItemDisabled)));
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          setFocusIdx((i) => {
            for (let k = navLength - 1; k >= 0; k -= 1) {
              if (!isItemDisabled(k)) return k;
            }
            return i;
          });
          break;
        case 'ArrowRight': {
          const item = flatItems[focusIdx];
          if (item && isSubmenuItem(item)) {
            e.preventDefault();
            e.stopPropagation();
            resetTypeahead();
            setOpenSubmenu(item.id);
          }
          break;
        }
        case 'ArrowLeft':
          if (level > 0) {
            e.preventDefault();
            e.stopPropagation();
            resetTypeahead();
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          onClose();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          resetTypeahead();
          const item = flatItems[focusIdx];
          if (!item) break;
          if (isSubmenuItem(item)) {
            setOpenSubmenu(item.id);
          } else if (isCheckbox(item) || isRadio(item)) {
            if (!item.disabled) item.onToggle();
          } else {
            const regItem = item as MenuItem;
            if (!regItem.disabled) {
              regItem.onAction();
              closeAll();
            }
          }
          break;
        }
        case 'Tab':
          e.preventDefault();
          resetTypeahead();
          // APG: Tab closes the menu and moves focus to the next/previous
          // element in the tab order after the anchor (the element focused
          // before the menu opened, i.e. the trigger for keyboard users).
          if (topTabHandler) {
            topTabHandler(e.shiftKey);
          } else {
            handleTopTab(e.shiftKey);
          }
          break;
      }
    },
    [
      flatItems,
      focusIdx,
      onClose,
      closeAll,
      level,
      menuRef,
      navLength,
      isItemDisabled,
      topTabHandler,
      handleTopTab,
    ],
  );

  let focusableCounter = -1;

  const isTruncatable = items.length > maxVisibleItems;
  const shouldLimitItems = isTruncatable && !showAllItems;
  const displayItems = shouldLimitItems ? items.slice(0, maxVisibleItems) : items;
  const scrollStyle: React.CSSProperties = isTruncatable
    ? { maxHeight: `${maxVisibleItems * 32}px`, overflowY: 'auto' }
    : {};

  const renderedItems = displayItems.map((entry) => {
    if (isSeparator(entry)) {
      return <hr key={entry.id} role="presentation" className="varve-menu__sep" />;
    }

    focusableCounter++;
    const idx = focusableCounter;
    const isCurrent = idx === focusIdx;

    if (isCheckbox(entry)) {
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={entry.checked}
          disabled={entry.disabled}
          aria-disabled={entry.disabled || undefined}
          className="varve-menu__item"
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            if (!entry.disabled) setFocusIdx(idx);
          }}
        >
          <span className="varve-menu__indicator">
            {entry.checked ? <Icon name="Check" size="0.85em" /> : ''}
          </span>
          <span>{entry.label}</span>
          {entry.badge ? <span className="varve-menu__badge">{entry.badge}</span> : null}
        </button>
      );
    }

    if (isRadio(entry)) {
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitemradio"
          aria-checked={entry.checked}
          disabled={entry.disabled}
          aria-disabled={entry.disabled || undefined}
          className="varve-menu__item"
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            if (!entry.disabled) setFocusIdx(idx);
          }}
        >
          <span className="varve-menu__indicator">
            {entry.checked ? (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="6" />
              </svg>
            ) : (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="6" />
              </svg>
            )}
          </span>
          <span>{entry.label}</span>
          {entry.badge ? <span className="varve-menu__badge">{entry.badge}</span> : null}
        </button>
      );
    }

    if (isSubmenuItem(entry)) {
      const submenuOpen = openSubmenu === entry.id;
      return (
        <div key={entry.id} className="varve-menu__item-wrapper">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenuOpen || undefined}
            disabled={entry.disabled}
            aria-disabled={entry.disabled || undefined}
            className="varve-menu__item"
            tabIndex={isCurrent ? 0 : -1}
            data-focusable-idx={idx}
            onMouseEnter={() => {
              if (!entry.disabled) {
                setFocusIdx(idx);
                if (openSubmenu && openSubmenu !== entry.id) {
                  setOpenSubmenu(entry.id);
                }
              }
            }}
            onClick={() => {
              if (!entry.disabled) {
                setOpenSubmenu(submenuOpen ? null : entry.id);
              }
            }}
          >
            <span>{entry.label}</span>
            {entry.badge ? <span className="varve-menu__badge">{entry.badge}</span> : null}
            <span className="varve-menu__submenu-arrow">▸</span>
          </button>
          {submenuOpen && open && (
            <MenuInternal
              items={entry.submenu}
              open
              onClose={() => setOpenSubmenu(null)}
              closeAll={closeAll}
              label={`${itemLabel(entry)} submenu`}
              level={level + 1}
              menuClassName="varve-menu varve-menu__submenu"
              topTabHandler={handleTopTab}
            />
          )}
        </div>
      );
    }

    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        disabled={entry.disabled}
        aria-disabled={entry.disabled || undefined}
        className="varve-menu__item"
        tabIndex={isCurrent ? 0 : -1}
        data-focusable-idx={idx}
        onClick={() => {
          if (!entry.disabled) {
            entry.onAction();
            closeAll();
          }
        }}
        onMouseEnter={() => {
          if (!entry.disabled) setFocusIdx(idx);
        }}
      >
        <span>{entry.label}</span>
        {entry.dialog && <span className="varve-menu__ellipsis">&hellip;</span>}
        {entry.badge ? <span className="varve-menu__badge">{entry.badge}</span> : null}
      </button>
    );
  });

  // The "Show all" button occupies the next focusable slot after the last
  // rendered item; separators do not consume a slot, so count focusables.
  const showMoreIdx = focusableCounter + 1;

  const containerStyle = isTruncatable ? { ...menuStyle, ...scrollStyle } : menuStyle;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={menuClassName}
      style={containerStyle}
      onKeyDown={handleKey}
    >
      {renderedItems}
      {shouldLimitItems && (
        <button
          type="button"
          role="menuitem"
          className="varve-menu__item varve-menu__show-more"
          tabIndex={showMoreIdx === focusIdx ? 0 : -1}
          data-focusable-idx={showMoreIdx}
          onMouseEnter={() => setFocusIdx(showMoreIdx)}
          onClick={() => {
            setShowAllItems(true);
            setFocusIdx(maxVisibleItems);
          }}
        >
          <span>Show all ({items.length} items)</span>
        </button>
      )}
    </div>
  );
}

// ============================================================
// Menu (public)
// ============================================================

export function Menu({ items, triggerRef, open, onClose, label }: MenuProps) {
  if (!open) return null;

  return (
    <FloatingPortal anchorRef={triggerRef} open={open} onClose={onClose} placement="bottom-start">
      <MenuInternal
        items={items}
        open={open}
        onClose={onClose}
        closeAll={onClose}
        label={label}
        level={0}
        triggerRef={triggerRef}
        menuClassName="varve-menu varve-menu--portaled"
      />
    </FloatingPortal>
  );
}

// ============================================================
// ContextMenu (public)
// ============================================================

export function ContextMenu({
  items,
  position,
  onClose,
  label = 'Context menu',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth) {
      x = position.x - rect.width;
    }
    if (y + rect.height > window.innerHeight) {
      y = position.y - rect.height;
    }
    menuRef.current.style.left = `${Math.max(0, x)}px`;
    menuRef.current.style.top = `${Math.max(0, y)}px`;
  }, [position]);

  if (!position) return null;

  return createPortal(
    <MenuInternal
      items={items}
      open
      onClose={onClose}
      closeAll={onClose}
      label={label}
      level={0}
      menuClassName="varve-ctxmenu"
      menuStyle={{
        position: 'fixed',
        left: position.x,
        top: position.y,
      }}
      containerRef={menuRef}
    />,
    document.body,
  );
}

// ============================================================
// useContextMenu hook
// ============================================================

export function useContextMenu(containerRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleContext(e: MouseEvent) {
      if (e.button === 2) {
        e.preventDefault();
        setPos({ x: e.clientX, y: e.clientY });
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const current = containerRef.current;
        if (!current) return;
        const rect = current.getBoundingClientRect();
        setPos({ x: rect.left + 16, y: rect.top + 16 });
      }
    }

    function handleTouchStart() {
      longPressRef.current = setTimeout(() => {
        setPos({ x: 0, y: 0 });
      }, 500);
    }

    function handleTouchEnd() {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    }

    el.addEventListener('contextmenu', handleContext);
    el.addEventListener('keydown', handleContext as unknown as EventListener);
    document.addEventListener('keydown', handleKey as unknown as EventListener);
    el.addEventListener('touchstart', handleTouchStart);
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchmove', handleTouchEnd);

    return () => {
      el.removeEventListener('contextmenu', handleContext);
      el.removeEventListener('keydown', handleContext as unknown as EventListener);
      document.removeEventListener('keydown', handleKey as unknown as EventListener);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchmove', handleTouchEnd);
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, [containerRef]);

  return { position: pos, close };
}
