/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menubar } from './components/Menubar';

let mockWorkspaceMode = 'design';
let mockLogoPanelVisible = false;

vi.mock('./context', () => ({
  useEditor: () => ({
    state: {
      canUndo: false,
      canRedo: false,
      undoLabel: 'Undo',
      redoLabel: 'Redo',
      document: { name: 'Test Doc', activePageId: null, nodes: {}, rootChildren: [] },
      zoom: 1,
      canvasMode: 'full',
      snapEnabled: true,
      softProofEnabled: false,
      tool: 'select',
      selection: [],
      workspaceMode: mockWorkspaceMode,
      logoPanelVisible: mockLogoPanelVisible,
      colorBlindnessView: 'none',
      rulerMode: 'global',
      timelinePanelVisible: false,
      graphEditorVisible: false,
      stateMachinePanelVisible: false,
      guidesVisible: true,
      distractionFreeMode: false,
      beforeAfterCompare: false,
      documentGrid: {
        visible: false,
        spacingX: 8,
        spacingY: 8,
        subdivisions: 4,
        offsetX: 0,
        offsetY: 0,
        color: 'var(--color-border-subtle)',
        opacity: 0.4,
      },
    },
    newDocument: vi.fn(),
    serializeDocument: () => '{}',
    loadDocument: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    removeSelected: vi.fn(),
    cutSelected: vi.fn(),
    copySelected: vi.fn(),
    paste: vi.fn(),
    duplicateSelected: vi.fn(),
    rootNodes: () => [],
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    setTool: vi.fn(),
    setCamera: vi.fn(),
    setZoom: vi.fn(),
    setShowExportDialog: vi.fn(),
    groupSelected: vi.fn(),
    ungroupSelected: vi.fn(),
    arrangeSelected: vi.fn(),
    setSnapEnabled: vi.fn(),
    setSoftProofEnabled: vi.fn(),
    toggleTimelinePanel: vi.fn(),
    textBold: vi.fn(),
    textItalic: vi.fn(),
    textUnderline: vi.fn(),
    textIncreaseSize: vi.fn(),
    textDecreaseSize: vi.fn(),
    textAlignLeft: vi.fn(),
    textAlignCenter: vi.fn(),
    textAlignRight: vi.fn(),
    textAlignJustify: vi.fn(),
    textToOutlines: vi.fn(),
    findReplace: vi.fn(),
    setCanvasMode: vi.fn(),
    setRulerMode: vi.fn(),
    setGridOverlayMode: vi.fn(),
    fitActivePage: vi.fn(),
    fitActiveFrame: vi.fn(),
    resetViewRotation: vi.fn(),
    rotateViewBy: vi.fn(),
    booleanOp: vi.fn(),
    startPresentation: vi.fn(),
    clearAllGuides: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    showArchiveDialog: false,
    archiveDialogMode: 'backup' as const,
    setShowArchiveDialog: vi.fn(),
    recordAction: vi.fn(),
    addMaskToSelected: vi.fn(),
    removeMaskFromSelected: vi.fn(),
    toggleMask: vi.fn(),
    invertMask: vi.fn(),
    flattenSelected: vi.fn(),
    rasterizeSelected: vi.fn(),
    mergeSelected: vi.fn(),
    createAdjustmentLayer: vi.fn(),
    assignMasterToPage: vi.fn(),
    createMaster: vi.fn(),
    toggleFacingPages: vi.fn(),
    requestWorkspaceSwitch: vi.fn(),
    toggleDistractionFreeMode: vi.fn(),
  }),
}));

