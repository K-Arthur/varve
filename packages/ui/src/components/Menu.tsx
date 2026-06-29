import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  onAction: () => void;
  disabled?: boolean;
  /** When true, shows a trailing "…" indicating a dialog follows. */
  dialog?: boolean;
  separator?: false;
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface MenuProps {
  items: readonly MenuEntry[];
  /** The element that opens the menu (receives focus-back on close). */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
}

export function Menu({ items, triggerRef, open, onClose, label }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const id = useId();

  const activeItems = items.filter((i) => !('separator' in i && i.separator));

  useEffect(() => {
    if (open) {
      setFocusIdx(0);
      const timer = requestAnimationFrame(() => {
        const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
      });
      return () => cancelAnimationFrame(timer);
    } else {
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [open, onClose]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusIdx((i) => Math.min(i + 1, activeItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIdx((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setFocusIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusIdx(activeItems.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const item = activeItems[focusIdx];
          if (item && !('separator' in item) && !item.disabled) {
            item.onAction();
            onClose();
          }
          break;
        }
        case 'Tab':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [activeItems, focusIdx, onClose],
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      id={id}
      className="strata-menu"
      onKeyDown={handleKey}
      hidden={!open}
    >
      {items.map((entry, i) => {
        if ('separator' in entry && entry.separator) {
          return <div key={entry.id} role="separator" className="strata-menu__sep" />;
        }
        const item = entry as MenuItem;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            className="strata-menu__item"
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => {
              if (!item.disabled) {
                item.onAction();
                onClose();
              }
            }}
            onMouseEnter={() => setFocusIdx(i)}
          >
            <span>{item.label}</span>
            {item.dialog && <span className="strata-menu__ellipsis">&hellip;</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface ContextMenuProps {
  items: readonly MenuEntry[];
  /** Where to position the menu (page coordinates). */
  position: { x: number; y: number } | null;
  onClose: () => void;
  label?: string;
}

export function ContextMenu({
  items,
  position,
  onClose,
  label = 'Context menu',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  const activeItems = items.filter((i) => !('separator' in i && i.separator));

  useEffect(() => {
    if (!position) return;
    const timer = requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      first?.focus();
    });
    return () => cancelAnimationFrame(timer);
  }, [position]);

  useEffect(() => {
    if (!position) return;
    setFocusIdx(0);
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [position, onClose]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusIdx((i) => Math.min(i + 1, activeItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIdx((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setFocusIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusIdx(activeItems.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const item = activeItems[focusIdx];
          if (item && !('separator' in item) && !item.disabled) {
            item.onAction();
            onClose();
          }
          break;
        }
        case 'Tab':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [activeItems, focusIdx, onClose],
  );

  if (!position) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="strata-ctxmenu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKey}
    >
      {items.map((entry, i) => {
        if ('separator' in entry && entry.separator) {
          return <div key={entry.id} role="separator" className="strata-menu__sep" />;
        }
        const item = entry as MenuItem;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            className="strata-menu__item"
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => {
              if (!item.disabled) {
                item.onAction();
                onClose();
              }
            }}
            onMouseEnter={() => setFocusIdx(i)}
          >
            <span>{item.label}</span>
            {item.dialog && <span className="strata-menu__ellipsis">&hellip;</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Hook that handles context menu triggers (right-click, Shift+F10, ContextMenu key, long-press). */
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
