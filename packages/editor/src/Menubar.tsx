// COMPLEXITY: 275 cyclo (over ceiling 200) — see Phase 5 of architecture-health-remediation-2026-07-26.md
import {
  AlertDialog,
  FloatingPortal,
  IconButton,
  SOLID_CHROME_ICONS,
  Tooltip,
  VarveLogo,
} from '@varve/ui';
import { getTheme, setTheme, type Theme } from '@varve/ui/tokens';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActionRegistry } from './actions/ActionRegistry';
import { ArchiveDialog, type ArchiveDialogProps } from './components/Archive/ArchiveDialog';
import { OfflineBanner } from './components/OfflineBanner';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { bumpThemeRevision, useEditor } from './context';
import { computeCapabilities, useNativeMenu } from './menu';
import { useMenubarFocusEffects } from './menu/menubarFocus';
import { handleMenubarKey } from './menu/menubarKeynav';
import { MenubarSubmenu } from './menu/menubarSubmenu';
import { labelWithFallback, type RecentEntry, useRecentFiles } from './recentFiles';
import { loadSettings } from './settings';
import { formatShortcut, getEffectiveBinding, SHORTCUT_DEFS } from './shortcuts';
import type { WorkspaceMode } from './workspace/workspaceTypes';

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

const THEMES: { id: Theme; label: string }[] = [
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
  },
  recentEntries: RecentEntry[],
  caps: ReadonlySet<string>,
  isMac: boolean,
  activeFilePath: string | undefined,
  revealLabel: string,
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
      case 'imageTrace':
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

  /** Helper: build an aria-keyshortcut string from SHORTCUT_DEFS. */
  const ks = (id: string): string => ariaShortcut(getEffectiveBinding(id));

  return [
    {
      id: 'File',
      items: [
        // ── Create ──
        {
          label: 'New',
          shortcut: formatShortcut(SHORTCUT_DEFS.newDocument.binding),
          ariaKeyshortcut: ks('newDocument'),
          action: 'new',
        },
        {
          label: 'New Logo Project',
          shortcut: formatShortcut(SHORTCUT_DEFS.newLogoProject.binding),
          ariaKeyshortcut: ks('newLogoProject'),
          action: 'newLogoProject',
        },
        {
          label: 'Logo',
          items: [
            {
              label: 'Create Logo Concept',
              shortcut: formatShortcut(SHORTCUT_DEFS.createLogoConcept.binding),
              ariaKeyshortcut: ks('createLogoConcept'),
              action: 'createLogoConcept',
            },
            {
              label: 'Duplicate Logo Concept',
              shortcut: formatShortcut(SHORTCUT_DEFS.duplicateLogoConcept.binding),
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
              shortcut: formatShortcut(SHORTCUT_DEFS.createMonochromeVariant.binding),
              ariaKeyshortcut: ks('createMonochromeVariant'),
              action: 'createMonochromeVariant',
              disabled: dis('createMonochromeVariant'),
            },
            {
              label: 'Create Reversed Variant',
              shortcut: formatShortcut(SHORTCUT_DEFS.createReversedVariant.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.open.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.import.binding),
          ariaKeyshortcut: ks('import'),
          action: 'import',
        },
        { label: '---' },
        // ── Close ──
        {
          label: 'Close Document',
          shortcut: formatShortcut(SHORTCUT_DEFS.tabClose.binding),
          ariaKeyshortcut: ks('tabClose'),
          action: 'tabClose',
        },
        {
          label: 'Close Window',
          shortcut: formatShortcut(SHORTCUT_DEFS.closeWindow.binding),
          ariaKeyshortcut: ks('closeWindow'),
          action: 'closeWindow',
        },
        { label: '---' },
        // ── Save ──
        {
          label: 'Save',
          shortcut: formatShortcut(SHORTCUT_DEFS.save.binding),
          ariaKeyshortcut: ks('save'),
          action: 'save',
        },
        {
          label: 'Save As\u2026',
          shortcut: formatShortcut(SHORTCUT_DEFS.saveAs.binding),
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
          label: 'Export\u2026',
          shortcut: formatShortcut(SHORTCUT_DEFS.export.binding),
          ariaKeyshortcut: ks('export'),
          action: 'export',
        },
        {
          label: 'Export SVG\u2026',
          shortcut: formatShortcut(SHORTCUT_DEFS.exportSvg.binding),
          ariaKeyshortcut: ks('exportSvg'),
          action: 'exportSvg',
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
                shortcut: formatShortcut(SHORTCUT_DEFS.archiveBackup.binding),
                ariaKeyshortcut: ks('archiveBackup'),
                action: 'archiveBackup' as const,
              },
              {
                label: 'Restore Archive\u2026' as const,
                shortcut: formatShortcut(SHORTCUT_DEFS.archiveRestore.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.settings.binding),
          ariaKeyshortcut: ks('settings'),
          action: 'settings',
        },
        // Quit is terminal; macOS hosts it in the native app menu (Cmd+Q).
        ...(!isMac
          ? [
              { label: '---' },
              {
                label: 'Quit Varve',
                shortcut: formatShortcut(SHORTCUT_DEFS.quitApp.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.undo.binding),
          ariaKeyshortcut: ks('undo'),
          action: 'undo',
        },
        {
          label: 'Redo',
          shortcut: formatShortcut(SHORTCUT_DEFS.redo.binding),
          ariaKeyshortcut: ks('redo'),
          action: 'redo',
        },
        { label: '---' },
        {
          label: 'Cut',
          shortcut: formatShortcut(SHORTCUT_DEFS.cut.binding),
          ariaKeyshortcut: ks('cut'),
          action: 'cut',
          disabled: dis('cut'),
        },
        {
          label: 'Copy',
          shortcut: formatShortcut(SHORTCUT_DEFS.copy.binding),
          ariaKeyshortcut: ks('copy'),
          action: 'copy',
          disabled: dis('copy'),
        },
        {
          label: 'Paste',
          shortcut: formatShortcut(SHORTCUT_DEFS.paste.binding),
          ariaKeyshortcut: ks('paste'),
          action: 'paste',
        },
        {
          label: 'Copy Properties',
          shortcut: formatShortcut(SHORTCUT_DEFS.copyProperties.binding),
          ariaKeyshortcut: ks('copyProperties'),
          action: 'copyProperties',
          disabled: !hasSelection,
        },
        {
          label: 'Paste Properties',
          shortcut: formatShortcut(SHORTCUT_DEFS.pasteProperties.binding),
          ariaKeyshortcut: ks('pasteProperties'),
          action: 'pasteProperties',
          disabled: !hasSelection,
        },
        {
          label: 'Duplicate',
          shortcut: formatShortcut(SHORTCUT_DEFS.duplicate.binding),
          ariaKeyshortcut: ks('duplicate'),
          action: 'duplicate',
          disabled: dis('duplicate'),
        },
        {
          label: 'Repeat Duplicate',
          shortcut: formatShortcut(SHORTCUT_DEFS.repeatDuplicate.binding),
          ariaKeyshortcut: ks('repeatDuplicate'),
          action: 'repeatDuplicate',
          disabled: dis('duplicate'),
        },
        { label: '---' },
        {
          label: 'Select All',
          shortcut: formatShortcut(SHORTCUT_DEFS.selectAll.binding),
          ariaKeyshortcut: ks('selectAll'),
          action: 'selectAll',
        },
        {
          label: 'Delete',
          shortcut: formatShortcut(SHORTCUT_DEFS.delete.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.selectionHistoryBack.binding),
          ariaKeyshortcut: ks('selectionHistoryBack'),
          action: 'selectionHistoryBack',
          disabled: !hasSelection,
        },
        {
          label: 'Selection History Forward',
          shortcut: formatShortcut(SHORTCUT_DEFS.selectionHistoryForward.binding),
          ariaKeyshortcut: ks('selectionHistoryForward'),
          action: 'selectionHistoryForward',
          disabled: !hasSelection,
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
        // Theme
        ...THEMES.map((t) => ({
          label: t.label,
          action: `theme:${t.id}`,
        })),
        { label: '---' },
        // Zoom
        {
          label: 'Zoom to 100%',
          shortcut: formatShortcut(SHORTCUT_DEFS.zoomReset.binding),
          ariaKeyshortcut: ks('zoomReset'),
          action: 'zoomReset',
        },
        {
          label: 'Zoom In',
          shortcut: formatShortcut(SHORTCUT_DEFS.zoomIn.binding),
          ariaKeyshortcut: ks('zoomIn'),
          action: 'zoomIn',
        },
        {
          label: 'Zoom Out',
          shortcut: formatShortcut(SHORTCUT_DEFS.zoomOut.binding),
          ariaKeyshortcut: ks('zoomOut'),
          action: 'zoomOut',
        },
        { label: '---' },
        // Canvas Mode
        {
          label: 'Full Render Mode',
          shortcut: formatShortcut(SHORTCUT_DEFS.canvasModeFull.binding),
          ariaKeyshortcut: ks('canvasModeFull'),
          action: 'canvasModeFull',
        },
        {
          label: 'Outline Mode',
          shortcut: formatShortcut(SHORTCUT_DEFS.canvasModeOutline.binding),
          ariaKeyshortcut: ks('canvasModeOutline'),
          action: 'canvasModeOutline',
        },
        {
          label: 'Preview Mode',
          shortcut: formatShortcut(SHORTCUT_DEFS.canvasModePreview.binding),
          ariaKeyshortcut: ks('canvasModePreview'),
          action: 'canvasModePreview',
        },
        {
          label: 'Inspect Mode',
          shortcut: formatShortcut(SHORTCUT_DEFS.toolInspect.binding),
          ariaKeyshortcut: ks('toolInspect'),
          action: 'inspectMode',
        },
        {
          label: 'Present\u2026',
          shortcut: formatShortcut(SHORTCUT_DEFS.present.binding),
          ariaKeyshortcut: ks('present'),
          action: 'present',
        },
        { label: '---' },
        // Viewport
        {
          label: 'Fit Active Page',
          shortcut: formatShortcut(SHORTCUT_DEFS.fitActivePage.binding),
          ariaKeyshortcut: ks('fitActivePage'),
          action: 'fitActivePage',
        },
        {
          label: 'Fit Active Frame',
          shortcut: formatShortcut(SHORTCUT_DEFS.fitActiveFrame.binding),
          ariaKeyshortcut: ks('fitActiveFrame'),
          action: 'fitActiveFrame',
        },
        {
          label: 'Reset View Rotation',
          shortcut: formatShortcut(SHORTCUT_DEFS.resetViewRotation.binding),
          ariaKeyshortcut: ks('resetViewRotation'),
          action: 'resetViewRotation',
        },
        {
          label: 'Rotate View Clockwise',
          shortcut: formatShortcut(SHORTCUT_DEFS.rotateViewCW.binding),
          ariaKeyshortcut: ks('rotateViewCW'),
          action: 'rotateViewCW',
        },
        {
          label: 'Rotate View Counter-clockwise',
          shortcut: formatShortcut(SHORTCUT_DEFS.rotateViewCCW.binding),
          ariaKeyshortcut: ks('rotateViewCCW'),
          action: 'rotateViewCCW',
        },
        { label: '---' },
        // Rulers & Grids
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
          shortcut: formatShortcut(SHORTCUT_DEFS.gridOverlayBaseline.binding),
          ariaKeyshortcut: ks('gridOverlayBaseline'),
          action: 'gridOverlayBaseline',
        },
        {
          label: 'Isometric Grid Overlay',
          shortcut: formatShortcut(SHORTCUT_DEFS.gridOverlayIsometric.binding),
          ariaKeyshortcut: ks('gridOverlayIsometric'),
          action: 'gridOverlayIsometric',
        },
        { label: '---' },
        // Guides
        {
          label: 'Toggle Snap',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleSnap.binding),
          ariaKeyshortcut: ks('toggleSnap'),
          action: 'toggleSnap',
        },
        {
          label: state.guidesVisible ? 'Hide Guides' : 'Show Guides',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleGuidesVisible.binding),
          ariaKeyshortcut: ks('toggleGuidesVisible'),
          action: 'toggleGuidesVisible',
        },
        {
          label: 'Lock All Guides',
          shortcut: formatShortcut(SHORTCUT_DEFS.lockAllGuides.binding),
          ariaKeyshortcut: ks('lockAllGuides'),
          action: 'lockAllGuides',
        },
        {
          label: 'Clear All Guides',
          action: 'clearGuides',
        },
        { label: '---' },
        // Print-specific
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
          shortcut: formatShortcut(SHORTCUT_DEFS.softProof.binding),
          ariaKeyshortcut: ks('softProof'),
          action: 'softProof',
        },
        { label: '---' },
        // Panels
        {
          label: 'Timeline Panel',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleTimelinePanel.binding),
          ariaKeyshortcut: ks('toggleTimelinePanel'),
          action: 'toggleTimelinePanel',
        },
        {
          label: 'Graph Editor',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleGraphEditor.binding),
          ariaKeyshortcut: ks('toggleGraphEditor'),
          action: 'toggleGraphEditor',
        },
        {
          label: 'State Machine Panel',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleStateMachinePanel.binding),
          ariaKeyshortcut: ks('toggleStateMachinePanel'),
          action: 'toggleStateMachinePanel',
        },
        {
          label: 'Fonts Panel',
          shortcut: formatShortcut(SHORTCUT_DEFS.openFontsPanel.binding),
          ariaKeyshortcut: ks('openFontsPanel'),
          action: 'openFontsPanel',
        },
        {
          label: 'Logo Panel',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleLogoPanel.binding),
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
        { label: '---' },
        // Workspace
        {
          label: 'Workspace: Design',
          action: 'workspaceDesign',
        },
        {
          label: 'Workspace: Print',
          action: 'workspacePrint',
        },
        {
          label: 'Workspace: Draw',
          action: 'workspaceDrawing',
        },
        {
          label: 'Workspace: Photo',
          action: 'workspaceImage',
        },
        {
          label: 'Workspace: Motion',
          action: 'workspaceMotion',
        },
        {
          label: 'Workspace: Logo',
          action: 'workspaceLogo',
        },
        {
          label: 'Workspace: Codegen',
          action: 'workspaceCodegen',
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
        { label: '---' },
        // Focus modes
        {
          label: 'Distraction-Free Mode',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleDistractionFree.binding),
          ariaKeyshortcut: ks('toggleDistractionFree'),
          action: 'toggleDistractionFree',
        },
        {
          label: 'Compare Before/After',
          shortcut: formatShortcut(SHORTCUT_DEFS.toggleBeforeAfterCompare.binding),
          ariaKeyshortcut: ks('toggleBeforeAfterCompare'),
          action: 'toggleBeforeAfterCompare',
        },
        {
          label: 'Test Logo at Small Sizes',
          shortcut: formatShortcut(SHORTCUT_DEFS.logoPreview.binding),
          ariaKeyshortcut: ks('logoPreview'),
          action: 'logoPreview',
          disabled: dis('logoPreview'),
        },
        { label: '---' },
        // Color Blindness
        {
          label: 'Color Blindness: None',
          action: 'colorBlindnessNone',
          shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessNone.binding),
          ariaKeyshortcut: ks('colorBlindnessNone'),
        },
        {
          label: 'Color Blindness: Protanopia (red)',
          action: 'colorBlindnessProtanopia',
          shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessProtanopia.binding),
          ariaKeyshortcut: ks('colorBlindnessProtanopia'),
        },
        {
          label: 'Color Blindness: Deuteranopia (green)',
          action: 'colorBlindnessDeuteranopia',
          shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessDeuteranopia.binding),
          ariaKeyshortcut: ks('colorBlindnessDeuteranopia'),
        },
        {
          label: 'Color Blindness: Tritanopia (blue)',
          action: 'colorBlindnessTritanopia',
          shortcut: formatShortcut(SHORTCUT_DEFS.colorBlindnessTritanopia.binding),
          ariaKeyshortcut: ks('colorBlindnessTritanopia'),
        },
        { label: '---' },
        {
          label: 'Keyboard Shortcuts',
          shortcut: formatShortcut(SHORTCUT_DEFS.shortcutPalette.binding),
          ariaKeyshortcut: ks('shortcutPalette'),
          action: 'shortcutPalette',
        },
        {
          label: 'Home',
          shortcut: formatShortcut(SHORTCUT_DEFS.home.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.group.binding),
          ariaKeyshortcut: ks('group'),
          action: 'group',
          disabled: dis('group'),
        },
        {
          label: 'Ungroup',
          shortcut: formatShortcut(SHORTCUT_DEFS.ungroup.binding),
          ariaKeyshortcut: ks('ungroup'),
          action: 'ungroup',
          disabled: dis('ungroup'),
        },
        { label: '---' },
        {
          label: 'Flip Horizontal',
          shortcut: formatShortcut(SHORTCUT_DEFS.flipH.binding),
          ariaKeyshortcut: ks('flipH'),
          action: 'flipH',
          disabled: !hasSelection,
        },
        {
          label: 'Flip Vertical',
          shortcut: formatShortcut(SHORTCUT_DEFS.flipV.binding),
          ariaKeyshortcut: ks('flipV'),
          action: 'flipV',
          disabled: !hasSelection,
        },
        { label: '---' },
        {
          label: 'New Adjustment Layer',
          shortcut: formatShortcut(SHORTCUT_DEFS.newAdjustmentLayer.binding),
          ariaKeyshortcut: ks('newAdjustmentLayer'),
          action: 'newAdjustmentLayer',
        },
        {
          label: 'Create Clipping Mask',
          shortcut: formatShortcut(SHORTCUT_DEFS.createClippingMask.binding),
          ariaKeyshortcut: ks('createClippingMask'),
          action: 'createClippingMask',
          disabled: dis('createClippingMask'),
        },
        {
          label: 'Release Clipping Mask',
          shortcut: formatShortcut(SHORTCUT_DEFS.releaseClippingMask.binding),
          ariaKeyshortcut: ks('releaseClippingMask'),
          action: 'releaseClippingMask',
          disabled: dis('releaseClippingMask'),
        },
        { label: '---' },
        { label: 'Remove Background...', action: 'batchBgRemove', disabled: dis('batchBgRemove') },
        {
          label: 'Crop Image',
          shortcut: formatShortcut(SHORTCUT_DEFS.toolCrop.binding),
          ariaKeyshortcut: ks('toolCrop'),
          action: 'toolCrop',
          disabled: dis('toolCrop'),
        },
        {
          label: 'Extract Palette',
          action: 'extractPalette',
          disabled: dis('extractPalette'),
        },
        {
          label: 'Vectorize Image…',
          shortcut: formatShortcut(SHORTCUT_DEFS.imageTrace.binding),
          ariaKeyshortcut: ks('imageTrace'),
          action: 'imageTrace',
          disabled: dis('imageTrace'),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.flattenSelection.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.booleanUnion.binding),
          ariaKeyshortcut: ks('booleanUnion'),
          action: 'booleanUnion',
          disabled: dis('booleanUnion'),
        },
        {
          label: 'Subtract',
          shortcut: formatShortcut(SHORTCUT_DEFS.booleanSubtract.binding),
          ariaKeyshortcut: ks('booleanSubtract'),
          action: 'booleanSubtract',
          disabled: dis('booleanSubtract'),
        },
        {
          label: 'Intersect',
          shortcut: formatShortcut(SHORTCUT_DEFS.booleanIntersect.binding),
          ariaKeyshortcut: ks('booleanIntersect'),
          action: 'booleanIntersect',
          disabled: dis('booleanIntersect'),
        },
        {
          label: 'Exclude',
          shortcut: formatShortcut(SHORTCUT_DEFS.booleanExclude.binding),
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
              shortcut: formatShortcut(SHORTCUT_DEFS.expandStroke.binding),
              ariaKeyshortcut: ks('expandStroke'),
              action: 'expandStroke',
              disabled: dis('expandStroke'),
            },
            {
              label: 'Offset Path…',
              shortcut: formatShortcut(SHORTCUT_DEFS.offsetPath.binding),
              ariaKeyshortcut: ks('offsetPath'),
              action: 'offsetPath',
              disabled: dis('offsetPath'),
            },
            {
              label: 'Round Path Corners…',
              shortcut: formatShortcut(SHORTCUT_DEFS.roundCorners.binding),
              ariaKeyshortcut: ks('roundCorners'),
              action: 'roundCorners',
              disabled: dis('roundCorners'),
            },
            {
              label: 'Simplify Path…',
              shortcut: formatShortcut(SHORTCUT_DEFS.simplifyPath.binding),
              ariaKeyshortcut: ks('simplifyPath'),
              action: 'simplifyPath',
              disabled: dis('simplifyPath'),
            },
            {
              label: 'Mirror Duplicate — Horizontal',
              shortcut: formatShortcut(SHORTCUT_DEFS.mirrorDuplicateHorizontal.binding),
              ariaKeyshortcut: ks('mirrorDuplicateHorizontal'),
              action: 'mirrorDuplicateHorizontal',
              disabled: dis('mirrorDuplicateHorizontal'),
            },
            {
              label: 'Mirror Duplicate — Vertical',
              shortcut: formatShortcut(SHORTCUT_DEFS.mirrorDuplicateVertical.binding),
              ariaKeyshortcut: ks('mirrorDuplicateVertical'),
              action: 'mirrorDuplicateVertical',
              disabled: dis('mirrorDuplicateVertical'),
            },
            {
              label: 'Radial Duplicate…',
              shortcut: formatShortcut(SHORTCUT_DEFS.radialDuplicate.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.bringFront.binding),
          ariaKeyshortcut: ks('bringFront'),
          action: 'bringFront',
          disabled: dis('bringFront'),
        },
        {
          label: 'Bring Forward',
          shortcut: formatShortcut(SHORTCUT_DEFS.bringForward.binding),
          ariaKeyshortcut: ks('bringForward'),
          action: 'bringForward',
          disabled: dis('bringForward'),
        },
        {
          label: 'Send Backward',
          shortcut: formatShortcut(SHORTCUT_DEFS.sendBackward.binding),
          ariaKeyshortcut: ks('sendBackward'),
          action: 'sendBackward',
          disabled: dis('sendBackward'),
        },
        {
          label: 'Send to Back',
          shortcut: formatShortcut(SHORTCUT_DEFS.sendBack.binding),
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
              shortcut: formatShortcut(SHORTCUT_DEFS.alignLeft.binding),
              ariaKeyshortcut: ks('alignLeft'),
              action: 'alignLeft',
              disabled: dis('alignLeft'),
            },
            {
              label: 'Align Horizontal Center',
              shortcut: formatShortcut(SHORTCUT_DEFS.alignCenterH.binding),
              ariaKeyshortcut: ks('alignCenterH'),
              action: 'alignCenterH',
              disabled: dis('alignCenterH'),
            },
            {
              label: 'Align Right',
              shortcut: formatShortcut(SHORTCUT_DEFS.alignRight.binding),
              ariaKeyshortcut: ks('alignRight'),
              action: 'alignRight',
              disabled: dis('alignRight'),
            },
            { label: '---' },
            {
              label: 'Align Top',
              shortcut: formatShortcut(SHORTCUT_DEFS.alignTop.binding),
              ariaKeyshortcut: ks('alignTop'),
              action: 'alignTop',
              disabled: dis('alignTop'),
            },
            {
              label: 'Align Vertical Center',
              shortcut: formatShortcut(SHORTCUT_DEFS.alignCenterV.binding),
              ariaKeyshortcut: ks('alignCenterV'),
              action: 'alignCenterV',
              disabled: dis('alignCenterV'),
            },
            {
              label: 'Align Bottom',
              shortcut: formatShortcut(SHORTCUT_DEFS.alignBottom.binding),
              ariaKeyshortcut: ks('alignBottom'),
              action: 'alignBottom',
              disabled: dis('alignBottom'),
            },
            { label: '---' },
            {
              label: 'Distribute Horizontally',
              shortcut: formatShortcut(SHORTCUT_DEFS.distributeHorizontal.binding),
              ariaKeyshortcut: ks('distributeHorizontal'),
              action: 'distributeHorizontal',
              disabled: dis('distributeHorizontal'),
            },
            {
              label: 'Distribute Vertically',
              shortcut: formatShortcut(SHORTCUT_DEFS.distributeVertical.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.harmonizeSpacing.binding),
          ariaKeyshortcut: ks('harmonizeSpacing'),
          action: 'harmonizeSpacing',
          disabled: dis('harmonizeSpacing'),
        },
        { label: '---' },
        {
          label: 'Nudge Left',
          shortcut: formatShortcut(SHORTCUT_DEFS.nudgeLeft.binding),
          ariaKeyshortcut: ks('nudgeLeft'),
          action: 'nudgeLeft',
          disabled: dis('nudgeLeft'),
        },
        {
          label: 'Nudge Right',
          shortcut: formatShortcut(SHORTCUT_DEFS.nudgeRight.binding),
          ariaKeyshortcut: ks('nudgeRight'),
          action: 'nudgeRight',
          disabled: dis('nudgeRight'),
        },
        {
          label: 'Nudge Up',
          shortcut: formatShortcut(SHORTCUT_DEFS.nudgeUp.binding),
          ariaKeyshortcut: ks('nudgeUp'),
          action: 'nudgeUp',
          disabled: dis('nudgeUp'),
        },
        {
          label: 'Nudge Down',
          shortcut: formatShortcut(SHORTCUT_DEFS.nudgeDown.binding),
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
          shortcut: formatShortcut(SHORTCUT_DEFS.openHelp.binding),
          ariaKeyshortcut: ks('openHelp'),
          action: 'openHelp',
        },
        {
          label: 'Help Center',
          shortcut: formatShortcut(SHORTCUT_DEFS.openHelpCenter.binding),
          ariaKeyshortcut: ks('openHelpCenter'),
          action: 'openHelpCenter',
        },
        {
          label: "What's This?",
          action: 'whatIsThis',
        },
        { label: '---' },
        { label: 'Take a Tour', action: 'startTour' },
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
  if (item.action === 'toggleLogoPanel') return 'menuitemcheckbox';
  if (item.action === 'rulerModeArtboard' || item.action === 'rulerModeGlobal')
    return 'menuitemradio';
  if (item.action?.startsWith('applyMaster')) return 'menuitemradio';
  return 'menuitem';
}

