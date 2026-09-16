// COMPLEXITY: 275 cyclo (over ceiling 200) — see Phase 5 of architecture-health-remediation-2026-07-26.md

import { adoptBrowserFileHandle, contentHash } from '@varve/platform';
import { MAX_ZOOM, MIN_ZOOM, VARVE_URLS } from '@varve/shared';
import {
  AlertDialog,
  elementAnchor,
  FloatingPortal,
  Icon,
  IconButton,
  SOLID_CHROME_ICONS,
  Tooltip,
  VarveLogo,
} from '@varve/ui';
import {
  getThemePreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ThemeChangeDetail,
  type ThemePreference,
} from '@varve/ui/tokens';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActionRegistry } from './actions/ActionRegistry';
import { isCapabilityRestricted, isWorkspaceModeAllowed } from './capabilities/restrictions';
import { ArchiveDialog, type ArchiveDialogProps } from './components/Archive/ArchiveDialog';
import { OfflineBanner } from './components/OfflineBanner';
import { RasterizeDialog } from './components/Rasterize/RasterizeDialog';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { useEditor } from './context';
import { computeCapabilities, getNudgeCapability, useNativeMenu } from './menu';
import { useMenubarContextEffects, useMenubarFocusEffects } from './menu/menubarFocus';
import { handleMenubarKey } from './menu/menubarKeynav';
import { MenubarSubmenu, menubarItemAriaChecked, menubarItemRole } from './menu/menubarSubmenu';
import { labelWithFallback, type RecentEntry, useRecentFiles } from './recentFiles';
import { loadSettings } from './settings';
import { formatShortcut, getEffectiveBinding } from './shortcuts';
import { useEffectiveWorkspaceConfig } from './workspace/useWorkspaceConfig';
import { resolveToolbarPlacement, type WorkspaceMode } from './workspace/workspaceTypes';

type MenuId = 'File' | 'Edit' | 'Text' | 'View' | 'Object' | 'Arrange' | 'Page' | 'Help';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: string;
  /** Dynamic disabled state — computed per render from editor state. */
  disabled?: boolean;
  /** ARIA keyshortcut string for screen readers (e.g. "Ctrl+G"). */
  ariaKeyshortcut?: string;
  /** Nested submenu items (2 levels max). */
  items?: MenuItem[];
}

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'high-contrast', label: 'High Contrast' },
];

/** Build a shortcut key string for aria-keyshortcuts (platform-independent, e.g. "Ctrl+G"). */
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

function formatZoomPercent(zoom: number): string {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, safeZoom));
  return String(Math.round(clamped * 100 * 100) / 100);
}

function parseZoomPercent(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.min(MAX_ZOOM * 100, Math.max(MIN_ZOOM * 100, percent)) / 100;
}

function ZoomInput({
  id,
  className,
  zoom,
  setZoom,
}: {
  id: string;
  className: string;
  zoom: number;
  setZoom: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const commit = (value: string) => {
    const nextZoom = parseZoomPercent(value);
    setDraft(null);
    if (nextZoom !== null) setZoom(nextZoom);
  };

  return (
    <input
      id={id}
      className={className}
      type="number"
      min={MIN_ZOOM * 100}
      max={MAX_ZOOM * 100}
      step={0.1}
      inputMode="decimal"
      value={draft ?? formatZoomPercent(zoom)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        cancelRef.current = false;
        setDraft((current) => current ?? formatZoomPercent(zoom));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelRef.current = true;
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        if (cancelRef.current) {
          cancelRef.current = false;
          return;
        }
        commit(e.currentTarget.value);
      }}
      aria-label={`Zoom ${formatZoomPercent(zoom)}%`}
    />
  );
}

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
  // Was 'https://strata.app/download' — a pre-rename domain the project has
  // never owned, so this menu item opened a dead host for every web user.
  const base = VARVE_URLS.download;
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

/**
 * Compute menu structure dynamically based on current editor state.
 */
