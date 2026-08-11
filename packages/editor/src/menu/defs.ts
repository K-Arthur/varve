import { labelWithFallback, loadEntries } from '../recentFiles/store';
import { SHORTCUT_DEFS } from '../shortcuts/ShortcutManager';
import type { ShortcutBinding } from '../shortcuts/types';
import type { Accelerator, Capability, MenuContext, MenuItemDef } from './types';

function hasCapability(ctx: MenuContext, cap: Capability): boolean {
  return ctx.platform.capabilities.has(cap);
}

const a = (
  key: string,
  ctrl?: boolean,
  shift?: boolean,
  alt?: boolean,
  meta?: boolean,
): Accelerator => ({ key, ctrl, shift, alt, meta });

/**
 * Resolve a menu accelerator from the live shortcut registry instead of a
 * hand-maintained copy (the old hardcoded Ctrl+Shift+D/P/R/I/M were stale
 * against the real Ctrl+Shift+1..9 bindings).
 */
function acceleratorFor(shortcutId: keyof typeof SHORTCUT_DEFS): Accelerator {
  const binding = (SHORTCUT_DEFS[shortcutId]?.binding ?? { key: '' }) as ShortcutBinding;
  return a(binding.key, binding.ctrl, binding.shift, binding.alt);
}

function enabledWithSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count > 0) return true;
  return { reason: 'Select a layer first' };
}

function enabledWithMultiSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count >= 2) return true;
  return { reason: 'Select 2 or more layers' };
}

function enabledWithTripleSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count >= 3) return true;
  return { reason: 'Select at least three layers to distribute.' };
}

function enabledWithSingleGroup(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.isSingle && ctx.selection.hasGroup) return true;
  return { reason: 'Select a group to ungroup' };
}

