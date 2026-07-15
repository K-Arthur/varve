import { AlertDialog, CHROME_ICONS, FloatingPortal, IconButton, StrataLogo } from '@strata/ui';
import type { Theme } from '@strata/ui/tokens';
import { getTheme, setTheme } from '@strata/ui/tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getActionRegistry } from './actions/ActionRegistry';
import { useEditor } from './context';
import { formatShortcut, SHORTCUT_DEFS } from './shortcuts';
import { WORKSPACE_LABELS, type WorkspaceMode } from './workspace/workspaceTypes';

type MenuId = 'File' | 'Edit' | 'View' | 'Object' | 'Arrange' | 'Page' | 'Plugins' | 'Help';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: string;
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'high-contrast', label: 'High Contrast' },
];

const MENUS: { id: MenuId; items: MenuItem[] }[] = [
  {
    id: 'File',
    items: [
      { label: 'New', shortcut: formatShortcut(SHORTCUT_DEFS.newDocument.binding), action: 'new' },
      { label: 'Open\u2026', shortcut: formatShortcut(SHORTCUT_DEFS.open.binding), action: 'open' },
      { label: 'Save', shortcut: formatShortcut(SHORTCUT_DEFS.save.binding), action: 'save' },
      {
        label: 'Save As\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.saveAs.binding),
        action: 'saveAs',
      },
      {
        label: 'Export SVG\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.exportSvg.binding),
        action: 'exportSvg',
      },
      {
        label: 'Import\u2026',
        shortcut: '\u2318I',
        action: 'import',
      },
      {
        label: 'Export\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.export.binding),
        action: 'export',
      },
      { label: '---' },
      {
        label: 'Present\u2026',
        shortcut: '\u21E7\u2318P',
        action: 'present',
      },
      { label: '---' },
      {
        label: 'Settings\u2026',
        shortcut: formatShortcut(SHORTCUT_DEFS.settings.binding),
        action: 'settings',
      },
    ],
  },
  {
    id: 'Edit',
    items: [
      { label: 'Undo', shortcut: formatShortcut(SHORTCUT_DEFS.undo.binding), action: 'undo' },
      { label: 'Redo', shortcut: formatShortcut(SHORTCUT_DEFS.redo.binding), action: 'redo' },
      { label: '---' },
      { label: 'Cut', shortcut: formatShortcut(SHORTCUT_DEFS.cut.binding), action: 'cut' },
      { label: 'Copy', shortcut: formatShortcut(SHORTCUT_DEFS.copy.binding), action: 'copy' },
      { label: 'Paste', shortcut: formatShortcut(SHORTCUT_DEFS.paste.binding), action: 'paste' },
      {
        label: 'Duplicate',
        shortcut: formatShortcut(SHORTCUT_DEFS.duplicate.binding),
        action: 'duplicate',
      },
      { label: '---' },
      {
        label: 'Select All',
        shortcut: formatShortcut(SHORTCUT_DEFS.selectAll.binding),
        action: 'selectAll',
      },
      { label: 'Delete', shortcut: '\u232B', action: 'delete' },
    ],
  },
  {
    id: 'View',
    items: [
      ...THEMES.map((t) => ({
        label: t.label,
        action: `theme:${t.id}`,
      })),
      { label: '---' },
      {
        label: 'Zoom to 100%',
        shortcut: formatShortcut(SHORTCUT_DEFS.zoomReset.binding),
        action: 'zoomReset',
      },
      {
        label: 'Inspect Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.toolInspect.binding),
        action: 'inspectMode',
      },
      { label: '---' },
      {
        label: 'Keyboard Shortcuts',
        shortcut: formatShortcut(SHORTCUT_DEFS.shortcutPalette.binding),
        action: 'shortcutPalette',
      },
      {
        label: 'Toggle Snap',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleSnap.binding),
        action: 'toggleSnap',
      },
      {
        label: 'Show Guides',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleGuidesVisible.binding),
        action: 'toggleGuidesVisible',
      },
      {
        label: 'Lock All Guides',
        shortcut: formatShortcut(SHORTCUT_DEFS.lockAllGuides.binding),
        action: 'lockAllGuides',
      },
      { label: '---' },
      {
        label: 'Facing Pages',
        action: 'toggleFacingPages',
      },
      {
        label: 'Soft Proofing',
        shortcut: formatShortcut(SHORTCUT_DEFS.softProof.binding),
        action: 'softProof',
      },
      {
        label: 'Timeline Panel',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleTimelinePanel.binding),
        action: 'toggleTimelinePanel',
      },
      { label: '---' },
      {
        label: 'Clear All Guides',
        action: 'clearGuides',
      },
      { label: '---' },
      {
        label: 'Outline Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.canvasModeOutline.binding),
        action: 'canvasModeOutline',
      },
      {
        label: 'Preview Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.canvasModePreview.binding),
        action: 'canvasModePreview',
      },
      { label: '---' },
      { label: 'Workspace: Design', action: 'workspaceDesign' },
      { label: 'Workspace: Print', action: 'workspacePrint' },
      { label: 'Workspace: Draw', action: 'workspaceDrawing' },
      { label: 'Workspace: Photo', action: 'workspaceImage' },
      { label: '---' },
      {
        label: 'Distraction-Free Mode',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleDistractionFree.binding),
        action: 'toggleDistractionFree',
      },
      {
        label: 'Compare Before/After',
        shortcut: formatShortcut(SHORTCUT_DEFS.toggleBeforeAfterCompare.binding),
        action: 'toggleBeforeAfterCompare',
      },
      { label: '---' },
      {
        label: 'Fit Active Page',
        shortcut: formatShortcut(SHORTCUT_DEFS.fitActivePage.binding),
        action: 'fitActivePage',
      },
      {
        label: 'Fit Active Frame',
        shortcut: formatShortcut(SHORTCUT_DEFS.fitActiveFrame.binding),
        action: 'fitActiveFrame',
      },
      {
        label: 'Reset View Rotation',
        shortcut: formatShortcut(SHORTCUT_DEFS.resetViewRotation.binding),
        action: 'resetViewRotation',
      },
      {
        label: 'Rotate View Clockwise',
        shortcut: formatShortcut(SHORTCUT_DEFS.rotateViewCW.binding),
        action: 'rotateViewCW',
      },
      {
        label: 'Rotate View Counter-clockwise',
        shortcut: formatShortcut(SHORTCUT_DEFS.rotateViewCCW.binding),
        action: 'rotateViewCCW',
      },
      {
        label: 'Artboard Ruler Origin',
        action: 'rulerModeArtboard',
      },
      {
        label: 'Global Ruler Origin',
        action: 'rulerModeGlobal',
      },
      {
        label: 'Baseline Grid Overlay',
        shortcut: formatShortcut(SHORTCUT_DEFS.gridOverlayBaseline.binding),
        action: 'gridOverlayBaseline',
      },
      {
        label: 'Isometric Grid Overlay',
        shortcut: formatShortcut(SHORTCUT_DEFS.gridOverlayIsometric.binding),
        action: 'gridOverlayIsometric',
      },
      { label: '---' },
      {
        label: '\u2616 Color Blindness: None',
        action: 'colorBlindnessNone',
        shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessNone.binding),
      },
      {
        label: '\u2616 Protanopia (red)',
        action: 'colorBlindnessProtanopia',
        shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessProtanopia.binding),
      },
      {
        label: '\u2616 Deuteranopia (green)',
        action: 'colorBlindnessDeuteranopia',
        shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessDeuteranopia.binding),
      },
      {
        label: '\u2616 Tritanopia (blue)',
        action: 'colorBlindnessTritanopia',
        shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessTritanopia.binding),
      },
      { label: '---' },
      {
        label: 'Home',
        shortcut: formatShortcut(SHORTCUT_DEFS.home.binding),
        action: 'home',
      },
    ],
  },
  {
    id: 'Object',
    items: [
      { label: 'Group', shortcut: formatShortcut(SHORTCUT_DEFS.group.binding), action: 'group' },
      {
        label: 'Ungroup',
        shortcut: formatShortcut(SHORTCUT_DEFS.ungroup.binding),
        action: 'ungroup',
      },
      { label: '---' },
      { label: 'Remove Background...', action: 'batchBgRemove' },
      { label: '---' },
      { label: 'Add Alpha Mask', action: 'addAlphaMask' },
      { label: 'Add Clip Mask', action: 'addClipMask' },
      { label: 'Add Luminance Mask', action: 'addLuminanceMask' },
      { label: 'Remove Mask', action: 'removeMask' },
      { label: 'Toggle Mask', action: 'toggleMask' },
      { label: 'Invert Mask', action: 'invertMask' },
      { label: '---' },
      {
        label: 'Union',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanUnion.binding),
        action: 'booleanUnion',
      },
      {
        label: 'Subtract',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanSubtract.binding),
        action: 'booleanSubtract',
      },
      {
        label: 'Intersect',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanIntersect.binding),
        action: 'booleanIntersect',
      },
      {
        label: 'Exclude',
        shortcut: formatShortcut(SHORTCUT_DEFS.booleanExclude.binding),
        action: 'booleanExclude',
      },
    ],
  },
  {
    id: 'Arrange',
    items: [
      {
        label: 'Bring to Front',
        shortcut: formatShortcut(SHORTCUT_DEFS.bringFront.binding),
        action: 'bringFront',
      },
      {
        label: 'Bring Forward',
        shortcut: formatShortcut(SHORTCUT_DEFS.bringForward.binding),
        action: 'bringForward',
      },
      {
        label: 'Send Backward',
        shortcut: formatShortcut(SHORTCUT_DEFS.sendBackward.binding),
        action: 'sendBackward',
      },
      {
        label: 'Send to Back',
        shortcut: formatShortcut(SHORTCUT_DEFS.sendBack.binding),
        action: 'sendBack',
      },
    ],
  },
  {
    id: 'Page',
    items: [
      {
        label: 'Create Master',
        action: 'createMaster',
      },
      {
        label: 'Apply Master to Page',
        action: 'applyMaster',
      },
      {
        label: 'Detach Master from Page',
        action: 'detachMaster',
      },
      { label: '---' },
      {
        label: 'Facing Pages',
        action: 'toggleFacingPages',
      },
    ],
  },
  { id: 'Plugins', items: [{ label: 'No plugins loaded', action: '' }] },
  {
    id: 'Help',
    items: [
      { label: 'Contextual help', shortcut: 'F1', action: 'openHelp' },
      { label: 'Help center', shortcut: 'Ctrl+Shift+F1', action: 'openHelpCenter' },
      { label: "What's this?", shortcut: 'Shift+F1', action: 'whatIsThis' },
      { label: 'Take a tour', action: 'startTour' },
      { label: '---' },
      { label: 'About Strata', action: 'about' },
    ],
  },
];

