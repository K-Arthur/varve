/**
 * EyedropperTool tests — sampling paths, cancellation, and failure reporting.
 */
import { describe, expect, it, vi } from 'vitest';
import { EyedropperTool } from '../EyedropperTool';
import type { ToolContext } from '../types';

type AppliedFill = { space: 'rgb'; r: number; g: number; b: number; a: number };

type UpdateNodeFn = (
  id: string,
  updater: (n: { fill: AppliedFill }) => { fill: AppliedFill },
) => void;

interface MockCtx {
  announce: ReturnType<typeof vi.fn>;
  updateNode: ReturnType<typeof vi.fn>;
}

function makeMockContext(
  canvas: HTMLCanvasElement | null,
  overrides: Record<string, unknown> = {},
) {
  const state = { node: { id: 'rect-1', fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } } };
  const ctx = {
    document: { nodes: { 'rect-1': state.node }, rootChildren: ['rect-1'] },
    selection: ['rect-1'],
    canvasElement: canvas,
    announce: vi.fn(),
    updateNode: vi.fn((id: string, updater: (n: unknown) => unknown) => {
      if (id !== 'rect-1') return;
      state.node = updater(state.node) as typeof state.node;
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    ...overrides,
  } as unknown as ToolContext & MockCtx;
  return ctx;
}

/** The vitest.setup mock returns a fresh context per getContext call, so bind one controlled context per canvas. */
function makeCanvas(pixels: { x: number; y: number; color: [number, number, number, number] }[]) {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const ctx2d = canvas.getContext('2d') as CanvasRenderingContext2D;
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: (contextId: string) => (contextId === '2d' ? ctx2d : null),
  });
  const backing = new Uint8ClampedArray(100 * 100 * 4);
  for (const { x, y, color } of pixels) {
    const index = (y * 100 + x) * 4;
    backing[index] = color[0];
    backing[index + 1] = color[1];
    backing[index + 2] = color[2];
    backing[index + 3] = color[3];
  }
  vi.spyOn(ctx2d, 'getImageData').mockImplementation(
    (x: number, y: number) =>
      new ImageData(
        new Uint8ClampedArray(backing.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)),
        1,
        1,
      ) as ImageData,
  );
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      toJSON: () => ({}),
    }),
  });
  return canvas;
}

/** Swaps a fake EyeDropper constructor into the global scope; returns a restore function. */
function withFakeEyeDropper(impl: unknown): () => void {
  const scope = globalThis as unknown as { EyeDropper?: unknown };
  const original = scope.EyeDropper;
  scope.EyeDropper = impl;
  return () => {
    scope.EyeDropper = original;
  };
}

describe('EyedropperTool', () => {
  it('does not fail silently when nothing is selected — it tells the user why', () => {
    const tool = new EyedropperTool();
    const ctx = makeMockContext(makeCanvas([]), { selection: [] });

    const result = tool.onPointerDown(
      { clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent,
      ctx,
    );

    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Select a layer to apply the sampled color');
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });

  it('applies an EyeDropper API sample to the selection fill', async () => {
    const restore = withFakeEyeDropper(
      class {
        open() {
          return Promise.resolve({ sRGBHex: '#ff8040' });
        }
      },
    );

    try {
      const tool = new EyedropperTool();
      const ctx = makeMockContext(null);

      tool.onPointerDown({ clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent, ctx);
      await vi.waitFor(() => {
        expect(ctx.updateNode).toHaveBeenCalled();
      });

      const fill = stateOf(ctx).fill;
      expect(fill).toEqual({ space: 'rgb', r: 255, g: 128, b: 64, a: 255 });
      expect(ctx.announce).toHaveBeenCalledWith('Color sampled and applied to fill');
    } finally {
      restore();
    }
  });

  it('leaves the document untouched when the EyeDropper prompt is dismissed', async () => {
    const restore = withFakeEyeDropper(
      class {
        open() {
          return Promise.reject(new DOMException('user cancelled', 'AbortError'));
        }
      },
    );

    try {
      const tool = new EyedropperTool();
      const ctx = makeMockContext(null);

      tool.onPointerDown({ clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent, ctx);

      await vi.waitFor(() => {
        expect(ctx.announce).not.toHaveBeenCalledWith('Color sampled and applied to fill');
      });
      expect(ctx.updateNode).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('reports an API failure instead of swallowing it', async () => {
    const restore = withFakeEyeDropper(
      class {
        open() {
          return Promise.reject(new TypeError('not supported in this build'));
        }
      },
    );

    try {
      const tool = new EyedropperTool();
      const ctx = makeMockContext(null);

      tool.onPointerDown({ clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent, ctx);

      await vi.waitFor(() => {
        expect(ctx.announce).toHaveBeenCalledWith('Screen sampling is unavailable here');
      });
      expect(ctx.updateNode).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('aborts an in-flight EyeDropper prompt on Escape', async () => {
    let openSignal: AbortSignal | undefined;
    const restore = withFakeEyeDropper(
      class {
        open(options?: { signal?: AbortSignal }) {
          openSignal = options?.signal ?? null;
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
      },
    );

    try {
      const tool = new EyedropperTool();
      const ctx = makeMockContext(null);

      tool.onPointerDown({ clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent, ctx);

      const signal = openSignal as AbortSignal | null;
      expect(signal).not.toBeNull();

      const handled = tool.onKeyDown({ key: 'Escape' } as unknown as KeyboardEvent, ctx);
      expect(handled).toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(ctx.announce).toHaveBeenCalledWith('Eyedropper cancelled');
    } finally {
      restore();
    }
  });

  it('samples canvas pixels when the EyeDropper API is unavailable', () => {
    const tool = new EyedropperTool();
    const canvas = makeCanvas([{ x: 5, y: 5, color: [255, 0, 0, 255] }]);
    const ctx = makeMockContext(canvas);

    const result = tool.onPointerDown(
      { clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent,
      ctx,
    );

    expect(result.consumed).toBe(true);
    const updater = lastUpdater(ctx);
    expect(updater({ fill: { space: 'rgb', r: 1, g: 2, b: 3, a: 4 } }).fill).toEqual({
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect(ctx.announce).toHaveBeenCalledWith('Color sampled and applied to fill');
  });

  it('reports failure instead of throwing when canvas pixels are unreadable', () => {
    const tool = new EyedropperTool();
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 100 }),
    });
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: () => null,
    });
    const ctx = makeMockContext(canvas);

    const result = tool.onPointerDown(
      { clientX: 5, clientY: 5, pointerId: 1 } as unknown as PointerEvent,
      ctx,
    );

    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Canvas sampling is unavailable for this pixel');
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

/** Applies the recorded updater to a known seed node and returns the result. */
function stateOf(ctx: MockCtx): { fill: AppliedFill } {
  const initial = { fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } };
  return lastUpdater(ctx)(initial);
}

function lastUpdater(ctx: MockCtx): UpdateNodeFn {
  const updater = (ctx.updateNode as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
  if (typeof updater !== 'function') throw new Error('updateNode was never called');
  return updater as UpdateNodeFn;
}
