// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishCursorWorldPosition } from './canvas/cursorPosition';
import { setCompositorDiagnostics } from './render/compositorDiagnosticsStore';
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
vi.mock('./components/PreflightWarnings', () => ({ PreflightWarnings: () => null }));
vi.mock('./components/StatusBar/DocumentHealthBadge', () => ({
  DocumentHealthBadge: () => null,
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
      zoom: 1,
      unitType: 'px',
      activeId: 's1',
      sessions: [{ id: 's1', name: 'Poster.varve', dirty: false }],
      saveState: 'saved',
      dirty: false,
      lastSavedAt: null,
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
  publishCursorWorldPosition(null);
  useEditorMock.mockReset();
  localStorage.clear();
  resetWorkspacePreferenceCache();
  setCompositorDiagnostics(null);
});

describe('StatusBar section gating', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('hides a status section the workspace config declares hidden', () => {
    useEditorMock.mockReturnValue(baseEditor());
    publishCursorWorldPosition({ x: 12.3, y: 45.6 });
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

  it('follows the live cursor without re-rendering the status bar', () => {
    useEditorMock.mockReturnValue(baseEditor());
    render(<StatusBar />);
    const rendersBefore = useEditorMock.mock.calls.length;
    const readout = document.querySelector('.editor-status__cursor') as HTMLElement;
    expect(readout.style.display).toBe('none');

    act(() => publishCursorWorldPosition({ x: 99.6, y: -3.2 }));
    expect(readout).toHaveTextContent('X: 100 Y: -3');
    expect(readout.style.display).toBe('');
    // The readout writes its own text; the status bar itself did not render.
    expect(useEditorMock.mock.calls.length).toBe(rendersBefore);

    act(() => publishCursorWorldPosition(null));
    expect(readout.style.display).toBe('none');
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

  it('gates the zoom controls, units select, and document health by section ids', () => {
    const editor = baseEditor();
    editor.selectedNodes = (() => [namedShapeNode]) as unknown as typeof editor.selectedNodes;
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Units/ })).toBeTruthy();
    expect(screen.queryByText('Hero Card')).toBeNull();

    act(() => {
      updateWorkspacePreferences((prefs) => {
        let next = setStatusSectionOverride(prefs, 'design', 'zoom', false);
        next = setStatusSectionOverride(next, 'design', 'unit', false);
        next = setStatusSectionOverride(next, 'design', 'viewToggles', false);
        return next;
      });
    });
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Units/ })).toBeNull();
    expect(screen.queryByLabelText('Toggle pixel grid')).toBeNull();
  });

  it('leaves selection identity to SelectionInfoBar rather than repeating it', () => {
    // The status bar used to render the selected node's name (or "N selected")
    // two rows below the SelectionInfoBar, from a different layer count. One
    // surface owns the fact now.
    const editor = baseEditor();
    editor.selectedNodes = (() => [namedShapeNode]) as unknown as typeof editor.selectedNodes;
    useEditorMock.mockReturnValue(editor);
    render(<StatusBar />);
    expect(screen.queryByText('Hero Card')).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('renders sections in the order the workspace declares them', () => {
    const editor = baseEditor();
    useEditorMock.mockReturnValue(editor);
    publishCursorWorldPosition({ x: 12.3, y: 45.6 });
    render(<StatusBar />);
    const bar = document.querySelector('.editor-status') as HTMLElement;
    const index = (text: string) =>
      Array.from(bar.children).findIndex((child) => child.textContent?.includes(text) === true);
    const cursor = index('X: 12');
    const saved = index('Saved');
    const units = index('px');
    // cursor position (10) is declared before save status (22), which is
    // declared before units (30) — and the row renders in that order, which
    // it used to ignore in favour of a fixed JSX sequence.
    expect(cursor).toBeGreaterThanOrEqual(0);
    expect(saved).toBeGreaterThan(cursor);
    expect(units).toBeGreaterThan(saved);
  });

  it('keeps an in-progress zoom edit stable and rejects malformed values', () => {
    const editor = baseEditor();
    useEditorMock.mockReturnValue(editor);
    const { rerender } = render(<StatusBar />);
    const zoom = screen.getByRole('spinbutton', { name: 'Zoom 100%' }) as HTMLInputElement;

    fireEvent.focus(zoom);
    fireEvent.change(zoom, { target: { value: '12.5' } });
    editor.state.zoom = 2;
    rerender(<StatusBar />);
    expect(zoom.value).toBe('12.5');

    fireEvent.blur(zoom);
    expect(editor.setZoom).toHaveBeenCalledWith(0.125);

    fireEvent.focus(zoom);
    fireEvent.change(zoom, { target: { value: 'not-a-number' } });
    fireEvent.blur(zoom);
    expect(editor.setZoom).toHaveBeenCalledTimes(1);
    expect(zoom.value).toBe('200');
  });

  it('reports actual GPU drawing separately from a ready device or requested preference', () => {
    useEditorMock.mockReturnValue(baseEditor());
    render(<StatusBar />);
    const base = {
      backendId: 'webgpu' as const,
      gpuActive: true,
      vertexPoolEntries: 0,
      bundleCacheEntries: 0,
      lastFrameVertexBytes: 0,
      adapterIsFallback: false,
    };
    act(() => setCompositorDiagnostics({ ...base, lastFrameGpuItems: 0 }));
    expect(screen.getByText('Canvas2D · GPU ready')).toBeTruthy();
    act(() => setCompositorDiagnostics({ ...base, lastFrameGpuItems: 2 }));
    expect(screen.getByText('WebGPU + Canvas2D')).toBeTruthy();
    act(() =>
      setCompositorDiagnostics({
        ...base,
        backendId: 'canvas2d',
        gpuActive: false,
        initFailureReason: 'WebGPU device request failed',
      }),
    );
    expect(screen.getByText('WebGPU unavailable · Canvas2D')).toHaveAttribute(
      'title',
      expect.stringContaining('device request failed'),
    );
    expect(
      screen.getByText('WebGPU preference fell back to Canvas2D: WebGPU device request failed.'),
    ).toHaveAttribute('role', 'status');
    act(() =>
      setCompositorDiagnostics({
        ...base,
        backendId: 'canvas2d',
        gpuActive: false,
        requestedRenderer: 'webgl2',
        initFailureReason: 'WebGL2 context unavailable',
      }),
    );
    expect(screen.getByText('WebGL2 unavailable · Canvas2D')).toHaveAttribute(
      'title',
      expect.stringContaining('WebGL2 context unavailable'),
    );
    act(() =>
      setCompositorDiagnostics({
        ...base,
        backendId: 'webgl2',
        gpuActive: true,
        lastFrameGpuItems: 2,
      }),
    );
    expect(screen.getByText('WebGL2 · experimental')).toHaveAttribute(
      'title',
      expect.stringContaining('Hardware execution is not inferred'),
    );
    act(() =>
      setCompositorDiagnostics({
        ...base,
        backendId: 'webgl2',
        gpuActive: false,
        deviceLost: true,
      }),
    );
    expect(screen.getByText('WebGL2 lost · Canvas2D')).toBeTruthy();
    act(() => setCompositorDiagnostics({ ...base, backendId: 'canvas2d', gpuActive: false }));
    expect(screen.getByText('Canvas2D')).toBeTruthy();
    expect(screen.queryByText(/\(cpu\)/)).toBeNull();
    act(() =>
      setCompositorDiagnostics({
        ...base,
        backendId: 'canvas2d',
        gpuActive: false,
        fatalError: 'Canvas compositor initialization failed',
      }),
    );
    expect(screen.getByText('Renderer unavailable')).toBeTruthy();
  });
});
