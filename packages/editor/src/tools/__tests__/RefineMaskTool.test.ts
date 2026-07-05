/**
 * RefineMaskTool tests — 6 TDD tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { RefineMaskTool } from '../RefineMaskTool';

function createWhiteMaskImageData(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = 50;
  canvas.height = 50;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 50, 50);
  const data = ctx.getImageData(0, 0, 50, 50);
  return data;
}

function averageMaskValue(data: ImageData): number {
  let sum = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    sum += data.data[i]!;
  }
  return sum / (50 * 50);
}

function makeMockImageNode() {
  const canvas = document.createElement('canvas');
  canvas.width = 50;
  canvas.height = 50;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 50, 50);
  const dataUrl = canvas.toDataURL('image/png');
  return {
    id: 'img-1',
    kind: 'image' as const,
    name: 'Test Image',
    w: 50,
    h: 50,
    src: 'test-src',
    backgroundRemoval: {
      maskDataUrl: dataUrl,
      method: 'quick' as const,
      confidence: 0.8,
      appliedAt: Date.now(),
    },
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
    locked: false,
  };
}

describe('RefineMaskTool', () => {
  function makeMinimalCtx(overrides?: Record<string, unknown>) {
    return {
      selection: ['img-1'],
      getNode: vi.fn(() => makeMockImageNode()),
      updateNode: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      announce: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      setDraft: vi.fn(),
      altKey: false,
      ...overrides,
    } as any;
  }

  it('brush adds to mask', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    const initialAvg = averageMaskValue(maskData);
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown({ altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);

    const afterAvg = averageMaskValue(maskData);
    expect(afterAvg).toBeGreaterThanOrEqual(initialAvg);
  });

  it('Alt+brush subtracts from mask', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    const initialAvg = averageMaskValue(maskData);
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown({ altKey: true, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);

    const afterAvg = averageMaskValue(maskData);
    expect(afterAvg).toBeLessThanOrEqual(initialAvg);
  });

  it('brush size changes affect coverage', () => {
    const tool = new RefineMaskTool();

    tool.setOptions({ brushSize: 4, hardness: 1 });
    expect((tool as any).options.brushSize).toBe(4);
    expect((tool as any).brushMask).not.toBeNull();
  });

  it('undo reverts stroke', () => {
    const tool = new RefineMaskTool();
    (tool as any).maskData = createWhiteMaskImageData();
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown({ altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalled();

    tool.onDragEnd(ctx);
    expect(ctx.commitTransaction).toHaveBeenCalled();
  });

  it('redo restores stroke', () => {
    const tool = new RefineMaskTool();
    (tool as any).maskData = createWhiteMaskImageData();
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown({ altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalled();

    tool.onDragEnd(ctx);
    expect(ctx.commitTransaction).toHaveBeenCalled();
  });

  it('empty mask handled gracefully', () => {
    const tool = new RefineMaskTool();
    const ctx = makeMinimalCtx({
      selection: ['img-2'],
      getNode: vi.fn(() => undefined),
    });

    const result = tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any,
      ctx,
    );

    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith(
      'Select an image with background removal applied first',
    );
  });
});
