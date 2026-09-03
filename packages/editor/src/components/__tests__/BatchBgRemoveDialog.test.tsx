// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchBgRemoveDialog } from '../BatchBgRemoveDialog';

afterEach(cleanup);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockRemoveBackground, mockImageCache, mockIsModelAvailable } = vi.hoisted(() => ({
  mockRemoveBackground: vi.fn(),
  mockImageCache: { load: vi.fn() },
  mockIsModelAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    getImageCache: () => mockImageCache,
    removeBackground: mockRemoveBackground,
    DEFAULT_PREVIEW_MAX_DIMENSION: 2048,
    getEnvironmentCapabilities: vi.fn().mockResolvedValue({
      webgpu: false,
      wasm: true,
      wasmSimd: true,
      onnxBackend: 'wasm',
      executionProviders: [{ name: 'wasm' }],
      maxMemoryMB: 512,
    }),
    isWasmModelSafe: vi.fn().mockResolvedValue(true),
    finalizeMaskResult: vi.fn(async (result: { maskDataUrl: string }) => ({
      ...result,
      needsSubjectPicker: false,
    })),
    getModelLoaderReady: vi.fn().mockResolvedValue({
      isModelAvailable: mockIsModelAvailable,
      getState: () => 'ready',
      subscribe: () => () => {},
    }),
    workerModelIdForMethod: (method: string) =>
      method === 'ai-balanced'
        ? 'u2netp'
        : method === 'ai-quality'
          ? 'birefnet-general-lite'
          : null,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function imageNode(
  id: string,
  overrides: Record<string, unknown> = {},
): import('@varve/scene').ShapeNode {
  return {
    id,
    name: `Image ${id}`,
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 0, 0] as import('@varve/engine').Affine,
    fills: [
      {
        type: 'image',
        image: { src: `https://example.com/${id}.png`, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    backgroundRemoval: undefined,
    ...overrides,
  };
}

function shapeNode(id: string) {
  return {
    id,
    name: `Shape ${id}`,
    kind: 'shape' as const,
    transform: [1, 0, 0, 1, 0, 0] as import('@varve/engine').Affine,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    index: 0,
    order: 'a0',
    strokes: [],
    effects: [],
    fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
  };
}

function findStartBtn() {
  return screen.getByRole('button', { name: /remove background/i });
}

function findDoneBtn() {
  return screen.getByRole('button', { name: 'Done' });
}

function mockCanvasGetContext() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        width: 100,
        height: 80,
        data: new Uint8ClampedArray(32000),
      })),
    };
    return ctx as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

function mockImageCacheLoad() {
  vi.mocked(mockImageCache.load).mockResolvedValue(document.createElement('img'));
}

function setupSuccessMocks() {
  mockRemoveBackground.mockResolvedValue({
    maskDataUrl: 'data:image/png;base64,abc',
    confidence: 0.95,
    method: 'ai-balanced',
    processingTimeMs: 100,
    width: 100,
    height: 80,
  });
  mockImageCacheLoad();
  mockCanvasGetContext();
}

function renderDialog(
  nodes: import('@varve/scene').SceneNode[] = [],
  overrides: Record<string, unknown> = {},
) {
  const onClose = vi.fn();
  const onNodeUpdate = vi.fn();
  const utils = render(
    <BatchBgRemoveDialog
      open={true}
      onClose={onClose}
      nodes={nodes}
      onNodeUpdate={onNodeUpdate}
      {...overrides}
    />,
  );
  return { onClose, onNodeUpdate, ...utils };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BatchBgRemoveDialog', () => {
  it('renders with selected image nodes', () => {
    renderDialog([imageNode('i1'), imageNode('i2')]);
    expect(screen.getByRole('heading', { name: /remove background/i })).toBeTruthy();
    expect(screen.getByText('2 images selected')).toBeTruthy();
    expect(screen.getByText('Image i1')).toBeTruthy();
    expect(screen.getByText('Image i2')).toBeTruthy();
  });

  it('shows method selector', () => {
    renderDialog([imageNode('i1')]);
    expect(screen.getByText('Quick')).toBeTruthy();
    expect(screen.getByText('AI Balanced')).toBeTruthy();
    expect(screen.getByText('AI Quality')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
  });

  it('start button processes files', async () => {
    setupSuccessMocks();

    const { onNodeUpdate } = renderDialog([imageNode('i1')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(onNodeUpdate).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({
        maskDataUrl: 'data:image/png;base64,abc',
        method: 'ai-balanced',
      }),
    );
  });

  it('progress updates per file', async () => {
    setupSuccessMocks();

    renderDialog([imageNode('i1'), imageNode('i2')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByText('2 succeeded')).toBeTruthy();
  });

  it('error isolation: one file fails, others continue', async () => {
    vi.mocked(mockImageCache.load)
      .mockResolvedValueOnce(document.createElement('img'))
      .mockResolvedValueOnce(document.createElement('img'));

    mockRemoveBackground
      .mockRejectedValueOnce(new Error('Processing failed'))
      .mockResolvedValueOnce({
        maskDataUrl: 'data:image/png;base64,def',
        confidence: 0.95,
        method: 'ai-balanced',
        processingTimeMs: 100,
        width: 100,
        height: 80,
      });

    mockCanvasGetContext();

    renderDialog([imageNode('i1'), imageNode('i2')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByText('1 succeeded')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
  });

  it('all-files-complete state shows results summary', async () => {
    setupSuccessMocks();

    renderDialog([imageNode('i1')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByText('1 succeeded')).toBeTruthy();
    expect(findDoneBtn()).toBeTruthy();
  });

  it('cancel during processing', async () => {
    vi.mocked(mockImageCache.load).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    renderDialog([imageNode('i1')]);

    fireEvent.click(findStartBtn());

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Processing')).toBeNull();
  });

  it('empty selection shows prompt', () => {
    renderDialog([]);
    expect(screen.getByText(/No image nodes selected/)).toBeTruthy();
    expect(findStartBtn()).toBeDisabled();
  });

  it('escape dismisses dialog', () => {
    const { onClose } = renderDialog([imageNode('i1')]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus inside the dialog and auto-focuses on open (keyboard-only users cannot tab behind the modal)', async () => {
    renderDialog([imageNode('i1')]);

    const dialog = screen.getByRole('dialog', { name: /batch background removal/i });

    // FocusTrap uses requestAnimationFrame — wait for initial focus to land.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    // Polyfill offsetParent in jsdom so FocusTrap's getFocusable finds these.
    for (const el of focusable) {
      Object.defineProperty(el, 'offsetParent', { value: dialog, configurable: true });
    }

    // Shift+Tab from the first element wraps around to the last.
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Tab from the last element wraps around to the first.
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('retry failed item', async () => {
    vi.mocked(mockImageCache.load)
      .mockResolvedValueOnce(document.createElement('img'))
      .mockResolvedValueOnce(document.createElement('img'));

    mockRemoveBackground
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce({
        maskDataUrl: 'data:image/png;base64,retry',
        confidence: 0.95,
        method: 'ai-balanced',
        processingTimeMs: 100,
        width: 100,
        height: 80,
      });

    mockCanvasGetContext();

    const { onNodeUpdate } = renderDialog([imageNode('i1')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();

    const retryBtn = screen.getByText('Retry');
    fireEvent.click(retryBtn);

    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    // Initial attempt failed (no onNodeUpdate call), retry succeeds (1 call)
    expect(onNodeUpdate).toHaveBeenCalledTimes(1);
    expect(onNodeUpdate).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({
        maskDataUrl: 'data:image/png;base64,retry',
      }),
    );
  });

  it('skips non-image nodes', () => {
    renderDialog([imageNode('i1'), shapeNode('s1')]);
    expect(screen.getByText('1 image selected')).toBeTruthy();
    expect(screen.getByText('Image i1')).toBeTruthy();
    expect(screen.queryByText('Shape s1')).toBeNull();
  });

  it('shows aria-live announcements', async () => {
    setupSuccessMocks();

    renderDialog([imageNode('i1')]);

    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();

    const liveRegion = document.querySelector('[role="status"]');
    expect(liveRegion?.textContent).toContain('succeeded');
  });

  it('blocks start when AI method selected but model unavailable', async () => {
    mockIsModelAvailable.mockResolvedValue(false);
    renderDialog([imageNode('i1')]);
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    await vi.waitFor(() => {
      expect(findStartBtn()).toHaveProperty('disabled', true);
    });
    expect(screen.getByText(/AI model not downloaded/i)).toBeTruthy();
  });

  it('fails the item instead of applying a quick result to an AI request', async () => {
    mockIsModelAvailable.mockResolvedValue(true);
    setupSuccessMocks();
    mockRemoveBackground.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,fallback',
      confidence: 0.5,
      method: 'quick',
      processingTimeMs: 1,
      width: 100,
      height: 80,
    });

    const { onNodeUpdate } = renderDialog([imageNode('i1')]);
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    await vi.waitFor(() => expect(findStartBtn()).not.toBeDisabled());
    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(onNodeUpdate).not.toHaveBeenCalled();
    const liveRegion = document.querySelector('[role="status"]');
    expect(liveRegion?.textContent).toMatch(/0 succeeded, 1 failed/i);
  });

  it('reprocesses nodes even when they already have a backgroundRemoval state', async () => {
    setupSuccessMocks();
    const { onNodeUpdate } = renderDialog([
      imageNode('i1', {
        backgroundRemoval: {
          maskDataUrl: 'data:image/png;base64,existing',
          method: 'quick',
          confidence: 0.9,
          appliedAt: 1,
        },
      }),
    ]);
    fireEvent.click(findStartBtn());
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(onNodeUpdate).toHaveBeenCalled();
  });
});