export function getFileMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    // ── Create ──
    {
      id: 'new',
      labelKey: 'menu.file.new',
      accelerator: a('n', true),
      kind: 'command',
      group: 'create',
      run: () => runAction('new'),
    },
    {
      id: 'newLogoProject',
      labelKey: 'menu.file.newLogoProject',
      accelerator: a('n', true, false, true),
      kind: 'command',
      group: 'create',
      run: () => runAction('newLogoProject'),
    },
    {
      id: 'logo',
      labelKey: 'menu.file.logo',
      kind: 'submenu',
      group: 'create',
      items: [
        {
          id: 'createLogoConcept',
          labelKey: 'menu.file.createLogoConcept',
          accelerator: a('1', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createLogoConcept'),
        },
        {
          id: 'duplicateLogoConcept',
          labelKey: 'menu.file.duplicateLogoConcept',
          accelerator: a('2', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('duplicateLogoConcept'),
        },
        {
          id: 'createLogoVariant',
          labelKey: 'menu.file.createLogoVariant',
          kind: 'command',
          group: 'create',
          run: () => runAction('createLogoVariant'),
        },
        {
          id: 'createMonochromeVariant',
          labelKey: 'menu.file.createMonochromeVariant',
          accelerator: a('m', true, true, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createMonochromeVariant'),
        },
        {
          id: 'createReversedVariant',
          labelKey: 'menu.file.createReversedVariant',
          accelerator: a('q', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createReversedVariant'),
        },
      ],
      run: () => {},
    },
    // ── Open / Import ──
    {
      id: 'open',
      labelKey: 'menu.file.open',
      accelerator: a('o', true),
      kind: 'command',
      group: 'open',
      run: () => runAction('open'),
    },
    {
      id: 'openRecent',
      labelKey: 'Open Recent',
      kind: 'submenu',
      group: 'open',
      items: (): MenuItemDef[] => {
        try {
          const entries = loadEntries().slice(0, 10);
          if (entries.length === 0) {
            return [
              {
                id: 'noRecent',
                labelKey: 'No Recent Files',
                kind: 'command',
                enabled: () => ({ reason: 'No recently opened files yet' }),
                run: () => {},
              },
            ];
          }
          const items: MenuItemDef[] = entries.map((e) => ({
            id: `recent:${e.id}`,
            labelKey: e.label,
            label: () => labelWithFallback(e.label),
            kind: 'command',
            group: 'recent',
            run: () => runAction(`openRecent:${e.id}`),
          }));
          items.push(
            { id: 'recent-sep', kind: 'separator', group: 'recent', run: () => {} },
            {
              id: 'clearRecent',
              labelKey: 'Clear Recent Files',
              kind: 'command',
              group: 'recent',
              run: () => runAction('clearRecent'),
            },
          );
          return items;
        } catch {
          return [];
        }
      },
      run: () => {},
    },
    {
      id: 'reopenLast',
      labelKey: 'Reopen Last File',
      accelerator: a('t', true, true),
      kind: 'command',
      group: 'open',
      run: () => runAction('reopenLast'),
    },
    {
      id: 'import',
      labelKey: 'menu.file.import',
      accelerator: a('i', true),
      kind: 'command',
      group: 'open',
      run: () => runAction('import'),
    },
    {
      id: 'insertIcon',
      labelKey: 'menu.file.insertIcon',
      accelerator: a('i', true, true, true),
      kind: 'command',
      group: 'open',
      run: () => runAction('insertIcon'),
    },
    {
      id: 'createTableFromClipboard',
      labelKey: 'menu.file.createTableFromClipboard',
      kind: 'command',
      group: 'open',
      run: () => runAction('createTableFromClipboard'),
    },
    // ── Close ──
    {
      id: 'tabClose',
      labelKey: 'menu.file.closeDocument',
      kind: 'command',
      group: 'close',
      run: () => runAction('tabClose'),
    },
    {
      id: 'closeWindow',
      labelKey: 'menu.file.closeWindow',
      kind: 'command',
      group: 'close',
      run: () => runAction('closeWindow'),
    },
    // ── Save ──
    {
      id: 'save',
      labelKey: 'menu.file.save',
      accelerator: a('s', true),
      kind: 'command',
      group: 'save',
      run: () => runAction('save'),
    },
    {
      id: 'saveAs',
      labelKey: 'menu.file.saveAs',
      accelerator: a('s', true, true),
      kind: 'command',
      group: 'save',
      run: () => runAction('saveAs'),
    },
    {
      id: 'saveCopy',
      labelKey: 'menu.file.saveCopy',
      kind: 'command',
      group: 'save',
      run: () => runAction('saveCopy'),
    },
    // ── Export ──
    {
      id: 'exportSvg',
      labelKey: 'menu.file.exportSvg',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'export',
      run: () => runAction('exportSvg'),
    },
    {
      id: 'export',
      labelKey: 'menu.file.export',
      accelerator: a('e', true),
      kind: 'command',
      group: 'export',
      run: () => runAction('export'),
    },
    // ── Document metadata ──
    {
      id: 'setFileThumbnail',
      labelKey: 'Set File Thumbnail…',
      kind: 'command',
      group: 'info',
      run: () => runAction('openThumbnailPicker'),
    },
    {
      id: 'documentInfo',
      labelKey: 'menu.file.documentInfo',
      kind: 'command',
      group: 'info',
      run: () => runAction('documentInfo'),
    },
    // ── Archive / backup ──
    {
      id: 'archiveBackup',
      labelKey: 'menu.file.archiveBackup',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => hasCapability(ctx, 'archive'),
      run: () => runAction('archiveBackup'),
    },
    {
      id: 'archiveRestore',
      labelKey: 'menu.file.archiveRestore',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => hasCapability(ctx, 'archive'),
      run: () => runAction('archiveRestore'),
    },
    {
      id: 'downloadSnapshot',
      labelKey: 'menu.file.downloadSnapshot',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => !hasCapability(ctx, 'archive'),
      run: () => runAction('downloadSnapshot'),
    },
    {
      id: 'restoreFromSnapshot',
      labelKey: 'menu.file.restoreFromSnapshot',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => !hasCapability(ctx, 'archive'),
      run: () => runAction('restoreFromSnapshot'),
    },
    // ── Settings ──
    {
      id: 'settings',
      labelKey: 'menu.file.settings',
      accelerator: a(',', true),
      kind: 'command',
      group: 'settings',
      run: () => runAction('settings'),
    },
    // ── Quit (terminal; macOS hosts it in the native app menu) ──
    {
      id: 'quitApp',
      labelKey: 'menu.file.quit',
      kind: 'command',
      group: 'quit',
      visible: (ctx) => ctx.platform.os !== 'mac',
      run: () => runAction('quitApp'),
    },
  ];
}

export function getEditMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'undo',
      labelKey: 'menu.edit.undo',
      accelerator: a('z', true),
      kind: 'command',
      group: 'undo',
      run: () => runAction('undo'),
    },
    {
      id: 'redo',
      labelKey: 'menu.edit.redo',
      accelerator: a('z', true, true),
      kind: 'command',
      group: 'undo',
      run: () => runAction('redo'),
    },
    {
      id: 'cut',
      labelKey: 'menu.edit.cut',
      accelerator: a('x', true),
      kind: 'command',
      group: 'clipboard',
      enabled: enabledWithSelection,
      run: () => runAction('cut'),
    },
    {
      id: 'copy',
      labelKey: 'menu.edit.copy',
      accelerator: a('c', true),
      kind: 'command',
      group: 'clipboard',
      enabled: enabledWithSelection,
      run: () => runAction('copy'),
    },
    {
      id: 'paste',
      labelKey: 'menu.edit.paste',
      accelerator: a('v', true),
      kind: 'command',
      group: 'clipboard',
      run: () => runAction('paste'),
    },
    {
      id: 'duplicate',
      labelKey: 'menu.edit.duplicate',
      accelerator: a('d', true),
      kind: 'command',
      group: 'clipboard',
      enabled: enabledWithSelection,
      run: () => runAction('duplicate'),
    },
    {
      id: 'repeatDuplicate',
      labelKey: 'menu.edit.repeatDuplicate',
      accelerator: a('d', true, true),
      kind: 'command',
      group: 'clipboard',
      enabled: enabledWithSelection,
      run: () => runAction('repeatDuplicate'),
    },
    {
      id: 'selectAll',
      labelKey: 'menu.edit.selectAll',
      accelerator: a('a', true),
      kind: 'command',
      group: 'selection',
      run: () => runAction('selectAll'),
    },
    {
      id: 'selectNone',
      labelKey: 'menu.edit.selectNone',
      accelerator: a('a', true, true),
      kind: 'command',
      group: 'selection',
      run: () => runAction('selectNone'),
    },
    {
      id: 'invertSelection',
      labelKey: 'menu.edit.invertSelection',
      accelerator: a('i', true, true),
      kind: 'command',
      group: 'selection',
      run: () => runAction('invertSelection'),
    },
    {
      id: 'selectParent',
      labelKey: 'menu.edit.selectParent',
      accelerator: a('ArrowUp', false, false, true),
      kind: 'command',
      group: 'selection',
      enabled: enabledWithSelection,
      run: () => runAction('selectParent'),
    },
    {
      id: 'selectChildren',
      labelKey: 'menu.edit.selectChildren',
      accelerator: a('ArrowDown', false, false, true),
      kind: 'command',
      group: 'selection',
      enabled: enabledWithSelection,
      run: () => runAction('selectChildren'),
    },
    {
      id: 'delete',
      labelKey: 'menu.edit.delete',
      accelerator: a('Backspace'),
      kind: 'command',
      group: 'selection',
      enabled: enabledWithSelection,
      run: () => runAction('delete'),
    },
    {
      id: 'findReplace',
      labelKey: 'menu.edit.findReplace',
      accelerator: a('f', true),
      kind: 'command',
      group: 'edit',
      run: () => runAction('findReplace'),
    },
    {
      id: 'selectionHistoryBack',
      labelKey: 'menu.edit.selectionHistoryBack',
      accelerator: a('z', true, false, true),
      kind: 'command',
      group: 'history',
      enabled: enabledWithSelection,
      run: () => runAction('selectionHistoryBack'),
    },
    {
      id: 'selectionHistoryForward',
      labelKey: 'menu.edit.selectionHistoryForward',
      accelerator: a('z', true, false, false, true),
      kind: 'command',
      group: 'history',
      enabled: enabledWithSelection,
      run: () => runAction('selectionHistoryForward'),
    },
  ];
}

