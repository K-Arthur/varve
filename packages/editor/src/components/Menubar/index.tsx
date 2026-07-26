import {
  AlertDialog,
  FloatingPortal,
  IconButton,
  SOLID_CHROME_ICONS,
  SolidIcon,
  StrataLogo,
  Tooltip,
  TooltipProvider,
} from '@strata/ui';
import { getTheme, setTheme, type Theme } from '@strata/ui/tokens';
import {
  getTypeAheadResetMs,
  isResetKey,
  matchMenuTypeAhead,
  shouldTypeAhead,
} from '@strata/ui/utils/menuTypeAhead';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActionRegistry } from '../../actions/ActionRegistry';
import type { ArchiveDialogProps } from '../Archive/ArchiveDialog';
import { ArchiveDialog } from '../Archive/ArchiveDialog';
import { bumpThemeRevision, useEditor } from '../../context';
import { useRecentFiles } from '../../recentFiles';
import { loadSettings } from '../../settings';
import { formatShortcut, getEffectiveBinding, SHORTCUT_DEFS } from '../../shortcuts';
import { WORKSPACE_LABELS, type WorkspaceMode } from '../../workspace/workspaceTypes';
import type { MenuBuildHelpers, MenuId, MenuItem, RecentEntry } from './types';
import { buildFileMenu } from './FileMenu';
import { buildEditMenu } from './EditMenu';
import { buildTextMenu } from './TextMenu';
import { buildViewMenu } from './ViewMenu';
import { buildObjectMenu } from './ObjectMenu';
import { buildArrangeMenu } from './ArrangeMenu';
import { buildPageMenu } from './PageMenu';
import { buildHelpMenu } from './HelpMenu';

export { buildFileMenu } from './FileMenu';
export { buildEditMenu } from './EditMenu';
export { buildTextMenu } from './TextMenu';
export { buildViewMenu } from './ViewMenu';
export { buildObjectMenu } from './ObjectMenu';
export { buildArrangeMenu } from './ArrangeMenu';
export { buildPageMenu } from './PageMenu';
export { buildHelpMenu } from './HelpMenu';
export type { MenuBuildHelpers, MenuId, MenuItem, MenuBuildState, RecentEntry } from './types';

function ariaShortcut(binding: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join('+');
}

const INSTALL_DISMISS_KEY = 'strata-install-desktop-dismissed';

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing */
  }
}

function isInstallDesktopDismissed(): boolean {
  return safeLocalStorageGet(INSTALL_DISMISS_KEY) === 'true';
}

function isInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function safeOpenInstallPage(): void {
  if (isInstallDesktopDismissed()) return;
  safeLocalStorageSet(INSTALL_DISMISS_KEY, 'true');
  const os = detectOS();
  const base = 'https://strata.app/download';
  const urls: Record<string, string> = {
    mac: `${base}/mac`,
    windows: `${base}/windows`,
    linux: `${base}/linux`,
  };
  try {
    window.open(urls[os] ?? base, '_blank', 'noopener,noreferrer');
  } catch {
    /* blocked popup */
  }
}

function detectOS(): 'mac' | 'windows' | 'linux' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';
  const p = navigator.platform?.toLowerCase() ?? '';
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'windows';
  if (p.includes('linux')) return 'linux';
  return 'unknown';
}

