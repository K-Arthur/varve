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
}

export interface MenuItemRadio {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  type: 'radio';
  group: string;
}

export interface SubmenuItem {
  id: string;
  label: string;
  submenu: readonly MenuEntry[];
  disabled?: boolean;
  type: 'submenu';
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
}: MenuInternalProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const menuRef = externalRef ?? internalRef;
  const [focusIdx, setFocusIdx] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const prevOpenRef = useRef(open);

  const flatItems = useMemo(
    () => items.filter((i): i is Exclude<MenuEntry, MenuSeparator> => !isSeparator(i)),
    [items],
  );

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setFocusIdx(0);
      setOpenSubmenu(null);
      const timer = setTimeout(() => {
        const el = menuRef.current?.querySelector<HTMLElement>('[data-focusable-idx="0"]');
        el?.focus();
      }, 0);
      prevOpenRef.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!open && prevOpenRef.current) {
      setOpenSubmenu(null);
      if (triggerRef && level === 0) {
        triggerRef.current?.focus();
      }
    }
    prevOpenRef.current = open;
  }, [open, triggerRef, level, menuRef]);

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
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        window.clearTimeout(typeaheadTimerRef.current ?? undefined);
        typeaheadRef.current += e.key.toLowerCase();
        typeaheadTimerRef.current = window.setTimeout(() => {
          typeaheadRef.current = '';
        }, 500);

        const matchIdx = flatItems.findIndex((item) =>
          itemLabel(item).toLowerCase().startsWith(typeaheadRef.current),
        );
        if (matchIdx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(matchIdx);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx((i) => Math.min(i + 1, flatItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(0);
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          setFocusIdx(flatItems.length - 1);
          break;
        case 'ArrowRight': {
          const item = flatItems[focusIdx];
          if (item && isSubmenuItem(item)) {
            e.preventDefault();
            e.stopPropagation();
            setOpenSubmenu(item.id);
          }
          break;
        }
        case 'ArrowLeft':
          if (level > 0) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
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
          closeAll();
          break;
      }
    },
    [flatItems, focusIdx, onClose, closeAll, level],
  );

  let focusableCounter = -1;

  const renderedItems = items.map((entry) => {
    if (isSeparator(entry)) {
      return <hr key={entry.id} role="presentation" className="strata-menu__sep" />;
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
          className="strata-menu__item"
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            setFocusIdx(idx);
          }}
        >
          <span className="strata-menu__indicator">{entry.checked ? '✓' : ''}</span>
          <span>{entry.label}</span>
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
          className="strata-menu__item"
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            setFocusIdx(idx);
          }}
        >
          <span className="strata-menu__indicator">{entry.checked ? '●' : '○'}</span>
          <span>{entry.label}</span>
        </button>
      );
    }

    if (isSubmenuItem(entry)) {
      const submenuOpen = openSubmenu === entry.id;
      return (
        <div key={entry.id} className="strata-menu__item-wrapper">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenuOpen || undefined}
            disabled={entry.disabled}
            aria-disabled={entry.disabled || undefined}
            className="strata-menu__item"
            tabIndex={isCurrent ? 0 : -1}
            data-focusable-idx={idx}
            onMouseEnter={() => {
              setFocusIdx(idx);
              if (openSubmenu && openSubmenu !== entry.id) {
                setOpenSubmenu(entry.id);
              }
            }}
            onClick={() => {
              if (!entry.disabled) {
                setOpenSubmenu(submenuOpen ? null : entry.id);
              }
            }}
          >
            <span>{entry.label}</span>
            <span className="strata-menu__submenu-arrow">▸</span>
          </button>
          {submenuOpen && open && (
            <MenuInternal
              items={entry.submenu}
              open
              onClose={() => {
                setOpenSubmenu(null);
                setTimeout(() => {
                  const el = menuRef.current?.querySelector<HTMLElement>(
                    `[data-focusable-idx="${idx}"]`,
                  );
                  el?.focus();
                }, 0);
              }}
              closeAll={closeAll}
              label={`${itemLabel(entry)} submenu`}
              level={level + 1}
              menuClassName="strata-menu strata-menu__submenu"
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
        className="strata-menu__item"
        tabIndex={isCurrent ? 0 : -1}
        data-focusable-idx={idx}
        onClick={() => {
          if (!entry.disabled) {
            entry.onAction();
            closeAll();
          }
        }}
        onMouseEnter={() => {
          setFocusIdx(idx);
        }}
      >
        <span>{entry.label}</span>
        {entry.dialog && <span className="strata-menu__ellipsis">&hellip;</span>}
      </button>
    );
  });

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={menuClassName}
      style={menuStyle}
      onKeyDown={handleKey}
    >
      {renderedItems}
    </div>
  );
}

// ============================================================
// Menu (public)
// ============================================================

export function Menu({ items, triggerRef, open, onClose, label }: MenuProps) {
  return (
    <MenuInternal
      items={items}
      open={open}
      onClose={onClose}
      closeAll={onClose}
      label={label}
      level={0}
      triggerRef={triggerRef}
      menuClassName="strata-menu"
      menuStyle={!open ? { display: 'none' } : undefined}
    />
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

  return (
    <MenuInternal
      items={items}
      open
      onClose={onClose}
      closeAll={onClose}
      label={label}
      level={0}
      menuClassName="strata-ctxmenu"
      menuStyle={{
        position: 'fixed',
        left: position.x,
        top: position.y,
      }}
      containerRef={menuRef}
    />
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
