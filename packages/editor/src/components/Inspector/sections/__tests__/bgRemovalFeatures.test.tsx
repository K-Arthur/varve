// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => {
  const mockFn = vi.fn();
  return { useEditor: mockFn };
});

import { useEditor } from '../../../../context';
import { BackgroundRemovalSection } from '../BackgroundRemovalSection';

afterEach(cleanup);

const mockedUseEditor = vi.mocked(useEditor);

const { mockExportRemoveBg, mockExportImageCache, mockExportIsModelAvailable } = vi.hoisted(() => ({
  mockExportRemoveBg: vi.fn(),
  mockExportImageCache: { load: vi.fn() },
  mockExportIsModelAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock('@varve/engine', () => ({
  DEFAULT_PREVIEW_MAX_DIMENSION: 2048,
  checkGifExportSupport: () => ({ supported: false, reason: 'test' }),
  checkVideoExportSupport: () => ({ supported: false, reason: 'test' }),
  isWasmModelSafe: vi.fn().mockResolvedValue(true),
  getModelLoaderReady: vi.fn().mockResolvedValue({
    getState: () => 'unavailable',
    isModelAvailable: mockExportIsModelAvailable,
    subscribe: () => () => {},
  }),
  workerModelIdForMethod: (method: string) =>
    method === 'ai-quality' ? 'birefnet-general-lite' : method === 'ai-balanced' ? 'u2netp' : null,
  removeBackground: mockExportRemoveBg,
  getImageCache: () => mockExportImageCache,
  getModelInfo: (method: string) => {
    const info: Record<
      string,
      {
        label: string;
        description: string;
        diskSizeBytes: number;
        estimatedPeakRamBytes: number;
        peakRamDisplay: string;
        diskSizeDisplay: string;
        quality: string;
        requiresDownload: boolean;
        gpuRecommended: boolean;
        wasmSafe: boolean;
      }
    > = {
      quick: {
        label: 'Quick',
        description: 'Fast CPU heuristic',
        diskSizeBytes: 0,
        estimatedPeakRamBytes: 16_000_000,
        peakRamDisplay: '~16 MB',
        diskSizeDisplay: '0 B',
        quality: 'Basic',
        requiresDownload: false,
        gpuRecommended: false,
        wasmSafe: true,
      },
      'ai-balanced': {
        label: 'AI Balanced',
        description: 'Bundled u2netp',
        diskSizeBytes: 4_700_000,
        estimatedPeakRamBytes: 50_000_000,
        peakRamDisplay: '~50 MB',
        diskSizeDisplay: '4.7 MB',
        quality: 'Good',
        requiresDownload: false,
        gpuRecommended: false,
        wasmSafe: true,
      },
      'ai-quality': {
        label: 'AI High Quality',
        description: 'BiRefNet Lite',
        diskSizeBytes: 224_000_000,
        estimatedPeakRamBytes: 900_000_000,
        peakRamDisplay: '~900 MB',
        diskSizeDisplay: '224 MB',
        quality: 'Best',
        requiresDownload: true,
        gpuRecommended: true,
        wasmSafe: false,
      },
    };
    return info[method] ?? null;
  },
  getEnvironmentCapabilities: vi.fn().mockResolvedValue({
    crossOriginIsolated: false,
    isWebKitGTK: false,
    isTauri: false,
    hasWorker: true,
    hasWebGL: true,
    hasWebGPU: false,
    sharedMemoryAvailable: false,
    wasmSafeModelBytes: 400_000_000,
    preferredOnnxProviders: ['webgl', 'wasm'],
    label: 'Test',
  }),
}));

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
}));

vi.mock('../../../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: () => null,
}));

vi.mock('../../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="disclosure-section" data-title={title}>
      {children}
    </div>
  ),
}));

function makeImageNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    name: 'Image 1',
    kind: 'shape' as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 },
    transform: [1, 0, 0, 1, 0, 0] as const,
    fills: [
      {
        type: 'image',
        image: { src: 'data:image/png;base64,abc', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    ...overrides,
  } as import('@varve/scene').ShapeNode;
}

function makeExportableImageNode(overrides: Record<string, unknown> = {}) {
  return makeImageNode({
    presets: [
      {
        id: 'p1',
        enabled: true,
        format: 'png',
        scale: { type: 'factor', value: 1 },
        suffix: '',
      },
    ],
    ...overrides,
  });
}

function createMockEditorContext(overrides: Record<string, unknown> = {}) {
  const { state: _stateOverride, ...contextOverrides } = overrides;
  const mockState = {
    tool: 'select' as const,
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: ['n1'],
    showOriginalBgNodeId: null,
    backgroundRemovalPreviewSession: null,
    maskPreviewMode: 'checkerboard' as const,
    refineMaskOptions: { brushSize: 20, hardness: 0.8 },
    ...(overrides.state ?? {}),
  };
  return {
    state: mockState,
    removeBackground: vi.fn().mockResolvedValue(undefined),
    removeBackgroundWithOptions: vi.fn().mockResolvedValue(undefined),
    cancelBackgroundRemoval: vi.fn(),
    applyBackgroundRemovalPreview: vi.fn(),
    cancelBackgroundRemovalPreview: vi.fn(),
    updateDoc: vi.fn(),
    updateNode: vi.fn(),
    announce: vi.fn(),
    setShowOriginalBg: vi.fn(),
    setMaskPreviewMode: vi.fn(),
    setTool: vi.fn(),
    setRefineMaskOptions: vi.fn(),
    refineHairEdges: vi.fn(),
    startTrimapEdit: vi.fn(),
    applyTrimapMatting: vi.fn(),
    setTrimapEditOptions: vi.fn(),
    ...contextOverrides,
  };
}

beforeEach(() => {
  mockedUseEditor.mockReturnValue(createMockEditorContext());
});

describe('BackgroundRemovalSection - Preview toggle', () => {
  it('shows an actual pending mask review and applies or cancels explicitly', () => {
    const applyBackgroundRemovalPreview = vi.fn();
    const cancelBackgroundRemovalPreview = vi.fn();
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        applyBackgroundRemovalPreview,
        cancelBackgroundRemovalPreview,
        state: {
          backgroundRemovalPreviewSession: {
            nodeId: 'n1',
            documentId: 'doc-1',
            sourceLocator: 'data:image/png;base64,abc',
            placementRevision: 1,
            maskDataUrl: 'data:image/png;base64,pending-mask',
            width: 200,
            height: 160,
            sourceWidth: 200,
            sourceHeight: 160,
            requestedMethod: 'ai-quality',
            actualMethod: 'ai-balanced',
            confidence: 0.9,
            feather: 0.5,
            decontaminate: true,
            executionProvider: 'wasm',
          },
        },
      }),
    );

    render(<BackgroundRemovalSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Background removal review')).toBeTruthy();
    expect(screen.getByText(/requested ai-quality; generated ai-balanced on wasm/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(applyBackgroundRemovalPreview).toHaveBeenCalledTimes(1);
    expect(cancelBackgroundRemovalPreview).toHaveBeenCalledTimes(1);
  });

  it('renders preview toggle when background removal exists', () => {
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    expect(screen.getByText('Show Original')).toBeTruthy();
  });

  it('calls setShowOriginalBg when preview toggle is clicked', () => {
    const setShowOriginalBg = vi.fn();
    mockedUseEditor.mockReturnValue(createMockEditorContext({ setShowOriginalBg }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Show Original'));
    expect(setShowOriginalBg).toHaveBeenCalledWith('n1');
  });

  it('shows "Showing Original" when preview is active', () => {
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        state: { showOriginalBgNodeId: 'n1' },
      }),
    );
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    expect(screen.getByText('Showing Original')).toBeTruthy();
  });

  it('calls setShowOriginalBg with null when toggling off', () => {
    const setShowOriginalBg = vi.fn();
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        setShowOriginalBg,
        state: { showOriginalBgNodeId: 'n1' },
      }),
    );
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.95,
        appliedAt: Date.now(),
        feather: 0.5,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Showing Original'));
    expect(setShowOriginalBg).toHaveBeenCalledWith(null);
  });
});

describe('BackgroundRemovalSection - Feather slider', () => {
  it('renders feather number input with default 0.5', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('0.5');
  });

  it('renders feather number input using existing value', () => {
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
        feather: 1.2,
        decontaminate: true,
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input.value).toBe('1.2');
  });

  it('increases feather value on + button click', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    const incBtn = screen.getByLabelText('Increase feather');
    fireEvent.click(incBtn);
    expect(input.value).toBe('0.6');
  });

  it('decreases feather value on - button click', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const decBtn = screen.getByLabelText('Decrease feather');
    fireEvent.click(decBtn);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    expect(input.value).toBe('0.4');
  });

  it('clamps feather to minimum 0', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-1' } });
    expect(input.value).toBe('0');
  });

  it('clamps feather to maximum 3', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const input = screen.getByLabelText('Feather') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('3');
  });
});