function buildMenus(
  state: {
    selection: string[];
    document: {
      activePageId?: string;
      pages?: Array<{ id: string; masterPageId?: string }>;
      masters?: Record<string, { name?: string }>;
      nodes?: Record<string, unknown>;
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
    bleedGuidesVisible: boolean;
    alignToPage: boolean;
  },
  recentEntries: RecentEntry[],
  caps: ReadonlySet<string>,
  isMac: boolean,
  activeFilePath: string | undefined,
  revealLabel: string,
  nudgeEnabled: boolean,
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
  const documentNodes = state.document?.nodes;
  const nodeCount =
    hasDocument && documentNodes && typeof documentNodes === 'object'
      ? Object.keys(documentNodes).length
      : 0;
  const hasNodes = nodeCount >= 1;
  const hasMultipleNodes = nodeCount >= 2;
  const selectedNodes = state.selection
    .map(
      (id) =>
        documentNodes?.[id] as
          | {
              kind?: string;
              textMode?: string;
              shape?: unknown;
              fills?: Array<{ type?: string; image?: { src?: string } }>;
            }
          | undefined,
    )
    .filter(
      (
        node,
      ): node is {
        kind: string;
        textMode?: string;
        shape?: unknown;
        fills?: Array<{ type?: string; image?: { src?: string } }>;
      } => Boolean(node),
    );
  const hasSelectedImage = selectedNodes.some(
    (node) =>
      node.kind === 'shape' &&
      node.fills?.some((fill) => fill.type === 'image' && Boolean(fill.image?.src)),
  );
  const canAttachTextToPath =
    selectedNodes.length === 2 &&
    selectedNodes.some((node) => node.kind === 'text') &&
    selectedNodes.some((node) => node.kind === 'shape' && node.shape != null);
  const canDetachTextFromPath =
    selectedNodes.length === 1 &&
    selectedNodes[0]?.kind === 'text' &&
    selectedNodes[0]?.textMode === 'path';

  /** Disabled helper: returns true when action cannot run in current context. */
  const dis = (action: string): boolean | undefined => {
    switch (action) {
      // Selection-dependent actions
      case 'cut':
      case 'copy':
      case 'duplicate':
      case 'delete':
      case 'selectAll':
        return !hasDocument;
      case 'smartFilterInvert':
        return !hasSelection;
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
      case 'expandStroke':
      case 'offsetPath':
      case 'roundCorners':
      case 'simplifyPath':
      case 'mirrorDuplicateHorizontal':
      case 'mirrorDuplicateVertical':
      case 'radialDuplicate':
        return !hasSelection;
      case 'duplicateLogoConcept':
      case 'createLogoVariant':
      case 'createMonochromeVariant':
      case 'createReversedVariant':
      case 'createIconVariant':
      case 'createSmallVariant':
        return !('logoProject' in (state.document ?? {})) || !hasSelection;
      case 'logoPreview':
      case 'addClearSpaceGuides':
        return !hasSelection;
      case 'exportLogoPackage':
        return !('logoProject' in (state.document ?? {}));
      case 'bringFront':
      case 'bringForward':
      case 'sendBackward':
      case 'sendBack':
      case 'harmonizeSpacing':
        return !hasSelection;
      case 'nudgeUp':
      case 'nudgeDown':
      case 'nudgeLeft':
      case 'nudgeRight':
        return !nudgeEnabled;
      case 'alignLeft':
      case 'alignCenterH':
      case 'alignRight':
      case 'alignTop':
      case 'alignCenterV':
      case 'alignBottom':
        // Relative alignment needs two roots; page alignment remains valid for
        // one object when the explicit page reference is active.
        return state.alignToPage ? !hasSelection : !hasMultipleSelection;
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
      case 'toolPerspective':
      case 'extractPalette':
      case 'imageTrace':
        return !hasSelection;
      case 'resizeImage':
        return !hasSelectedImage;
      case 'contentAwareFill':
        return !hasSelectedImage || state.selection.length !== 1;
      case 'attachTextToPath':
        return !canAttachTextToPath;
      case 'detachTextFromPath':
        return !canDetachTextFromPath;
      case 'batchBgRemove':
        // On-device inference; a deployment can withhold it entirely.
        return !hasSelection || isCapabilityRestricted('inference');
      // Workspaces a deployment does not expose. requestWorkspaceSwitch already
      // refuses them, so this is about not offering a menu item that silently
      // does nothing. Disabled rather than hidden on purpose: a greyed
      // "Workspace: Print" says the capability exists in Varve but not here,
      // which is the honest message and the one the demo banner expands on.
      case 'workspaceDesign':
        return !isWorkspaceModeAllowed('design');
      case 'workspacePrint':
        return !isWorkspaceModeAllowed('print');
      case 'workspaceDrawing':
        return !isWorkspaceModeAllowed('drawing');
      case 'workspaceImage':
        return !isWorkspaceModeAllowed('image');
      case 'workspaceMotion':
        return !isWorkspaceModeAllowed('motion');
      case 'workspaceLogo':
        return !isWorkspaceModeAllowed('logo');
      case 'workspaceEmail':
        return !isWorkspaceModeAllowed('email');
      case 'workspaceCodegen':
        return !isWorkspaceModeAllowed('codegen');
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

  /** Helper: build an aria-keyshortcut string from SHORTCUT_DEFS. */
  const ks = (id: string): string => ariaShortcut(getEffectiveBinding(id));

  /**
   * Visible shortcut text. Reads the effective binding (user keymap overrides
   * included) so the menu never shows a default key that no longer executes,
   * mirroring what `aria-keyshortcuts` already announced.
   */
  const shortcutText = (id: string): string => formatShortcut(getEffectiveBinding(id));

  return [
    {
      id: 'File',
      items: [
        // ── Create ──
        {
          label: 'New',
          shortcut: shortcutText('newDocument'),
          ariaKeyshortcut: ks('newDocument'),
          action: 'new',
        },
        {
          label: 'New Logo Project',
          shortcut: shortcutText('newLogoProject'),
          ariaKeyshortcut: ks('newLogoProject'),
          action: 'newLogoProject',
        },
        {
          label: 'Logo',
          items: [
            {
              label: 'Create Logo Concept',
              shortcut: shortcutText('createLogoConcept'),
              ariaKeyshortcut: ks('createLogoConcept'),
              action: 'createLogoConcept',
            },
            {
              label: 'Duplicate Logo Concept',
              shortcut: shortcutText('duplicateLogoConcept'),
              ariaKeyshortcut: ks('duplicateLogoConcept'),
              action: 'duplicateLogoConcept',
              disabled: dis('duplicateLogoConcept'),
            },
            {
              label: 'Create Logo Variant…',
              action: 'createLogoVariant',
              disabled: dis('createLogoVariant'),
            },
            {
              label: 'Create Monochrome Variant',
              shortcut: shortcutText('createMonochromeVariant'),
              ariaKeyshortcut: ks('createMonochromeVariant'),
              action: 'createMonochromeVariant',
              disabled: dis('createMonochromeVariant'),
            },
            {
              label: 'Create Reversed Variant',
              shortcut: shortcutText('createReversedVariant'),
              ariaKeyshortcut: ks('createReversedVariant'),
              action: 'createReversedVariant',
              disabled: dis('createReversedVariant'),
            },
          ],
        },
        { label: '---' },
        // ── Open / Import ──
        {
          label: 'Open\u2026',
          shortcut: shortcutText('open'),
          ariaKeyshortcut: ks('open'),
          action: 'open',
        },
        ...(recentEntries.length > 0
          ? [
              {
                label: 'Open Recent',
                items: [
                  ...recentEntries.slice(0, 10).map(
                    (e) =>
                      ({
                        label: labelWithFallback(e.label),
                        action: `recent:${e.id}`,
                      }) as MenuItem,
                  ),
                  { label: '---' },
                  {
                    label: 'Clear Recent Files',
                    action: 'clearRecent',
                  } as MenuItem,
                ],
              } as MenuItem,
            ]
          : []),
        {
          label: 'Import\u2026',
          shortcut: shortcutText('import'),
          ariaKeyshortcut: ks('import'),
          action: 'import',
        },
        {
          label: 'Quick Convert\u2026',
          action: 'quickConvert',
        },
        { label: '---' },
        // ── Close ──
        {
          label: 'Close Document',
          shortcut: shortcutText('tabClose'),
          ariaKeyshortcut: ks('tabClose'),
          action: 'tabClose',
        },
        {
          label: 'Close Window',
          shortcut: shortcutText('closeWindow'),
          ariaKeyshortcut: ks('closeWindow'),
          action: 'closeWindow',
        },
        { label: '---' },
        // ── Save ──
        {
          label: 'Save',
          shortcut: shortcutText('save'),
          ariaKeyshortcut: ks('save'),
          action: 'save',
        },
        {
          label: 'Save As\u2026',
          shortcut: shortcutText('saveAs'),
          ariaKeyshortcut: ks('saveAs'),
          action: 'saveAs',
        },
        {
          label: 'Save a Copy\u2026',
          action: 'saveCopy',
        },
        { label: '---' },
        // ── Export ──
        {
          label: 'Export SVG\u2026',
          shortcut: shortcutText('exportSvg'),
          ariaKeyshortcut: ks('exportSvg'),
          action: 'exportSvg',
        },
        {
          label: 'Export\u2026',
          shortcut: shortcutText('export'),
          ariaKeyshortcut: ks('export'),
          action: 'export',
        },
        {
          label: 'Export Logo Package\u2026',
          action: 'exportLogoPackage',
          disabled: dis('exportLogoPackage'),
        },
        { label: '---' },
        // ── Document metadata ──
        {
          label: 'Document Info\u2026',
          action: 'documentInfo',
        },
        {
          label: 'Set File Thumbnail\u2026',
          action: 'openThumbnailPicker',
        },
        {
          label: 'Document Color Mode\u2026',
          action: 'openColorConversion',
        },
        ...(activeFilePath
          ? [
              {
                label: revealLabel,
                action: 'revealInFiles',
              } as MenuItem,
              {
                label: 'Copy File Path',
                action: 'copyFilePath',
              } as MenuItem,
            ]
          : []),
        { label: '---' },
        // ── Archive / backup ──
        ...(caps.has('archive')
          ? [
              {
                label: 'Backup Archive\u2026' as const,
                shortcut: shortcutText('archiveBackup'),
                ariaKeyshortcut: ks('archiveBackup'),
                action: 'archiveBackup' as const,
              },
              {
                label: 'Restore Archive\u2026' as const,
                shortcut: shortcutText('archiveRestore'),
                ariaKeyshortcut: ks('archiveRestore'),
                action: 'archiveRestore' as const,
              },
            ]
          : [
              { label: 'Download Snapshot\u2026' as const, action: 'downloadSnapshot' as const },
              {
                label: 'Restore from Snapshot\u2026' as const,
                action: 'restoreFromSnapshot' as const,
              },
            ]),
        { label: '---' },
        // ── App ──
        {
          label: 'Settings\u2026',
          shortcut: shortcutText('settings'),
          ariaKeyshortcut: ks('settings'),
          action: 'settings',
        },
        // Quit is terminal; macOS hosts it in the native app menu (Cmd+Q).
        ...(!isMac
          ? [
              { label: '---' },
              {
                label: 'Quit Varve',
                shortcut: shortcutText('quitApp'),
                ariaKeyshortcut: ks('quitApp'),
                action: 'quitApp',
              } as MenuItem,
            ]
          : []),
      ],
    },
    {
      id: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: shortcutText('undo'),
          ariaKeyshortcut: ks('undo'),
          action: 'undo',
        },
        {
          label: 'Redo',
          shortcut: shortcutText('redo'),
          ariaKeyshortcut: ks('redo'),
          action: 'redo',
        },
        { label: '---' },
        {
          label: 'Cut',
          shortcut: shortcutText('cut'),
          ariaKeyshortcut: ks('cut'),
          action: 'cut',
          disabled: dis('cut'),
        },
        {
          label: 'Copy',
          shortcut: shortcutText('copy'),
          ariaKeyshortcut: ks('copy'),
          action: 'copy',
          disabled: dis('copy'),
        },
        {
          label: 'Paste',
          shortcut: shortcutText('paste'),
          ariaKeyshortcut: ks('paste'),
          action: 'paste',
        },
        {
          label: 'Copy Text',
          action: 'copyText',
          disabled: !hasSelection,
        },
        {
          label: 'Copy as SVG',
          action: 'copyAsSvg',
          disabled: !hasSelection,
        },
        {
          label: 'Copy as PNG',
          action: 'copyAsPng',
          disabled: !hasSelection,
        },
        {
          label: 'Paste as Plain Text',
          action: 'pastePlainText',
        },
        {
          label: 'Paste SVG Markup',
          action: 'pasteSvgMarkup',
        },
        {
          label: 'Copy Properties',
          shortcut: shortcutText('copyProperties'),
          ariaKeyshortcut: ks('copyProperties'),
          action: 'copyProperties',
          disabled: !hasSelection,
        },
        {
          label: 'Paste Properties',
          shortcut: shortcutText('pasteProperties'),
          ariaKeyshortcut: ks('pasteProperties'),
          action: 'pasteProperties',
          disabled: !hasSelection,
        },
        {
          label: 'Duplicate',
          shortcut: shortcutText('duplicate'),
          ariaKeyshortcut: ks('duplicate'),
          action: 'duplicate',
          disabled: dis('duplicate'),
        },
        {
          label: 'Repeat Duplicate',
          shortcut: shortcutText('repeatDuplicate'),
          ariaKeyshortcut: ks('repeatDuplicate'),
          action: 'repeatDuplicate',
          disabled: dis('duplicate'),
        },
        { label: '---' },
        {
          label: 'Select All',
          shortcut: shortcutText('selectAll'),
          ariaKeyshortcut: ks('selectAll'),
          action: 'selectAll',
        },
        {
          label: 'Delete',
          shortcut: shortcutText('delete'),
          ariaKeyshortcut: ks('delete'),
          action: 'delete',
          disabled: dis('delete'),
        },
        { label: '---' },
        {
          label: 'Find & Replace…',
          action: 'findReplace',
        },
        { label: '---' },
        {
          label: 'Selection History Back',
          shortcut: shortcutText('selectionHistoryBack'),
          ariaKeyshortcut: ks('selectionHistoryBack'),
          action: 'selectionHistoryBack',
          disabled: !hasSelection,
        },
        {
          label: 'Selection History Forward',
          shortcut: shortcutText('selectionHistoryForward'),
          ariaKeyshortcut: ks('selectionHistoryForward'),
          action: 'selectionHistoryForward',
          disabled: !hasSelection,
        },
        { label: '---' },
        {
          label: 'Pixel Selection',
          items: [
            { label: 'Transform Pixels', action: 'transformSelectedPixels' },
            {
              label: 'Transform Selection Boundary',
              action: 'transformSelectionBoundary',
            },
          ],
        },
      ],
    },
    {
      id: 'Text',
      items: [
        {
          label: 'Bold',
          shortcut: formatShortcut({ key: 'b', ctrl: true, shift: true }),
          ariaKeyshortcut: ariaShortcut({ key: 'b', ctrl: true, shift: true }),
          action: 'textBold',
          disabled: !hasSelection,
        },
        {
          label: 'Italic',
          shortcut: formatShortcut({ key: 'i', ctrl: true, shift: true }),
          ariaKeyshortcut: ariaShortcut({ key: 'i', ctrl: true, shift: true }),
          action: 'textItalic',
          disabled: !hasSelection,
        },
        {
          label: 'Underline',
          shortcut: formatShortcut({ key: 'u', ctrl: true, shift: true }),
          ariaKeyshortcut: ariaShortcut({ key: 'u', ctrl: true, shift: true }),
          action: 'textUnderline',
          disabled: !hasSelection,
        },
        { label: '---' },
        {
          label: 'Increase Font Size',
          shortcut: formatShortcut({ key: '=', ctrl: true, shift: true }),
          ariaKeyshortcut: ariaShortcut({ key: '=', ctrl: true, shift: true }),
          action: 'textIncreaseSize',
          disabled: !hasSelection,
        },
        {
          label: 'Decrease Font Size',
          shortcut: formatShortcut({ key: '-', ctrl: true, shift: true }),
          ariaKeyshortcut: ariaShortcut({ key: '-', ctrl: true, shift: true }),
          action: 'textDecreaseSize',
          disabled: !hasSelection,
        },
        { label: '---' },
        {
          label: 'Align Left',
          action: 'textAlignLeft',
          disabled: !hasSelection,
        },
        {
          label: 'Align Center',
          action: 'textAlignCenter',
          disabled: !hasSelection,
        },
        {
          label: 'Align Right',
          action: 'textAlignRight',
          disabled: !hasSelection,
        },
        {
          label: 'Align Justify',
          action: 'textAlignJustify',
          disabled: !hasSelection,
        },
        { label: '---' },
        {
          label: 'Convert to Outlines',
          action: 'textToOutlines',
          disabled: !hasSelection,
        },
      ],
    },
    {
      id: 'View',
      items: [
        // Grouped into submenus so the View root fits on one screen: as a
        // flat list it measured 1984px tall at 1280x800 and forced pointer
        // users to wheel-scroll a menu (external evidence: Fluent UI #32311,
        // Atlassian JRASERVER-33935, Wikimedia T344776). The placement pair
        // and focus-mode commands stay at the root because they are the
        // entries users reach for directly.
        {
          label: 'Theme',
          items: THEMES.map((t) => ({
            label: t.label,
            action: `theme:${t.id}`,
          })),
        },
        {
          label: 'Zoom',
          items: [
            {
              label: 'Zoom to 100%',
              shortcut: shortcutText('zoomReset'),
              ariaKeyshortcut: ks('zoomReset'),
              action: 'zoomReset',
            },
            {
              label: 'Zoom In',
              shortcut: shortcutText('zoomIn'),
              ariaKeyshortcut: ks('zoomIn'),
              action: 'zoomIn',
            },
            {
              label: 'Zoom Out',
              shortcut: shortcutText('zoomOut'),
              ariaKeyshortcut: ks('zoomOut'),
              action: 'zoomOut',
            },
          ],
        },
        {
          label: 'Canvas Mode',
          items: [
            {
              label: 'Full Render Mode',
              shortcut: shortcutText('canvasModeFull'),
              ariaKeyshortcut: ks('canvasModeFull'),
              action: 'canvasModeFull',
            },
            {
              label: 'Outline Mode',
              shortcut: shortcutText('canvasModeOutline'),
              ariaKeyshortcut: ks('canvasModeOutline'),
              action: 'canvasModeOutline',
            },
            {
              label: 'Preview Mode',
              shortcut: shortcutText('canvasModePreview'),
              ariaKeyshortcut: ks('canvasModePreview'),
              action: 'canvasModePreview',
            },
            {
              label: 'Inspect Mode',
              shortcut: shortcutText('toolInspect'),
              ariaKeyshortcut: ks('toolInspect'),
              action: 'inspectMode',
            },
            {
              label: 'Present\u2026',
              shortcut: shortcutText('present'),
              ariaKeyshortcut: ks('present'),
              action: 'present',
            },
          ],
        },
        {
          label: 'Viewport',
          items: [
            {
              label: 'Fit Active Page',
              shortcut: shortcutText('fitActivePage'),
              ariaKeyshortcut: ks('fitActivePage'),
              action: 'fitActivePage',
            },
            {
              label: 'Fit Active Frame',
              shortcut: shortcutText('fitActiveFrame'),
              ariaKeyshortcut: ks('fitActiveFrame'),
              action: 'fitActiveFrame',
            },
            {
              label: 'Reset View Rotation',
              shortcut: shortcutText('resetViewRotation'),
              ariaKeyshortcut: ks('resetViewRotation'),
              action: 'resetViewRotation',
            },
            {
              label: 'Rotate View Clockwise',
              shortcut: shortcutText('rotateViewCW'),
              ariaKeyshortcut: ks('rotateViewCW'),
              action: 'rotateViewCW',
            },
            {
              label: 'Rotate View Counter-clockwise',
              shortcut: shortcutText('rotateViewCCW'),
              ariaKeyshortcut: ks('rotateViewCCW'),
              action: 'rotateViewCCW',
            },
          ],
        },
        {
          label: 'Rulers & Grids',
          items: [
            {
              label: 'Artboard Ruler Origin',
              action: 'rulerModeArtboard',
              disabled: state.rulerMode === 'artboard',
            },
            {
              label: 'Global Ruler Origin',
              action: 'rulerModeGlobal',
              disabled: state.rulerMode === 'global',
            },
            {
              label: 'Baseline Grid Overlay',
              shortcut: shortcutText('gridOverlayBaseline'),
              ariaKeyshortcut: ks('gridOverlayBaseline'),
              action: 'gridOverlayBaseline',
            },
            {
              label: 'Isometric Grid Overlay',
              shortcut: shortcutText('gridOverlayIsometric'),
              ariaKeyshortcut: ks('gridOverlayIsometric'),
              action: 'gridOverlayIsometric',
            },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'Toggle Snap',
              shortcut: shortcutText('toggleSnap'),
              ariaKeyshortcut: ks('toggleSnap'),
              action: 'toggleSnap',
            },
            {
              label: state.guidesVisible ? 'Hide Guides' : 'Show Guides',
              shortcut: shortcutText('toggleGuidesVisible'),
              ariaKeyshortcut: ks('toggleGuidesVisible'),
              action: 'toggleGuidesVisible',
            },
            {
              label: 'Lock All Guides',
              shortcut: shortcutText('lockAllGuides'),
              ariaKeyshortcut: ks('lockAllGuides'),
              action: 'lockAllGuides',
            },
            {
              label: 'Clear All Guides',
              action: 'clearGuides',
            },
          ],
        },
        {
          label: 'Print',
          items: [
            {
              label: 'Facing Pages',
              action: 'toggleFacingPages',
            },
            {
              label: state.bleedGuidesVisible ? 'Hide Bleed Guides' : 'Show Bleed Guides',
              action: 'toggleBleedGuides',
            },
            {
              label: 'Soft Proofing',
              shortcut: shortcutText('softProof'),
              ariaKeyshortcut: ks('softProof'),
              action: 'softProof',
            },
          ],
        },
        {
          label: 'Panels',
          items: [
            {
              label: 'Timeline Panel',
              shortcut: shortcutText('toggleTimelinePanel'),
              ariaKeyshortcut: ks('toggleTimelinePanel'),
              action: 'toggleTimelinePanel',
            },
            {
              label: 'Graph Editor',
              shortcut: shortcutText('toggleGraphEditor'),
              ariaKeyshortcut: ks('toggleGraphEditor'),
              action: 'toggleGraphEditor',
            },
            {
              label: 'State Machine Panel',
              shortcut: shortcutText('toggleStateMachinePanel'),
              ariaKeyshortcut: ks('toggleStateMachinePanel'),
              action: 'toggleStateMachinePanel',
            },
            {
              label: 'Fonts Panel',
              shortcut: shortcutText('openFontsPanel'),
              ariaKeyshortcut: ks('openFontsPanel'),
              action: 'openFontsPanel',
            },
            {
              label: 'Logo Panel',
              shortcut: shortcutText('toggleLogoPanel'),
              ariaKeyshortcut: ks('toggleLogoPanel'),
              action: 'toggleLogoPanel',
            },
            {
              label: 'History Panel',
              action: 'toggleHistoryPanel',
            },
            { label: '---' },
            {
              label: 'Show All Panels',
              action: 'restoreAllPanels',
            },
          ],
        },
        {
          label: 'Workspace',
          items: [
            {
              label: 'Workspace: Design',
              action: 'workspaceDesign',
              disabled: dis('workspaceDesign'),
            },
            {
              label: 'Workspace: Print',
              action: 'workspacePrint',
              disabled: dis('workspacePrint'),
            },
            {
              label: 'Workspace: Draw',
              action: 'workspaceDrawing',
              disabled: dis('workspaceDrawing'),
            },
            {
              label: 'Workspace: Photo',
              action: 'workspaceImage',
              disabled: dis('workspaceImage'),
            },
            {
              label: 'Workspace: Motion',
              action: 'workspaceMotion',
              disabled: dis('workspaceMotion'),
            },
            {
              label: 'Workspace: Logo',
              action: 'workspaceLogo',
              disabled: dis('workspaceLogo'),
            },
            {
              label: 'Workspace: Email',
              action: 'workspaceEmail',
              disabled: dis('workspaceEmail'),
            },
            {
              label: 'Workspace: Codegen',
              action: 'workspaceCodegen',
              disabled: dis('workspaceCodegen'),
            },
            {
              label: 'Reset Workspace to Default',
              action: 'resetWorkspace',
            },
            {
              label: 'Reset All Workspaces to Default',
              action: 'resetAllWorkspaces',
            },
            {
              label: 'Customize Workspace\u2026',
              action: 'customizeWorkspace',
            },
            {
              label: 'Manage Layouts\u2026',
              action: 'manageWorkspaceLayouts',
            },
          ],
        },
        { label: '---' },
        // Toolbar placement. Radio pair: one position is always selected, and
        // the choice persists per workspace (workspace preference store).
        {
          label: 'Toolbar at Bottom',
          action: 'viewToolbarBottom',
        },
        {
          label: 'Toolbar at Top',
          action: 'viewToolbarTop',
        },
        { label: '---' },
        // Focus modes
        {
          label: 'Distraction-Free Mode',
          shortcut: shortcutText('toggleDistractionFree'),
          ariaKeyshortcut: ks('toggleDistractionFree'),
          action: 'toggleDistractionFree',
        },
        {
          label: 'Compare Before/After',
          shortcut: shortcutText('toggleBeforeAfterCompare'),
          ariaKeyshortcut: ks('toggleBeforeAfterCompare'),
          action: 'toggleBeforeAfterCompare',
        },
        {
          label: 'Test Logo at Small Sizes',
          shortcut: shortcutText('logoPreview'),
          ariaKeyshortcut: ks('logoPreview'),
          action: 'logoPreview',
          disabled: dis('logoPreview'),
        },
        { label: '---' },
        {
          label: 'Color Blindness',
          items: [
            {
              label: 'Color Blindness: None',
              action: 'colorBlindnessNone',
              shortcut: shortcutText('colorBlindnessNone'),
              ariaKeyshortcut: ks('colorBlindnessNone'),
            },
            {
              label: 'Color Blindness: Protanopia (red)',
              action: 'colorBlindnessProtanopia',
              shortcut: shortcutText('colorBlindnessProtanopia'),
              ariaKeyshortcut: ks('colorBlindnessProtanopia'),
            },
            {
              label: 'Color Blindness: Deuteranopia (green)',
              action: 'colorBlindnessDeuteranopia',
              shortcut: shortcutText('colorBlindnessDeuteranopia'),
              ariaKeyshortcut: ks('colorBlindnessDeuteranopia'),
            },
            {
              label: 'Color Blindness: Tritanopia (blue)',
              action: 'colorBlindnessTritanopia',
              shortcut: shortcutText('colorBlindnessTritanopia'),
              ariaKeyshortcut: ks('colorBlindnessTritanopia'),
            },
          ],
        },
        { label: '---' },
        {
          label: 'Keyboard Shortcuts',
          shortcut: shortcutText('shortcutPalette'),
          ariaKeyshortcut: ks('shortcutPalette'),
          action: 'shortcutPalette',
        },
        {
          label: 'Home',
          shortcut: shortcutText('home'),
          ariaKeyshortcut: ks('home'),
          action: 'home',
        },
      ],
    },
    {
      id: 'Object',
      items: [
        {
          label: 'Group',
          shortcut: shortcutText('group'),
          ariaKeyshortcut: ks('group'),
          action: 'group',
          disabled: dis('group'),
        },
        {
          label: 'Ungroup',
          shortcut: shortcutText('ungroup'),
          ariaKeyshortcut: ks('ungroup'),
          action: 'ungroup',
          disabled: dis('ungroup'),
        },
        { label: '---' },
        {
          label: 'Flip Horizontal',
          shortcut: shortcutText('flipH'),
          ariaKeyshortcut: ks('flipH'),
          action: 'flipH',
          disabled: !hasSelection,
        },
        {
          label: 'Flip Vertical',
          shortcut: shortcutText('flipV'),
          ariaKeyshortcut: ks('flipV'),
          action: 'flipV',
          disabled: !hasSelection,
        },
        {
          label: 'Resize Image…',
          action: 'resizeImage',
          disabled: dis('resizeImage'),
        },
        {
          label: 'Fit to Plane',
          action: 'fitSelectionToPlane',
          disabled: !hasSelection,
        },
        {
          label: 'Unproject from Plane',
          action: 'unprojectSelectionFromPlane',
          disabled: !hasSelection,
        },
        {
          label: 'Create Isometric Grid Artwork…',
          action: 'createIsometricGridArtwork',
          disabled: false,
        },
        { label: '---' },
        {
          label: 'Open Effect Studio…',
          shortcut: shortcutText('openAppearancePanel'),
          ariaKeyshortcut: ks('openAppearancePanel'),
          action: 'openAppearancePanel',
        },
        { label: '---' },
        {
          label: 'New Adjustment Layer',
          shortcut: shortcutText('newAdjustmentLayer'),
          ariaKeyshortcut: ks('newAdjustmentLayer'),
          action: 'newAdjustmentLayer',
        },
        {
          label: 'Object Filter',
          items: [
            {
              label: 'Invert',
              action: 'smartFilterInvert',
              disabled: dis('smartFilterInvert'),
            },
          ],
        },
        {
          label: 'Create Clipping Mask',
          shortcut: shortcutText('createClippingMask'),
          ariaKeyshortcut: ks('createClippingMask'),
          action: 'createClippingMask',
          disabled: dis('createClippingMask'),
        },
        {
          label: 'Release Clipping Mask',
          shortcut: shortcutText('releaseClippingMask'),
          ariaKeyshortcut: ks('releaseClippingMask'),
          action: 'releaseClippingMask',
          disabled: dis('releaseClippingMask'),
        },
        { label: '---' },
        {
          label: 'Generative Edit…',
          action: 'contentAwareFill',
          disabled: dis('contentAwareFill'),
        },
        { label: 'Remove Background...', action: 'batchBgRemove', disabled: dis('batchBgRemove') },
        {
          label: 'Crop Image',
          shortcut: shortcutText('toolCrop'),
          ariaKeyshortcut: ks('toolCrop'),
          action: 'toolCrop',
          disabled: dis('toolCrop'),
        },
        {
          label: 'Perspective Image',
          shortcut: shortcutText('toolPerspective'),
          ariaKeyshortcut: ks('toolPerspective'),
          action: 'toolPerspective',
          disabled: dis('toolPerspective'),
        },
        {
          label: 'Extract Palette',
          action: 'extractPalette',
          disabled: dis('extractPalette'),
        },
        {
          label: 'Vectorize Image…',
          shortcut: shortcutText('imageTrace'),
          ariaKeyshortcut: ks('imageTrace'),
          action: 'imageTrace',
          disabled: dis('imageTrace'),
        },
        { label: '---' },
        // Text on path
        {
          label: 'Text on Path',
          action: 'attachTextToPath',
          disabled: dis('attachTextToPath'),
        },
        {
          label: 'Detach Text from Path',
          action: 'detachTextFromPath',
          disabled: dis('detachTextFromPath'),
        },
        { label: '---' },
        // Masks
        { label: 'Add Alpha Mask', action: 'addAlphaMask', disabled: dis('addAlphaMask') },
        { label: 'Add Clip Mask', action: 'addClipMask', disabled: dis('addClipMask') },
        {
          label: 'Add Luminance Mask',
          action: 'addLuminanceMask',
          disabled: dis('addLuminanceMask'),
        },
        { label: 'Remove Mask', action: 'removeMask', disabled: dis('removeMask') },
        { label: 'Toggle Mask', action: 'toggleMask', disabled: dis('toggleMask') },
        { label: 'Invert Mask', action: 'invertMask', disabled: dis('invertMask') },
        { label: '---' },
        // Flatten & Merge
        {
          label: 'Flatten Selection',
          shortcut: shortcutText('flattenSelection'),
          ariaKeyshortcut: ks('flattenSelection'),
          action: 'flattenSelection',
          disabled: dis('flattenSelection'),
        },
        {
          label: 'Rasterize',
          action: 'rasterizeSelection',
          disabled: dis('rasterizeSelection'),
        },
        {
          label: 'Merge Selected Layers',
          action: 'mergeSelected',
          disabled: dis('mergeSelected'),
        },
        {
          label: 'Generate Clear-Space Guides…',
          action: 'addClearSpaceGuides',
          disabled: dis('addClearSpaceGuides'),
        },
        { label: '---' },
        // Boolean
        {
          label: 'Union',
          shortcut: shortcutText('booleanUnion'),
          ariaKeyshortcut: ks('booleanUnion'),
          action: 'booleanUnion',
          disabled: dis('booleanUnion'),
        },
        {
          label: 'Subtract',
          shortcut: shortcutText('booleanSubtract'),
          ariaKeyshortcut: ks('booleanSubtract'),
          action: 'booleanSubtract',
          disabled: dis('booleanSubtract'),
        },
        {
          label: 'Intersect',
          shortcut: shortcutText('booleanIntersect'),
          ariaKeyshortcut: ks('booleanIntersect'),
          action: 'booleanIntersect',
          disabled: dis('booleanIntersect'),
        },
        {
          label: 'Exclude',
          shortcut: shortcutText('booleanExclude'),
          ariaKeyshortcut: ks('booleanExclude'),
          action: 'booleanExclude',
          disabled: dis('booleanExclude'),
        },
        { label: '---' },
        // Path operations
        {
          label: 'Path',
          items: [
            {
              label: 'Expand Stroke to Outline',
              shortcut: shortcutText('expandStroke'),
              ariaKeyshortcut: ks('expandStroke'),
              action: 'expandStroke',
              disabled: dis('expandStroke'),
            },
            {
              label: 'Offset Path…',
              shortcut: shortcutText('offsetPath'),
              ariaKeyshortcut: ks('offsetPath'),
              action: 'offsetPath',
              disabled: dis('offsetPath'),
            },
            {
              label: 'Round Path Corners…',
              shortcut: shortcutText('roundCorners'),
              ariaKeyshortcut: ks('roundCorners'),
              action: 'roundCorners',
              disabled: dis('roundCorners'),
            },
            {
              label: 'Simplify Path…',
              shortcut: shortcutText('simplifyPath'),
              ariaKeyshortcut: ks('simplifyPath'),
              action: 'simplifyPath',
              disabled: dis('simplifyPath'),
            },
            {
              label: 'Mirror Duplicate — Horizontal',
              shortcut: shortcutText('mirrorDuplicateHorizontal'),
              ariaKeyshortcut: ks('mirrorDuplicateHorizontal'),
              action: 'mirrorDuplicateHorizontal',
              disabled: dis('mirrorDuplicateHorizontal'),
            },
            {
              label: 'Mirror Duplicate — Vertical',
              shortcut: shortcutText('mirrorDuplicateVertical'),
              ariaKeyshortcut: ks('mirrorDuplicateVertical'),
              action: 'mirrorDuplicateVertical',
              disabled: dis('mirrorDuplicateVertical'),
            },
            {
              label: 'Radial Duplicate…',
              shortcut: shortcutText('radialDuplicate'),
              ariaKeyshortcut: ks('radialDuplicate'),
              action: 'radialDuplicate',
              disabled: dis('radialDuplicate'),
            },
          ],
        },
        { label: '---' },
        // Intelligence
        { label: 'Audit', action: 'runAudit', disabled: dis('runAudit') },
        { label: 'Scan for Debt', action: 'scanDebt', disabled: dis('scanDebt') },
        { label: 'Suggest Names', action: 'suggestNames', disabled: dis('suggestNames') },
        {
          label: 'Detect Duplicates',
          action: 'detectDuplicates',
          disabled: dis('detectDuplicates'),
        },
      ],
    },
    {
      id: 'Arrange',
      items: [
        {
          label: 'Bring to Front',
          shortcut: shortcutText('bringFront'),
          ariaKeyshortcut: ks('bringFront'),
          action: 'bringFront',
          disabled: dis('bringFront'),
        },
        {
          label: 'Bring Forward',
          shortcut: shortcutText('bringForward'),
          ariaKeyshortcut: ks('bringForward'),
          action: 'bringForward',
          disabled: dis('bringForward'),
        },
        {
          label: 'Send Backward',
          shortcut: shortcutText('sendBackward'),
          ariaKeyshortcut: ks('sendBackward'),
          action: 'sendBackward',
          disabled: dis('sendBackward'),
        },
        {
          label: 'Send to Back',
          shortcut: shortcutText('sendBack'),
          ariaKeyshortcut: ks('sendBack'),
          action: 'sendBack',
          disabled: dis('sendBack'),
        },
        { label: '---' },
        {
          label: 'Align',
          disabled: dis('alignLeft'),
          items: [
            {
              label: 'Align Left',
              shortcut: shortcutText('alignLeft'),
              ariaKeyshortcut: ks('alignLeft'),
              action: 'alignLeft',
              disabled: dis('alignLeft'),
            },
            {
              label: 'Align Horizontal Center',
              shortcut: shortcutText('alignCenterH'),
              ariaKeyshortcut: ks('alignCenterH'),
              action: 'alignCenterH',
              disabled: dis('alignCenterH'),
            },
            {
              label: 'Align Right',
              shortcut: shortcutText('alignRight'),
              ariaKeyshortcut: ks('alignRight'),
              action: 'alignRight',
              disabled: dis('alignRight'),
            },
            { label: '---' },
            {
              label: 'Align Top',
              shortcut: shortcutText('alignTop'),
              ariaKeyshortcut: ks('alignTop'),
              action: 'alignTop',
              disabled: dis('alignTop'),
            },
            {
              label: 'Align Vertical Center',
              shortcut: shortcutText('alignCenterV'),
              ariaKeyshortcut: ks('alignCenterV'),
              action: 'alignCenterV',
              disabled: dis('alignCenterV'),
            },
            {
              label: 'Align Bottom',
              shortcut: shortcutText('alignBottom'),
              ariaKeyshortcut: ks('alignBottom'),
              action: 'alignBottom',
              disabled: dis('alignBottom'),
            },
            { label: '---' },
            {
              label: 'Distribute Horizontally',
              shortcut: shortcutText('distributeHorizontal'),
              ariaKeyshortcut: ks('distributeHorizontal'),
              action: 'distributeHorizontal',
              disabled: dis('distributeHorizontal'),
            },
            {
              label: 'Distribute Vertically',
              shortcut: shortcutText('distributeVertical'),
              ariaKeyshortcut: ks('distributeVertical'),
              action: 'distributeVertical',
              disabled: dis('distributeVertical'),
            },
            { label: '---' },
            {
              label: 'Tidy Up',
              action: 'tidySelected',
              disabled: dis('tidySelected'),
            },
          ],
        },
        {
          label: 'Harmonize Spacing',
          shortcut: shortcutText('harmonizeSpacing'),
          ariaKeyshortcut: ks('harmonizeSpacing'),
          action: 'harmonizeSpacing',
          disabled: dis('harmonizeSpacing'),
        },
        { label: '---' },
        {
          label: 'Nudge Left',
          shortcut: shortcutText('nudgeLeft'),
          ariaKeyshortcut: ks('nudgeLeft'),
          action: 'nudgeLeft',
          disabled: dis('nudgeLeft'),
        },
        {
          label: 'Nudge Right',
          shortcut: shortcutText('nudgeRight'),
          ariaKeyshortcut: ks('nudgeRight'),
          action: 'nudgeRight',
          disabled: dis('nudgeRight'),
        },
        {
          label: 'Nudge Up',
          shortcut: shortcutText('nudgeUp'),
          ariaKeyshortcut: ks('nudgeUp'),
          action: 'nudgeUp',
          disabled: dis('nudgeUp'),
        },
        {
          label: 'Nudge Down',
          shortcut: shortcutText('nudgeDown'),
          ariaKeyshortcut: ks('nudgeDown'),
          action: 'nudgeDown',
          disabled: dis('nudgeDown'),
        },
      ],
    },
    {
      id: 'Page',
      items: [
        ...(currentPageIsMaster
          ? [{ label: 'This page is a master page', disabled: true }]
          : currentPageMasterId
            ? [
                {
                  label: `Current Master: ${masterNames[currentPageMasterId] ?? 'Unknown'}`,
                  disabled: true,
                },
              ]
            : [{ label: 'No master applied', disabled: true }]),
        { label: '---' },
        {
          label: 'Create Master',
          action: 'createMaster',
          disabled: dis('createMaster'),
        },
        { label: '---' },
        ...Object.entries(masterNames)
          .filter(([id]) => id !== activePageId)
          .map(([id, name]) => ({
            label: name,
            action: `applyMaster:${id}`,
          })),
        ...(Object.keys(masterNames).length > 0 ? [{ label: '---' }] : []),
        {
          label: 'None',
          action: 'applyMaster:',
        },
        { label: '---' },
        {
          label: currentPageMasterId
            ? `Detach from '${masterNames[currentPageMasterId] ?? 'Unknown'}'`
            : 'Detach from Master',
          action: 'detachMaster',
          disabled: dis('detachMaster'),
        },
      ],
    },
    {
      id: 'Help',
      items: [
        {
          label: 'Contextual Help',
          shortcut: shortcutText('openHelp'),
          ariaKeyshortcut: ks('openHelp'),
          action: 'openHelp',
        },
        {
          label: 'Help Center',
          shortcut: shortcutText('openHelpCenter'),
          ariaKeyshortcut: ks('openHelpCenter'),
          action: 'openHelpCenter',
        },
        { label: 'Contact Support', action: 'contactSupport' },
        { label: 'Send Feedback', action: 'sendFeedback' },
        { label: 'Report a Security Issue', action: 'reportSecurity' },
        { label: 'Privacy', action: 'openPrivacy' },
        {
          label: "What's This?",
          action: 'whatIsThis',
        },
        { label: '---' },
        { label: 'Getting Started', action: 'gettingStarted' },
        { label: 'Take a Tour', action: 'startTour' },
        { label: "What's New", action: 'whatsNew' },
        { label: '---' },
        { label: 'About Varve', action: 'about' },
        ...(!caps.has('nativeMenu') && !isInstallDesktopDismissed() && !isInIframe()
          ? [
              { label: '---' as const },
              { label: 'Install Desktop App\u2026' as const, action: 'installDesktopApp' as const },
            ]
          : []),
      ],
    },
  ];
}