vi.mock('./shortcuts', () => {
  const shortcutDefs = {
    save: { binding: { key: 's', ctrl: true }, label: 'Save' },
    newDocument: { binding: { key: 'n', ctrl: true }, label: 'New' },
    open: { binding: { key: 'o', ctrl: true }, label: 'Open' },
    saveAs: { binding: { key: 's', ctrl: true, shift: true }, label: 'Save As' },
    exportSvg: { binding: { key: 'e', ctrl: true }, label: 'Export SVG' },
    export: { binding: { key: 'e', ctrl: true, shift: true }, label: 'Export' },
    settings: { binding: { key: ',', ctrl: true }, label: 'Settings' },
    undo: { binding: { key: 'z', ctrl: true }, label: 'Undo' },
    redo: { binding: { key: 'z', ctrl: true, shift: true }, label: 'Redo' },
    shortcutPalette: { binding: { key: 'k', ctrl: true }, label: 'Shortcuts' },
    toggleSnap: { binding: { key: ',', ctrl: false }, label: 'Snap' },
    toggleGuidesVisible: { binding: { key: ';', ctrl: true }, label: 'Show/Hide Guides' },
    lockAllGuides: {
      binding: { key: ';', ctrl: true, alt: true },
      label: 'Lock/Unlock All Guides',
    },
    softProof: { binding: { key: 'y', ctrl: true, shift: true }, label: 'Soft Proof' },
    toggleTimelinePanel: { binding: { key: 't', ctrl: true, alt: true }, label: 'Timeline' },
    canvasModeOutline: { binding: { key: 'o', ctrl: true, shift: true }, label: 'Outline' },
    canvasModePreview: { binding: { key: 'p', ctrl: true, shift: true }, label: 'Preview' },
    fitActivePage: { binding: { key: '1', shift: true }, label: 'Fit Page' },
    fitActiveFrame: { binding: { key: '2', shift: true }, label: 'Fit Frame' },
    resetViewRotation: { binding: { key: '0', ctrl: true }, label: 'Reset Rotation' },
    rotateViewCW: { binding: { key: ']', ctrl: true }, label: 'Rotate CW' },
    rotateViewCCW: { binding: { key: '[', ctrl: true }, label: 'Rotate CCW' },
    toggleGrid: { binding: { key: 'g', alt: true, shift: true }, label: 'Grid' },
    gridOverlayBaseline: { binding: { key: 'b', ctrl: true }, label: 'Baseline Grid' },
    gridOverlayIsometric: { binding: { key: 'i', ctrl: true }, label: 'Iso Grid' },
    home: { binding: { key: 'h', ctrl: true, shift: true }, label: 'Home' },
    cut: { binding: { key: 'x', ctrl: true }, label: 'Cut' },
    copy: { binding: { key: 'c', ctrl: true }, label: 'Copy' },
    paste: { binding: { key: 'v', ctrl: true }, label: 'Paste' },
    duplicate: { binding: { key: 'd', ctrl: true }, label: 'Duplicate' },
    selectAll: { binding: { key: 'a', ctrl: true }, label: 'Select All' },
    group: { binding: { key: 'g', ctrl: true }, label: 'Group' },
    ungroup: { binding: { key: 'g', ctrl: true, shift: true }, label: 'Ungroup' },
    booleanUnion: { binding: { key: 'u', ctrl: true, alt: true }, label: 'Union' },
    booleanSubtract: { binding: { key: 's', ctrl: true, alt: true }, label: 'Subtract' },
    booleanIntersect: { binding: { key: 'i', ctrl: true, alt: true }, label: 'Intersect' },
    booleanExclude: { binding: { key: 'x', ctrl: true, alt: true }, label: 'Exclude' },
    bringFront: { binding: { key: ']', ctrl: true, shift: true }, label: 'Front' },
    bringForward: { binding: { key: ']', ctrl: true }, label: 'Forward' },
    sendBackward: { binding: { key: '[', ctrl: true }, label: 'Backward' },
    sendBack: { binding: { key: '[', ctrl: true, shift: true }, label: 'Back' },
    zoomReset: { binding: { key: '0', ctrl: true }, label: 'Zoom 100' },
    toolInspect: { binding: { key: 'i', ctrl: true, shift: true }, label: 'Inspect' },
    toggleDistractionFree: {
      binding: { key: 'f', ctrl: true, shift: true },
      label: 'Distraction-Free Mode',
    },
    toggleBeforeAfterCompare: {
      binding: { key: '\\' },
      label: 'Compare Before/After',
    },
    colorBlindnessNone: {
      binding: { key: '0', ctrl: true, alt: true },
      label: 'Color Blindness: None',
    },
    colorBlindnessProtanopia: {
      binding: { key: 'p', ctrl: true, alt: true },
      label: 'Color Blindness: Protanopia',
    },
    colorBlindnessDeuteranopia: {
      binding: { key: 'd', ctrl: true, alt: true },
      label: 'Color Blindness: Deuteranopia',
    },
    colorBlindnessTritanopia: {
      binding: { key: 't', ctrl: true, alt: true },
      label: 'Color Blindness: Tritanopia',
    },
    harmonizeSpacing: {
      binding: { key: ' ', ctrl: true, shift: true },
      label: 'Harmonize Spacing',
    },
    toggleGraphEditor: {
      binding: { key: 'g', ctrl: true, alt: true },
      label: 'Graph Editor',
    },
    toggleStateMachinePanel: {
      binding: { key: 'k', ctrl: true, alt: true },
      label: 'State Machine Panel',
    },
    flattenSelection: {
      binding: { key: 'f', ctrl: true, shift: true },
      label: 'Flatten Selection',
    },
    newAdjustmentLayer: {
      binding: { key: 'n', alt: true },
      label: 'New Adjustment Layer',
    },
    createClippingMask: {
      binding: { key: 'm', ctrl: true },
      label: 'Create Clipping Mask',
    },
    releaseClippingMask: {
      binding: { key: 'm', ctrl: true, shift: true },
      label: 'Release Clipping Mask',
    },
    toolCrop: {
      binding: { key: 'c' },
      label: 'Crop tool',
    },
    archiveBackup: {
      binding: { key: 'n', ctrl: true, shift: true },
      label: 'Backup Archive',
    },
    archiveRestore: {
      binding: { key: 'l', ctrl: true, shift: true },
      label: 'Restore Archive',
    },
    import: { binding: { key: 'i', ctrl: true }, label: 'Import' },
    present: { binding: { key: 'p', ctrl: true, shift: true }, label: 'Present' },
    delete: { binding: { key: 'Backspace' }, label: 'Delete' },
    openHelp: { binding: { key: 'F1' }, label: 'Contextual Help' },
    openFontsPanel: { binding: { key: 'f', ctrl: true, alt: true }, label: 'Open Fonts Panel' },
    openHelpCenter: { binding: { key: 'F1', ctrl: true, shift: true }, label: 'Help Center' },
    repeatDuplicate: { binding: { key: 'd', ctrl: true, shift: true }, label: 'Repeat Duplicate' },
    selectionHistoryBack: {
      binding: { key: 'ArrowLeft', alt: true },
      label: 'Selection History Back',
    },
    selectionHistoryForward: {
      binding: { key: 'ArrowRight', alt: true },
      label: 'Selection History Forward',
    },
    flipH: { binding: { key: 'h', shift: true }, label: 'Flip Horizontal' },
    flipV: { binding: { key: 'v', shift: true }, label: 'Flip Vertical' },
    canvasModeFull: {
      binding: { key: 'Escape', ctrl: true, shift: true },
      label: 'Full Render Mode',
    },
    zoomIn: { binding: { key: '=', ctrl: true }, label: 'Zoom In' },
    zoomOut: { binding: { key: '-', ctrl: true }, label: 'Zoom Out' },
    alignLeft: { binding: { key: 'ArrowLeft', ctrl: true, shift: true }, label: 'Align left' },
    alignCenterH: {
      binding: { key: 'Home', ctrl: true, shift: true },
      label: 'Align horizontal center',
    },
    alignRight: { binding: { key: 'ArrowRight', ctrl: true, shift: true }, label: 'Align right' },
    alignTop: { binding: { key: 'ArrowUp', ctrl: true, shift: true }, label: 'Align top' },
    alignCenterV: {
      binding: { key: 'PageUp', ctrl: true, shift: true },
      label: 'Align vertical center',
    },
    alignBottom: { binding: { key: 'ArrowDown', ctrl: true, shift: true }, label: 'Align bottom' },
    distributeHorizontal: {
      binding: { key: 'h', ctrl: true, alt: true },
      label: 'Distribute horizontally',
    },
    distributeVertical: {
      binding: { key: 'v', ctrl: true, alt: true },
      label: 'Distribute vertically',
    },
    nudgeLeft: { binding: { key: 'ArrowLeft' }, label: 'Nudge Left' },
    nudgeRight: { binding: { key: 'ArrowRight' }, label: 'Nudge Right' },
    nudgeUp: { binding: { key: 'ArrowUp' }, label: 'Nudge Up' },
    nudgeDown: { binding: { key: 'ArrowDown' }, label: 'Nudge Down' },
  };
  // Any def the menu references but this mock does not spell out resolves
  // to a synthetic binding (the agent menu system grows new commands that
  // this harness should not need to chase).
  return {
    formatShortcut: () => 'Ctrl+S',
    getEffectiveBinding: (id: string) => {
      const defs: Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }> =
        {
          import: { key: 'i', ctrl: true },
          present: { key: 'p', ctrl: true, shift: true },
          delete: { key: 'Backspace' },
          toggleGrid: { key: 'g', ctrl: true, shift: true },
          openHelp: { key: 'F1' },
          openHelpCenter: { key: 'F1', ctrl: true, shift: true },
        };
      return defs[id] ?? { key: '' };
    },
    SHORTCUT_DEFS: new Proxy(shortcutDefs, {
      get: (target, prop) =>
        Reflect.get(target, prop) ?? {
          binding: { key: String(prop), ctrl: true },
          label: String(prop),
        },
    }),
  };
});