export function getTextMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'linkTextFrames',
      labelKey: 'menu.text.linkTextFrames',
      accelerator: a('k', true, false, true),
      kind: 'command',
      group: 'threading',
      workspaces: ['design', 'print'],
      enabled: enabledWithSelection,
      run: () => runAction('linkTextFrames'),
    },
    {
      id: 'unlinkTextFrames',
      labelKey: 'menu.text.unlinkTextFrames',
      accelerator: a('k', true, true, true),
      kind: 'command',
      group: 'threading',
      workspaces: ['design', 'print'],
      enabled: enabledWithSelection,
      run: () => runAction('unlinkTextFrames'),
    },
    {
      id: 'textBold',
      labelKey: 'menu.text.bold',
      accelerator: a('b', true, true),
      kind: 'command',
      group: 'format',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textBold'),
    },
    {
      id: 'textItalic',
      labelKey: 'menu.text.italic',
      accelerator: a('i', true, true),
      kind: 'command',
      group: 'format',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textItalic'),
    },
    {
      id: 'textUnderline',
      labelKey: 'menu.text.underline',
      accelerator: a('u', true, true),
      kind: 'command',
      group: 'format',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textUnderline'),
    },
    {
      id: 'textIncreaseSize',
      labelKey: 'menu.text.increaseSize',
      accelerator: a('=', true, true),
      kind: 'command',
      group: 'size',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textIncreaseSize'),
    },
    {
      id: 'textDecreaseSize',
      labelKey: 'menu.text.decreaseSize',
      accelerator: a('-', true, true),
      kind: 'command',
      group: 'size',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textDecreaseSize'),
    },
    {
      id: 'textAlignLeft',
      labelKey: 'menu.text.alignLeft',
      kind: 'command',
      group: 'align',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textAlignLeft'),
    },
    {
      id: 'textAlignCenter',
      labelKey: 'menu.text.alignCenter',
      kind: 'command',
      group: 'align',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textAlignCenter'),
    },
    {
      id: 'textAlignRight',
      labelKey: 'menu.text.alignRight',
      kind: 'command',
      group: 'align',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textAlignRight'),
    },
    {
      id: 'textAlignJustify',
      labelKey: 'menu.text.alignJustify',
      kind: 'command',
      group: 'align',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      enabled: enabledWithSelection,
      run: () => runAction('textAlignJustify'),
    },
    {
      id: 'textToOutlines',
      labelKey: 'menu.text.toOutlines',
      kind: 'command',
      group: 'convert',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('textToOutlines'),
    },
  ];
}