function separatorKey(items: MenuItem[], current: MenuItem, parentLabel: string): string {
  let ordinal = 0;
  for (const item of items) {
    if (item === current) break;
    if (item.label === '---') ordinal += 1;
  }
  return `${parentLabel}-separator-${ordinal}`;
}

/** Compute aria-checked for a menu item based on current state. */
function itemAriaChecked(
  item: MenuItem,
  state: {
    canvasMode: string;
    workspaceMode: string;
    colorBlindnessView: string;
    rulerMode: string;
    logoPanelVisible: boolean;
    document?: { activePageId?: string; pages?: Array<{ id: string; masterPageId?: string }> };
  },
): boolean | undefined {
  if (item.action === 'toggleLogoPanel') return state.logoPanelVisible;
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
  toolCrop: ['design', 'print', 'image'],
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
    openFile,
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
  const {
    entries: recentEntries,
    remove: removeRecent,
    clear: clearRecent,
  } = useRecentFiles(platform);
  // `sessions` may be absent in unit-test harnesses that pass a partial state.
  const activeSession = (state.sessions ?? []).find((s) => s.id === state.activeId);
  const activeFilePath = activeSession?.filePath;
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

  const isMac = useMemo(() => {
    try {
      return navigator.platform?.toLowerCase().includes('mac') ?? false;
    } catch {
      return false;
    }
  }, []);

  const caps = useMemo(() => computeCapabilities(), []);
  const rawMenus = useMemo(
    () => buildMenus(state, recentEntries, caps, isMac, activeFilePath, revealLabel),
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
      caps,
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
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme() ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const topLevelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [missingFileDialog, setMissingFileDialog] = useState<{
    message: string;
    entryId: string;
  } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
    const saved = (localStorage.getItem('varve-theme') ??
      localStorage.getItem('strata-theme')) as Theme | null;
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
    return () => {
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = null;
      }
    };
  }, []);
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
        openFile(entry.id, entry.label, fileEntry?.filePath, json);
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
          openFile(undefined, entry.label, undefined, text);
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

      // Menubar-specific actions (not in the registry or with different behavior)
      switch (action) {
        case 'new':
          // Opens its own tab — the current document stays open and intact,
          // so there is nothing to confirm.
          newDocument();
          return;
        case 'settings':
          onOpenSettings?.();
          return;
        case 'clearRecent':
          clearRecent();
          return;
        case 'reopenLast':
          {
            const mostRecent = recentEntries[0];
            if (mostRecent) void openRecentFile(mostRecent);
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
        case 'downloadSnapshot':
          setShowArchiveDialog(true, 'backup');
          return;
        case 'restoreFromSnapshot':
          setShowArchiveDialog(true, 'restore');
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
            localStorage.setItem('varve-theme', theme);
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

  useNativeMenu({
    selection: state.selection,
    document: state.document,
    workspaceMode: state.workspaceMode,
    platformKind: platform?.kind,
    runAction: handleAction,
    getTheme: () => getTheme() ?? 'light',
  });

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

  const currentSubmenuItems = useMemo(() => {
    if (openSubmenu === null || openMenuIndex < 0) return [];
    const item = menus[openMenuIndex]?.items[openSubmenu];
    if (!item?.items) return [];
    return item.items;
  }, [openSubmenu, openMenuIndex, menus]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      handleMenubarKey(e, {
        menuRef,
        dropdownMenuRef,
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
          role="menubar"
          aria-label="Application"
          ref={menuRef}
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
              aria-haspopup="true"
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
                      <hr
                        key={separatorKey(menus[openMenuIndex]?.items ?? [], item, openMenu)}
                        className="editor-menubar__menu-sep"
                        tabIndex={-1}
                      />
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
                      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is emitted only when the runtime role is menuitemradio/menuitemcheckbox */}
                      <button
                        role={hasSubmenu ? 'menuitem' : role}
                        type="button"
                        aria-haspopup={hasSubmenu ? true : undefined}
                        aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
                        aria-checked={
                          !hasSubmenu && (role === 'menuitemradio' || role === 'menuitemcheckbox')
                            ? isChecked
                            : undefined
                        }
                        aria-keyshortcuts={item.ariaKeyshortcut}
                        disabled={item.disabled && !hasSubmenu}
                        tabIndex={activeItemIndex === itemIdx ? 0 : -1}
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
                        <MenubarSubmenu
                          items={item.items}
                          parentLabel={item.label}
                          open
                          activeSubmenuIndex={activeSubmenuIndex}
                          anchorRef={dropdownMenuRef}
                          submenuRef={submenuRef}
                          currentTheme={currentTheme}
                          state={state}
                          onClose={() => {
                            setOpenSubmenu(null);
                            setActiveSubmenuIndex(0);
                            // Return focus to the parent item when the submenu
                            // had it (outside-click close).
                            const active = document.activeElement;
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
                })}
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
                if (e.key === 'Escape') setEditingName(false);
              }}
              aria-label="Document name"
            />
          ) : (
            <Tooltip label="Rename document">
              <button
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
        variant="danger"
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