vi.mock('@varve/codegen', () => ({
  exportDocumentToSvg: () => '<svg/>',
}));

afterEach(() => {
  cleanup();
});

describe('Menubar dropdown portal', () => {
  it('renders open menu in document.body via FloatingPortal', async () => {
    const user = userEvent.setup();
    render(<Menubar />);

    const menubar = screen.getByRole('menubar');
    await user.click(within(menubar).getByRole('menuitem', { name: 'File' }));

    const menuPanel = document.body.querySelector('.editor-menubar__menu');
    expect(menuPanel).toBeTruthy();
    expect(menuPanel?.parentElement).toBe(document.body);
    expect(
      // jsdom 30 computes the label+shortcut spans as inline (no CSS in
      // tests), so dom-accessibility-api concatenates "SaveCtrl+S" without a
      // space; the real browser (CSS loaded) exposes "Save Ctrl+S".
      within(menuPanel as HTMLElement).getByRole('menuitem', { name: /Save\s*Ctrl/ }),
    ).toBeTruthy();
  });

  it('uses position fixed on the portaled menu wrapper', async () => {
    const user = userEvent.setup();
    render(<Menubar />);

    const menubar = screen.getByRole('menubar');
    await user.click(within(menubar).getByRole('menuitem', { name: 'View' }));

    const menuPanel = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    expect(menuPanel).toBeTruthy();
    expect(menuPanel.style.position).toBe('fixed');
  });
});