export function getViewMenu(
  runAction: (id: string) => void,
  deps?: { getTheme?: () => string },
): MenuItemDef[] {
  return [
    {
      id: 'theme:light',
      labelKey: 'menu.view.themeLight',
      kind: 'radio',
      group: 'theme',
      radioGroup: 'theme',
      checked: () => deps?.getTheme?.() === 'light',
      run: () => runAction('theme:light'),
    },
    {
      id: 'theme:dark',
      labelKey: 'menu.view.themeDark',
      kind: 'radio',
      group: 'theme',
      radioGroup: 'theme',
      checked: () => deps?.getTheme?.() === 'dark',
      run: () => runAction('theme:dark'),
    },
    {
      id: 'theme:high-contrast',
      labelKey: 'menu.view.themeHighContrast',
      kind: 'radio',
      group: 'theme',
      radioGroup: 'theme',
      checked: () => deps?.getTheme?.() === 'high-contrast',
      run: () => runAction('theme:high-contrast'),
    },
    {
      id: 'zoomReset',
      labelKey: 'menu.view.zoomReset',
      accelerator: a('0', true),
      kind: 'command',
      group: 'zoom',
      run: () => runAction('zoomReset'),
    },
    {
      id: 'zoomIn',
      labelKey: 'menu.view.zoomIn',
      accelerator: a('=', true),
      kind: 'command',
      group: 'zoom',
      run: () => runAction('zoomIn'),
    },
    {
      id: 'zoomOut',
      labelKey: 'menu.view.zoomOut',
      accelerator: a('-', true),
      kind: 'command',
      group: 'zoom',
      run: () => runAction('zoomOut'),
    },
    {
      id: 'canvasModeFull',
      labelKey: 'menu.view.canvasModeFull',
      accelerator: a('1', true),
      kind: 'command',
      group: 'canvasMode',
      run: () => runAction('canvasModeFull'),
    },
    {
      id: 'canvasModeOutline',
      labelKey: 'menu.view.canvasModeOutline',
      accelerator: a('2', true),
      kind: 'command',
      group: 'canvasMode',
      run: () => runAction('canvasModeOutline'),
    },
    {
      id: 'canvasModePreview',
      labelKey: 'menu.view.canvasModePreview',
      accelerator: a('3', true),
      kind: 'command',
      group: 'canvasMode',
      run: () => runAction('canvasModePreview'),
    },
    {
      id: 'inspectMode',
      labelKey: 'menu.view.inspectMode',
      accelerator: a('i', true, true),
      kind: 'command',
      group: 'canvasMode',
      workspaces: ['design', 'print', 'drawing', 'image', 'motion'],
      run: () => runAction('inspectMode'),
    },
    {
      id: 'present',
      labelKey: 'menu.view.present',
      accelerator: a('.', true),
      kind: 'command',
      group: 'present',
      run: () => runAction('present'),
    },
    {
      id: 'fitActivePage',
      labelKey: 'menu.view.fitActivePage',
      accelerator: a('0', true, false, true),
      kind: 'command',
      group: 'viewport',
      run: () => runAction('fitActivePage'),
    },
    {
      id: 'fitSpread',
      labelKey: 'menu.view.fitSpread',
      accelerator: a('5', true, false, true),
      kind: 'command',
      group: 'viewport',
      run: () => runAction('fitSpread'),
    },
    {
      id: 'fitAllPages',
      labelKey: 'menu.view.fitAllPages',
      accelerator: a('6', true, false, true),
      kind: 'command',
      group: 'viewport',
      run: () => runAction('fitAllPages'),
    },
    {
      id: 'fitActiveFrame',
      labelKey: 'menu.view.fitActiveFrame',
      accelerator: a('1', true, false, true),
      kind: 'command',
      group: 'viewport',
      run: () => runAction('fitActiveFrame'),
    },
    {
      id: 'resetViewRotation',
      labelKey: 'menu.view.resetViewRotation',
      accelerator: a('0', true, true),
      kind: 'command',
      group: 'viewport',
      run: () => runAction('resetViewRotation'),
    },
    {
      id: 'rotateViewCW',
      labelKey: 'menu.view.rotateViewCW',
      kind: 'command',
      group: 'viewport',
      run: () => runAction('rotateViewCW'),
    },
    {
      id: 'rotateViewCCW',
      labelKey: 'menu.view.rotateViewCCW',
      kind: 'command',
      group: 'viewport',
      run: () => runAction('rotateViewCCW'),
    },
    {
      id: 'rulerModeArtboard',
      labelKey: 'menu.view.rulerModeArtboard',
      kind: 'radio',
      group: 'rulers',
      radioGroup: 'rulerMode',
      run: () => runAction('rulerModeArtboard'),
    },
    {
      id: 'rulerModeGlobal',
      labelKey: 'menu.view.rulerModeGlobal',
      kind: 'radio',
      group: 'rulers',
      radioGroup: 'rulerMode',
      run: () => runAction('rulerModeGlobal'),
    },
    {
      id: 'toggleGrid',
      labelKey: 'menu.view.toggleGrid',
      accelerator: a('g', true, true),
      kind: 'command',
      group: 'grid',
      run: () => runAction('toggleGrid'),
    },
    {
      id: 'gridOverlayBaseline',
      labelKey: 'menu.view.gridOverlayBaseline',
      accelerator: a("'", true),
      kind: 'command',
      group: 'grid',
      run: () => runAction('gridOverlayBaseline'),
    },
    {
      id: 'gridOverlayIsometric',
      labelKey: 'menu.view.gridOverlayIsometric',
      kind: 'command',
      group: 'grid',
      run: () => runAction('gridOverlayIsometric'),
    },
    {
      id: 'toggleSnap',
      labelKey: 'menu.view.toggleSnap',
      accelerator: a(';', true),
      kind: 'command',
      group: 'guides',
      run: () => runAction('toggleSnap'),
    },
    {
      id: 'toggleGuides',
      labelKey: 'menu.view.toggleGuides',
      accelerator: a(';', true, true),
      kind: 'command',
      group: 'guides',
      run: () => runAction('toggleGuides'),
    },
    {
      id: 'lockGuides',
      labelKey: 'menu.view.lockGuides',
      accelerator: a('l', true, true),
      kind: 'command',
      group: 'guides',
      run: () => runAction('lockGuides'),
    },
    {
      id: 'clearGuides',
      labelKey: 'menu.view.clearGuides',
      kind: 'command',
      group: 'guides',
      run: () => runAction('clearGuides'),
    },
    {
      id: 'toggleFacingPages',
      labelKey: 'menu.view.toggleFacingPages',
      kind: 'command',
      group: 'print',
      workspaces: ['print'],
      run: () => runAction('toggleFacingPages'),
    },
    {
      id: 'softProof',
      labelKey: 'menu.view.softProof',
      kind: 'command',
      group: 'print',
      workspaces: ['print', 'image'],
      run: () => runAction('softProof'),
    },
    {
      id: 'toggleTimelinePanel',
      labelKey: 'menu.view.toggleTimelinePanel',
      accelerator: a('t', true),
      kind: 'command',
      group: 'panels',
      workspaces: ['design', 'motion'],
      run: () => runAction('toggleTimelinePanel'),
    },
    {
      id: 'toggleGraphEditor',
      labelKey: 'menu.view.toggleGraphEditor',
      accelerator: a('g', true),
      kind: 'command',
      group: 'panels',
      workspaces: ['design', 'motion'],
      run: () => runAction('toggleGraphEditor'),
    },
    {
      id: 'toggleStateMachinePanel',
      labelKey: 'menu.view.toggleStateMachinePanel',
      accelerator: a('m', true, true),
      kind: 'command',
      group: 'panels',
      workspaces: ['design', 'motion'],
      run: () => runAction('toggleStateMachinePanel'),
    },
    {
      id: 'toggleLogoPanel',
      labelKey: 'menu.view.toggleLogoPanel',
      accelerator: a('l', true, true, true),
      kind: 'command',
      group: 'panels',
      workspaces: ['logo'],
      run: () => runAction('toggleLogoPanel'),
    },
    {
      id: 'workspaceDesign',
      labelKey: 'menu.view.workspaceDesign',
      accelerator: acceleratorFor('workspaceDesign'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceDesign'),
    },
    {
      id: 'workspacePrint',
      labelKey: 'menu.view.workspacePrint',
      accelerator: acceleratorFor('workspacePrint'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspacePrint'),
    },
    {
      id: 'workspaceDrawing',
      labelKey: 'menu.view.workspaceDrawing',
      accelerator: acceleratorFor('workspaceDrawing'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceDrawing'),
    },
    {
      id: 'workspaceImage',
      labelKey: 'menu.view.workspaceImage',
      accelerator: acceleratorFor('workspaceImage'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceImage'),
    },
    {
      id: 'workspaceMotion',
      labelKey: 'menu.view.workspaceMotion',
      accelerator: acceleratorFor('workspaceMotion'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceMotion'),
    },
    {
      id: 'workspaceLogo',
      labelKey: 'menu.view.workspaceLogo',
      accelerator: acceleratorFor('workspaceLogo'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceLogo'),
    },
    {
      id: 'workspaceCodegen',
      labelKey: 'menu.view.workspaceCodegen',
      accelerator: acceleratorFor('workspaceCodegen'),
      kind: 'radio',
      group: 'workspace',
      radioGroup: 'workspace',
      run: () => runAction('workspaceCodegen'),
    },
    {
      id: 'resetWorkspace',
      labelKey: 'menu.view.resetWorkspace',
      kind: 'command',
      group: 'workspace',
      run: () => runAction('resetWorkspace'),
    },
    {
      id: 'logoPreview',
      labelKey: 'menu.view.logoPreview',
      accelerator: a('p', true, true, true),
      kind: 'command',
      group: 'focus',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('logoPreview'),
    },
    {
      id: 'exportLogoPackage',
      labelKey: 'menu.file.exportLogoPackage',
      kind: 'command',
      group: 'file',
      run: () => runAction('exportLogoPackage'),
    },
    {
      id: 'toggleDistractionFree',
      labelKey: 'menu.view.distractionFree',
      accelerator: a('.', true, true),
      kind: 'command',
      group: 'focus',
      run: () => runAction('toggleDistractionFree'),
    },
    {
      id: 'toggleBeforeAfterCompare',
      labelKey: 'menu.view.beforeAfterCompare',
      accelerator: a('y', true),
      kind: 'command',
      group: 'focus',
      workspaces: ['design', 'print', 'drawing', 'image'],
      run: () => runAction('toggleBeforeAfterCompare'),
    },
    {
      id: 'colorBlindnessNone',
      labelKey: 'menu.view.colorBlindnessNone',
      kind: 'radio',
      group: 'colorBlindness',
      radioGroup: 'colorBlindness',
      run: () => runAction('colorBlindnessNone'),
    },
    {
      id: 'colorBlindnessProtanopia',
      labelKey: 'menu.view.colorBlindnessProtanopia',
      kind: 'radio',
      group: 'colorBlindness',
      radioGroup: 'colorBlindness',
      run: () => runAction('colorBlindnessProtanopia'),
    },
    {
      id: 'colorBlindnessDeuteranopia',
      labelKey: 'menu.view.colorBlindnessDeuteranopia',
      kind: 'radio',
      group: 'colorBlindness',
      radioGroup: 'colorBlindness',
      run: () => runAction('colorBlindnessDeuteranopia'),
    },
    {
      id: 'colorBlindnessTritanopia',
      labelKey: 'menu.view.colorBlindnessTritanopia',
      kind: 'radio',
      group: 'colorBlindness',
      radioGroup: 'colorBlindness',
      run: () => runAction('colorBlindnessTritanopia'),
    },
    {
      id: 'shortcutPalette',
      labelKey: 'menu.view.shortcutPalette',
      accelerator: a('/', true),
      kind: 'command',
      group: 'help',
      run: () => runAction('shortcutPalette'),
    },
    {
      id: 'home',
      labelKey: 'menu.view.home',
      accelerator: a('h', true, true),
      kind: 'command',
      group: 'help',
      run: () => runAction('home'),
    },
  ];
}

export function getObjectMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'group',
      labelKey: 'menu.object.group',
      accelerator: a('g', true),
      kind: 'command',
      group: 'grouping',
      enabled: (ctx) => {
        if (ctx.selection.canGroup) return true;
        return { reason: 'Requires 2+ selected nodes' };
      },
      run: () => runAction('group'),
    },
    {
      id: 'ungroup',
      labelKey: 'menu.object.ungroup',
      accelerator: a('g', true, true),
      kind: 'command',
      group: 'grouping',
      enabled: (ctx) => {
        if (ctx.selection.canUngroup) return true;
        return { reason: 'Select a group to ungroup' };
      },
      run: () => runAction('ungroup'),
    },
    {
      id: 'flipH',
      labelKey: 'menu.object.flipH',
      accelerator: a('h', true),
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('flipH'),
    },
    {
      id: 'flipV',
      labelKey: 'menu.object.flipV',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('flipV'),
    },
    {
      id: 'newAdjustmentLayer',
      labelKey: 'menu.object.newAdjustmentLayer',
      accelerator: a('a', true, true),
      kind: 'command',
      group: 'adjustment',
      workspaces: ['design', 'print', 'image'],
      run: () => runAction('newAdjustmentLayer'),
    },
    {
      id: 'createClippingMask',
      labelKey: 'menu.object.createClippingMask',
      accelerator: a('7', true),
      kind: 'command',
      group: 'mask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('createClippingMask'),
    },
    {
      id: 'releaseClippingMask',
      labelKey: 'menu.object.releaseClippingMask',
      accelerator: a('7', true, true),
      kind: 'command',
      group: 'mask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('releaseClippingMask'),
    },
    {
      id: 'batchBgRemove',
      labelKey: 'menu.object.batchBgRemove',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('batchBgRemove'),
    },
    {
      id: 'imageTrace',
      labelKey: 'menu.object.imageTrace',
      accelerator: a('t', true, true, true),
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('imageTrace'),
    },
    {
      id: 'toolCrop',
      labelKey: 'menu.object.cropImage',
      accelerator: a('c', true, true),
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'print', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('toolCrop'),
    },
    {
      id: 'extractPalette',
      labelKey: 'menu.object.extractPalette',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('extractPalette'),
    },
    {
      id: 'addAlphaMask',
      labelKey: 'menu.object.addAlphaMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addAlphaMask'),
    },
    {
      id: 'addClipMask',
      labelKey: 'menu.object.addClipMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addClipMask'),
    },
    {
      id: 'addLuminanceMask',
      labelKey: 'menu.object.addLuminanceMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addLuminanceMask'),
    },
    {
      id: 'removeMask',
      labelKey: 'menu.object.removeMask',
      kind: 'command',
      group: 'maskOps',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('removeMask'),
    },
    {
      id: 'toggleMask',
      labelKey: 'menu.object.toggleMask',
      kind: 'command',
      group: 'maskOps',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('toggleMask'),
    },
    {
      id: 'invertMask',
      labelKey: 'menu.object.invertMask',
      kind: 'command',
      group: 'maskOps',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('invertMask'),
    },
    {
      id: 'flattenSelection',
      labelKey: 'menu.object.flattenSelection',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('flattenSelection'),
    },
    {
      id: 'rasterizeSelection',
      labelKey: 'menu.object.rasterize',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('rasterizeSelection'),
    },
    {
      id: 'mergeSelected',
      labelKey: 'menu.object.mergeSelected',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('mergeSelected'),
    },
    {
      id: 'addClearSpaceGuides',
      labelKey: 'menu.object.addClearSpaceGuides',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('addClearSpaceGuides'),
    },
    {
      id: 'booleanUnion',
      labelKey: 'menu.object.booleanUnion',
      accelerator: a('u', true, true),
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanUnion'),
    },
    {
      id: 'booleanSubtract',
      labelKey: 'menu.object.booleanSubtract',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanSubtract'),
    },
    {
      id: 'booleanIntersect',
      labelKey: 'menu.object.booleanIntersect',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanIntersect'),
    },
    {
      id: 'booleanExclude',
      labelKey: 'menu.object.booleanExclude',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanExclude'),
    },
    {
      id: 'path',
      labelKey: 'menu.object.path',
      kind: 'submenu',
      group: 'path',
      items: getPathSubmenuItems(runAction),
      enabled: enabledWithSelection,
      run: () => {},
    },
    {
      id: 'audit',
      labelKey: 'menu.object.audit',
      kind: 'submenu',
      group: 'intelligence',
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.document.nodeCount >= 1) return true;
        return { reason: 'Document is empty' };
      },
      badge: (ctx) => {
        if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
        return undefined;
      },
      items: [
        {
          id: 'auditSelection',
          labelKey: 'Audit Selection',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select a layer to audit' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'auditPage',
          labelKey: 'Audit Page',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'Document is empty' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'auditDocument',
          labelKey: 'Audit Document',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'Document is empty' };
          },
          run: () => runAction('runAudit'),
        },
      ],
      run: () => {},
    },
    {
      id: 'scanDebt',
      labelKey: 'menu.object.scanDebt',
      kind: 'command',
      group: 'intelligence',
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.document.nodeCount >= 1) return true;
        return { reason: 'No layers to scan' };
      },
      badge: (ctx) => {
        if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
        return undefined;
      },
      run: () => runAction('scanDebt'),
    },
    {
      id: 'suggestNames',
      labelKey: 'menu.object.suggestNames',
      kind: 'command',
      group: 'intelligence',
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.selection.count >= 1) return true;
        return { reason: 'Select one or more layers' };
      },
      run: () => runAction('suggestNames'),
    },
    {
      id: 'detectDuplicates',
      labelKey: 'menu.object.detectDuplicates',
      kind: 'command',
      group: 'intelligence',
      label: (ctx) => {
        if (ctx.selection.count >= 1) return 'Detect Duplicates in Selection';
        return 'Detect Duplicates on Page';
      },
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.document.nodeCount >= 2) return true;
        return { reason: 'Need at least 2 layers to detect duplicates' };
      },
      run: () => runAction('detectDuplicates'),
    },
  ];
}

