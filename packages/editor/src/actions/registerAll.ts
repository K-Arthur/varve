import { isTauriRuntime } from '@varve/platform';
import { type ContactChannelId, contactMailto } from '@varve/shared';
import { isCapabilityRestricted } from '../capabilities/restrictions';
import { registerColorConversionActions } from '../components/ColorConversion/colorConversionCommands';
import type { EditorContextValue } from '../context';
import { openMockupsWithSelection } from '../mockup/mockupActions';
import { SHORTCUT_DEFS } from '../shortcuts/ShortcutManager';
import { registerThumbnailActions } from '../thumbnail/thumbnailCommands';
import { type ActionCategory, getActionRegistry } from './ActionRegistry';
import { type ActionHandlerCallbacks, createActionHandlers } from './createActionHandlers';

/**
 * Commands that run on-device inference. A deployment that withholds it must
 * not list them in the command palette: the guards downstream make them safe,
 * but a searchable command that does nothing when chosen is its own defect.
 *
 * Declared after the imports: bundlers hoist imports above any statement that
 * precedes them, so a module-level const sitting above one is initialised only
 * after every import's side effects have run. This module sits in an import
 * cycle, so that ordering left a window where re-entry read the binding in its
 * temporal dead zone and the whole app failed to start.
 */
const INFERENCE_COMMANDS: ReadonlySet<string> = new Set(['batchBgRemove', 'upscaleImage']);

function categoryFromShortcut(cat: string): ActionCategory {
  const lc = cat.toLowerCase();
  if (lc === 'edit') return 'edit';
  if (lc === 'file') return 'file';
  if (lc === 'view') return 'view';
  if (lc === 'object') return 'object';
  if (lc === 'arrange') return 'arrange';
  if (lc === 'tools') return 'tools';
  if (lc === 'insert') return 'insert';
  return 'help';
}

/**
 * Open a public Varve contact without putting routing details in the shell.
 *
 * The URL carries only the channel's short static subject — never a document
 * name, path, version, or diagnostic string. Contact URLs are handed to the
 * OS mail client and to shell history; anything embedded here leaks.
 *
 * Desktop and web need different mechanisms. `window.open('mailto:...')` in a
 * Tauri webview is not a reliable external-protocol handler: WebKitGTK
 * commonly ignores it, so the menu item silently does nothing. The native
 * path therefore hands the URL to `tauri-plugin-opener`, whose default
 * permission set already allows the `mailto:` scheme. The browser fallback
 * assigns `location.href` rather than opening a tab, because a `mailto:`
 * navigation must not leave behind a blank window when no handler exists.
 */
export function openVarveContact(contact: ContactChannelId): void {
  const href = contactMailto(contact);

  if (isTauriRuntime()) {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      void Promise.resolve(invoke('plugin:opener|open_url', { url: href })).catch(() => {
        // No mail handler installed, or the user dismissed the chooser.
        // Not actionable, and not worth interrupting the editor for: the
        // address is also published in Settings > About and on the website.
      });
      return;
    }
  }

  try {
    window.location.href = href;
  } catch {
    /* No mail handler; the address is still discoverable in About. */
  }
}

export function registerAllShortcuts(exec: (id: string) => (() => void) | null): void {
  const r = getActionRegistry();
  for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
    if (!r.has(id)) {
      r.register(
        {
          id,
          label: def.label,
          category: categoryFromShortcut(def.category),
          shortcut: def.binding,
        },
        () => exec(id)?.(),
      );
    }
  }
}

