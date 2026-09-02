import * as React from 'react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import {
  firstEnabledIndex,
  nextEnabledIndex,
  TABBABLE_SELECTOR,
  walkFocus,
} from '../utils/focusMovement';
import { getTypeAheadResetMs, matchMenuTypeAhead, shouldTypeAhead } from '../utils/menuTypeAhead';
import { FloatingPortal } from './FloatingPortal';
import type { OverlayCloseReason } from './OverlayRegistry';
import {
  elementAnchor,
  type OverlayAnchor,
  pointAnchor,
  type ViewportPoint,
  viewportPoint,
} from './overlayGeometry';

// ============================================================
// Types
// ============================================================

export type MenuSize = 'compact' | 'default' | 'rich';

interface MenuItemVisuals {
  /** Optional leading icon. Icons are decorative when a visible label exists. */
  icon?: IconName;
  /** Optional second line, intended for chooser/rich menus only. */
  description?: string;
  /** Display-only shortcut text from the canonical shortcut registry. */
  shortcut?: string;
  /** APG key grammar for assistive technology, when a shortcut is present. */
  ariaKeyshortcuts?: string;
  /** Use restrained danger treatment for irreversible commands. */
  destructive?: boolean;
}

export interface MenuItem extends MenuItemVisuals {
  id: string;
  label: string;
  onAction: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** When true, shows a trailing "…" indicating a dialog follows. */
  dialog?: boolean;
  /**
   * Explicitly tells the menu that activation transfers focus to another
   * managed surface. The visual `dialog` marker is intentionally separate:
   * an ellipsis describes the command, but must not by itself suppress focus
   * restoration when a caller only uses it as a label.
   */
  focusTransfer?: 'dialog' | 'external';
  /** Optional badge count/text shown after the label. */
  badge?: string;
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export interface MenuLabel {
  id: string;
  label: string;
  type: 'label';
}

export interface MenuItemCheckbox extends MenuItemVisuals {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  type: 'checkbox';
  badge?: string;
}

export interface MenuItemRadio extends MenuItemVisuals {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  type: 'radio';
  group: string;
  badge?: string;
}

export interface SubmenuItem extends MenuItemVisuals {
  id: string;
  label: string;
  submenu: readonly MenuEntry[];
  disabled?: boolean;
  type: 'submenu';
  badge?: string;
}

export type MenuEntry =
  | MenuItem
  | MenuSeparator
  | MenuLabel
  | MenuItemCheckbox
  | MenuItemRadio
  | SubmenuItem;

export interface MenuProps {
  items: readonly MenuEntry[];
  /** The element that opens the menu (receives focus-back on close). */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: (reason?: OverlayCloseReason) => void;
  label: string;
  /** Stable DOM id for MenuButton aria-controls wiring. */
  id?: string;
  /** Semantic width/density; avoid per-callsite pixel widths. */
  size?: MenuSize;
  /** Optional legacy item cap. Normal menus rely on measured viewport sizing. */
  maxVisibleItems?: number;
}

export interface ContextMenuProps {
  items: readonly MenuEntry[];
  /** Explicit element or viewport-point anchor. */
  anchor?: OverlayAnchor | null;
  /**
   * Compatibility adapter for older callers. Values are interpreted as
   * viewport/client coordinates and converted to a point anchor immediately.
   * New code should pass `anchor`.
   */
  position?: ViewportPoint | { x: number; y: number } | null;
  /** Context element used by the legacy position adapter and keyboard opens. */
  contextElement?: HTMLElement | null;
  /** Owner document for legacy point positions, especially detached windows. */
  ownerDocument?: Document;
  onClose: (reason?: OverlayCloseReason) => void;
  label?: string;
  /** Semantic width/density; avoid per-callsite pixel widths. */
  size?: MenuSize;
  /** Stable DOM id for diagnostics and test targeting. */
  id?: string;
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

function isLabel(e: MenuEntry): e is MenuLabel {
  return 'type' in e && e.type === 'label';
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

function focusMenuTrigger(triggerRef: React.RefObject<HTMLElement | null> | undefined): void {
  triggerRef?.current?.focus({ preventScroll: true });
}

function itemLabel(entry: MenuEntry): string {
  if (isSeparator(entry) || isLabel(entry)) return '';
  return entry.label;
}

/** Remove orphaned separators and labels after state-dependent filtering. */
function normalizeMenuEntries(items: readonly MenuEntry[]): MenuEntry[] {
  const normalized: MenuEntry[] = [];
  for (const entry of items) {
    if (isSeparator(entry)) {
      const previous = normalized.at(-1);
      if (!previous || isSeparator(previous) || isLabel(previous)) continue;
      normalized.push(entry);
      continue;
    }
    if (isLabel(entry)) {
      const previous = normalized.at(-1);
      if (previous && isSeparator(previous)) normalized.pop();
      if (normalized.at(-1) && isLabel(normalized.at(-1)!)) continue;
      normalized.push(entry);
      continue;
    }
    normalized.push(entry);
  }
  while (normalized.at(-1) && (isSeparator(normalized.at(-1)!) || isLabel(normalized.at(-1)!))) {
    normalized.pop();
  }
  return normalized;
}

type MenuActionEntry = Exclude<MenuEntry, MenuSeparator | MenuLabel>;

function itemClassName(entry: MenuActionEntry, isCurrent: boolean): string {
  return [
    'varve-menu__item',
    isCurrent ? 'varve-menu__item--current' : '',
    entry.destructive ? 'varve-menu__item--destructive' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function menuTrailing(entry: MenuActionEntry, extra?: React.ReactNode): React.ReactNode {
  return (
    <span className="varve-menu__trailing">
      {entry.shortcut ? (
        <span className="varve-menu__shortcut" aria-hidden="true">
          {entry.shortcut}
        </span>
      ) : null}
      {entry.badge ? <span className="varve-menu__badge">{entry.badge}</span> : null}
      {extra}
    </span>
  );
}

function menuBody(
  entry: MenuActionEntry,
  indicator: React.ReactNode,
  extra?: React.ReactNode,
): React.ReactNode {
  return (
    <>
      <span className="varve-menu__leading">
        <span className="varve-menu__indicator">{indicator}</span>
        {entry.icon ? <Icon name={entry.icon} size="var(--icon-size-sm)" /> : null}
      </span>
      <span className="varve-menu__item-content">
        <span className="varve-menu__item-label">{entry.label}</span>
        {entry.description ? (
          <span className="varve-menu__item-description">{entry.description}</span>
        ) : null}
      </span>
      {menuTrailing(entry, extra)}
    </>
  );
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
  onClose: (reason?: OverlayCloseReason) => void;
  closeAll: (reason?: OverlayCloseReason) => void;
  label: string;
  level: number;
  triggerRef?: React.RefObject<HTMLElement | null>;
  id?: string;
  menuClassName: string;
  menuStyle?: React.CSSProperties;
  maxVisibleItems?: number;
  /**
   * Top-level Tab handler: closes the whole tree and walks the tab order
   * from the top-level anchor. Submenus delegate Tab to it so the anchor is
   * always the element focused before the menu tree opened.
   */
  topTabHandler?: (shift: boolean) => void;
  /** Cancels the parent level's delayed close while crossing into a portaled child. */
  cancelParentClose?: () => void;
  /** Shared by every level so a dialog action suppresses root focus restore. */
  focusRestoreSuppressionRef?: React.MutableRefObject<boolean>;
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
  id,
  menuClassName,
  menuStyle,
  maxVisibleItems,
  topTabHandler,
  cancelParentClose,
  focusRestoreSuppressionRef,
}: MenuInternalProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const menuRef = internalRef;
  const submenuAnchorRefs = useRef(
    new Map<string, React.MutableRefObject<HTMLButtonElement | null>>(),
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // "Show all" expands the truncated list in place. It previously only called
  // closeAll(), so activating it dismissed the menu without ever revealing
  // the hidden items — the control named an action it did not perform.
  const [showAllItems, setShowAllItems] = useState(false);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const submenuCloseTimerRef = useRef<number | null>(null);
  const localSuppressFocusRestoreRef = useRef(false);
  const suppressFocusRestore = focusRestoreSuppressionRef ?? localSuppressFocusRestoreRef;
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

  const clearSubmenuClose = useCallback(() => {
    if (submenuCloseTimerRef.current === null) return;
    const ownerWindow = menuRef.current?.ownerDocument.defaultView ?? window;
    ownerWindow.clearTimeout(submenuCloseTimerRef.current);
    submenuCloseTimerRef.current = null;
  }, []);

  const scheduleSubmenuClose = useCallback(() => {
    clearSubmenuClose();
    const ownerWindow = menuRef.current?.ownerDocument.defaultView ?? window;
    submenuCloseTimerRef.current = ownerWindow.setTimeout(() => {
      submenuCloseTimerRef.current = null;
      onClose('outside-pointer');
    }, 150);
  }, [clearSubmenuClose, onClose]);

  const activateAction = useCallback(
    (item: MenuItem) => {
      // Close before dispatch so an action-launched dialog can take focus after
      // the menu tree unmounts. Dialog actions explicitly suppress the root
      // menu's ordinary focus restoration.
      if (item.focusTransfer) suppressFocusRestore.current = true;
      closeAll('action');
      item.onAction();
    },
    [closeAll, suppressFocusRestore],
  );

  const normalizedItems = useMemo(() => normalizeMenuEntries(items), [items]);
  const flatItems = useMemo(
    () => normalizedItems.filter((i): i is MenuActionEntry => !isSeparator(i) && !isLabel(i)),
    [normalizedItems],
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
      closeAll('tab');
    },
    [closeAll],
  );

  // Navigation range: only rendered items are reachable by arrow keys.
  const navLength =
    showAllItems || maxVisibleItems === undefined
      ? flatItems.length
      : Math.min(flatItems.length, maxVisibleItems);

  useEffect(() => {
    if (!open) return;

    const ownerDocument =
      menuRef.current?.ownerDocument ?? triggerRef?.current?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView ?? window;

    // Only the root owns focus restoration. A child submenu returns focus to
    // its parent item on keyboard close; letting every level restore here
    // would produce duplicate, racing focus writes during tree teardown.
    if (level === 0) {
      // Capture the previously focused element so every close path can restore
      // it. Runs on first mount too (ContextMenu mounts with open=true).
      const prior = ownerDocument.activeElement;
      if (prior && prior !== ownerDocument.body && !menuRef.current?.contains(prior)) {
        restoreRef.current = prior as HTMLElement;
      } else if (triggerRef?.current && !menuRef.current?.contains(triggerRef.current)) {
        // Nothing focused before open (e.g. mouse-open in Firefox) — fall back
        // to the trigger so Escape/action/Tab still restore predictably.
        restoreRef.current = triggerRef.current;
      }
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

    const timer = ownerWindow.setTimeout(() => {
      const el = menuRef.current?.querySelector<HTMLElement>(`[data-focusable-idx="${safeIdx}"]`);
      el?.focus();
    }, 0);

    if (MENU_PERF_ENABLED && typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`menu:open:${label}`);
      performance.mark(`menu:open:${label}:state-updated`);
    }
    capturePostPaint(`menu:open:${label}:painted`);

    return () => {
      ownerWindow.clearTimeout(timer);
      menuEl?.removeEventListener('focusin', handleFocusIn);
      if (level !== 0) return;
      if (suppressFocusRestore.current) {
        suppressFocusRestore.current = false;
        return;
      }
      const target = restoreRef.current ?? (triggerRef?.current as HTMLElement | null) ?? null;
      const active = ownerDocument.activeElement;
      const focusWasInside = focusInsideRef.current;
      // Only restore when this menu owned focus at close time and no other
      // surface took it afterwards (activeElement is body when the focused
      // element was removed with the menu).
      if (!focusWasInside || (active !== ownerDocument.body && !menuEl?.contains(active))) return;
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
  }, [open, triggerRef, label, navLength, isItemDisabled, level, suppressFocusRestore]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-focusable-idx="${focusIdx}"]`);
    el?.focus();
  }, [focusIdx, open]);

  useEffect(() => {
    const ownerWindow = menuRef.current?.ownerDocument.defaultView;
    return () => {
      (ownerWindow ?? window).clearTimeout(typeaheadTimerRef.current ?? undefined);
      if (submenuCloseTimerRef.current !== null) {
        (ownerWindow ?? window).clearTimeout(submenuCloseTimerRef.current);
        submenuCloseTimerRef.current = null;
      }
    };
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const ownerWindow = menuRef.current?.ownerDocument.defaultView ?? window;
      if (shouldTypeAhead(e, typeaheadRef.current)) {
        ownerWindow.clearTimeout(typeaheadTimerRef.current ?? undefined);
        typeaheadRef.current += e.key;
        typeaheadTimerRef.current = ownerWindow.setTimeout(() => {
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
          ownerWindow.setTimeout(() => {
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
        ownerWindow.clearTimeout(typeaheadTimerRef.current ?? undefined);
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
            focusMenuTrigger(triggerRef);
            onClose('left-arrow');
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          resetTypeahead();
          if (level > 0) focusMenuTrigger(triggerRef);
          onClose('escape');
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
              activateAction(regItem);
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
      level,
      navLength,
      isItemDisabled,
      topTabHandler,
      handleTopTab,
      activateAction,
      triggerRef,
    ],
  );

  let focusableCounter = -1;

  const isTruncatable = maxVisibleItems !== undefined && normalizedItems.length > maxVisibleItems;
  const shouldLimitItems = isTruncatable && !showAllItems;
  const displayItems = shouldLimitItems
    ? normalizedItems.slice(0, maxVisibleItems ?? normalizedItems.length)
    : normalizedItems;
  const scrollStyle: React.CSSProperties = isTruncatable
    ? {
        maxHeight: `${(maxVisibleItems ?? normalizedItems.length) * 32}px`,
        overflowY: 'auto',
      }
    : {};

  const renderedItems = displayItems.map((entry) => {
    if (isSeparator(entry)) {
      return <hr key={entry.id} role="presentation" className="varve-menu__sep" />;
    }

    if (isLabel(entry)) {
      return (
        <div key={entry.id} role="presentation" className="varve-menu__label">
          {entry.label}
        </div>
      );
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
          className={itemClassName(entry, isCurrent)}
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          aria-keyshortcuts={entry.ariaKeyshortcuts}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            clearSubmenuClose();
            cancelParentClose?.();
            if (!entry.disabled) setFocusIdx(idx);
          }}
        >
          {menuBody(entry, entry.checked ? <Icon name="Check" size="0.85em" /> : null)}
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
          className={itemClassName(entry, isCurrent)}
          tabIndex={isCurrent ? 0 : -1}
          data-focusable-idx={idx}
          aria-keyshortcuts={entry.ariaKeyshortcuts}
          onClick={() => {
            if (!entry.disabled) entry.onToggle();
          }}
          onMouseEnter={() => {
            clearSubmenuClose();
            cancelParentClose?.();
            if (!entry.disabled) setFocusIdx(idx);
          }}
        >
          {menuBody(
            entry,
            <span className={`varve-menu__radio${entry.checked ? ' is-checked' : ''}`} />,
          )}
        </button>
      );
    }

    if (isSubmenuItem(entry)) {
      const submenuOpen = openSubmenu === entry.id;
      const submenuAnchorRef = (() => {
        const existing = submenuAnchorRefs.current.get(entry.id);
        if (existing) return existing;
        const created = { current: null } as React.MutableRefObject<HTMLButtonElement | null>;
        submenuAnchorRefs.current.set(entry.id, created);
        return created;
      })();
      return (
        <div key={entry.id} className="varve-menu__item-wrapper">
          <button
            ref={submenuAnchorRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenuOpen || undefined}
            disabled={entry.disabled}
            aria-disabled={entry.disabled || undefined}
            className={itemClassName(entry, isCurrent)}
            tabIndex={isCurrent ? 0 : -1}
            data-focusable-idx={idx}
            aria-keyshortcuts={entry.ariaKeyshortcuts}
            onMouseEnter={() => {
              clearSubmenuClose();
              cancelParentClose?.();
              if (!entry.disabled) {
                setFocusIdx(idx);
                // Pointer navigation opens the hovered branch immediately;
                // the parent-level leave delay below keeps the corridor to a
                // portaled child usable without making keyboard navigation
                // wait for a timer.
                setOpenSubmenu(entry.id);
              }
            }}
            onClick={() => {
              if (!entry.disabled) {
                setOpenSubmenu(submenuOpen ? null : entry.id);
              }
            }}
          >
            {menuBody(
              entry,
              null,
              <span className="varve-menu__submenu-arrow" aria-hidden="true">
                ›
              </span>,
            )}
          </button>
          {submenuOpen && open && (
            <FloatingPortal
              anchorRef={submenuAnchorRef}
              open
              kind="submenu"
              placement="right-start"
              logicalPlacement={true}
              fallbackPlacements={['left-start']}
              offsetDistance={0}
              dismissOnEscape={false}
              onClose={() => setOpenSubmenu(null)}
              className="varve-floating-layer"
            >
              <MenuInternal
                items={entry.submenu}
                open
                onClose={(reason) => {
                  if (reason === 'escape' || reason === 'left-arrow') {
                    submenuAnchorRef.current?.focus({ preventScroll: true });
                  }
                  setOpenSubmenu(null);
                }}
                closeAll={closeAll}
                label={`${itemLabel(entry)} submenu`}
                level={level + 1}
                triggerRef={submenuAnchorRef}
                menuClassName="varve-menu varve-menu--compact varve-menu--portaled"
                topTabHandler={handleTopTab}
                cancelParentClose={clearSubmenuClose}
                focusRestoreSuppressionRef={suppressFocusRestore}
              />
            </FloatingPortal>
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
        className={itemClassName(entry, isCurrent)}
        tabIndex={isCurrent ? 0 : -1}
        data-focusable-idx={idx}
        aria-keyshortcuts={entry.ariaKeyshortcuts}
        onClick={() => {
          if (!entry.disabled) {
            activateAction(entry);
          }
        }}
        onContextMenu={entry.onContextMenu}
        onMouseEnter={() => {
          clearSubmenuClose();
          cancelParentClose?.();
          if (!entry.disabled) setFocusIdx(idx);
        }}
      >
        {menuBody(
          entry,
          null,
          entry.dialog ? <span className="varve-menu__ellipsis">&hellip;</span> : null,
        )}
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
      id={id}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      className={menuClassName}
      style={containerStyle}
      onKeyDown={handleKey}
      onPointerEnter={() => {
        clearSubmenuClose();
        cancelParentClose?.();
      }}
      onPointerLeave={scheduleSubmenuClose}
    >
      {renderedItems}
      {shouldLimitItems && (
        <button
          type="button"
          role="menuitem"
          className="varve-menu__item varve-menu__show-more"
          tabIndex={showMoreIdx === focusIdx ? 0 : -1}
          data-focusable-idx={showMoreIdx}
          onMouseEnter={() => {
            clearSubmenuClose();
            cancelParentClose?.();
            setFocusIdx(showMoreIdx);
          }}
          onClick={() => {
            setShowAllItems(true);
            setFocusIdx(maxVisibleItems ?? normalizedItems.length);
          }}
        >
          <span>Show all ({normalizedItems.length} items)</span>
        </button>
      )}
    </div>
  );
}

// ============================================================
// Menu (public)
// ============================================================

export function Menu({
  items,
  triggerRef,
  open,
  onClose,
  label,
  id,
  size = 'compact',
  maxVisibleItems,
}: MenuProps) {
  if (!open) return null;

  return (
    <FloatingPortal
      anchorRef={triggerRef}
      open={open}
      onClose={onClose}
      kind="action-menu"
      placement="bottom-start"
      dismissOnEscape={false}
    >
      <MenuInternal
        items={items}
        open={open}
        onClose={onClose}
        closeAll={onClose}
        label={label}
        level={0}
        triggerRef={triggerRef}
        id={id}
        menuClassName={`varve-menu varve-menu--${size} varve-menu--portaled`}
        maxVisibleItems={maxVisibleItems}
      />
    </FloatingPortal>
  );
}

// ============================================================
// ContextMenu (public)
// ============================================================

export function ContextMenu({
  items,
  anchor,
  position,
  contextElement,
  ownerDocument,
  onClose,
  label = 'Context menu',
  size = 'compact',
  id,
}: ContextMenuProps) {
  const resolvedAnchor = useMemo<OverlayAnchor | null>(() => {
    if (anchor) return anchor;
    if (!position) return null;
    try {
      const point = 'space' in position ? position : viewportPoint(position.x, position.y);
      const documentForPoint =
        ownerDocument ??
        contextElement?.ownerDocument ??
        (typeof document !== 'undefined' ? document : null);
      return documentForPoint ? pointAnchor(point, documentForPoint, contextElement) : null;
    } catch {
      return null;
    }
  }, [anchor, position, contextElement, ownerDocument]);

  if (!resolvedAnchor) return null;

  return (
    <FloatingPortal
      anchor={resolvedAnchor}
      open
      onClose={onClose}
      kind="context-menu"
      placement="bottom-start"
      fallbackPlacements={['top-start', 'bottom-end', 'top-end']}
      offsetDistance={0}
      dismissOnEscape={false}
      className="varve-floating-layer"
    >
      <MenuInternal
        items={items}
        open
        onClose={onClose}
        closeAll={onClose}
        label={label}
        level={0}
        id={id}
        menuClassName={`varve-menu varve-menu--${size} varve-ctxmenu varve-menu--portaled`}
      />
    </FloatingPortal>
  );
}

// ============================================================
// useContextMenu hook
// ============================================================

export function useContextMenu(containerRef: React.RefObject<HTMLElement | null>) {
  const [anchor, setAnchor] = useState<OverlayAnchor | null>(null);
  const longPressRef = useRef<number | null>(null);

  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ownerDocument = el.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;

    function handleContext(e: MouseEvent) {
      if (e.button === 2) {
        e.preventDefault();
        setAnchor(pointAnchor(viewportPoint(e.clientX, e.clientY), ownerDocument, el));
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const current = containerRef.current;
        if (!current) return;
        const active = ownerDocument.activeElement;
        const focusedElement =
          active && current.contains(active) ? (active as HTMLElement) : current;
        setAnchor(elementAnchor(focusedElement));
      }
    }

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      longPressRef.current = ownerWindow.setTimeout(() => {
        setAnchor(pointAnchor(viewportPoint(touch.clientX, touch.clientY), ownerDocument, el));
      }, 500);
    }

    function handleTouchEnd() {
      if (longPressRef.current !== null) {
        ownerWindow.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    }

    el.addEventListener('contextmenu', handleContext);
    ownerDocument.addEventListener('keydown', handleKey as unknown as EventListener);
    el.addEventListener('touchstart', handleTouchStart);
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchmove', handleTouchEnd);

    return () => {
      el.removeEventListener('contextmenu', handleContext);
      ownerDocument.removeEventListener('keydown', handleKey as unknown as EventListener);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchmove', handleTouchEnd);
      if (longPressRef.current !== null) ownerWindow.clearTimeout(longPressRef.current);
    };
  }, [containerRef]);

  return {
    anchor,
    position: anchor?.kind === 'point' ? anchor.point : null,
    close,
  };
}