function getAlignSubmenuItems(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'alignLeft',
      labelKey: 'menu.arrange.alignLeft',
      accelerator: a('a', true, false, true),
      kind: 'command',
      group: 'align-h',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignLeft'),
    },
    {
      id: 'alignCenterH',
      labelKey: 'menu.arrange.alignCenterH',
      accelerator: a('c', true, false, true),
      kind: 'command',
      group: 'align-h',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignCenterH'),
    },
    {
      id: 'alignRight',
      labelKey: 'menu.arrange.alignRight',
      accelerator: a('d', true, false, true),
      kind: 'command',
      group: 'align-h',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignRight'),
    },
    {
      id: 'alignTop',
      labelKey: 'menu.arrange.alignTop',
      accelerator: a('w', true, false, true),
      kind: 'command',
      group: 'align-v',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignTop'),
    },
    {
      id: 'alignCenterV',
      labelKey: 'menu.arrange.alignCenterV',
      accelerator: a('e', true, false, true),
      kind: 'command',
      group: 'align-v',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignCenterV'),
    },
    {
      id: 'alignBottom',
      labelKey: 'menu.arrange.alignBottom',
      accelerator: a('x', true, false, true),
      kind: 'command',
      group: 'align-v',
      enabled: enabledWithMultiSelection,
      run: () => runAction('alignBottom'),
    },
    {
      id: 'distributeHorizontal',
      labelKey: 'menu.arrange.distributeH',
      accelerator: a('h', true, false, true),
      kind: 'command',
      group: 'distribute',
      enabled: enabledWithTripleSelection,
      run: () => runAction('distributeHorizontal'),
    },
    {
      id: 'distributeVertical',
      labelKey: 'menu.arrange.distributeV',
      accelerator: a('v', true, false, true),
      kind: 'command',
      group: 'distribute',
      enabled: enabledWithTripleSelection,
      run: () => runAction('distributeVertical'),
    },
    {
      id: 'tidySelected',
      labelKey: 'menu.arrange.tidyUp',
      kind: 'command',
      group: 'tidy',
      enabled: enabledWithMultiSelection,
      run: () => runAction('tidySelected'),
    },
  ];
}