function separatorKey(items: MenuItem[], current: MenuItem, parentLabel: string): string {
  let ordinal = 0;
  for (const item of items) {
    if (item === current) break;
    if (item.label === '---') ordinal += 1;
  }
  return `${parentLabel}-separator-${ordinal}`;
}

/**
 * Workspace visibility filter map — mirrors the workspaces annotations in
 * menu/defs.ts. Maps action IDs to allowed workspace modes.
 * Absent from this map = shown in all workspaces.
 */
const WORKSPACE_ITEM_FILTER: Record<string, WorkspaceMode[]> = {
  // Text menu — hidden in codegen
  textBold: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textItalic: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textUnderline: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textIncreaseSize: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textDecreaseSize: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textAlignLeft: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textAlignCenter: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textAlignRight: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textAlignJustify: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  textToOutlines: ['design', 'print', 'drawing', 'logo'],

  // View menu — mode-specific panels
  inspectMode: ['design', 'print', 'drawing', 'image', 'motion', 'logo'],
  toggleTimelinePanel: ['design', 'motion'],
  toggleGraphEditor: ['design', 'motion'],
  toggleStateMachinePanel: ['design', 'motion'],
  toggleLogoPanel: ['logo'],
  toggleBeforeAfterCompare: ['design', 'print', 'drawing', 'image'],

  // Object menu — mode-specific
  newAdjustmentLayer: ['design', 'print', 'image'],
  createClippingMask: ['design', 'print', 'drawing', 'image', 'logo'],
  releaseClippingMask: ['design', 'print', 'drawing', 'image', 'logo'],
  batchBgRemove: ['design', 'image'],
  contentAwareFill: ['design', 'drawing', 'image'],
  toolCrop: ['design', 'print', 'image'],
  toolPerspective: ['design', 'print', 'image'],
  extractPalette: ['design', 'drawing', 'image'],
  addAlphaMask: ['design', 'print', 'drawing', 'image', 'logo'],
  addClipMask: ['design', 'print', 'drawing', 'image', 'logo'],
  addLuminanceMask: ['design', 'print', 'drawing', 'image', 'logo'],
  removeMask: ['design', 'print', 'drawing', 'image', 'logo'],
  toggleMask: ['design', 'print', 'drawing', 'image', 'logo'],
  invertMask: ['design', 'print', 'drawing', 'image', 'logo'],
  flattenSelection: ['design', 'print', 'drawing', 'image', 'logo'],
  rasterizeSelection: ['design', 'print', 'drawing', 'image', 'logo'],
  mergeSelected: ['design', 'print', 'drawing', 'image', 'logo'],
  booleanUnion: ['design', 'print', 'drawing', 'logo'],
  booleanSubtract: ['design', 'print', 'drawing', 'logo'],
  booleanIntersect: ['design', 'print', 'drawing', 'logo'],
  booleanExclude: ['design', 'print', 'drawing', 'logo'],

  // Page menu — multi-page only
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

  /** Drop leading/trailing/consecutive separators after filtering. */
  function normalizeSeparators(items: MenuItem[]): MenuItem[] {
    const out: MenuItem[] = [];
    for (const item of items) {
      if (item.label === '---') {
        if (out.length === 0 || out[out.length - 1]?.label === '---') continue;
        out.push(item);
        continue;
      }
      out.push(item);
    }
    while (out.length > 0 && out[out.length - 1]?.label === '---') out.pop();
    return out;
  }

  function filterItems(items: MenuItem[]): MenuItem[] {
    const filtered: MenuItem[] = [];
    for (const item of items) {
      if (item.label === '---') {
        filtered.push(item);
        continue;
      }
      if (!shouldKeep(item.action)) continue;
      if (item.items) {
        // Recurse without mutating the memoized menu definitions, drop a
        // submenu whose children were all filtered out (an empty flyout is a
        // dead end), and re-normalize separators at this level.
        const children = normalizeSeparators(filterItems(item.items));
        if (children.length === 0) continue;
        filtered.push({ ...item, items: children });
        continue;
      }
      filtered.push(item);
    }
    return normalizeSeparators(filtered);
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
  onGettingStarted,
  onWhatsNew,
}: {
  onBackToHome?: () => void;
  onGettingStarted?: () => void;
  onWhatsNew?: () => void;
}) {
  const {
    state,
    serializeDocument,
    loadDocument,
    openFile,
    undo,
    redo,
    setZoom,
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
    toggleDistractionFreeMode,
    recordAction,
    createAdjustmentLayer,
    showArchiveDialog,
    setShowArchiveDialog,
    platform,
  } = useEditor();
  const {
    entries: recentEntries,
    remove: removeRecent,
    clear: clearRecent,
  } = useRecentFiles(platform);
  // `sessions` may be absent in unit-test harnesses that pass a partial state.
  const activeSession = (state.sessions ?? []).find((s) => s.id === state.activeId);
  const activeFilePath = activeSession?.filePath;
  // Menu availability (Audit / Scan for Debt / Suggest Names) depends on
  // whether the document has nodes, not on which are selected. Track the
  // count so structural edits without a selection change still rebuild it.
  const documentNodeCount = Object.keys(state.document?.nodes ?? {}).length;
  const revealLabel = platform?.fileManagerLabel() ?? 'Reveal in Files';
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

  // Toolbar placement drives the View radio pair's checked state. Resolved
  // through the effective workspace config so the menu agrees with the
  // palette and survives reloads (workspace preference store).
  const toolbarPlacement = resolveToolbarPlacement(
    useEffectiveWorkspaceConfig(state.workspaceMode as WorkspaceMode),
  );

  const isMac = useMemo(() => {
    try {
      return navigator.platform?.toLowerCase().includes('mac') ?? false;
    } catch {
      return false;
    }
  }, []);

  const caps = useMemo(() => computeCapabilities(), []);
  const nudgeCapability = useMemo(
    () => getNudgeCapability(state.document, state.selection),
    [state.document, state.selection],
  );
  const rawMenus = useMemo(
    () =>
      buildMenus(
        state,
        recentEntries,
        caps,
        isMac,
        activeFilePath,
        revealLabel,
        nudgeCapability.canNudge,
      ),
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
      state.alignToPage,
      state.bleedGuidesVisible,
      state.document.masters,
      documentNodeCount,
      activeFilePath,
      recentEntries,
      caps,
      nudgeCapability.canNudge,
    ],
  );

  const menus = useMemo(() => {
    let filtered = filterMenusByWorkspace(
      rawMenus,
      state.workspaceMode as WorkspaceMode,
      showAllMenuItems,
    );
    // Windows and Linux Tauri windows use Strata's in-window menubar. Merely
    // detecting the Tauri bridge does not mean those commands are reachable
    // through a platform menu (and hiding Edit also hides Undo/Redo).
    if (nativeMenuAvailable && isMac) {
      filtered = filtered.filter((m) => m.id !== 'Edit' && m.id !== 'Help');
      filtered = filtered.map((m) => {
        if (m.id === 'File') {
          return {
            ...m,
            items: m.items.filter((item) => item.action !== 'settings' && item.action !== 'about'),
          };
        }
        return m;
      });
    }
    return filtered;
  }, [rawMenus, state.workspaceMode, showAllMenuItems, nativeMenuAvailable, isMac]);

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [currentTheme, setCurrentTheme] = useState<ThemePreference>(getThemePreference);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const topLevelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Each submenu is anchored to its own parent item. A single dropdown ref
  // makes every flyout originate from the menu's top-left corner.
  const submenuAnchorRefs = useRef(new Map<string, { current: HTMLButtonElement | null }>());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [missingFileDialog, setMissingFileDialog] = useState<{
    message: string;
    entryId: string;
  } | null>(null);
  const [rasterizeDialogOpen, setRasterizeDialogOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameButtonRef = useRef<HTMLButtonElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Element focused before the dropdown opened; restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const prevOpenMenuRef = useRef<MenuId | null>(null);
  // Non-null when Tab/Shift+Tab closed the menu: restore must walk the tab
  // order past the anchor instead of returning focus to it.
  const tabWalkDirRef = useRef<1 | -1 | null>(null);
  const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

  useEffect(() => {
    const handleChange = (event: Event) => {
      setCurrentTheme((event as CustomEvent<ThemeChangeDetail>).detail.preference);
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
  }, []);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
      return;
    }
    // Rename ended (commit or cancel): hand focus back to the trigger so
    // keyboard users keep their place instead of landing on <body>.
    if (!editingName && restoreNameFocusRef.current) {
      restoreNameFocusRef.current = false;
      nameButtonRef.current?.focus();
    }
  }, [editingName]);

  // One type-ahead buffer per menu level: opening, switching, or closing a
  // menu level starts a fresh search. Cleanup clears a pending reset timer.
  useEffect(() => {
    typeaheadRef.current = '';
    return () => {
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = null;
      }
    };
  }, [openMenu, openSubmenu]);
  useMenubarFocusEffects({
    openMenu,
    openSubmenu,
    activeItemIndex,
    activeSubmenuIndex,
    menuRef,
    dropdownMenuRef,
    submenuRef,
    restoreFocusRef,
    prevOpenMenuRef,
    tabWalkDirRef,
    setActiveItemIndex,
    setActiveSubmenuIndex,
  });
  useMenubarContextEffects({
    openMenu,
    workspaceMode: state.workspaceMode,
    activeId: state.activeId,
    menuRef,
    dropdownMenuRef,
    setOpenMenu,
    setOpenSubmenu,
    setActiveItemIndex,
    setActiveSubmenuIndex,
  });

  const openMenuIndex = openMenu ? menus.findIndex((m) => m.id === openMenu) : -1;
  const openMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  openMenuAnchorRef.current =
    openMenuIndex >= 0 ? (topLevelRefs.current[openMenuIndex] ?? null) : null;

  const startNameEdit = useCallback(() => {
    setNameDraft(state.document.name || '');
    setEditingName(true);
  }, [state.document.name]);

  // The rename input replaces the trigger button, so when editing ends the
  // focused element is removed from the DOM and focus fell to <body>. Flag a
  // restore so the effect below returns focus to the rename trigger.
  const restoreNameFocusRef = useRef(false);

  const stopNameEdit = useCallback(() => {
    restoreNameFocusRef.current = true;
    setEditingName(false);
  }, []);

  const handleRasterize = useCallback(
    (options: import('./flatten/rasterizeOptions').RasterizeSelectionOptions) => {
      setRasterizeDialogOpen(false);
      rasterizeSelected(options);
    },
    [rasterizeSelected],
  );

  const commitName = useCallback(() => {
    restoreNameFocusRef.current = true;
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.document.name) {
      const json = serializeDocument();
      const doc = JSON.parse(json);
      doc.name = trimmed;
      // Renaming the open document — same file, so keep its binding (passing
      // no identity here would silently unbind the tab from its path).
      loadDocument(JSON.stringify(doc), { name: trimmed, keepIdentity: true });
    }
  }, [nameDraft, state.document.name, serializeDocument, loadDocument]);

  const openRecentFile = useCallback(
    async (entry: RecentEntry) => {
      if (entry.locator.kind === 'library') {
        // Platform recent records are library references, not raw paths:
        // read the document by id, restore the disk binding from the file
        // row when one exists, and open the existing tab if already open.
        if (!platform) {
          setMissingFileDialog({
            message: `Couldn't open ${entry.label} — no platform storage is available.`,
            entryId: entry.id,
          });
          return;
        }
        const json = await platform.readFile(entry.id).catch(() => null);
        if (!json) {
          void platform
            .patchRecentFile(entry.id, { name: entry.label, missing: true })
            .catch(() => undefined);
          setMissingFileDialog({
            message: `Couldn't find ${entry.label} — it may have been moved or deleted`,
            entryId: entry.id,
          });
          return;
        }
        const fileEntry = await platform.getFile(entry.id).catch(() => undefined);
        openFile(entry.id, entry.label, fileEntry?.filePath, json, true);
        return;
      }

      if (entry.locator.kind === 'path') {
        if (typeof window !== 'undefined' && '__TAURI__' in window) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('plugin:fs|stat', { path: entry.locator.path });
            const text = await invoke<string>('home_read_text_file_approved', {
              path: entry.locator.path,
            });
            // Its own tab, like Figma/Photoshop — and openFile switches to the
            // existing tab when this file is already open rather than
            // duplicating it. No app-store id yet; save() mints one.
            openFile(undefined, entry.label, entry.locator.path, text);
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
          const { loadHandle } = await import('./recentFiles/store');
          const handle = await loadHandle(entry.locator.handleKey);
          if (!handle) {
            setMissingFileDialog({
              message: `Couldn't find ${entry.label} — the file reference was lost`,
              entryId: entry.id,
            });
            return;
          }
          const permissionedHandle = handle as FileSystemFileHandle & {
            queryPermission: (options: { mode: 'read' }) => Promise<PermissionState>;
            requestPermission: (options: { mode: 'read' }) => Promise<PermissionState>;
          };
          const state = await permissionedHandle.queryPermission({ mode: 'read' });
          if (state === 'denied') {
            setMissingFileDialog({
              message: `Permission denied for ${entry.label}. Try opening it from the file dialog.`,
              entryId: entry.id,
            });
            return;
          }
          if (state === 'prompt') {
            const result = await permissionedHandle.requestPermission({ mode: 'read' });
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
          // Bind the stored handle so Save writes back to the file the user
          // picked instead of re-prompting. Opening used to discard the
          // handle, leaving Recent a read-only snapshot with no destination.
          let binding:
            | { saveHandleId: string; saveHandleName: string; diskContentHash: string }
            | undefined;
          try {
            binding = {
              saveHandleId: await adoptBrowserFileHandle(handle, file.name),
              saveHandleName: file.name,
              // Baseline for the external-change guard: a later save refuses
              // to overwrite a file that changed since this read.
              diskContentHash: contentHash(text),
            };
          } catch {
            // The document still opens; the first save asks for a location.
          }
          openFile(undefined, entry.label, undefined, text, undefined, binding);
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
    [loadDocument, openFile, platform],
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

      // All registered capabilities share one implementation across the
      // custom menubar, native menu, command palette, and quick actions bar.
      // The switch below is only for menu-only compatibility actions and
      // harnesses that intentionally omit the editor action registration.
      if (getActionRegistry().dispatch(action)) return;

      // Menubar-specific actions (not in the registry or with different behavior)
      switch (action) {
        case 'clearRecent':
          clearRecent();
          return;
        case 'gettingStarted':
          onGettingStarted?.();
          return;
        case 'whatsNew':
          onWhatsNew?.();
          return;
        case 'installDesktopApp':
          safeOpenInstallPage();
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
          setRasterizeDialogOpen(true);
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
            const theme = action.slice(6) as ThemePreference;
            setThemePreference(theme);
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
      recentEntries,
      onBackToHome,
      onGettingStarted,
      setShowArchiveDialog,
      assignMasterToPage,
      recordAction,
      createAdjustmentLayer,
      rasterizeSelected,
      setRasterizeDialogOpen,
      openRecentFile,
      clearRecent,
    ],
  );

  useNativeMenu({
    selection: state.selection,
    document: state.document,
    workspaceMode: state.workspaceMode,
    platformKind: platform?.kind,
    runAction: handleAction,
    getTheme: getThemePreference,
  });

  // ─── keyboard navigation ──────────────────────────────────────────────

  const currentSubmenuItems = useMemo(() => {
    if (openSubmenu === null || openMenuIndex < 0) return [];
    const item = menus[openMenuIndex]?.items[openSubmenu];
    if (!item?.items) return [];
    return item.items;
  }, [openSubmenu, openMenuIndex, menus]);

  // Availability is recomputed on every render. If the open flyout's parent
  // becomes unavailable (selection cleared, capability changed), close the
  // flyout instead of leaving commands that can no longer run on screen. When
  // the flyout owned focus, move it to the dropdown's first enabled item so a
  // disabled parent never strands focus on <body>.
  useEffect(() => {
    if (openSubmenu === null || openMenuIndex < 0) return;
    const parent = menus[openMenuIndex]?.items[openSubmenu];
    if (!parent?.items || !parent.disabled) return;
    setOpenSubmenu(null);
    setActiveSubmenuIndex(0);
    // The render path already withheld the flyout this commit, so if it owned
    // focus the unmount dropped focus to <body>. That is the only state this
    // close path owns: a pointer user's focus elsewhere is left untouched.
    const ownerDocument = dropdownMenuRef.current?.ownerDocument;
    if (!ownerDocument || ownerDocument.activeElement !== ownerDocument.body) return;
    const items = dropdownMenuRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.hasAttribute('disabled')) continue;
      setActiveItemIndex(i);
      item.focus({ preventScroll: true });
      break;
    }
  }, [openSubmenu, openMenuIndex, menus, dropdownMenuRef, setActiveItemIndex]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      handleMenubarKey(e, {
        menuRef,
        dropdownMenuRef,
        submenuRef,
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
      });
    },
    [
      openMenu,
      focusedIndex,
      activeItemIndex,
      handleAction,
      openSubmenu,
      activeSubmenuIndex,
      currentSubmenuItems,
      menus,
    ],
  );

  return (
    <div className="editor-menubar" data-testid="menubar">
      <OfflineBanner />
      <div className="editor-menubar__side">
        <Tooltip label="Home" shortcut={formatShortcut(getEffectiveBinding('home'))}>
          <button
            type="button"
            className="editor-menubar__home"
            aria-label="Home"
            onClick={() => onBackToHome?.()}
          >
            <VarveLogo size={16} />
          </button>
        </Tooltip>
        <div
          className="editor-menubar__left"
          ref={menuRef}
          role="menubar"
          aria-label="Application"
          onKeyDown={handleMenuKeyDown}
        >
          {menus.map((menu, i) => (
            <button
              key={menu.id}
              ref={(el) => {
                topLevelRefs.current[i] = el;
              }}
              role="menuitem"
              className="editor-menubar__item"
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.id}
              tabIndex={focusedIndex === i ? 0 : -1}
              type="button"
              onClick={() => {
                setOpenMenu(openMenu === menu.id ? null : menu.id);
                setFocusedIndex(i);
                setActiveItemIndex(0);
              }}
              onMouseEnter={() => {
                if (openMenu && openMenu !== menu.id) {
                  setOpenMenu(menu.id);
                  setOpenSubmenu(null);
                  setActiveItemIndex(0);
                  setActiveSubmenuIndex(0);
                }
              }}
            >
              {menu.id}
            </button>
          ))}
          {openMenu && openMenuIndex >= 0 && (
            <FloatingPortal
              key={openMenu}
              anchorRef={openMenuAnchorRef}
              anchor={
                topLevelRefs.current[openMenuIndex]
                  ? elementAnchor(topLevelRefs.current[openMenuIndex]!)
                  : undefined
              }
              open
              insideRefs={[submenuRef]}
              kind="menubar-menu"
              dismissOnEscape={false}
              onClose={() => {
                setOpenMenu(null);
                setOpenSubmenu(null);
                setActiveItemIndex(0);
                setActiveSubmenuIndex(0);
              }}
              className="editor-menubar__menu"
            >
              <div
                ref={dropdownMenuRef}
                role="menu"
                aria-label={openMenu}
                onKeyDown={(event) => {
                  // The portal remains a logical child of the menubar in
                  // React's event tree. Stop here so a dropdown key is not
                  // processed a second time by the menubar container (which
                  // would turn `e` into `ee` for type-ahead).
                  event.stopPropagation();
                  handleMenuKeyDown(event);
                }}
              >
                {/* activeItemIndex counts only focusable items (separators
                    excluded), matching menubarKeynav and the MENU_ITEM_SELECTOR
                    NodeList it focuses through. Comparing it against the raw
                    config index put tabIndex=0 on the wrong item — or on no
                    item at all — as soon as a separator preceded the active
                    one. Track the focusable index alongside the config index. */}
                {(() => {
                  let focusableIdx = -1;
                  return menus[openMenuIndex]?.items.map((item, itemIdx) => {
                    if (item.label === '---') {
                      return (
                        <hr
                          key={separatorKey(menus[openMenuIndex]?.items ?? [], item, openMenu)}
                          className="editor-menubar__menu-sep"
                          tabIndex={-1}
                        />
                      );
                    }
                    focusableIdx += 1;
                    const itemFocusableIdx = focusableIdx;
                    const role = menubarItemRole(item);
                    const isChecked = menubarItemAriaChecked(
                      item,
                      state,
                      currentTheme,
                      toolbarPlacement,
                    );
                    const isActive =
                      (item.action?.startsWith('theme:') &&
                        currentTheme === item.action.slice(6)) ||
                      isChecked;
                    const hasSubmenu = !!item.items;
                    const isSubmenuOpen = openSubmenu === itemIdx;
                    const submenuAnchorKey = `${openMenu}:${item.action ?? item.label}`;
                    let submenuAnchorRef = submenuAnchorRefs.current.get(submenuAnchorKey);
                    if (!submenuAnchorRef) {
                      submenuAnchorRef = { current: null };
                      submenuAnchorRefs.current.set(submenuAnchorKey, submenuAnchorRef);
                    }
                    return (
                      <div
                        key={item.label}
                        role="none"
                        className="editor-menubar__menu-item-wrapper"
                        onMouseEnter={() => {
                          if (hasSubmenu && !item.disabled) {
                            // Pointer-opening a flyout must still establish
                            // the owning parent item for Escape/Left focus
                            // restoration; hover must not itself steal focus.
                            setActiveItemIndex(itemFocusableIdx);
                            setOpenSubmenu(itemIdx);
                            setActiveSubmenuIndex(0);
                          } else {
                            // A plain command row closes any open flyout.
                            // Previously the child stayed open over an
                            // unrelated row until an outside click or Escape,
                            // which read as a stuck menu.
                            setOpenSubmenu(null);
                          }
                        }}
                      >
                        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is emitted only when the runtime role is menuitemradio/menuitemcheckbox */}
                        <button
                          ref={hasSubmenu ? submenuAnchorRef : undefined}
                          role={hasSubmenu ? 'menuitem' : role}
                          type="button"
                          aria-haspopup={hasSubmenu ? 'menu' : undefined}
                          aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
                          aria-checked={
                            !hasSubmenu && (role === 'menuitemradio' || role === 'menuitemcheckbox')
                              ? isChecked
                              : undefined
                          }
                          aria-keyshortcuts={item.ariaKeyshortcut}
                          disabled={item.disabled}
                          tabIndex={activeItemIndex === itemFocusableIdx ? 0 : -1}
                          className={`editor-menubar__menu-item${isActive ? ' editor-menubar__menu-item--active' : ''}${hasSubmenu ? ' editor-menubar__menu-item--submenu' : ''}`}
                          onClick={() => {
                            if (hasSubmenu) {
                              if (item.disabled) return;
                              setOpenSubmenu(isSubmenuOpen ? null : itemIdx);
                              setActiveSubmenuIndex(0);
                            } else {
                              handleAction(item.action ?? '');
                            }
                          }}
                        >
                          <span className="editor-menubar__menu-label">{item.label}</span>
                          {hasSubmenu && (
                            /* A right chevron, not a filled "play" triangle:
                             * the triangle glyph was font-dependent (weight
                             * and baseline moved with the face), read as a
                             * media control, and contradicted the stroke-icon
                             * system. Sized in em so it tracks the item text. */
                            <span className="editor-menubar__menu-submenu-arrow" aria-hidden="true">
                              <Icon name="ChevronRight" size="1em" />
                            </span>
                          )}
                          {!hasSubmenu && item.shortcut && (
                            <span className="editor-menubar__menu-shortcut">{item.shortcut}</span>
                          )}
                        </button>
                        {hasSubmenu && isSubmenuOpen && item.items && !item.disabled && (
                          <MenubarSubmenu
                            items={item.items}
                            parentLabel={item.label}
                            open
                            activeSubmenuIndex={activeSubmenuIndex}
                            anchorRef={submenuAnchorRef}
                            submenuRef={submenuRef}
                            currentTheme={currentTheme}
                            state={state}
                            onKeyDown={handleMenuKeyDown}
                            onClose={() => {
                              setOpenSubmenu(null);
                              setActiveSubmenuIndex(0);
                              // Return focus to the parent item when the submenu
                              // had it (outside-click close).
                              const active =
                                submenuRef.current?.ownerDocument.activeElement ?? null;
                              if (active && submenuRef.current?.contains(active)) {
                                const parentItems =
                                  dropdownMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                                    MENU_ITEM_SELECTOR,
                                  );
                                parentItems?.[activeItemIndex]?.focus();
                              }
                            }}
                            handleAction={handleAction}
                          />
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </FloatingPortal>
          )}
        </div>
      </div>

      {/* ── Center: Document name ── */}
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
                if (e.key === 'Escape') stopNameEdit();
              }}
              aria-label="Document name"
            />
          ) : (
            <Tooltip label="Rename document">
              <button
                ref={nameButtonRef}
                type="button"
                className="editor-menubar__doc-name-text"
                onClick={startNameEdit}
              >
                {state.document.name || 'Untitled'}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Right: Workspace tabs + Zoom + Undo/Redo ── */}
      <div className="editor-menubar__controls">
        <WorkspaceTabs />
        <span aria-hidden className="editor-menubar__zoom-divider">
          |
        </span>
        <IconButton
          icon={SOLID_CHROME_ICONS.undo}
          label={state.undoLabel}
          size="sm"
          solid
          onClick={undo}
          disabled={!state.canUndo}
        />
        <IconButton
          icon={SOLID_CHROME_ICONS.redo}
          label={state.redoLabel}
          size="sm"
          solid
          onClick={redo}
          disabled={!state.canRedo}
        />
        <div className="editor-menubar__zoom">
          <span aria-hidden className="editor-menubar__zoom-divider">
            |
          </span>
          <label htmlFor="menubar-zoom" className="sr-only">
            Zoom
          </label>
          <ZoomInput
            id="menubar-zoom"
            className="editor-menubar__zoom-input"
            zoom={state.zoom}
            setZoom={setZoom}
          />
          <span className="editor-menubar__zoom-unit">%</span>
        </div>
      </div>

      <AlertDialog
        open={missingFileDialog !== null}
        onClose={() => setMissingFileDialog(null)}
        onConfirm={() => {
          const entryId = missingFileDialog?.entryId;
          setMissingFileDialog(null);
          if (entryId) removeRecent(entryId);
        }}
        title="File Not Found"
        description={missingFileDialog?.message ?? ''}
        confirmLabel="Remove from List"
        cancelLabel="Keep in List"
        variant="destructive"
      />

      <RasterizeDialog
        open={rasterizeDialogOpen}
        selectionCount={state.selection.length}
        onClose={() => setRasterizeDialogOpen(false)}
        onRasterize={handleRasterize}
      />

      <ArchiveDialog
        open={showArchiveDialog}
        onClose={() => setShowArchiveDialog(false)}
        document={state.document as ArchiveDialogProps['document']}
        platform={platform}
        onCreateArchive={(result) => {
          // Desktop: native Save dialog + the atomic write_binary_file
          // command. Browser: no filesystem access, so a plain download is
          // the only option and the browser itself handles it atomically.
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
            loadDocument(JSON.stringify(result.document), {
              name: result.document.name,
              keepIdentity: true,
            });
          }
        }}
      />
    </div>
  );
}
