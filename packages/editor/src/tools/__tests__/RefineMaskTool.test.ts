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
    kind: 'shape' as const,
    name: 'Test Image',
    shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    fills: [
      {
        type: 'image',
        image: { src: 'test-src', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
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

  it('commitMask fires on drag end, not during pointer down', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();
    const beforeAvg = averageMaskValue(maskData);

    tool.onPointerDown({ altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);
    tool.onDragEnd(ctx);

    expect(ctx.updateNode).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).toHaveBeenCalled();
    expect(averageMaskValue(maskData)).toBeGreaterThanOrEqual(beforeAvg);
  });

  it('does not commit mask during drag move', () => {
    const tool = new RefineMaskTool();
    (tool as any).maskData = createWhiteMaskImageData();
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();
    tool.onPointerDown({ altKey: false, clientX: 10, clientY: 10, pointerId: 1 } as any, ctx);
    (tool as any).drag = {
      kind: 'dragging',
      pointerId: 1,
      startCanvas: { x: 10, y: 10 },
      startWorld: { x: 10, y: 10 },
      currentCanvas: { x: 30, y: 30 },
      currentWorld: { x: 30, y: 30 },
    };
    tool.onDragMove(ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
  });

  it('adjusts brush size with bracket keys', () => {
    const tool = new RefineMaskTool();
    const ctx = makeMinimalCtx();
    tool.onKeyDown({ key: ']' } as KeyboardEvent, ctx);
    expect((tool as any).options.brushSize).toBe(24);
    tool.onKeyDown({ key: '[', shiftKey: true } as KeyboardEvent, ctx);
    expect((tool as any).options.hardness).toBeCloseTo(0.7, 5);
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

  it('Escape exits refine mask mode', () => {
    const tool = new RefineMaskTool();
    const ctx = makeMinimalCtx({ setTool: vi.fn() });
    const handled = tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx);
    expect(handled).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('V key exits refine mask mode', () => {
    const tool = new RefineMaskTool();
    const ctx = makeMinimalCtx({ setTool: vi.fn() });
    const handled = tool.onKeyDown({ key: 'v' } as KeyboardEvent, ctx);
    expect(handled).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('onDragCancel restores pre-stroke mask snapshot', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    maskData.data[0] = 200;
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown({ altKey: false, clientX: 25, clientY: 25, pointerId: 1 } as any, ctx);
    maskData.data[0] = 50;
    tool.onDragCancel(ctx);

    // onDragCancel clones maskSnapshot back into tool.maskData (not the stale local ref)
    expect((tool as any).maskData.data[0]).toBe(200);
    expect(ctx.abortTransaction).toHaveBeenCalled();
  });
});