function getPathSubmenuItems(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'expandStroke',
      labelKey: 'menu.object.expandStroke',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('expandStroke'),
    },
    {
      id: 'offsetPath',
      labelKey: 'menu.object.offsetPath',
      accelerator: a('o', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('offsetPath'),
    },
    {
      id: 'roundCorners',
      labelKey: 'menu.object.roundCorners',
      accelerator: a('c', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('roundCorners'),
    },
    {
      id: 'simplifyPath',
      labelKey: 'menu.object.simplifyPath',
      accelerator: a('w', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('simplifyPath'),
    },
    {
      id: 'mirrorDuplicateHorizontal',
      labelKey: 'menu.object.mirrorDuplicateHorizontal',
      accelerator: a('h', true, true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('mirrorDuplicateHorizontal'),
    },
    {
      id: 'mirrorDuplicateVertical',
      labelKey: 'menu.object.mirrorDuplicateVertical',
      accelerator: a('v', true, true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('mirrorDuplicateVertical'),
    },
    {
      id: 'radialDuplicate',
      labelKey: 'menu.object.radialDuplicate',
      accelerator: a('r', true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing', 'logo'],
      enabled: enabledWithSelection,
      run: () => runAction('radialDuplicate'),
    },
  ];
}

export function getArrangeMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'bringFront',
      labelKey: 'menu.arrange.bringFront',
      accelerator: a(']', true),
      kind: 'command',
      group: 'order',
      enabled: enabledWithSelection,
      run: () => runAction('bringFront'),
    },
    {
      id: 'bringForward',
      labelKey: 'menu.arrange.bringForward',
      accelerator: a(']', true, true),
      kind: 'command',
      group: 'order',
      enabled: enabledWithSelection,
      run: () => runAction('bringForward'),
    },
    {
      id: 'sendBackward',
      labelKey: 'menu.arrange.sendBackward',
      accelerator: a('[', true, true),
      kind: 'command',
      group: 'order',
      enabled: enabledWithSelection,
      run: () => runAction('sendBackward'),
    },
    {
      id: 'sendBack',
      labelKey: 'menu.arrange.sendBack',
      accelerator: a('[', true),
      kind: 'command',
      group: 'order',
      enabled: enabledWithSelection,
      run: () => runAction('sendBack'),
    },
    {
      id: 'align',
      labelKey: 'menu.arrange.align',
      kind: 'submenu',
      group: 'align-group',
      items: getAlignSubmenuItems(runAction),
      enabled: enabledWithMultiSelection,
      run: () => {},
    },
    {
      id: 'harmonizeSpacing',
      labelKey: 'menu.arrange.harmonizeSpacing',
      accelerator: a('h', true, true),
      kind: 'command',
      group: 'spacing',
      enabled: enabledWithSelection,
      run: () => runAction('harmonizeSpacing'),
    },
    {
      id: 'nudgeLeft',
      labelKey: 'menu.arrange.nudgeLeft',
      accelerator: a('ArrowLeft'),
      kind: 'command',
      group: 'nudge',
      enabled: enabledWithSelection,
      run: () => runAction('nudgeLeft'),
    },
    {
      id: 'nudgeRight',
      labelKey: 'menu.arrange.nudgeRight',
      accelerator: a('ArrowRight'),
      kind: 'command',
      group: 'nudge',
      enabled: enabledWithSelection,
      run: () => runAction('nudgeRight'),
    },
    {
      id: 'nudgeUp',
      labelKey: 'menu.arrange.nudgeUp',
      accelerator: a('ArrowUp'),
      kind: 'command',
      group: 'nudge',
      enabled: enabledWithSelection,
      run: () => runAction('nudgeUp'),
    },
    {
      id: 'nudgeDown',
      labelKey: 'menu.arrange.nudgeDown',
      accelerator: a('ArrowDown'),
      kind: 'command',
      group: 'nudge',
      enabled: enabledWithSelection,
      run: () => runAction('nudgeDown'),
    },
  ];
}

export function getPageMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'createMaster',
      labelKey: 'menu.page.createMaster',
      kind: 'command',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.currentPageIsMaster) {
          return { reason: 'This page is already a master.' };
        }
        return true;
      },
      run: () => runAction('createMaster'),
    },
    {
      id: 'applyMaster',
      labelKey: 'menu.page.applyMaster',
      kind: 'submenu',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.masterPages.length === 0) {
          return { reason: 'No master pages yet \u2014 create one first.' };
        }
        if (!ctx.document.activePageId) {
          return { reason: 'No active page selected.' };
        }
        return true;
      },
      items: (ctx) => {
        const masters = ctx.document.masterPages;
        const current = ctx.document.currentPageMaster;
        const activeId = ctx.document.activePageId;
        const items: MenuItemDef[] = [];

        const candidates = activeId ? masters.filter((m) => m.id !== activeId) : masters;

        for (const m of candidates) {
          items.push({
            id: `applyMaster:${m.id}`,
            labelKey: m.name,
            kind: 'radio',
            radioGroup: 'masterApply',
            checked: () => current?.id === m.id,
            run: () => runAction(`applyMaster:${m.id}`),
          });
        }

        if (candidates.length > 0) {
          items.push({
            id: 'applyMasterSep',
            labelKey: '---',
            kind: 'separator',
            group: 'master',
          });
        }

        items.push({
          id: 'applyMasterNone',
          labelKey: 'menu.page.applyMasterNone',
          kind: 'radio',
          radioGroup: 'masterApply',
          checked: () => current == null,
          run: () => runAction('applyMaster:'),
        });

        return items;
      },
      run: () => {},
    },
    {
      id: 'detachMaster',
      labelKey: 'menu.page.detachMaster',
      label: (ctx) => {
        const m = ctx.document.currentPageMaster;
        return m ? `Detach from '${m.name}'` : 'Detach from Master';
      },
      kind: 'command',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.currentPageMaster) return true;
        return { reason: 'This page has no master.' };
      },
      run: () => runAction('detachMaster'),
    },
  ];
}

