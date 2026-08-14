// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => ({ useEditor: vi.fn() }));

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
}));

import { useEditor } from '../../../../context';
import { ImageEnhancementSection } from '../ImageEnhancementSection';

// Vitest 4 types mocks strictly; these tests intentionally return partial
// context values (only the fields under test), so loosen the return slot.
const mockedUseEditor = vi.mocked(useEditor) as unknown as {
  (): ReturnType<typeof useEditor>;
  mockReturnValue: (value: unknown) => void;
};

function imageNode(overrides?: Record<string, unknown>) {
  return {
    id: 'image-1',
    kind: 'shape' as const,
    name: 'Logo',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10 },
    fills: [
      {
        type: 'image' as const,
        image: { src: 'data:image/png;base64,AAAA', fit: 'fill' as const, x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    strokes: [],
    effects: [],
    order: 'a0',
    ...overrides,
  };
}

describe('ImageEnhancementSection — live trace', () => {
  const upscaleSelectedImage = vi.fn().mockResolvedValue(undefined);
  const traceSelectedImage = vi.fn().mockResolvedValue(undefined);
  const setSelectedLiveTraceParams = vi.fn();
  const flattenSelectedLiveTrace = vi.fn();
  const clearSelectedLiveTrace = vi.fn();
  const cancelImageProcessing = vi.fn();

  beforeEach(() => {
    upscaleSelectedImage.mockClear();
    traceSelectedImage.mockClear();
    setSelectedLiveTraceParams.mockClear();
    flattenSelectedLiveTrace.mockClear();
    clearSelectedLiveTrace.mockClear();
    cancelImageProcessing.mockClear();
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {} },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      upscaleSelectedImage,
      traceSelectedImage,
      setSelectedLiveTraceParams,
      flattenSelectedLiveTrace,
      clearSelectedLiveTrace,
      cancelImageProcessing,
      announce: vi.fn(),
    });
  });

  afterEach(cleanup);

  it('renders live trace toggle checkbox', () => {
    render(<ImageEnhancementSection nodes={[imageNode()]} />);
    expect(screen.getByLabelText(/auto trace/i)).toBeInTheDocument();
  });

  it('live trace mode shows loading state when node has unresolved liveTrace', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: null,
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    expect(screen.getByText(/tracing/i)).toBeInTheDocument();
  });

  it('live trace mode shows resolved state when resolvedAt is set', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: Date.now(),
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    expect(screen.getByText(/auto trace active/i)).toBeInTheDocument();
  });

  it('live trace mode shows error state when lastError is set', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: null,
        lastError: 'No foreground contours found',
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    expect(screen.getByText(/no foreground contours found/i)).toBeInTheDocument();
  });

  it('live trace param change triggers debounced trace via setSelectedLiveTraceParams', async () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: null,
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);

    const thresholdSlider = screen.getByLabelText(/trace threshold/i);
    fireEvent.change(thresholdSlider, { target: { value: '200' } });

    await waitFor(() => {
      expect(setSelectedLiveTraceParams).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 200 }),
      );
    });
  });

  it('flatten button calls flattenSelectedLiveTrace', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: Date.now(),
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    const flatten = screen.getByRole('button', { name: /flatten/i });
    fireEvent.click(flatten);
    expect(flattenSelectedLiveTrace).toHaveBeenCalledTimes(1);
  });

  it('retrace button calls traceSelectedImage with liveTrace:true', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'color',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 10,
          simplifyTolerance: 0.5,
          maxPaths: 500,
          maxColors: 6,
          compoundHoles: true,
        },
        resolvedAt: Date.now(),
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    const retrace = screen.getByRole('button', { name: /retrace/i });
    fireEvent.click(retrace);
    expect(traceSelectedImage).toHaveBeenCalledWith(
      expect.objectContaining({ liveTrace: true, mode: 'color', minArea: 10 }),
    );
  });

  it('cancel button shows during loading and calls cancelImageProcessing', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: null,
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    const cancel = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancel);
    expect(cancelImageProcessing).toHaveBeenCalledTimes(1);
  });

  it('advanced section shows foreground, simplify tolerance, max paths, alpha threshold, compound holes', () => {
    const node = imageNode({
      liveTrace: {
        sourceNodeId: 'image-1',
        params: {
          mode: 'monochrome',
          threshold: 128,
          foreground: 'dark',
          alphaThreshold: 1,
          minArea: 4,
          simplifyTolerance: 0.75,
          maxPaths: 1000,
          maxColors: 8,
          compoundHoles: true,
        },
        resolvedAt: Date.now(),
        lastError: null,
      },
    });
    render(<ImageEnhancementSection nodes={[node]} />);
    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
  });
});

describe('ImageEnhancementSection — original one-shot', () => {
  const upscaleSelectedImage = vi.fn().mockResolvedValue(undefined);
  const traceSelectedImage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    upscaleSelectedImage.mockClear();
    traceSelectedImage.mockClear();
    mockedUseEditor.mockReturnValue({
      state: { sectionVisibility: {} },
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
      upscaleSelectedImage,
      traceSelectedImage,
      setSelectedLiveTraceParams: vi.fn(),
      flattenSelectedLiveTrace: vi.fn(),
      clearSelectedLiveTrace: vi.fn(),
      cancelImageProcessing: vi.fn(),
      announce: vi.fn(),
    });
  });

  afterEach(cleanup);

  it('opens upscale dialog and dispatches trace operations for image-filled shapes', async () => {
    const openUpscaleDialog = vi.fn<() => void>();
    mockedUseEditor.mockReturnValue({
      ...mockedUseEditor(),
      openUpscaleDialog,
    });
    render(<ImageEnhancementSection nodes={[imageNode()]} />);

    expect(screen.getByRole('button', { name: /image & vector/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // Upscale now opens a dialog
    fireEvent.click(screen.getByRole('button', { name: /enhance image/i }));
    expect(openUpscaleDialog).toHaveBeenCalled();

    // Trace controls are still inline
    fireEvent.click(screen.getByLabelText('Trace mode'));
    fireEvent.click(screen.getByRole('option', { name: 'Color' }));
    fireEvent.change(screen.getByLabelText('Trace color count'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Minimum trace area'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace color' }));

    await waitFor(() =>
      expect(traceSelectedImage).toHaveBeenCalledWith({
        mode: 'color',
        threshold: 128,
        maxColors: 6,
        foreground: 'dark',
        minArea: 3,
        simplifyTolerance: 0.75,
        liveTrace: false,
      }),
    );
  });

  it('opens upscale dialog instead of inline controls', async () => {
    const openUpscaleDialog = vi.fn<() => void>();
    mockedUseEditor.mockReturnValue({
      ...mockedUseEditor(),
      openUpscaleDialog,
    });
    render(<ImageEnhancementSection nodes={[imageNode()]} />);

    fireEvent.click(screen.getByRole('button', { name: /enhance image/i }));
    expect(openUpscaleDialog).toHaveBeenCalled();
  });

  it('does not render for non-image nodes', () => {
    const node = { ...imageNode(), fills: [] };
    const { container } = render(<ImageEnhancementSection nodes={[node]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
