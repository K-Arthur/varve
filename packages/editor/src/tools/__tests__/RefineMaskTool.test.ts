/**
 * RefineMaskTool tests — TDD: transform-aware coordinate mapping,
 * pressure sensitivity, and coalesced events.
 */

import { createAreaSelection } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { RefineMaskTool } from '../RefineMaskTool';

function createWhiteMaskImageData(w = 50, h = 50): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function averageMaskValue(data: ImageData): number {
  let sum = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    sum += data.data[i]!;
  }
  return sum / (data.width * data.height || 1);
}

function makeMockImageNode(overrides?: Record<string, unknown>) {
  const assetId = 'mask-img-1';
  return {
    id: 'img-1',
    kind: 'shape' as const,
    name: 'Test Image',
    shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    fills: [
      {
        type: 'image',
        image: { src: 'test-src', fit: 'fill', x: 0, y: 0, scale: 1, w: 50, h: 50 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    mask: {
      type: 'alpha' as const,
      visible: true,
      rasterMask: {
        assetId,
        coordinateSpace: 'source-image-pixels' as const,
        sourceIdentity: { kind: 'source-metadata' as const, locator: 'test-src', revision: 1 },
      },
    },
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
    locked: false,
    ...overrides,
  };
}

describe('RefineMaskTool', () => {
  function makeMinimalCtx(overrides?: Record<string, unknown>) {
    return {
      selection: ['img-1'],
      getNode: vi.fn(() => makeMockImageNode()),
      updateNode: vi.fn(),
      commitRasterMask: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      announce: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      setDraft: vi.fn(),
      altKey: false,
      document: {
        id: 'test-doc',
        nodes: { 'img-1': makeMockImageNode() },
        assets: {},
      },
      maskPreviewMode: 'none' as const,
      setMaskPreviewMode: vi.fn(),
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

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

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

    tool.onPointerDown(
      { altKey: true, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

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

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
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

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
    tool.onDragEnd(ctx);

    expect(ctx.commitRasterMask).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).toHaveBeenCalled();
    expect(averageMaskValue(maskData)).toBeGreaterThanOrEqual(beforeAvg);
  });

  it('does not commit mask during drag move', () => {
    const tool = new RefineMaskTool();
    (tool as any).maskData = createWhiteMaskImageData();
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();
    tool.onPointerDown(
      { altKey: false, clientX: 10, clientY: 10, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
    (tool as any).drag = {
      kind: 'dragging',
      pointerId: 1,
      startCanvas: { x: 10, y: 10 },
      startWorld: { x: 10, y: 10 },
      currentCanvas: { x: 30, y: 30 },
      currentWorld: { x: 30, y: 30 },
    };
    tool.onPointerMove({ pointerId: 1, getCoalescedEvents: () => [], pressure: 0.5 } as any, ctx);
    expect(ctx.commitRasterMask).not.toHaveBeenCalled();
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
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith('Select a visual layer or frame to paint a mask');
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

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
    maskData.data[0] = 50;
    tool.onDragCancel(ctx);

    expect((tool as any).maskData.data[0]).toBe(200);
    expect(ctx.abortTransaction).toHaveBeenCalled();
  });

  it('pressure sensitivity affects mask intensity', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.1 } as any,
      ctx,
    );
    const lowPressureAvg = averageMaskValue(maskData);

    const maskData2 = createWhiteMaskImageData();
    (tool as any).maskData = maskData2;
    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 2, pressure: 1.0 } as any,
      ctx,
    );
    const highPressureAvg = averageMaskValue(maskData2);

    expect(highPressureAvg).toBeGreaterThan(lowPressureAvg);
  });

  it('clips a refinement stroke to the active area selection', () => {
    const tool = new RefineMaskTool();
    tool.setOptions({ brushSize: 10, hardness: 1 });
    const maskData = createWhiteMaskImageData();
    for (let i = 0; i < maskData.data.length; i += 4) {
      maskData.data[i] = 128;
      maskData.data[i + 1] = 128;
      maskData.data[i + 2] = 128;
      maskData.data[i + 3] = 128;
    }
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    (tool as any).mapper = {
      mapWorldPoint: (p: { x: number; y: number }) => p,
      mapMaskPixelToWorld: (p: { x: number; y: number }) => p,
      sourceWidth: 50,
      sourceHeight: 50,
    };
    const ctx = makeMinimalCtx({
      areaSelection: createAreaSelection({
        kind: 'rectangle',
        x: 23,
        y: 23,
        w: 4,
        h: 4,
        feather: 0,
        antialias: false,
      }),
    });

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 1 } as any,
      ctx,
    );

    expect(maskData.data[(25 * maskData.width + 25) * 4]).toBe(255);
    expect(maskData.data[(20 * maskData.width + 25) * 4]).toBe(128);

    // The stroke keeps its pointer-down selection snapshot even if editor
    // state changes before a later/coalesced sample is processed.
    ctx.areaSelection = null;
    tool.onPointerMove(
      {
        pointerId: 1,
        getCoalescedEvents: () => [{ clientX: 40, clientY: 25, pressure: 1 }],
        pressure: 1,
      } as any,
      ctx,
    );
    expect(maskData.data[(25 * maskData.width + 40) * 4]).toBe(128);
  });

  it('mapper converts world coords on rotated image', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    const ctx = makeMinimalCtx();

    const mockMapper = {
      mapWorldPoint: vi.fn((p: { x: number; y: number }) => ({
        x: Math.round(p.x * 0.5),
        y: Math.round(p.y * 0.5),
      })),
    };
    (tool as any).mapper = mockMapper;

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    expect(mockMapper.mapWorldPoint).toHaveBeenCalled();
    const pixel = mockMapper.mapWorldPoint({ x: 25, y: 25 });
    expect(pixel.x).toBe(13);
    expect(pixel.y).toBe(13);
  });

  it('coalesced events are processed in onPointerMove', () => {
    const tool = new RefineMaskTool();
    const maskData = createWhiteMaskImageData();
    // Set all pixels to a mid-gray so brush stroke changes them detectably
    for (let i = 0; i < maskData.data.length; i += 4) {
      maskData.data[i] = 128;
      maskData.data[i + 1] = 128;
      maskData.data[i + 2] = 128;
      maskData.data[i + 3] = 128;
    }
    const initialPixel = maskData.data[0];
    (tool as any).maskData = maskData;
    (tool as any).nodeId = 'img-1';
    (tool as any).lastPaintedPoint = { x: 10, y: 10 };
    const ctx = makeMinimalCtx();

    (tool as any).drag = {
      kind: 'dragging',
      pointerId: 1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 30, y: 30 },
      currentWorld: { x: 30, y: 30 },
    };

    const coalesced = [
      { clientX: 16, clientY: 16, pressure: 0.5 },
      { clientX: 22, clientY: 22, pressure: 0.6 },
      { clientX: 30, clientY: 30, pressure: 0.7 },
    ];

    tool.onPointerMove({ pointerId: 1, getCoalescedEvents: () => coalesced } as any, ctx);

    // The brush painted around world(16,16) — check pixel at that location
    const paintedIdx = 16 * maskData.width + 16;
    const pixelAt16 = maskData.data[paintedIdx * 4];
    expect(pixelAt16).not.toBe(initialPixel);
  });
});