export function getHelpMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'openHelp',
      labelKey: 'menu.help.contextualHelp',
      accelerator: a('F1'),
      kind: 'command',
      group: 'help',
      run: () => runAction('openHelp'),
    },
    {
      id: 'openHelpCenter',
      labelKey: 'menu.help.helpCenter',
      kind: 'command',
      group: 'help',
      run: () => runAction('openHelpCenter'),
    },
    {
      id: 'whatIsThis',
      labelKey: 'menu.help.whatIsThis',
      accelerator: a('F1', false, false, true),
      kind: 'command',
      group: 'help',
      run: () => runAction('whatIsThis'),
    },
    {
      id: 'startTour',
      labelKey: 'menu.help.startTour',
      kind: 'command',
      group: 'about',
      run: () => runAction('startTour'),
    },
    {
      id: 'about',
      labelKey: 'menu.help.about',
      kind: 'command',
      group: 'about',
      run: () => runAction('about'),
    },
    {
      id: 'installDesktopApp',
      labelKey: 'menu.help.installDesktopApp',
      kind: 'command',
      group: 'install',
      visible: (ctx) => {
        if (hasCapability(ctx, 'nativeMenu')) return false;
        try {
          if (
            typeof localStorage !== 'undefined' &&
            (localStorage.getItem('varve-install-desktop-dismissed') ??
              localStorage.getItem('strata-install-desktop-dismissed')) === 'true'
          )
            return false;
        } catch {
          return false;
        }
        try {
          if (typeof window !== 'undefined' && window.self !== window.top) return false;
        } catch {
          return false;
        }
        return true;
      },
      run: () => runAction('installDesktopApp'),
    },
  ];
}