function buildMenus(
  state: {
    selection: string[];
    document: {
      activePageId?: string;
      pages?: Array<{ id: string; masterPageId?: string }>;
      masters?: Record<string, { name?: string }>;
    };
    canvasMode: string;
    workspaceMode: string;
    colorBlindnessView: string;
    softProofEnabled: boolean;
    timelinePanelVisible: boolean;
    graphEditorVisible: boolean;
    stateMachinePanelVisible: boolean;
    guidesVisible: boolean;
    distractionFreeMode: boolean;
    beforeAfterCompare: boolean;
    rulerMode: string;
    snapEnabled: boolean;
  },
  recentEntries: RecentEntry[],
): { id: MenuId; items: MenuItem[] }[] {
  const doc = state.document;
  const activePageId = doc?.activePageId ?? null;
  const activePage = activePageId ? doc?.pages?.find((p) => p.id === activePageId) : null;
  const currentPageMasterId = activePage?.masterPageId ?? null;
  const masterNames = doc?.masters
    ? Object.fromEntries(Object.entries(doc.masters).map(([id, m]) => [id, m?.name ?? 'Unknown']))
    : {};
  const currentPageIsMaster = activePageId != null && masterNames[activePageId] != null;

  const hasSelection = state.selection.length > 0;
  const hasMultipleSelection = state.selection.length >= 2;
  const hasDocument = !!state.document;
  const nodeCount =
    hasDocument && 'nodes' in state.document ? Object.keys(state.document.nodes).length : 0;
  const hasNodes = nodeCount >= 1;
  const hasMultipleNodes = nodeCount >= 2;

  const dis = (action: string): boolean | undefined => {
    switch (action) {
      case 'cut':
      case 'copy':
      case 'duplicate':
      case 'delete':
      case 'selectAll':
        return !hasDocument;
      case 'group':
      case 'ungroup':
        return !hasMultipleSelection;
      case 'flattenSelection':
      case 'rasterizeSelection':
      case 'mergeSelected':
      case 'releaseClippingMask':
        return !hasSelection;
      case 'booleanUnion':
      case 'booleanSubtract':
      case 'booleanIntersect':
      case 'booleanExclude':
        return !hasMultipleSelection;
      case 'bringFront':
      case 'bringForward':
      case 'sendBackward':
      case 'sendBack':
      case 'nudgeUp':
      case 'nudgeDown':
      case 'nudgeLeft':
      case 'nudgeRight':
      case 'harmonizeSpacing':
        return !hasSelection;
      case 'alignLeft':
      case 'alignCenterH':
      case 'alignRight':
      case 'alignTop':
      case 'alignCenterV':
      case 'alignBottom':
      case 'tidySelected':
        return !hasMultipleSelection;
      case 'distributeHorizontal':
      case 'distributeVertical':
        return state.selection.length < 3;
      case 'newAdjustmentLayer':
      case 'createClippingMask':
        return !hasSelection;
      case 'addAlphaMask':
      case 'addClipMask':
      case 'addLuminanceMask':
      case 'removeMask':
      case 'toggleMask':
      case 'invertMask':
        return !hasSelection;
      case 'toolCrop':
      case 'extractPalette':
      case 'batchBgRemove':
        return !hasSelection;
      case 'createMaster':
        return currentPageIsMaster;
      case 'applyMaster':
        return !activePageId || !doc?.masters || Object.keys(doc.masters).length === 0;
      case 'detachMaster':
        return !currentPageMasterId;
      case 'runAudit':
      case 'scanDebt':
        return !hasNodes;
      case 'suggestNames':
        return !hasSelection;
      case 'detectDuplicates':
        return !hasMultipleNodes;
      default:
        return undefined;
    }
  };

  const ks = (id: string): string => ariaShortcut(getEffectiveBinding(id));
  const fmt = (id: string): string => formatShortcut(SHORTCUT_DEFS[id].binding);
  const fmtBinding = (binding: {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  }): string => formatShortcut(binding);
  const ariaShortcutBinding = (binding: {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  }): string => ariaShortcut(binding);

  const helpers: MenuBuildHelpers = { dis, ks, fmt, fmtBinding, ariaShortcutBinding };

  return [
    { id: 'File' as MenuId, items: buildFileMenu(state, recentEntries, helpers) },
    { id: 'Edit' as MenuId, items: buildEditMenu(state, helpers) },
    { id: 'Text' as MenuId, items: buildTextMenu(state, helpers) },
    { id: 'View' as MenuId, items: buildViewMenu(state, helpers) },
    { id: 'Object' as MenuId, items: buildObjectMenu(state, helpers) },
    { id: 'Arrange' as MenuId, items: buildArrangeMenu(state, helpers) },
    { id: 'Page' as MenuId, items: buildPageMenu(state, helpers) },
    { id: 'Help' as MenuId, items: buildHelpMenu(state, helpers) },
  ];
}