describe('Menubar menu structure', () => {
  it('keeps Edit with Undo and Redo reachable in non-macOS Tauri windows', async () => {
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {},
    });
    try {
      const user = userEvent.setup();
      render(<Menubar />);
      const edit = within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Edit' });
      await user.click(edit);
      const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
      expect(within(menu).getByRole('menuitem', { name: /Undo/ })).toBeTruthy();
      expect(within(menu).getByRole('menuitem', { name: /Redo/ })).toBeTruthy();
    } finally {
      Reflect.deleteProperty(window, '__TAURI__');
    }
  });

  it('renders all top-level menus', () => {
    render(<Menubar />);
    const menubar = screen.getByRole('menubar');
    for (const name of ['File', 'Edit', 'View', 'Object', 'Arrange', 'Page', 'Help']) {
      expect(within(menubar).getByRole('menuitem', { name })).toBeTruthy();
    }
  });

  it('File menu contains New, Open, Save, Import, Export, Settings', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'File' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const items = within(menu).getAllByRole('menuitem');
    const labels = items.map((el) => el.textContent ?? '');
    expect(labels.some((t) => t.startsWith('New'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Open'))).toBe(true);
    expect(labels.some((t) => t === 'Save' || t.startsWith('Save'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Import'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Export'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Settings'))).toBe(true);
  });

  it('View menu shows the Logo Panel toggle only in the Logo workspace', async () => {
    const user = userEvent.setup();
    const viewMenuItems = async (): Promise<string[]> => {
      render(<Menubar />);
      await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'View' }));
      // The logo toggle renders as menuitemcheckbox; match all item roles.
      const menu = await screen.findByRole('menu');
      const labels = within(menu)
        .getAllByRole('menuitem')
        .concat(within(menu).queryAllByRole('menuitemcheckbox'))
        .concat(within(menu).queryAllByRole('menuitemradio'))
        .map((el) => el.textContent ?? '');
      cleanup();
      return labels;
    };

    try {
      mockWorkspaceMode = 'design';
      mockLogoPanelVisible = false;
      const designLabels = await viewMenuItems();
      expect(designLabels.some((t) => t.includes('Logo Panel'))).toBe(false);

      mockWorkspaceMode = 'logo';
      mockLogoPanelVisible = true;
      const logoLabels = await viewMenuItems();
      const item = logoLabels.find((t) => t.includes('Logo Panel'));
      expect(item).toBeTruthy();
    } finally {
      // Restore defaults for subsequent tests even on assertion failure.
      mockWorkspaceMode = 'design';
      mockLogoPanelVisible = false;
    }
  });

  it('Edit menu contains Undo, Redo, Cut, Copy, Paste, Duplicate, Delete', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Edit' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    expect(within(menu).getByRole('menuitem', { name: /Undo/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Redo/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Cut/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Copy/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Paste/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /^Duplicate/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Delete/ })).toBeTruthy();
  });

  it('Object menu contains Group, Ungroup, Boolean ops, Masks, Adjustments', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Object' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    expect(within(menu).getByRole('menuitem', { name: /Group/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Ungroup/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Union/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Subtract/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Intersect/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Exclude/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Add Alpha Mask/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /New Adjustment Layer/ })).toBeTruthy();
  });

  it('Help menu contains Contextual Help, Help Center, About', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Help' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    expect(within(menu).getByRole('menuitem', { name: /Contextual Help/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Help Center/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /About Varve/ })).toBeTruthy();
  });
});

