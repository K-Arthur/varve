/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menubar } from './Menubar';

vi.mock('./context', () => ({
  useEditor: () => ({
    state: {
      document: { name: 'Test Doc' },
      zoom: 1,
      canvasMode: 'full',
      snapEnabled: true,
      softProofEnabled: false,
      tool: 'select',
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
  }),
}));

vi.mock('./shortcuts', () => ({
  formatShortcut: () => 'Ctrl+S',
  SHORTCUT_DEFS: {
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
  },
}));

vi.mock('@strata/codegen', () => ({
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
      within(menuPanel as HTMLElement).getByRole('menuitem', { name: /Save Ctrl/ }),
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
