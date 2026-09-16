/**
 * Shared role and checked-state resolution for menubar items.
 *
 * The dropdown (`Menubar.tsx`) and the submenu (`menubarSubmenu.tsx`) used to
 * carry hand-copied versions of this logic, and the copies drifted twice:
 * workspace and colour-blindness radios inside a submenu compared
 * case-sensitively against lowercase state and always reported unchecked, and
 * the Logo Panel toggle lost its checkbox role once it moved into the Panels
 * submenu. One implementation keeps both surfaces identical by construction.
 */

export interface MenubarItemState {
  canvasMode: string;
  workspaceMode: string;
  colorBlindnessView: string;
  rulerMode: string;
  logoPanelVisible: boolean;
  document?: { activePageId?: string; pages?: Array<{ id: string; masterPageId?: string }> };
}

export interface MenubarItemLike {
  action?: string;
}

export type ToolbarPlacementChoice = 'bottom' | 'top';

export function menubarItemRole(
  item: MenubarItemLike,
): 'menuitem' | 'menuitemradio' | 'menuitemcheckbox' {
  if (item.action?.startsWith('theme:')) return 'menuitemradio';
  if (
    item.action === 'canvasModeOutline' ||
    item.action === 'canvasModePreview' ||
    item.action === 'canvasModeFull'
  )
    return 'menuitemcheckbox';
  if (item.action?.startsWith('colorBlindness')) return 'menuitemradio';
  if (item.action?.startsWith('workspace')) return 'menuitemradio';
  if (item.action === 'viewToolbarTop' || item.action === 'viewToolbarBottom')
    return 'menuitemradio';
  if (item.action === 'toggleLogoPanel') return 'menuitemcheckbox';
  if (item.action === 'rulerModeArtboard' || item.action === 'rulerModeGlobal')
    return 'menuitemradio';
  if (item.action?.startsWith('applyMaster')) return 'menuitemradio';
  return 'menuitem';
}

/** Compute aria-checked for a menu item based on current state. */
export function menubarItemAriaChecked(
  item: MenubarItemLike,
  state: MenubarItemState,
  currentTheme: string,
  toolbarPlacement: ToolbarPlacementChoice = 'bottom',
): boolean | undefined {
  if (item.action === 'viewToolbarTop') return toolbarPlacement === 'top';
  if (item.action === 'viewToolbarBottom') return toolbarPlacement === 'bottom';
  if (item.action === 'toggleLogoPanel') return state.logoPanelVisible;
  if (item.action?.startsWith('theme:')) {
    return currentTheme === item.action.slice(6);
  }
  if (item.action === 'canvasModeOutline') return state.canvasMode === 'outline';
  if (item.action === 'canvasModePreview') return state.canvasMode === 'preview';
  if (item.action === 'canvasModeFull') return state.canvasMode === 'full';
  if (item.action?.startsWith('colorBlindness')) {
    // Action ids are camelCase (colorBlindnessProtanopia); state values are
    // lowercase (protanopia).
    return state.colorBlindnessView === item.action.slice('colorBlindness'.length).toLowerCase();
  }
  if (item.action?.startsWith('workspace')) {
    // Action ids are camelCase (workspaceDesign); state values are lowercase
    // (design). Without normalizing, every workspace radio in a submenu
    // rendered aria-checked="false" even for the active mode.
    return state.workspaceMode === item.action.replace('workspace', '').toLowerCase();
  }
  if (item.action === 'rulerModeArtboard') return state.rulerMode === 'artboard';
  if (item.action === 'rulerModeGlobal') return state.rulerMode === 'global';
  if (item.action?.startsWith('applyMaster:')) {
    const targetId = item.action.slice('applyMaster:'.length);
    const activePageId = state.document?.activePageId ?? null;
    const activePage = activePageId
      ? state.document?.pages?.find((p) => p.id === activePageId)
      : null;
    const currentMasterId = activePage?.masterPageId ?? null;
    if (targetId === '') return currentMasterId == null;
    return currentMasterId === targetId;
  }
  return undefined;
}
