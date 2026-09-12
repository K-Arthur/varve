import { describe, expect, it, vi } from 'vitest';
import { canvasBackingSize } from './canvasSurface';
import { type PresentWorkerFrameArgs, tryPresentWorkerFrame } from './presentWorkerFrame';

function makeArgs(overrides: {
  canvasWidth: number;
  canvasHeight: number;
  bitmapDpr: number;
}): PresentWorkerFrameArgs {
  const viewport = { width: 1000, height: 800 };
  const camera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 };
  return {
    ctx: {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D,
    canvas: {
      width: overrides.canvasWidth,
      height: overrides.canvasHeight,
    } as HTMLCanvasElement,
    boardColor: '#ffffff',
    wb: {
      bitmap: {} as ImageBitmap,
      docVersion: 7,
      camera,
      viewport,
      dpr: overrides.bitmapDpr,
    },
    compositor: {
      compositeRasterLayer: vi.fn(),
    } as unknown as PresentWorkerFrameArgs['compositor'],
    camera,
    viewport,
    dpr: 1,
    docVersion: 7,
    frameStart: performance.now(),
    coordinator: {
      getDiagnostics: () => ({ submittedFrames: 1 }),
      completeFrame: vi.fn(),
    } as unknown as PresentWorkerFrameArgs['coordinator'],
    decision: { kind: 'content', reasons: ['worker-present'], explicit: [] },
    snapshot: {} as PresentWorkerFrameArgs['snapshot'],
    cacheDiag: { bytes: 0, entries: 0 },
  } as unknown as PresentWorkerFrameArgs;
}

describe('tryPresentWorkerFrame surface matching', () => {
  it('presents a preview-scale bitmap on a preview-scale surface', () => {
    const bitmapDpr = 0.75;
    const args = makeArgs({
      canvasWidth: canvasBackingSize(1000, bitmapDpr),
      canvasHeight: canvasBackingSize(800, bitmapDpr),
      bitmapDpr,
    });

    expect(tryPresentWorkerFrame(args)).toBe(true);
    expect(args.compositor?.compositeRasterLayer).toHaveBeenCalledTimes(1);
  });

  it('refuses a preview-scale bitmap once the surface is back at full resolution', () => {
    const args = makeArgs({ canvasWidth: 1000, canvasHeight: 800, bitmapDpr: 0.75 });

    expect(tryPresentWorkerFrame(args)).toBe(false);
    expect(args.compositor?.compositeRasterLayer).not.toHaveBeenCalled();
  });

  it('presents a full-resolution bitmap on a full-resolution surface', () => {
    const args = makeArgs({ canvasWidth: 1000, canvasHeight: 800, bitmapDpr: 1 });

    expect(tryPresentWorkerFrame(args)).toBe(true);
  });

  it('refuses a bitmap for a different camera even when the surface matches', () => {
    const args = makeArgs({ canvasWidth: 1000, canvasHeight: 800, bitmapDpr: 1 });
    args.camera = { zoom: 2, pan: { x: 0, y: 0 }, rotation: 0 };

    expect(tryPresentWorkerFrame(args)).toBe(false);
  });
});