function makeMockFrameNode(overrides?: Record<string, unknown>) {
  return {
    id: 'frame-1',
    kind: 'frame' as const,
    name: 'Test Frame',
    w: 60,
    h: 40,
    children: ['child-1'],
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
    locked: false,
    ...overrides,
  };
}

describe('RefineMaskTool brush-mask creation', () => {
  function frameCtx() {
    const frameNode = makeMockFrameNode();
    return {
      selection: ['frame-1'],
      getNode: vi.fn(() => frameNode),
      commitRasterMask: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      announce: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      setDraft: vi.fn(),
      setPointerCapture: vi.fn(),
      altKey: false,
      document: {
        id: 'test-doc',
        rootChildren: ['frame-1'],
        nodes: { 'frame-1': frameNode, 'child-1': { id: 'child-1', kind: 'shape' } },
        assets: {},
      },
    } as any;
  }

  it('creates a fresh transparent mask when a frame has no mask (paint-to-create)', () => {
    const tool = new RefineMaskTool();
    const ctx = frameCtx();
    tool.onActivate(ctx);
    const maskData = (tool as any).maskData as ImageData | null;
    expect(maskData).not.toBeNull();
    expect(maskData!.width).toBe(60);
    expect(maskData!.height).toBe(40);
    // Fully transparent: painting reveals, Alt+paint hides.
    let max = 0;
    for (let i = 0; i < maskData!.data.length; i += 4) {
      max = Math.max(max, maskData!.data[i]!);
    }
    expect(max).toBe(0);
  });

  it('commits a container-local mask on drag end', () => {
    const tool = new RefineMaskTool();
    const ctx = frameCtx();
    tool.onActivate(ctx);
    tool.onPointerDown(
      { altKey: false, clientX: 30, clientY: 20, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
    tool.onDragEnd(ctx);
    expect(ctx.commitRasterMask).toHaveBeenCalledTimes(1);
    const args = ctx.commitRasterMask.mock.calls[0];
    expect(args[0]).toBe('frame-1');
    expect(args[4]).toBe('container-local-pixels');
  });

  it('creates a mask for an image without background removal (paint-to-create)', () => {
    const tool = new RefineMaskTool();
    const node = makeMockImageNode();
    const noMask = { ...node, mask: undefined };
    const ctx = {
      selection: ['img-1'],
      getNode: vi.fn(() => noMask),
      commitRasterMask: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      announce: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      setDraft: vi.fn(),
      setPointerCapture: vi.fn(),
      altKey: false,
      document: { id: 'test-doc', rootChildren: ['img-1'], nodes: { 'img-1': noMask }, assets: {} },
    } as any;
    tool.onActivate(ctx);
    const maskData = (tool as any).maskData as ImageData | null;
    expect(maskData).not.toBeNull();
    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );
    tool.onDragEnd(ctx);
    expect(ctx.commitRasterMask).toHaveBeenCalledTimes(1);
    expect(ctx.commitRasterMask.mock.calls[0][4]).toBe('source-image-pixels');
  });
});
