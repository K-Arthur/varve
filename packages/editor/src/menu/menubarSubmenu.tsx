/**
 * Menubar submenu — extracted from Menubar.tsx (over its complexity ceiling).
 *
 * Renders the portaled submenu for a dropdown item with roving tabindex and
 * keyboard-driven focus (the parent menu owns the arrow-key state machine in
 * menubarKeynav.ts; this component only renders and wires focus return).
 */

import { FloatingPortal } from '@varve/ui';
import type React from 'react';
import { type MenubarItemState, menubarItemAriaChecked, menubarItemRole } from './menubarItemState';

// Re-exported so the dropdown can use the same helpers without adding an
// import statement beyond the submenu it already renders (Menubar.tsx is a
// hub file with an import budget; the implementation stays single-sourced in
// menubarItemState.ts).
export { menubarItemAriaChecked, menubarItemRole };

interface SubmenuDef {
  label: string;
  shortcut?: string;
  action?: string;
  disabled?: boolean;
  ariaKeyshortcut?: string;
}

interface MenubarSubmenuProps {
  items: SubmenuDef[];
  parentLabel: string;
  open: boolean;
  activeSubmenuIndex: number;
  anchorRef: React.RefObject<HTMLElement | null>;
  submenuRef: React.RefObject<HTMLDivElement | null>;
  currentTheme: string;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  state: MenubarItemState;
  onClose: () => void;
  handleAction: (action: string) => void;
}

function separatorKey(items: SubmenuDef[], current: SubmenuDef, parentLabel: string): string {
  let ordinal = 0;
  for (const item of items) {
    if (item === current) break;
    if (item.label === '---') ordinal += 1;
  }
  return `${parentLabel}-separator-${ordinal}`;
}

export function MenubarSubmenu({
  items,
  parentLabel,
  open,
  activeSubmenuIndex,
  anchorRef,
  submenuRef,
  currentTheme,
  onKeyDown,
  state,
  onClose,
  handleAction,
}: MenubarSubmenuProps) {
  if (!open) return null;

  return (
    <FloatingPortal
      anchorRef={anchorRef}
      open
      onClose={onClose}
      kind="submenu"
      placement="right-start"
      logicalPlacement={true}
      fallbackPlacements={['left-start']}
      offsetDistance={0}
      dismissOnEscape={false}
      className="editor-menubar__submenu"
    >
      <div
        ref={submenuRef}
        role="menu"
        aria-label={parentLabel}
        onKeyDown={(event) => {
          // A submenu is both a React descendant of the dropdown and a
          // separately portaled surface. It owns its key event exactly once.
          event.stopPropagation();
          onKeyDown(event);
        }}
      >
        {/* activeSubmenuIndex counts only focusable items (separators
            excluded), matching menubarKeynav and the MENU_ITEM_SELECTOR
            NodeList it focuses through. Comparing it against the raw config
            index put tabIndex=0 on the wrong item — or on no item at all —
            as soon as a separator preceded the active one. Track the
            focusable index alongside the config index, as the parent
            dropdown already does. */}
        {(() => {
          let focusableIdx = -1;
          return items.map((subItem) => {
            if (subItem.label === '---') {
              return (
                <hr
                  key={separatorKey(items, subItem, parentLabel)}
                  className="editor-menubar__menu-sep"
                  tabIndex={-1}
                />
              );
            }
            focusableIdx += 1;
            const subFocusableIdx = focusableIdx;
            const subRole = menubarItemRole(subItem);
            const subChecked = menubarItemAriaChecked(subItem, state, currentTheme);
            const subActive =
              (subItem.action?.startsWith('theme:') && currentTheme === subItem.action.slice(6)) ||
              subChecked;
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is emitted only when the runtime role is menuitemradio/menuitemcheckbox
              <button
                key={subItem.label}
                role={subRole}
                type="button"
                aria-checked={
                  subRole === 'menuitemradio' || subRole === 'menuitemcheckbox'
                    ? subChecked
                    : undefined
                }
                aria-keyshortcuts={subItem.ariaKeyshortcut}
                disabled={subItem.disabled}
                tabIndex={activeSubmenuIndex === subFocusableIdx ? 0 : -1}
                className={`editor-menubar__menu-item${subActive ? ' editor-menubar__menu-item--active' : ''}`}
                onClick={() => handleAction(subItem.action ?? '')}
              >
                <span className="editor-menubar__menu-label">{subItem.label}</span>
                {subItem.shortcut && (
                  <span className="editor-menubar__menu-shortcut">{subItem.shortcut}</span>
                )}
              </button>
            );
          });
        })()}
      </div>
    </FloatingPortal>
  );
}