describe('BackgroundRemovalSection - Decontaminate checkbox', () => {
  it('renders decontaminate checkbox checked by default', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Reduce colour fringe')
      .previousElementSibling as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  it('toggles decontaminate off', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Reduce colour fringe')
      .previousElementSibling as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it('toggles decontaminate on after off', () => {
    const node = makeImageNode();
    render(<BackgroundRemovalSection nodes={[node]} />);
    const checkbox = screen.getByText('Reduce colour fringe')
      .previousElementSibling as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });
});

describe('ExportDialog - Remove background toggle', () => {
  beforeEach(() => {
    mockExportRemoveBg.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,export',
      method: 'quick',
      confidence: 0.8,
      processingTimeMs: 1,
      width: 200,
      height: 160,
    });
    mockExportImageCache.load.mockReset().mockResolvedValue({ width: 200, height: 160 });
    mockExportIsModelAvailable.mockResolvedValue(true);
    const canvasProto = HTMLCanvasElement.prototype;
    canvasProto.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => new ImageData(200, 160)),
    })) as unknown as typeof canvasProto.getContext;
  });

  it('renders remove background before export checkbox', async () => {
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    render(<ExportDialog isOpen={true} onClose={() => {}} nodes={[]} onExport={async () => {}} />);
    expect(screen.getByText('Remove background before export')).toBeTruthy();
  }, 15000);

  it('does not call onApplyBackgroundRemoval when toggle is off', async () => {
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    const onApplyBackgroundRemoval = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[makeImageNode()]}
        onExport={async () => {}}
        onApplyBackgroundRemoval={onApplyBackgroundRemoval}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await vi.waitFor(() => expect(onApplyBackgroundRemoval).not.toHaveBeenCalled());
  });

  it('invokes onApplyBackgroundRemoval callback with correct id+state', async () => {
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    const onApplyBackgroundRemoval = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[makeExportableImageNode()]}
        onExport={async () => {}}
        onApplyBackgroundRemoval={onApplyBackgroundRemoval}
      />,
    );
    fireEvent.click(screen.getByText('Remove background before export'));
    fireEvent.click(screen.getByRole('button', { name: /export \(1\)/i }));
    await vi.waitFor(() => {
      expect(onApplyBackgroundRemoval).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({
          method: 'quick',
          maskDataUrl: expect.stringContaining('export'),
        }),
      );
    });
  });

  it('blocks export bg removal when AI method selected but model unavailable', async () => {
    mockExportIsModelAvailable.mockResolvedValue(false);
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    const onApplyBackgroundRemoval = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[makeExportableImageNode()]}
        onExport={async () => {}}
        onApplyBackgroundRemoval={onApplyBackgroundRemoval}
      />,
    );
    fireEvent.click(screen.getByText('Remove background before export'));
    fireEvent.click(screen.getByLabelText('Background removal method for export'));
    fireEvent.click(screen.getByRole('option', { name: /balanced/i }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /download ai model/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /export \(1\)/i }));
    await vi.waitFor(() => {
      expect(screen.getByText(/download the ai model first/i)).toBeTruthy();
    });
    expect(onApplyBackgroundRemoval).not.toHaveBeenCalled();
  });

  it('does not export when an AI preprocessing request returns a quick result', async () => {
    mockExportRemoveBg.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,fallback',
      method: 'quick',
      confidence: 0.5,
      processingTimeMs: 1,
      width: 200,
      height: 160,
    });
    const { ExportDialog } = await import('../../../Export/ExportDialog');
    const onApplyBackgroundRemoval = vi.fn();
    const onExport = vi.fn();
    render(
      <ExportDialog
        isOpen={true}
        onClose={() => {}}
        nodes={[makeExportableImageNode()]}
        onExport={onExport}
        onApplyBackgroundRemoval={onApplyBackgroundRemoval}
      />,
    );
    fireEvent.click(screen.getByText('Remove background before export'));
    fireEvent.click(screen.getByLabelText('Background removal method for export'));
    fireEvent.click(screen.getByRole('option', { name: /balanced/i }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /download ai model/i })).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /export \(1\)/i }));
    await vi.waitFor(() => {
      expect(screen.getByText(/AI background removal failed/i)).toBeTruthy();
    });
    expect(onApplyBackgroundRemoval).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });
});