describe('Menubar shortcut display', () => {
  it('no hardcoded Mac symbols on non-Mac platforms', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    // Open File menu
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'File' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    // Import should use formatShortcut, not hardcoded '⌘I'
    const importItem = within(menu).getByRole('menuitem', { name: /Import/ });
    const shortcut = importItem.querySelector('.editor-menubar__menu-shortcut');
    expect(shortcut?.textContent).not.toContain('\u2318'); // No Cmd symbol
    expect(shortcut?.textContent).not.toContain('\u21E7'); // No Shift symbol
  });

  it('all menu items show shortcut text from formatShortcut', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Edit' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    // All our shortcuts render as 'Ctrl+S' since formatShortcut mock returns that
    const shortcutElements = menu.querySelectorAll('.editor-menubar__menu-shortcut');
    expect(shortcutElements.length).toBeGreaterThan(0);
  });
});

describe('Menubar disabled states', () => {
  it('disables selection-dependent items when no selection', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Object' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    // Group requires 2+ selected
    const groupItem = within(menu).getByRole('menuitem', { name: /Group/ });
    expect(groupItem).toBeDisabled();
  });

  it('disables arrange items when no selection', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(
      within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Arrange' }),
    );
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const bringFront = within(menu).getByRole('menuitem', { name: /Bring to Front/ });
    expect(bringFront).toBeDisabled();
  });
});

describe('Menubar ARIA attributes', () => {
  it('workspace items have menuitemradio role', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'View' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const designItem = within(menu).getByRole('menuitemradio', { name: /Workspace: Design/ });
    expect(designItem).toBeTruthy();
    expect(designItem).toHaveAttribute('aria-checked', 'true');
    expect(designItem).not.toBeDisabled();
  });

  it('theme items have menuitemradio role', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'View' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const lightItem = within(menu).getByRole('menuitemradio', { name: 'Light' });
    expect(lightItem).toBeTruthy();
  });

  it('canvas mode items have menuitemcheckbox role', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'View' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const outlineItem = within(menu).getByRole('menuitemcheckbox', { name: /Outline Mode/ });
    expect(outlineItem).toBeTruthy();
  });

  it('menu items have aria-keyshortcuts', async () => {
    const user = userEvent.setup();
    render(<Menubar />);
    await user.click(within(screen.getByRole('menubar')).getByRole('menuitem', { name: 'Edit' }));
    const menu = document.body.querySelector('.editor-menubar__menu') as HTMLElement;
    const undoItem = within(menu).getByRole('menuitem', { name: /Undo/ });
    expect(undoItem).toHaveAttribute('aria-keyshortcuts');
  });
});

describe('Menubar workspace switcher', () => {
  it('renders workspace radio buttons', () => {
    render(<Menubar />);
    const workspaceGroup = screen.getByRole('radiogroup', { name: 'Workspace' });
    expect(workspaceGroup).toBeTruthy();
    expect(within(workspaceGroup).getByRole('radio', { name: /Design/ })).toBeTruthy();
    expect(within(workspaceGroup).getByRole('radio', { name: /Print/ })).toBeTruthy();
    expect(within(workspaceGroup).getByRole('radio', { name: /Draw/ })).toBeTruthy();
    expect(within(workspaceGroup).getByRole('radio', { name: /Photo/ })).toBeTruthy();
    expect(within(workspaceGroup).getByRole('radio', { name: /Motion/ })).toBeTruthy();
  });

  it('marks default workspace as checked', () => {
    render(<Menubar />);
    const designRadio = screen.getByRole('radio', { name: /Design/ });
    expect(designRadio).toHaveAttribute('aria-checked', 'true');
  });
});
