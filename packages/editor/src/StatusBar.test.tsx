// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';
import {
  resetWorkspacePreferenceCache,
  setStatusSectionOverride,
  updateWorkspacePreferences,
} from './workspace/workspaceStore';

vi.setConfig({ testTimeout: 30000 });

const useEditorMock = vi.fn();

vi.mock('./context', () => ({
  useEditor: () => useEditorMock(),
}));

vi.mock('./components/Shell', () => ({ DocumentInfoDialog: () => null }));
vi.mock('./components/AuditBadge', () => ({ AuditBadge: () => null }));
vi.mock('./components/DebtBadge', () => ({ DebtBadge: () => null }));
vi.mock('./components/PreflightWarnings', () => ({ PreflightWarnings: () => null }));
vi.mock('./components/StatusBar/LayoutScoreIndicator', () => ({
  LayoutScoreIndicator: () => null,
}));
vi.mock('./components/StatusBar/SaveStatusIndicator', () => ({
  SaveStatusIndicator: () => null,
}));
vi.mock('./intelligence/ShortcutTipChip', () => ({ ShortcutTipChip: () => null }));
vi.mock('./intelligence/useShortcutTips', () => ({
  useShortcutTips: () => ({ currentTip: null, dismiss: () => {} }),
}));

function page(id: string, name: string) {
  return {
    id,
    name,
    width: 800,
    height: 600,
    order: '0',
    backgrounds: [],
    contentRoot: 'g1',
  };
}

const imageShapeNode = {
  kind: 'shape',
  name: 'photo',
  id: 'n1',
  fills: [
    {
      type: 'image',
      image: { src: 'data:image/png;base64,x', imageWidth: 1920, imageHeight: 1080 },
    },
  ],
};

const namedShapeNode = { kind: 'shape', name: 'Hero Card', id: 'n2' };

function baseEditor() {
  return {
    state: {
      tool: 'select',
      workspaceMode: 'design',
      cursorPos: { x: 12.3, y: 45.6 },
      zoom: 1,
      unitType: 'px',
      pixelGridEnabled: false,
      snapEnabled: true,
      snapGrid: 10,
      rulerMode: 'global',
      gridOverlayMode: 'none',
      cameraRotation: 0,
      currentPageId: 'p1',
      document: {
        nodes: {},
        rootChildren: [],
        pages: [page('p1', 'Cover')],
        colorConfig: { mode: 'cmyk', bitDepth: 'uint16' },
      },
    },
    selectedNodes: () => [],
    rootNodes: () => [],
    revealSelection: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitAll: vi.fn(),
    fitActivePage: vi.fn(),
    resetViewRotation: vi.fn(),
    setZoom: vi.fn(),
    setUnitType: vi.fn(),
    setPixelGridEnabled: vi.fn(),
    setSnapEnabled: vi.fn(),
    setSnapGrid: vi.fn(),
    setRulerMode: vi.fn(),
    setGridOverlayMode: vi.fn(),
    clearAllGuides: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  useEditorMock.mockReset();
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

describe('StatusBar section gating', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('hides a status section the workspace config declares hidden', () => {
    useEditorMock.mockReturnValue(baseEditor());
    render(<StatusBar />);
    expect(screen.getByText(/X: 12 Y: 46/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();

    // Customize the design workspace to hide the cursor position section.
    // The store notifies subscribers synchronously, so the already-rendered
    // status bar updates in place — no second render needed.
    act(() => {
      updateWorkspacePreferences((prefs) =>
        setStatusSectionOverride(prefs, 'design', 'cursorPos', false),
      );
    });
    expect(screen.queryByText(/X: 12 Y: 46/)).toBeNull();
    // Other sections remain visible.
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
  });

  it('shows page info in print mode', () => {
    const editor = baseEditor();
    editor.state.workspaceMode = 'print';
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.getByText('Page 1 of 1 · Cover')).toBeTruthy();
  });

  it('shows the document color mode when the section is visible', () => {
    const editor = baseEditor();
    editor.state.workspaceMode = 'print';
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.getByText(/CMYK · uint16/)).toBeTruthy();
  });

  it('shows natural pixel dimensions for a selected raster node in image mode', () => {
    const editor = baseEditor();
    editor.state.workspaceMode = 'image';
    editor.selectedNodes = (() => [imageShapeNode]) as unknown as typeof editor.selectedNodes;
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.getByText('1920 \u00d7 1080 px')).toBeTruthy();
  });

  it('omits the image info section when no raster node is selected', () => {
    const editor = baseEditor();
    editor.state.workspaceMode = 'image';
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.queryByText('1920 \u00d7 1080 px')).toBeNull();
  });

  it('gates the zoom controls, units select, and selection info by section ids', () => {
    const editor = baseEditor();
    editor.selectedNodes = (() => [namedShapeNode]) as unknown as typeof editor.selectedNodes;
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Units/ })).toBeTruthy();
    expect(screen.getByText('Hero Card')).toBeTruthy();

    act(() => {
      updateWorkspacePreferences((prefs) => {
        let next = setStatusSectionOverride(prefs, 'design', 'zoom', false);
        next = setStatusSectionOverride(next, 'design', 'unit', false);
        next = setStatusSectionOverride(next, 'design', 'selectionInfo', false);
        return next;
      });
    });
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Units/ })).toBeNull();
    expect(screen.queryByText('Hero Card')).toBeNull();
  });
});