describe('BackgroundRemovalSection - Refine mask wiring', () => {
  it.each(['quick', 'ai-balanced', 'ai-quality'] as const)(
    'exposes Edit mask for a %s result',
    (method) => {
      const node = makeImageNode({
        backgroundRemoval: {
          maskDataUrl: 'data:image/png;base64,mask',
          method,
          confidence: 0.9,
          appliedAt: Date.now(),
        },
      });
      render(<BackgroundRemovalSection nodes={[node]} />);
      fireEvent.click(screen.getByText('Edit mask'));
      expect(screen.getByText('Mask editor')).toBeTruthy();
      expect(screen.getByText('Refine Mask')).toBeTruthy();
      expect(screen.getByText('Edit trimap')).toBeTruthy();
    },
  );

  it('shows the mask editor only when background removal exists', () => {
    render(<BackgroundRemovalSection nodes={[makeImageNode()]} />);
    expect(screen.queryByText('Edit mask')).toBeNull();

    render(
      <BackgroundRemovalSection
        nodes={[
          makeImageNode({
            backgroundRemoval: {
              maskDataUrl: 'data:image/png;base64,mask',
              method: 'quick',
              confidence: 0.9,
              appliedAt: Date.now(),
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Edit mask')).toBeTruthy();
  });

  it('activates the refine-mask tool when Edit mask is opened', () => {
    const setTool = vi.fn();
    mockedUseEditor.mockReturnValue(createMockEditorContext({ setTool }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Edit mask'));
    expect(setTool).toHaveBeenCalledWith('refineMask');
  });

  it('shows brush controls only while refineMask tool is active', () => {
    mockedUseEditor.mockReturnValue(
      createMockEditorContext({
        state: { tool: 'refineMask', selection: ['n1'] },
      }),
    );
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    expect(screen.getByLabelText('Brush size')).toBeTruthy();
    expect(screen.getByLabelText('Hardness')).toBeTruthy();
  });
});

describe('BackgroundRemovalSection - Phase E actions', () => {
  it('shows Refine edges (hair/fur) when background removal exists', () => {
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Edit mask'));
    expect(screen.getByText('Refine edges (hair/fur)')).toBeTruthy();
    expect(screen.getByText('Edit trimap')).toBeTruthy();
  });

  it('calls refineHairEdges when hair refine clicked', () => {
    const refineHairEdges = vi.fn();
    mockedUseEditor.mockReturnValue(createMockEditorContext({ refineHairEdges }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Edit mask'));
    fireEvent.click(screen.getByText('Refine edges (hair/fur)'));
    expect(refineHairEdges).toHaveBeenCalled();
  });

  it('calls startTrimapEdit when Edit trimap clicked', () => {
    const startTrimapEdit = vi.fn();
    mockedUseEditor.mockReturnValue(createMockEditorContext({ startTrimapEdit }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Edit mask'));
    fireEvent.click(screen.getByText('Edit trimap'));
    expect(startTrimapEdit).toHaveBeenCalled();
  });
});

describe('BackgroundRemovalSection - Error normalization', () => {
  it('returns "Cancelled" for aborted/cancelled errors', async () => {
    const removeBackgroundWithOptions = vi.fn().mockRejectedValue(new Error('cancelled'));
    mockedUseEditor.mockReturnValue(createMockEditorContext({ removeBackgroundWithOptions }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Preview new mask'));
    await vi.waitFor(() => {
      expect(screen.queryByText(/Background removal failed/i)).toBeNull();
    });
  });

  it('preserves real AI provider detail in error message', async () => {
    const realError = 'AI background removal failed (worker-onnx: ONNX Runtime ran out of memory)';
    const removeBackgroundWithOptions = vi.fn().mockRejectedValue(new Error(realError));
    mockedUseEditor.mockReturnValue(createMockEditorContext({ removeBackgroundWithOptions }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Preview new mask'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('ran out of memory');
    });
  });

  it('preserves generic error detail when no known pattern matches', async () => {
    const realError = 'AI background removal failed (worker-onnx: WebGPU device lost)';
    const removeBackgroundWithOptions = vi.fn().mockRejectedValue(new Error(realError));
    mockedUseEditor.mockReturnValue(createMockEditorContext({ removeBackgroundWithOptions }));
    const node = makeImageNode({
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,mask',
        method: 'quick',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    });
    render(<BackgroundRemovalSection nodes={[node]} />);
    fireEvent.click(screen.getByText('Preview new mask'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('WebGPU device lost');
    });
  });
});