function itemRole(item: MenuItem): string {
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

function itemAriaChecked(
  item: MenuItem,
  state: {
    canvasMode: string;
    workspaceMode: string;
    colorBlindnessView: string;
    rulerMode: string;
    document?: { activePageId?: string; pages?: Array<{ id: string; masterPageId?: string }> };
  },
): boolean | undefined {
  if (item.action?.startsWith('theme:')) {
    return getTheme() === item.action.slice(6);
  }
  if (item.action === 'canvasModeOutline') return state.canvasMode === 'outline';
  if (item.action === 'canvasModePreview') return state.canvasMode === 'preview';
  if (item.action === 'canvasModeFull') return state.canvasMode === 'full';
  if (item.action?.startsWith('colorBlindness')) {
    const type = item.action.slice('colorBlindness'.length).toLowerCase();
    return state.colorBlindnessView === type;
  }
  if (item.action?.startsWith('workspace')) {
    const mode = item.action.replace('workspace', '').toLowerCase();
    return state.workspaceMode === mode;
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

const WORKSPACE_ITEM_FILTER: Record<string, WorkspaceMode[]> = {
  textBold: ['design', 'print', 'drawing', 'image', 'motion'],
  textItalic: ['design', 'print', 'drawing', 'image', 'motion'],
  textUnderline: ['design', 'print', 'drawing', 'image', 'motion'],
  textIncreaseSize: ['design', 'print', 'drawing', 'image', 'motion'],
  textDecreaseSize: ['design', 'print', 'drawing', 'image', 'motion'],
  textAlignLeft: ['design', 'print', 'drawing', 'image', 'motion'],
  textAlignCenter: ['design', 'print', 'drawing', 'image', 'motion'],
  textAlignRight: ['design', 'print', 'drawing', 'image', 'motion'],
  textAlignJustify: ['design', 'print', 'drawing', 'image', 'motion'],
  textToOutlines: ['design', 'print', 'drawing'],
  inspectMode: ['design', 'print', 'drawing', 'image', 'motion'],
  toggleTimelinePanel: ['design', 'motion'],
  toggleGraphEditor: ['design', 'motion'],
  toggleStateMachinePanel: ['design', 'motion'],
  toggleBeforeAfterCompare: ['design', 'print', 'drawing', 'image'],
  newAdjustmentLayer: ['design', 'print', 'image'],
  createClippingMask: ['design', 'print', 'drawing', 'image'],
  releaseClippingMask: ['design', 'print', 'drawing', 'image'],
  batchBgRemove: ['design', 'image'],
  toolCrop: ['design', 'print', 'image'],
  extractPalette: ['design', 'drawing', 'image'],
  addAlphaMask: ['design', 'print', 'drawing', 'image'],
  addClipMask: ['design', 'print', 'drawing', 'image'],
  addLuminanceMask: ['design', 'print', 'drawing', 'image'],
  removeMask: ['design', 'print', 'drawing', 'image'],
  toggleMask: ['design', 'print', 'drawing', 'image'],
  invertMask: ['design', 'print', 'drawing', 'image'],
  flattenSelection: ['design', 'print', 'drawing', 'image'],
  rasterizeSelection: ['design', 'print', 'drawing', 'image'],
  mergeSelected: ['design', 'print', 'drawing', 'image'],
  booleanUnion: ['design', 'print', 'drawing'],
  booleanSubtract: ['design', 'print', 'drawing'],
  booleanIntersect: ['design', 'print', 'drawing'],
  booleanExclude: ['design', 'print', 'drawing'],
  createMaster: ['design', 'print'],
  applyMaster: ['design', 'print'],
  detachMaster: ['design', 'print'],
};

function filterMenusByWorkspace(
  menus: { id: MenuId; items: MenuItem[] }[],
  workspace: WorkspaceMode,
  showAll: boolean,
): { id: MenuId; items: MenuItem[] }[] {
  if (showAll) return menus;

  function shouldKeep(action: string | undefined): boolean {
    if (!action) return true;
    const allowed = WORKSPACE_ITEM_FILTER[action];
    if (!allowed) return true;
    return allowed.includes(workspace);
  }

  function filterItems(items: MenuItem[]): MenuItem[] {
    return items.filter((item) => {
      if (item.label === '---') return true;
      if (!shouldKeep(item.action)) return false;
      if (item.items) {
        item.items = filterItems(item.items);
      }
      return true;
    });
  }

  return menus
    .map((menu) => ({ id: menu.id, items: filterItems(menu.items) }))
    .filter((menu) => {
      const visible = menu.items.filter((i) => i.label !== '---');
      return visible.length > 0;
    });
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
    flattenSelected,
    rasterizeSelected,
    mergeSelected,
    assignMasterToPage,
    createMaster,
    toggleFacingPages,
    requestWorkspaceSwitch,
    toggleDistractionFreeMode,
    recordAction,
    createAdjustmentLayer,
    showArchiveDialog,
    setShowArchiveDialog,
    platform,
  } = useEditor();
  const { entries: recentEntries, remove: removeRecent, clear: clearRecent } = useRecentFiles();
  const showAllMenuItems = useMemo(() => {
    try {
      return loadSettings().appearance.showAllMenuItems;
    } catch {
      return false;
    }
  }, [state.workspaceMode]);

  const nativeMenuAvailable = useMemo(() => {
    try {
      return typeof window !== 'undefined' && '__TAURI__' in window;
    } catch {
      return false;
    }
  }, []);

  const isMac = useMemo(() => {
    try {
      return navigator.platform?.toLowerCase().includes('mac') ?? false;
    } catch {
      return false;
    }
  }, []);

  const rawMenus = useMemo(
    () => buildMenus(state, recentEntries),
    [
      state.selection,
      state.document.activePageId,
      state.canvasMode,
      state.workspaceMode,
      state.colorBlindnessView,
      state.softProofEnabled,
      state.timelinePanelVisible,
      state.graphEditorVisible,
      state.stateMachinePanelVisible,
      state.guidesVisible,
      state.distractionFreeMode,
      state.beforeAfterCompare,
      state.rulerMode,
      state.snapEnabled,
      recentEntries,
    ],
  );

  const menus = useMemo(() => {
    let filtered = filterMenusByWorkspace(
      rawMenus,
      state.workspaceMode as WorkspaceMode,
      showAllMenuItems,
    );
    if (nativeMenuAvailable) {
      filtered = filtered.filter((m) => m.id !== 'Edit' && m.id !== 'Help');
      if (isMac) {
        filtered = filtered.map((m) => {
          if (m.id === 'File') {
            return {
              ...m,
              items: m.items.filter(
                (item) => item.action !== 'settings' && item.action !== 'about',
              ),
            };
          }
          return m;
        });
      }
    }
    return filtered;
  }, [rawMenus, state.workspaceMode, showAllMenuItems, nativeMenuAvailable, isMac]);

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme() ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const topLevelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [confirmNewDoc, setConfirmNewDoc] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [missingFileDialog, setMissingFileDialog] = useState<{
    message: string;
    entryId: string;
  } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('strata-theme') as Theme | null;
    if (saved && saved !== getTheme()) {
      setTheme(saved);
      setCurrentTheme(saved);
      bumpThemeRevision();
    }
    const observer = new MutationObserver(() => {
      const current = getTheme();
      if (current) setCurrentTheme(current);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
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

  useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (openMenu) {
      setOpenMenu(null);
      setOpenSubmenu(null);
      setActiveItemIndex(0);
      setActiveSubmenuIndex(0);
    }
  }, [state.workspaceMode]);

  const openMenuIndex = openMenu ? menus.findIndex((m) => m.id === openMenu) : -1;
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

  const openRecentFile = useCallback(
    async (entry: RecentEntry) => {
      if (entry.locator.kind === 'path') {
        if (typeof window !== 'undefined' && '__TAURI__' in window) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('plugin:fs|stat', { path: entry.locator.path });
            const text = await invoke<string>('home_read_text_file', {
              path: entry.locator.path,
            });
            loadDocument(text, { name: entry.label, filePath: entry.locator.path });
            return;
          } catch {
            setMissingFileDialog({
              message: `Couldn't find ${entry.label} — it may have been moved or deleted`,
              entryId: entry.id,
            });
            return;
          }
        }
        loadDocument('', { name: entry.label });
        return;
      }

      if (entry.locator.kind === 'fsHandle') {
        try {
          const { loadHandle } = await import('../../recentFiles/store');
          const handle = await loadHandle(entry.locator.handleKey);
          if (!handle) {
            setMissingFileDialog({
              message: `Couldn't find ${entry.label} — the file reference was lost`,
              entryId: entry.id,
            });
            return;
          }
          const state = await handle.queryPermission({ mode: 'read' });
          if (state === 'denied') {
            setMissingFileDialog({
              message: `Permission denied for ${entry.label}. Try opening it from the file dialog.`,
              entryId: entry.id,
            });
            return;
          }
          if (state === 'prompt') {
            const result = await handle.requestPermission({ mode: 'read' });
            if (result !== 'granted') {
              setMissingFileDialog({
                message: `Permission denied for ${entry.label}.`,
                entryId: entry.id,
              });
              return;
            }
          }
          const file = await handle.getFile();
          const text = await file.text();
          loadDocument(text, { name: entry.label });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'NotFoundError') {
            setMissingFileDialog({
              message: `${entry.label} no longer exists on disk.`,
              entryId: entry.id,
            });
            return;
          }
          setMissingFileDialog({
            message: `Failed to open ${entry.label}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            entryId: entry.id,
          });
        }
        return;
      }

      loadDocument('', { name: entry.label });
    },
    [loadDocument],
  );

  const handleAction = useCallback(
    (action: string) => {
      setOpenMenu(null);
      recordAction(`menu:${action}`);

      if (action.startsWith('recent:')) {
        const id = action.slice(7);
        const entry = recentEntries.find((e) => e.id === id);
        if (entry) void openRecentFile(entry);
        return;
      }

      switch (action) {
        case 'new':
          setConfirmNewDoc(true);
          return;
        case 'settings':
          onOpenSettings?.();
          return;
        case 'clearRecent':
          clearRecent();
          return;
        case 'reopenLast':
          if (recentEntries.length > 0) {
            void openRecentFile(recentEntries[0]);
          }
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
        case 'archiveBackup':
          setShowArchiveDialog(true, 'backup');
          return;
        case 'archiveRestore':
          setShowArchiveDialog(true, 'restore');
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
        case 'flattenSelection':
          flattenSelected('flatten', 1);
          return;
        case 'rasterizeSelection':
          rasterizeSelected(1);
          return;
        case 'mergeSelected':
          mergeSelected();
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
        case 'newAdjustmentLayer':
          createAdjustmentLayer();
          return;
        case 'createMaster':
          createMaster('Master', 1920, 1080);
          return;
        case 'applyMaster': {
          const activeId = state.document.activePageId;
          if (activeId) {
            const masterEntries = state.document.masters ? Object.keys(state.document.masters) : [];
            const first = masterEntries.find((id) => id !== activeId);
            if (first) assignMasterToPage(activeId, first);
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
            bumpThemeRevision();
            return;
          }
          if (action.startsWith('applyMaster:')) {
            const masterId = action.slice('applyMaster:'.length);
            const activeId = state.document.activePageId;
            if (activeId) {
              assignMasterToPage(activeId, masterId || null);
            }
            return;
          }
          break;
      }

      const registry = getActionRegistry();
      const registered = registry.get(action);
      if (registered) {
        (registered.handler as () => void)();
        return;
      }

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
      recentEntries,
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
      setShowArchiveDialog,
      addMaskToSelected,
      removeMaskFromSelected,
      toggleMask,
      invertMask,
      clearAllGuides,
      startPresentation,
      assignMasterToPage,
      createMaster,
      toggleFacingPages,
      requestWorkspaceSwitch,
      toggleDistractionFreeMode,
      recordAction,
      createAdjustmentLayer,
      openRecentFile,
      clearRecent,
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

  const currentSubmenuItems = useMemo(() => {
    if (openSubmenu === null || openMenuIndex < 0) return [];
    const item = menus[openMenuIndex]?.items[openSubmenu];
    if (!item?.items) return [];
    return item.items;
  }, [openSubmenu, openMenuIndex, menus]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const openIdx = openMenu ? menus.findIndex((m) => m.id === openMenu) : -1;

      if (openSubmenu !== null) {
        const subItems = currentSubmenuItems.filter((i) => i.label !== '---');

        switch (e.key) {
          case 'ArrowDown':
          case 'ArrowUp': {
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            setActiveSubmenuIndex((prev) => {
              const next = prev + dir;
              if (next < 0) return subItems.length - 1;
              if (next >= subItems.length) return 0;
              return next;
            });
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            const item = subItems[activeSubmenuIndex];
            if (item?.action) handleAction(item.action);
            return;
          }
          case 'ArrowLeft':
          case 'Escape': {
            e.preventDefault();
            setOpenSubmenu(null);
            setActiveSubmenuIndex(0);
            return;
          }
        }
        return;
      }

      if (openIdx >= 0 && openMenu) {
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
              const targetItems = menuEl.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
              );
              targetItems[matchIdx]?.scrollIntoView({ block: 'nearest' });
            }, 0);
          }
          return;
        }

        if (isResetKey(e)) {
          resetTypeahead();
        }

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
            if (item?.items) {
              setOpenSubmenu(activeItemIndex);
              setActiveSubmenuIndex(0);
            } else if (item?.action) {
              handleAction(item.action);
            }
            return;
          }
          case 'ArrowRight': {
            e.preventDefault();
            const item = items[activeItemIndex];
            if (item?.items) {
              setOpenSubmenu(activeItemIndex);
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
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown': {
            e.preventDefault();
            const next = (focusedIndex + 1) % menus.length;
            setFocusedIndex(next);
            topLevelRefs.current[next]?.focus();
            return;
          }
          case 'ArrowLeft':
          case 'ArrowUp': {
            e.preventDefault();
            const prev = (focusedIndex - 1 + menus.length) % menus.length;
            setFocusedIndex(prev);
            topLevelRefs.current[prev]?.focus();
            return;
          }
          case 'Enter':
          case ' ': {
            e.preventDefault();
            setOpenMenu(menus[focusedIndex]?.id ?? null);
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
            setFocusedIndex(menus.length - 1);
            topLevelRefs.current[menus.length - 1]?.focus();
            return;
          }
        }
      }
    },
    [
      openMenu,
      focusedIndex,
      activeItemIndex,
      handleAction,
      openSubmenu,
      activeSubmenuIndex,
      currentSubmenuItems,
    ],
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
        {menus.map((menu, i) => (
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
            setOpenSubmenu(null);
            setActiveItemIndex(0);
            setActiveSubmenuIndex(0);
          }}
          className="editor-menubar__menu"
        >
          <div ref={dropdownMenuRef} role="menu" aria-label={openMenu}>
            {menus[openMenuIndex]?.items.map((item, itemIdx) => {
              if (item.label === '---') {
                return (
                  <hr key={`sep-${itemIdx}`} className="editor-menubar__menu-sep" tabIndex={-1} />
                );
              }
              const role = itemRole(item);
              const isChecked = itemAriaChecked(item, state);
              const isActive =
                (item.action?.startsWith('theme:') && currentTheme === item.action.slice(6)) ||
                isChecked;
              const hasSubmenu = !!item.items;
              const isSubmenuOpen = openSubmenu === itemIdx;
              return (
                <div
                  key={item.label}
                  role="none"
                  className="editor-menubar__menu-item-wrapper"
                  onMouseEnter={() => {
                    if (hasSubmenu) {
                      setOpenSubmenu(itemIdx);
                      setActiveSubmenuIndex(0);
                    }
                  }}
                >
                  {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is valid for menuitemradio/menuitemcheckbox per ARIA spec */}
                  <button
                    role={hasSubmenu ? 'menuitem' : role}
                    type="button"
                    aria-haspopup={hasSubmenu ? true : undefined}
                    aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
                    aria-checked={hasSubmenu ? undefined : isChecked}
                    aria-keyshortcuts={item.ariaKeyshortcut}
                    disabled={item.disabled && !hasSubmenu}
                    className={`editor-menubar__menu-item${isActive ? ' editor-menubar__menu-item--active' : ''}${hasSubmenu ? ' editor-menubar__menu-item--submenu' : ''}`}
                    onClick={() => {
                      if (hasSubmenu) {
                        setOpenSubmenu(isSubmenuOpen ? null : itemIdx);
                        setActiveSubmenuIndex(0);
                      } else {
                        handleAction(item.action ?? '');
                      }
                    }}
                  >
                    <span className="editor-menubar__menu-label">{item.label}</span>
                    {hasSubmenu && (
                      <span className="editor-menubar__menu-submenu-arrow">&#9654;</span>
                    )}
                    {!hasSubmenu && item.shortcut && (
                      <span className="editor-menubar__menu-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                  {hasSubmenu && isSubmenuOpen && item.items && (
                    <FloatingPortal
                      anchorRef={dropdownMenuRef}
                      open
                      onClose={() => {
                        setOpenSubmenu(null);
                        setActiveSubmenuIndex(0);
                      }}
                      className="editor-menubar__submenu"
                    >
                      <div ref={submenuRef} role="menu" aria-label={item.label}>
                        {item.items.map((subItem, subIdx) => {
                          if (subItem.label === '---') {
                            return (
                              <hr
                                key={`subsep-${subIdx}`}
                                className="editor-menubar__menu-sep"
                                tabIndex={-1}
                              />
                            );
                          }
                          const subRole = itemRole(subItem);
                          const subChecked = itemAriaChecked(subItem, state);
                          const subActive =
                            (subItem.action?.startsWith('theme:') &&
                              currentTheme === subItem.action.slice(6)) ||
                            subChecked;
                          return (
                            <button
                              key={subItem.label}
                              role={subRole}
                              type="button"
                              aria-checked={subChecked}
                              aria-keyshortcuts={subItem.ariaKeyshortcut}
                              disabled={subItem.disabled}
                              className={`editor-menubar__menu-item${subActive ? ' editor-menubar__menu-item--active' : ''}`}
                              onClick={() => handleAction(subItem.action ?? '')}
                            >
                              <span className="editor-menubar__menu-label">{subItem.label}</span>
                              {subItem.shortcut && (
                                <span className="editor-menubar__menu-shortcut">
                                  {subItem.shortcut}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </FloatingPortal>
                  )}
                </div>
              );
            })}
          </div>
        </FloatingPortal>
      )}

      <div className="editor-menubar__center">
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

      <div className="editor-menubar__controls">
        <div className="editor-menubar__workspace" role="radiogroup" aria-label="Workspace">
          {(['design', 'print', 'drawing', 'image', 'motion'] as WorkspaceMode[]).map(
            (mode, idx) => {
              const WORKSPACE_SOLID_ICONS: Record<WorkspaceMode, keyof typeof SOLID_CHROME_ICONS> =
                {
                  design: 'penTool',
                  print: 'printer',
                  drawing: 'paintBrush',
                  image: 'image',
                  motion: 'play',
                  codegen: 'code',
                };
              const solidIcon = WORKSPACE_SOLID_ICONS[mode];
              return (
                <label
                  key={mode}
                  className={`editor-menubar__workspace-btn${state.workspaceMode === mode ? ' editor-menubar__workspace-btn--active' : ''}`}
                  title={`${WORKSPACE_LABELS[mode]} workspace (Ctrl+Shift+${idx + 1})`}
                >
                  <input
                    type="radio"
                    name="workspace-mode"
                    value={mode}
                    checked={state.workspaceMode === mode}
                    onChange={() => requestWorkspaceSwitch(mode)}
                    className="sr-only"
                  />
                  <SolidIcon name={SOLID_CHROME_ICONS[solidIcon]} size={15} />
                  <span className="editor-menubar__workspace-btn-label">
                    {WORKSPACE_LABELS[mode]}
                  </span>
                </label>
              );
            },
          )}
        </div>
        <span aria-hidden className="editor-menubar__zoom-divider">
          |
        </span>
        <TooltipProvider>
          <Tooltip label="Undo" shortcut="Ctrl+Z">
            <IconButton
              icon={SOLID_CHROME_ICONS.undo}
              label="Undo"
              size="sm"
              solid
              onClick={undo}
            />
          </Tooltip>
          <Tooltip label="Redo" shortcut="Ctrl+Shift+Z">
            <IconButton
              icon={SOLID_CHROME_ICONS.redo}
              label="Redo"
              size="sm"
              solid
              onClick={redo}
            />
          </Tooltip>
        </TooltipProvider>
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

      <AlertDialog
        open={missingFileDialog !== null}
        onClose={() => setMissingFileDialog(null)}
        onConfirm={() => {
          const entryId = missingFileDialog?.entryId;
          setMissingFileDialog(null);
          if (entryId) removeRecent(entryId);
        }}
        onCancel={() => setMissingFileDialog(null)}
        title="File Not Found"
        description={missingFileDialog?.message ?? ''}
        confirmLabel="Remove from List"
        cancelLabel="Keep in List"
        variant="danger"
      />

      <ArchiveDialog
        open={showArchiveDialog}
        onClose={() => setShowArchiveDialog(false)}
        document={state.document as ArchiveDialogProps['document']}
        platform={platform}
        onCreateArchive={(result) => {
          if (platform?.kind === 'tauri') {
            void platform.saveBinaryFile(
              result.fileName.replace(/\.zip$/, ''),
              result.bytes,
              'application/zip',
              '.zip',
            );
            return;
          }
          const blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = result.fileName;
          a.click();
          URL.revokeObjectURL(url);
        }}
        onRestoreArchive={(result) => {
          if (result.document) {
            loadDocument(JSON.stringify(result.document), { name: result.document.name });
          }
        }}
      />
    </div>
  );
}