function itemRole(item: MenuItem): string {
  if (item.action?.startsWith('theme:')) return 'menuitemradio';
  if (item.action?.startsWith('canvasMode')) return 'menuitemcheckbox';
  if (item.action?.startsWith('colorBlindness')) return 'menuitemradio';
  if (item.action?.startsWith('workspace')) return 'menuitemradio';
  return 'menuitem';
}

export function Menubar({
  onBackToHome,
  onOpenSettings,
  onStartTour,
  onOpenPalette,
  onOpenHelp,
  onOpenHelpCenter,
  onWhatIsThis,
  onOpenAbout,
  onBatchBgRemove,
}: {
  onBackToHome?: () => void;
  onOpenSettings?: () => void;
  onStartTour?: () => void;
  onOpenPalette?: () => void;
  onOpenHelp?: () => void;
  onOpenHelpCenter?: () => void;
  onWhatIsThis?: () => void;
  onOpenAbout?: () => void;
  onBatchBgRemove?: () => void;
}) {
  const {
    state,
    newDocument,
    serializeDocument,
    loadDocument,
    undo,
    redo,
    setZoom,
    setShowExportDialog,
    clearAllGuides,
    startPresentation,
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    assignMasterToPage,
    createMaster,
    toggleFacingPages,
    setWorkspaceMode,
    toggleDistractionFreeMode,
  } = useEditor();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme() ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const topLevelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [confirmNewDoc, setConfirmNewDoc] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('strata-theme') as Theme | null;
    if (saved && saved !== getTheme()) {
      setTheme(saved);
      setCurrentTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  useEffect(() => {
    if (openMenu) {
      const menu = dropdownMenuRef.current;
      if (!menu) return;
      const items = menu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
      );
      items[activeItemIndex]?.focus();
    }
  }, [openMenu, activeItemIndex]);

  const openMenuIndex = openMenu ? MENUS.findIndex((m) => m.id === openMenu) : -1;
  const openMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  openMenuAnchorRef.current =
    openMenuIndex >= 0 ? (topLevelRefs.current[openMenuIndex] ?? null) : null;

  const startNameEdit = useCallback(() => {
    setNameDraft(state.document.name || '');
    setEditingName(true);
  }, [state.document.name]);

  const commitName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.document.name) {
      const json = serializeDocument();
      const doc = JSON.parse(json);
      doc.name = trimmed;
      loadDocument(JSON.stringify(doc), { name: trimmed });
    }
  }, [nameDraft, state.document.name, serializeDocument, loadDocument]);

  const handleAction = useCallback(
    (action: string) => {
      setOpenMenu(null);

      // Menubar-specific actions (not in the registry or with different behavior)
      switch (action) {
        case 'new':
          setConfirmNewDoc(true);
          return;
        case 'settings':
          onOpenSettings?.();
          return;
        case 'startTour':
          onStartTour?.();
          return;
        case 'shortcutPalette':
          onOpenPalette?.();
          return;
        case 'whatIsThis':
          onWhatIsThis?.();
          return;
        case 'about':
          onOpenAbout?.();
          return;
        case 'batchBgRemove':
          onBatchBgRemove?.();
          return;
        case 'export':
          setShowExportDialog(true);
          return;
        case 'addAlphaMask':
          addMaskToSelected('alpha');
          return;
        case 'addClipMask':
          addMaskToSelected('clip');
          return;
        case 'addLuminanceMask':
          addMaskToSelected('luminance');
          return;
        case 'removeMask':
          removeMaskFromSelected();
          return;
        case 'toggleMask':
          toggleMask();
          return;
        case 'invertMask':
          invertMask();
          return;
        case 'clearGuides':
          clearAllGuides();
          return;
        case 'present':
          startPresentation();
          return;
        case 'toggleFacingPages':
          toggleFacingPages();
          return;
        case 'toggleDistractionFree':
          toggleDistractionFreeMode();
          return;
        case 'createMaster':
          createMaster('Master', 1920, 1080);
          return;
        case 'applyMaster': {
          const activeId = state.document.activePageId;
          const masterEntries = state.document.masters ? Object.keys(state.document.masters) : [];
          if (activeId && masterEntries.length > 0) {
            assignMasterToPage(activeId, masterEntries[0]!);
          }
          return;
        }
        case 'detachMaster': {
          const activeId = state.document.activePageId;
          if (activeId) {
            assignMasterToPage(activeId, null);
          }
          return;
        }
        default:
          if (action.startsWith('theme:')) {
            const theme = action.slice(6) as Theme;
            setTheme(theme);
            setCurrentTheme(theme);
            localStorage.setItem('strata-theme', theme);
            return;
          }
          break;
      }

      // Fallback to shared action registry
      const registry = getActionRegistry();
      const registered = registry.get(action);
      if (registered) {
        (registered.handler as () => void)();
        return;
      }

      // Legacy fallbacks for actions not yet in the registry
      switch (action) {
        case 'open':
          document.querySelector<HTMLInputElement>('#file-open-input')?.click();
          break;
        case 'import':
          document.querySelector<HTMLInputElement>('#file-import-input')?.click();
          break;
        case 'home':
          onBackToHome?.();
          break;
        default:
          break;
      }
    },
    [
      state,
      onBackToHome,
      onOpenSettings,
      onStartTour,
      onOpenPalette,
      onOpenHelp,
      onOpenHelpCenter,
      onWhatIsThis,
      onOpenAbout,
      onBatchBgRemove,
      setShowExportDialog,
      addMaskToSelected,
      removeMaskFromSelected,
      toggleMask,
      invertMask,
      clearAllGuides,
      startPresentation,
      assignMasterToPage,
      createMaster,
      toggleFacingPages,
      setWorkspaceMode,
      toggleDistractionFreeMode,
    ],
  );

  const handleZoomInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v) && v > 0) setZoom(v / 100);
    },
    [setZoom],
  );

  const handleZoomKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
  }, []);

  // ─── keyboard navigation ──────────────────────────────────────────────

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const openIdx = openMenu ? MENUS.findIndex((m) => m.id === openMenu) : -1;

      if (openIdx >= 0 && openMenu) {
        // Dropdown is open — navigate items
        const menu = MENUS[openIdx];
        if (!menu) return;
        const items = menu.items.filter((i) => i.label !== '---');

        switch (e.key) {
          case 'ArrowDown':
          case 'ArrowUp': {
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setActiveItemIndex((prev) => {
              const next = prev + dir;
              if (next < 0) return items.length - 1;
              if (next >= items.length) return 0;
              return next;
            });
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            const item = items[activeItemIndex];
            if (item?.action) handleAction(item.action);
            return;
          }
          case 'Escape': {
            e.preventDefault();
            setOpenMenu(null);
            setActiveItemIndex(0);
            topLevelRefs.current[openIdx]?.focus();
            return;
          }
          case 'ArrowLeft': {
            e.preventDefault();
            const prev = (openIdx - 1 + MENUS.length) % MENUS.length;
            setOpenMenu(MENUS[prev]?.id ?? null);
            setActiveItemIndex(0);
            setFocusedIndex(prev);
            return;
          }
          case 'ArrowRight': {
            e.preventDefault();
            const next = (openIdx + 1) % MENUS.length;
            setOpenMenu(MENUS[next]?.id ?? null);
            setActiveItemIndex(0);
            setFocusedIndex(next);
            return;
          }
          case 'Home': {
            e.preventDefault();
            setActiveItemIndex(0);
            return;
          }
          case 'End': {
            e.preventDefault();
            setActiveItemIndex(items.length - 1);
            return;
          }
        }
      } else {
        // Top-level navigation
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': {
            e.preventDefault();
            const next = (focusedIndex + 1) % MENUS.length;
            setFocusedIndex(next);
            topLevelRefs.current[next]?.focus();
            return;
          }
          case 'ArrowLeft':
          case 'ArrowUp': {
            e.preventDefault();
            const prev = (focusedIndex - 1 + MENUS.length) % MENUS.length;
            setFocusedIndex(prev);
            topLevelRefs.current[prev]?.focus();
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            setOpenMenu(MENUS[focusedIndex]?.id ?? null);
            setActiveItemIndex(0);
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
            setFocusedIndex(MENUS.length - 1);
            topLevelRefs.current[MENUS.length - 1]?.focus();
            return;
          }
        }
      }
    },
    [openMenu, focusedIndex, activeItemIndex, handleAction],
  );

  return (
    <div
      className="editor-menubar"
      role="menubar"
      aria-label="Application"
      ref={menuRef}
      data-testid="menubar"
      onKeyDown={handleMenuKeyDown}
    >
      <div className="editor-menubar__left">
        <button
          type="button"
          className="editor-menubar__home"
          aria-label="Home (Ctrl+Shift+H)"
          title="Home (Ctrl+Shift+H)"
          onClick={() => onBackToHome?.()}
        >
          <StrataLogo size={16} />
        </button>
        {MENUS.map((menu, i) => (
          <button
            key={menu.id}
            ref={(el) => {
              topLevelRefs.current[i] = el;
            }}
            role="menuitem"
            className="editor-menubar__item"
            aria-haspopup="true"
            aria-expanded={openMenu === menu.id}
            tabIndex={focusedIndex === i ? 0 : -1}
            type="button"
            onClick={() => {
              setOpenMenu(openMenu === menu.id ? null : menu.id);
              setFocusedIndex(i);
              setActiveItemIndex(0);
            }}
            onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
          >
            {menu.id}
          </button>
        ))}
      </div>

      {openMenu && openMenuIndex >= 0 && (
        <FloatingPortal
          anchorRef={openMenuAnchorRef}
          open
          onClose={() => {
            setOpenMenu(null);
            setActiveItemIndex(0);
          }}
          className="editor-menubar__menu"
        >
          <div ref={dropdownMenuRef} role="menu" aria-label={openMenu}>
            {MENUS[openMenuIndex]?.items.map((item, itemIdx) => {
              if (item.label === '---') {
                return (
                  <hr key={`sep-${itemIdx}`} className="editor-menubar__menu-sep" tabIndex={-1} />
                );
              }
              const isActive =
                item.action?.startsWith('theme:') && currentTheme === item.action.slice(6);
              const colorBlindType = item.action?.startsWith('colorBlindness')
                ? item.action.slice('colorBlindness'.length).toLowerCase()
                : null;
              const workspaceType = item.action?.startsWith('workspace')
                ? item.action.replace('workspace', '').toLowerCase()
                : null;
              const isChecked =
                item.action === 'canvasModeOutline'
                  ? state.canvasMode === 'outline'
                  : item.action === 'canvasModePreview'
                    ? state.canvasMode === 'preview'
                    : colorBlindType !== null
                      ? state.colorBlindnessView === colorBlindType
                      : workspaceType !== null
                        ? state.workspaceMode === workspaceType
                        : undefined;
              return (
                // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is valid for menuitemradio role per ARIA spec
                <button
                  key={item.label}
                  role={itemRole(item)}
                  type="button"
                  aria-checked={
                    item.action?.startsWith('theme:')
                      ? currentTheme === item.action.slice(6)
                      : item.action === 'canvasModeOutline'
                        ? state.canvasMode === 'outline'
                        : item.action === 'canvasModePreview'
                          ? state.canvasMode === 'preview'
                          : colorBlindType !== null
                            ? state.colorBlindnessView === colorBlindType
                            : workspaceType !== null
                              ? state.workspaceMode === workspaceType
                              : undefined
                  }
                  disabled={!item.action}
                  className={`editor-menubar__menu-item${isActive || isChecked ? ' editor-menubar__menu-item--active' : ''}`}
                  onClick={() => handleAction(item.action ?? '')}
                >
                  <span className="editor-menubar__menu-label">{item.label}</span>
                  {item.shortcut && (
                    <span className="editor-menubar__menu-shortcut">{item.shortcut}</span>
                  )}
                </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}

      {/* ── Center: Workspace mode switcher + Document name ── */}
      <div className="editor-menubar__center">
        <div className="editor-menubar__workspace" role="radiogroup" aria-label="Workspace">
          {(['design', 'print', 'drawing', 'image'] as WorkspaceMode[]).map((mode, idx) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={state.workspaceMode === mode}
              className={`editor-menubar__workspace-btn${state.workspaceMode === mode ? ' editor-menubar__workspace-btn--active' : ''}`}
              onClick={() => setWorkspaceMode(mode)}
              title={`${WORKSPACE_LABELS[mode]} workspace (Ctrl+Shift+${idx + 1})`}
            >
              {WORKSPACE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="editor-menubar__doc-name">
          {editingName ? (
            <input
              ref={nameInputRef}
              className="editor-menubar__doc-name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setEditingName(false);
              }}
              aria-label="Document name"
            />
          ) : (
            // biome-ignore lint/a11y/useSemanticElements: span with role="button" is intentional for inline clickable text; keyboard + click handlers present
            <span
              role="button"
              tabIndex={0}
              className="editor-menubar__doc-name-text"
              onClick={startNameEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  startNameEdit();
                }
              }}
              title="Click to rename"
            >
              {state.document.name || 'Untitled'}
            </span>
          )}
        </div>
      </div>

      {/* ── Right: Zoom + Undo/Redo ── */}
      <div className="editor-menubar__controls">
        <IconButton icon={CHROME_ICONS.undo} label="Undo" size="sm" onClick={undo} />
        <IconButton icon={CHROME_ICONS.redo} label="Redo" size="sm" onClick={redo} />
        <div className="editor-menubar__zoom">
          <span aria-hidden className="editor-menubar__zoom-divider">
            |
          </span>
          <label htmlFor="menubar-zoom" className="sr-only">
            Zoom
          </label>
          <input
            id="menubar-zoom"
            className="editor-menubar__zoom-input"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={Math.round(state.zoom * 100)}
            onChange={handleZoomInput}
            onKeyDown={handleZoomKey}
            aria-label={`Zoom ${Math.round(state.zoom * 100)}%`}
          />
          <span className="editor-menubar__zoom-unit">%</span>
        </div>
      </div>

      <AlertDialog
        open={confirmNewDoc}
        onClose={() => setConfirmNewDoc(false)}
        onConfirm={() => {
          setConfirmNewDoc(false);
          newDocument();
        }}
        title="New Document"
        description="Create a new document? Unsaved changes will be lost."
        confirmLabel="Create"
        variant="danger"
      />
    </div>
  );
}
