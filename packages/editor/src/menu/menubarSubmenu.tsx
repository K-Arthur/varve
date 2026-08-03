/**
 * Menubar submenu — extracted from Menubar.tsx (over its complexity ceiling).
 *
 * Renders the portaled submenu for a dropdown item with roving tabindex and
 * keyboard-driven focus (the parent menu owns the arrow-key state machine in
 * menubarKeynav.ts; this component only renders and wires focus return).
 */

import { FloatingPortal } from '@strata/ui';
import type React from 'react';

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
  anchorRef: React.RefObject<HTMLDivElement | null>;
  submenuRef: React.RefObject<HTMLDivElement | null>;
  currentTheme: string;
  state: {
    canvasMode: string;
    workspaceMode: string;
    colorBlindnessView: string;
    rulerMode: string;
    document?: { activePageId?: string; pages?: Array<{ id: string; masterPageId?: string }> };
  };
  onClose: () => void;
  handleAction: (action: string) => void;
}

function itemRole(item: SubmenuDef): string {
  if (item.action?.startsWith('theme:')) return 'menuitemradio';
  if (
    item.action === 'canvasModeOutline' ||
    item.action === 'canvasModePreview' ||
    item.action === 'canvasModeFull'
  )
    return 'menuitemcheckbox';
  if (item.action?.startsWith('colorBlindness')) return 'menuitemradio';
  if (item.action?.startsWith('workspace')) return 'menuitemradio';
  if (item.action === 'rulerModeArtboard' || item.action === 'rulerModeGlobal')
    return 'menuitemradio';
  if (item.action?.startsWith('applyMaster')) return 'menuitemradio';
  return 'menuitem';
}

function separatorKey(items: SubmenuDef[], current: SubmenuDef, parentLabel: string): string {
  let ordinal = 0;
  for (const item of items) {
    if (item === current) break;
    if (item.label === '---') ordinal += 1;
  }
  return `${parentLabel}-separator-${ordinal}`;
}

/** Compute aria-checked for a menu item based on current state. */
function itemAriaChecked(
  item: SubmenuDef,
  state: MenubarSubmenuProps['state'],
): boolean | undefined {
  if (item.action?.startsWith('theme:')) {
    return getTheme() === item.action.slice(6);
  }
  if (item.action === 'canvasModeOutline') return state.canvasMode === 'outline';
  if (item.action === 'canvasModePreview') return state.canvasMode === 'preview';
  if (item.action === 'canvasModeFull') return state.canvasMode === 'full';
  if (item.action?.startsWith('colorBlindness')) {
    return state.colorBlindnessView === item.action.slice('colorBlindness'.length);
  }
  if (item.action?.startsWith('workspace')) {
    return state.workspaceMode === item.action.slice('workspace'.length);
  }
  if (item.action === 'rulerModeArtboard') return state.rulerMode === 'artboard';
  if (item.action === 'rulerModeGlobal') return state.rulerMode === 'global';
  if (item.action?.startsWith('applyMaster')) {
    return state.document?.activePageId
      ? state.document.pages?.find((p) => p.id === state.document?.activePageId)?.masterPageId ===
          item.action.slice('applyMaster'.length)
      : false;
  }
  return undefined;
}

function getTheme(): string {
  try {
    return document.documentElement.dataset.theme ?? 'light';
  } catch {
    return 'light';
  }
}

export function MenubarSubmenu({
  items,
  parentLabel,
  open,
  activeSubmenuIndex,
  anchorRef,
  submenuRef,
  currentTheme,
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
      className="editor-menubar__submenu"
    >
      <div ref={submenuRef} role="menu" aria-label={parentLabel}>
        {items.map((subItem, subItemIdx) => {
          if (subItem.label === '---') {
            return (
              <hr
                key={separatorKey(items, subItem, parentLabel)}
                className="editor-menubar__menu-sep"
                tabIndex={-1}
              />
            );
          }
          const subRole = itemRole(subItem);
          const subChecked = itemAriaChecked(subItem, state);
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
              tabIndex={activeSubmenuIndex === subItemIdx ? 0 : -1}
              className={`editor-menubar__menu-item${subActive ? ' editor-menubar__menu-item--active' : ''}`}
              onClick={() => handleAction(subItem.action ?? '')}
            >
              <span className="editor-menubar__menu-label">{subItem.label}</span>
              {subItem.shortcut && (
                <span className="editor-menubar__menu-shortcut">{subItem.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    </FloatingPortal>
  );
}