export function registerEditorActions(
  ctx: EditorContextValue,
  callbacks?: ActionHandlerCallbacks,
): void {
  const r = getActionRegistry();
  const handlers = createActionHandlers(ctx, callbacks);

  // Thumbnail commands: source selection + picker entry point. Registered
  // BEFORE registerAllShortcuts() so real handlers win over no-op stubs.
  registerThumbnailActions(ctx);

  // Document color conversion dialog entry point (Assign vs Convert).
  registerColorConversionActions();

  const reg = (id: string, label: string, category: ActionCategory, handler: () => void) => {
    if (!r.has(id)) {
      r.register({ id, label, category }, handler);
    }
  };

  for (const [id, handler] of Object.entries(handlers)) {
    const def = SHORTCUT_DEFS[id as keyof typeof SHORTCUT_DEFS];
    if (def) {
      r.register(
        {
          id,
          label: def.label,
          category: categoryFromShortcut(def.category),
          shortcut: def.binding,
        },
        handler,
      );
    }
  }

  const menuActions = [
    ['new', 'New Document', 'file'],
    ['findReplace', 'Find and Replace', 'edit'],
    ['insertIcon', 'Insert Icon…', 'insert'],
    ['textBold', 'Bold', 'text'],
    ['textItalic', 'Italic', 'text'],
    ['textUnderline', 'Underline', 'text'],
    ['textIncreaseSize', 'Increase Text Size', 'text'],
    ['textDecreaseSize', 'Decrease Text Size', 'text'],
    ['textAlignLeft', 'Align Text Left', 'text'],
    ['textAlignCenter', 'Align Text Center', 'text'],
    ['textAlignRight', 'Align Text Right', 'text'],
    ['textAlignJustify', 'Justify Text', 'text'],
    ['textToOutlines', 'Convert Text to Outlines', 'text'],
    ['inspectMode', 'Toggle Inspect Mode', 'view'],
    ['rulerModeArtboard', 'Use Artboard Rulers', 'view'],
    ['rulerModeGlobal', 'Use Global Rulers', 'view'],
    ['toggleGuides', 'Toggle Guides', 'view'],
    ['toggleBleedGuides', 'Toggle Bleed Guides', 'view'],
    ['lockGuides', 'Lock Guides', 'view'],
    ['clearGuides', 'Clear Guides', 'view'],
    ['resetWorkspace', 'Reset Workspace', 'view'],
    ['resetAllWorkspaces', 'Reset All Workspaces', 'view'],
    ['customizeWorkspace', 'Customize Workspace', 'view'],
    ['batchBgRemove', 'Batch Background Removal', 'object'],
    ['extractPalette', 'Extract Color Palette', 'object'],
    ['auditSelection', 'Audit Selection', 'object'],
    ['auditPage', 'Audit Page', 'object'],
    ['auditDocument', 'Audit Document', 'object'],
    ['createTableFromClipboard', 'Create Table From Clipboard Data', 'insert'],
    ['exportTableCsv', 'Export Table as TSV', 'file'],
    ['whatIsThis', 'What Is This?', 'help'],
    ['startTour', 'Start Tour', 'help'],
    ['about', 'About Varve', 'help'],
    ['contactSupport', 'Contact Support', 'help'],
    ['sendFeedback', 'Send Feedback', 'help'],
    ['reportSecurity', 'Report a Security Issue', 'help'],
    ['openPrivacy', 'Privacy', 'help'],
    // No-shortcut File actions: menu-only, but must reach the registry so
    // menu clicks and keyboard paths share the same handler.
    ['saveCopy', 'Save a Copy…', 'file'],
    ['documentInfo', 'Document Info…', 'file'],
    ['revealInFiles', 'Reveal in Files', 'file'],
    ['copyFilePath', 'Copy File Path', 'file'],
  ] as const satisfies ReadonlyArray<readonly [string, string, ActionCategory]>;
  for (const [id, label, category] of menuActions) {
    if (INFERENCE_COMMANDS.has(id) && isCapabilityRestricted('inference')) continue;
    const handler = handlers[id];
    if (handler) reg(id, label, category, handler);
  }

  // toggleBleedGuides must NOT go through the guarded path: its handler
  // reads the current bleedGuidesVisible state, and a handler pinned to
  // the boot context would always compute `!false` (toggling to true, i.e.
  // never hiding the guides). Re-registering here on every state change
  // keeps the closure fresh, like the SHORTCUT_DEFS-bound actions.
  r.register(
    {
      id: 'toggleBleedGuides',
      label: 'Toggle Bleed Guides',
      category: 'view',
    },
    handlers.toggleBleedGuides ?? (() => {}),
  );

  if (!r.has('runAudit')) {
    r.register(
      {
        id: 'runAudit',
        label: 'Audit',
        category: 'object',
        keywords: ['contrast', 'wcag', 'a11y'],
      },
      handlers.runAudit ?? (() => {}),
    );
  }
  if (!r.has('scanDebt')) {
    r.register(
      {
        id: 'scanDebt',
        label: 'Scan for Debt',
        category: 'object',
        keywords: ['debt', 'issues', 'problems'],
      },
      handlers.scanDebt ?? (() => {}),
    );
  }
  if (!r.has('suggestNames')) {
    r.register(
      {
        id: 'suggestNames',
        label: 'Suggest Names',
        category: 'object',
        keywords: ['rename', 'naming', 'layers'],
      },
      handlers.suggestNames ?? (() => {}),
    );
  }
  if (!r.has('detectDuplicates')) {
    r.register(
      {
        id: 'detectDuplicates',
        label: 'Detect Duplicates',
        category: 'component',
        keywords: ['component', 'variant', 'duplicate'],
      },
      handlers.detectDuplicates ?? (() => {}),
    );
  }

  const panelActions = [
    ['openInspectorProperties', 'Open Properties', ['inspector', 'selection', 'properties']],
    ['openAppearancePanel', 'Open Appearance & Effects', ['effects', 'mask', 'paint', 'styles']],
    ['openAdjustmentsPanel', 'Open Adjustments', ['image', 'retouch', 'enhance', 'ai']],
    ['openPrototypePanel', 'Open Prototype', ['interaction', 'flow', 'trigger']],
    ['openFontsPanel', 'Open Fonts Panel', ['font', 'typography', 'typeface']],
    ['openDocumentPanel', 'Open Document Settings', ['canvas', 'color mode', 'document']],
    ['openExportPanel', 'Open Export', ['asset', 'png', 'svg', 'pdf']],
    ['openInspectPanel', 'Open Inspect', ['spec', 'handoff', 'measure', 'code']],
    ['openAuditPanel', 'Open Audit', ['accessibility', 'quality', 'score']],
  ] as const;
  for (const [id, label, keywords] of panelActions) {
    reg(id, label, 'panel', handlers[id] ?? (() => {}));
    const action = r.get(id);
    if (action) action.keywords = [...keywords];
  }

  reg('toggleLeftPanel', 'Toggle Layers Panel', 'panel', () => ctx.toggleLeftPanel());
  reg('toggleRightPanel', 'Toggle Inspector Panel', 'panel', () => ctx.toggleRightPanel());
  reg('toggleLibraryPanel', 'Toggle Library Panel', 'panel', () => ctx.toggleLibraryPanel());
  reg('toggleCodegenPanel', 'Toggle Codegen Panel', 'panel', () => ctx.toggleCodegenPanel());
  reg('toggleLogoPanel', 'Toggle Logo Panel', 'panel', () => ctx.toggleLogoPanel());
  reg('toggleTimelinePanel', 'Toggle Timeline Panel', 'panel', () => ctx.toggleTimelinePanel());
  reg('toggleHistoryPanel', 'Toggle History Panel', 'panel', () => ctx.toggleHistoryPanel());
  reg('restoreAllPanels', 'Show All Panels', 'panel', () => ctx.restoreAllPanels());
  reg('applyMockup', 'Apply Mockup…', 'object', () => {
    openMockupsWithSelection(ctx);
  });
  reg('openMockupsPanel', 'Open Mockups Panel', 'panel', () => {
    openMockupsWithSelection(ctx);
  });
  if (handlers.home) reg('home', 'Go to Home', 'file', handlers.home);
  reg('togglePixelGrid', 'Toggle Pixel Grid', 'canvas', () =>
    ctx.setPixelGridEnabled(!ctx.state.pixelGridEnabled),
  );
  reg('toggleGrid', 'Toggle Grid', 'canvas', () => {
    const dg = ctx.state.documentGrid;
    ctx.setDocumentGrid({ ...dg, visible: !dg.visible });
  });
  reg('enterFrame', 'Enter Frame', 'canvas', handlers.enterFrame ?? (() => {}));
  reg('editText', 'Edit Text', 'text', handlers.editText ?? (() => {}));
  if (!r.has('upscaleImage') && !isCapabilityRestricted('inference')) {
    r.register(
      {
        id: 'upscaleImage',
        label: 'Enhance Image…',
        category: 'object',
        keywords: [
          'enhance',
          'upscale',
          'image',
          'denoise',
          'restore',
          'enlarge',
          'ai',
          'super-resolution',
          'rescale',
        ],
      },
      handlers.upscaleImage ?? (() => {}),
    );
  }
  if (!r.has('imageTrace')) {
    r.register(
      {
        id: 'imageTrace',
        label: 'Vectorize Image',
        category: 'object',
        keywords: [
          'trace',
          'vectorize',
          'image trace',
          'raster to vector',
          'outline',
          'convert',
          'autotrace',
          'potrace',
          'centerline',
        ],
      },
      handlers.imageTrace ?? (() => {}),
    );
  }
  if (!r.has('attachTextToPath')) {
    r.register(
      {
        id: 'attachTextToPath',
        label: 'Text on Path',
        category: 'object',
        keywords: [
          'text on path',
          'type on path',
          'curved text',
          'text path',
          'textpath',
          'circular text',
          'attach text',
          'follow path',
        ],
      },
      handlers.attachTextToPath ?? (() => {}),
    );
  }
  if (!r.has('detachTextFromPath')) {
    r.register(
      {
        id: 'detachTextFromPath',
        label: 'Detach Text from Path',
        category: 'object',
        keywords: ['detach text', 'remove text from path', 'straighten text', 'unattach'],
      },
      handlers.detachTextFromPath ?? (() => {}),
    );
  }
  // Mask operations (reachable via Object menu and Layers context menu)
  const maskOps = [
    ['addAlphaMask', 'Add Alpha Mask', ['mask', 'alpha', 'transparency']],
    ['addClipMask', 'Add Clip Mask', ['mask', 'clip', 'vector']],
    ['addLuminanceMask', 'Add Luminance Mask', ['mask', 'luminance', 'brightness']],
    ['createMaskFromSelection', 'Create Mask from Selection', ['mask', 'selection', 'alpha']],
    ['loadMaskAsSelection', 'Load Mask as Selection', ['mask', 'selection', 'load']],
    ['removeMask', 'Remove Mask', ['mask', 'delete', 'clear']],
    ['toggleMask', 'Toggle Mask', ['mask', 'enable', 'disable']],
    ['invertMask', 'Invert Mask', ['mask', 'invert', 'reverse']],
  ] as const;
  for (const [id, label, keywords] of maskOps) {
    reg(id, label, 'object', handlers[id] ?? (() => {}));
    const action = r.get(id);
    if (action) action.keywords = [...keywords];
  }
  // Rasterize / Merge
  reg(
    'rasterizeSelection',
    'Rasterize Selection',
    'object',
    handlers.rasterizeSelection ?? (() => {}),
  );
  reg('mergeSelected', 'Merge Selected', 'object', handlers.mergeSelected ?? (() => {}));
  // Master page operations
  reg('createMaster', 'Create Master', 'object', handlers.createMaster ?? (() => {}));
  reg('applyMaster', 'Apply Master to Page', 'object', handlers.applyMaster ?? (() => {}));
  reg('detachMaster', 'Detach Master from Page', 'object', handlers.detachMaster ?? (() => {}));
  reg(
    'toggleFacingPages',
    'Toggle Facing Pages',
    'object',
    handlers.toggleFacingPages ?? (() => {}),
  );
  reg('nudgeUp', 'Nudge Up', 'object', handlers.nudgeUp ?? (() => {}));
  reg('nudgeDown', 'Nudge Down', 'object', handlers.nudgeDown ?? (() => {}));
  reg('nudgeLeft', 'Nudge Left', 'object', handlers.nudgeLeft ?? (() => {}));
  reg('nudgeRight', 'Nudge Right', 'object', handlers.nudgeRight ?? (() => {}));
  reg('tidySelected', 'Tidy Up', 'arrange', handlers.tidySelected ?? (() => {}));
}