export interface MenuDefsOptions {
  runAction: (id: string) => void;
  getTheme?: () => string;
}

function withCanonicalAccelerators(items: MenuItemDef[]): MenuItemDef[] {
  return items.map((item) => {
    const shortcut = SHORTCUT_DEFS[item.id as keyof typeof SHORTCUT_DEFS];
    const itemChildren = item.items;
    const nestedItems = Array.isArray(itemChildren)
      ? withCanonicalAccelerators(itemChildren)
      : typeof itemChildren === 'function'
        ? (ctx: MenuContext) => withCanonicalAccelerators(itemChildren(ctx))
        : undefined;

    return {
      ...item,
      ...(shortcut ? { accelerator: { ...shortcut.binding } } : {}),
      ...(nestedItems ? { items: nestedItems } : {}),
    };
  });
}

export function getAllMenuDefs(opts: MenuDefsOptions): MenuItemDef[] {
  return withCanonicalAccelerators([
    {
      id: 'file',
      labelKey: 'menu.file',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getFileMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'edit',
      labelKey: 'menu.edit',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getEditMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'text',
      labelKey: 'menu.text',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getTextMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'view',
      labelKey: 'menu.view',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getViewMenu(opts.runAction, { getTheme: opts.getTheme }),
      run: () => {},
    },
    {
      id: 'object',
      labelKey: 'menu.object',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getObjectMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'arrange',
      labelKey: 'menu.arrange',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getArrangeMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'page',
      labelKey: 'menu.page',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getPageMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'help',
      labelKey: 'menu.help',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getHelpMenu(opts.runAction),
      run: () => {},
    },
  ]);
}

export function getCanvasContextMenuDefs(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'ctx-cut',
      labelKey: 'menu.edit.cut',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('cut'),
    },
    {
      id: 'ctx-copy',
      labelKey: 'menu.edit.copy',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('copy'),
    },
    {
      id: 'ctx-paste',
      labelKey: 'menu.edit.paste',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      run: () => runAction('paste'),
    },
    {
      id: 'ctx-duplicate',
      labelKey: 'menu.edit.duplicate',
      kind: 'command',
      group: 'edit-op',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('duplicate'),
    },
    {
      id: 'ctx-delete',
      labelKey: 'menu.edit.delete',
      kind: 'command',
      group: 'edit-op',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('delete'),
    },
    {
      id: 'ctx-group',
      labelKey: 'menu.object.group',
      kind: 'command',
      group: 'grouping',
      contexts: ['canvas'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('group'),
    },
    {
      id: 'ctx-ungroup',
      labelKey: 'menu.object.ungroup',
      kind: 'command',
      group: 'grouping',
      contexts: ['canvas'],
      enabled: enabledWithSingleGroup,
      run: () => runAction('ungroup'),
    },
    {
      id: 'ctx-intel',
      labelKey: 'Intelligence',
      kind: 'submenu',
      group: 'intel',
      contexts: ['canvas'],
      enabled: (ctx) => {
        if (ctx.document.nodeCount >= 1) return true;
        return { reason: 'Document is empty' };
      },
      badge: (ctx) => {
        if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
        return undefined;
      },
      items: [
        {
          id: 'ctx-auditSelection',
          labelKey: 'Audit Selection',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select a layer to audit' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'ctx-scanDebt',
          labelKey: 'Scan for Debt',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'No layers to scan' };
          },
          badge: (ctx) => {
            if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
            return undefined;
          },
          run: () => runAction('scanDebt'),
        },
        {
          id: 'ctx-suggestNames',
          labelKey: 'Suggest Names',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select one or more layers' };
          },
          run: () => runAction('suggestNames'),
        },
        {
          id: 'ctx-detectDuplicates',
          labelKey: 'Detect Duplicates in Selection',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          label: (ctx) => {
            if (ctx.selection.count >= 1) return 'Detect Duplicates in Selection';
            return 'Detect Duplicates on Page';
          },
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 2) return true;
            return { reason: 'Need at least 2 layers to detect duplicates' };
          },
          run: () => runAction('detectDuplicates'),
        },
      ],
      run: () => {},
    },
    {
      id: 'ctx-selectAll',
      labelKey: 'menu.edit.selectAll',
      kind: 'command',
      group: 'selection',
      contexts: ['canvas'],
      run: () => runAction('selectAll'),
    },
  ];
}
