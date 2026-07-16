/**
 * TrimapEditTool tests — TDD: transform-aware coordinate mapping,
 * pressure sensitivity, and edge-case handling.
 */
import { describe, expect, it, vi } from 'vitest';
import { TrimapEditTool } from '../TrimapEditTool';

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

function createTestTrimap(w = 50, h = 50, value = 128): Uint8Array {
  const data = new Uint8Array(w * h);
  data.fill(value);
  return data;
}

describe('TrimapEditTool', () => {
  function makeMinimalCtx(overrides?: Record<string, unknown>) {
    return {
      selection: ['img-1'],
      getNode: vi.fn(() => makeMockImageNode()),
      getTrimapData: vi.fn(() => null),
      setTrimapPreview: vi.fn(),
      commitTrimapEdit: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      announce: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
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

  it('trimap paint on unscaled image sets correct trimap values', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap();
    (tool as any).trimap = trimap;
    (tool as any).width = 50;
    (tool as any).height = 50;
    (tool as any).nodeId = 'img-1';
    (tool as any).options.penMode = 'foreground';
    const ctx = makeMinimalCtx();

    tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    const centerIdx = 25 * 50 + 25;
    expect(trimap[centerIdx]).toBe(255);
  });

  it('mapper converts world coords on scaled image', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap();
    (tool as any).trimap = trimap;
    (tool as any).width = 50;
    (tool as any).height = 50;
    (tool as any).nodeId = 'img-1';
    (tool as any).options.penMode = 'foreground';
    const ctx = makeMinimalCtx();

    const mockMapper = {
      mapWorldPoint: vi.fn((p: { x: number; y: number }) => ({
        x: Math.round(p.x / 2),
        y: Math.round(p.y / 2),
      })),
    };
    (tool as any).mapper = mockMapper;

    tool.onPointerDown(
      { altKey: false, clientX: 50, clientY: 50, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    expect(mockMapper.mapWorldPoint).toHaveBeenCalledWith({ x: 50, y: 50 });
  });

  it('trimap paint on flipped image uses mapper', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap();
    (tool as any).trimap = trimap;
    (tool as any).width = 50;
    (tool as any).height = 50;
    (tool as any).nodeId = 'img-1';
    (tool as any).options.penMode = 'foreground';
    (tool as any).options.brushSize = 4;

    const mockMapper = {
      mapWorldPoint: vi.fn((p: { x: number; y: number }) => ({
        x: Math.round(50 - p.x),
        y: Math.round(p.y),
      })),
    };
    (tool as any).mapper = mockMapper;

    const ctx = makeMinimalCtx();
    tool.onPointerDown(
      { altKey: false, clientX: 10, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    // The mapper maps world x=10 to source x=40 (flipped).
    // Brush radius 2: paints cols 38-42, rows 23-27.
    const flippedIdx = 25 * 50 + 40;
    expect(trimap[flippedIdx]).toBe(255);
    // Position (10, 25) is not in the brush area because mapper mapped it to (40, 25)
    const notFlippedIdx = 25 * 50 + 10;
    expect(trimap[notFlippedIdx]).toBe(128);
  });

  it('pressure sensitivity affects stroke but not trimap values', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap(10, 10, 128);
    const preAvg = trimap.reduce((a, b) => a + b, 0) / trimap.length;
    (tool as any).trimap = trimap;
    (tool as any).width = 10;
    (tool as any).height = 10;
    (tool as any).nodeId = 'img-1';
    (tool as any).options.penMode = 'foreground';
    const ctx = makeMinimalCtx();

    tool.onPointerDown(
      { altKey: false, clientX: 5, clientY: 5, pointerId: 1, pressure: 0.1 } as any,
      ctx,
    );

    const postAvg = trimap.reduce((a, b) => a + b, 0) / trimap.length;
    expect(postAvg).toBeGreaterThanOrEqual(preAvg);
  });

  it('coalesced events paint intermediate points', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap(100, 100, 128);
    (tool as any).trimap = trimap;
    (tool as any).width = 100;
    (tool as any).height = 100;
    (tool as any).nodeId = 'img-1';
    (tool as any).lastPaintedPoint = { x: 10, y: 10 };
    (tool as any).options.penMode = 'background';
    (tool as any).options.brushSize = 4;
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
      { clientX: 15, clientY: 15, pressure: 0.5 },
      { clientX: 20, clientY: 20, pressure: 0.6 },
      { clientX: 25, clientY: 25, pressure: 0.7 },
    ];

    tool.onPointerMove({ pointerId: 1, getCoalescedEvents: () => coalesced } as any, ctx);

    // Brush at (15,15) with radius 2 paints pixels at rows 13-17, cols 13-17
    const bgIdx14_14 = 14 * 100 + 14;
    expect(trimap[bgIdx14_14]).toBe(0);

    expect(ctx.setTrimapPreview).toHaveBeenCalled();
  });

  it('unknown mode sets trimap to 128', () => {
    const tool = new TrimapEditTool();
    const trimap = createTestTrimap();
    (tool as any).trimap = trimap;
    (tool as any).width = 50;
    (tool as any).height = 50;
    (tool as any).nodeId = 'img-1';
    (tool as any).options.penMode = 'unknown';
    const ctx = makeMinimalCtx();

    tool.onPointerDown(
      { altKey: false, clientX: 10, clientY: 10, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    const idx = 10 * 50 + 10;
    expect(trimap[idx]).toBe(128);
  });

  it('Escape exits trimap edit mode', () => {
    const tool = new TrimapEditTool();
    const ctx = makeMinimalCtx({ setTool: vi.fn() });
    const handled = tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx);
    expect(handled).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('pen mode switches with keyboard 1/2/3', () => {
    const tool = new TrimapEditTool();
    const ctx = makeMinimalCtx();

    tool.onKeyDown({ key: '1' } as KeyboardEvent, ctx);
    expect(tool.getOptions().penMode).toBe('foreground');

    tool.onKeyDown({ key: '2' } as KeyboardEvent, ctx);
    expect(tool.getOptions().penMode).toBe('unknown');

    tool.onKeyDown({ key: '3' } as KeyboardEvent, ctx);
    expect(tool.getOptions().penMode).toBe('background');
  });

  it('no trimap gracefully handles pointer down', () => {
    const tool = new TrimapEditTool();
    const ctx = makeMinimalCtx({ selection: [] });

    const result = tool.onPointerDown(
      { altKey: false, clientX: 25, clientY: 25, pointerId: 1, pressure: 0.5 } as any,
      ctx,
    );

    expect(result.consumed).toBe(false);
  });
});
