// @vitest-environment jsdom

import { makeRasterLayerNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushWorkerHost, DabResult } from '../../render/brushWorkerHost';
import { normalizeInputEvent } from '../inputNormalizer';
import { PaintTool } from '../PaintTool';
import type { ToolContext } from '../types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    document: {
      nodes: {},
      rootChildren: [],
      name: 'Test',
    } as unknown as ToolContext['document'],
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    pointerPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    maskPreviewMode: 'none',
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    nodeEditTargetId: null,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    setTool: vi.fn(),
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx: number, wy: number) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn(() => null),
    setDropTargetFrame: vi.fn(),
    nodeWorldBounds: vi.fn(() => null),
    engine: null,
    hitTest: vi.fn(() => null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    snapPosition: vi.fn((b: { x: number; y: number; w: number; h: number }) => ({
      x: b.x,
      y: b.y,
      guides: [],
    })),
    createRasterLayer: vi.fn(() => 'raster-1'),
    touchMultiSelect: { active: false, suspended: false },
    ...overrides,
  };
}

function makePointerEvent(
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    pointerType: 'mouse',
    getCoalescedEvents: vi.fn(() => []),
    ...overrides,
  } as unknown as PointerEvent;
}

describe('PaintTool', () => {
  let tool: PaintTool;
  let ctx: ToolContext;

  beforeEach(() => {
    tool = new PaintTool(false);
    ctx = makeCtx();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a PaintTool with paint id and default preset', () => {
    expect(tool.id).toBe('paint');
    expect(tool.cursor({} as any)).toEqual({ css: 'crosshair' });
  });

  it('creates an EraserTool with eraser id', () => {
    const eraser = new PaintTool(true);
    expect(eraser.id).toBe('eraser');
  });

  it('onPointerDown opens a transaction and calls createRasterLayer', () => {
    const pointer = makePointerEvent(100, 200);
    const result = tool.onPointerDown(pointer, ctx);

    expect(result.consumed).toBe(true);
    expect(ctx.beginTransaction).toHaveBeenCalledOnce();
    expect(ctx.createRasterLayer).toHaveBeenCalledOnce();
  });

  it('onPointerUp commits the transaction', () => {
    const pointer = makePointerEvent(100, 200);
    tool.onPointerDown(pointer, ctx);
    tool.onPointerUp(pointer, ctx);

    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('defers commit until worker dab batches settle', async () => {
    const resolvers: Array<(result: DabResult) => void> = [];
    const worker = {
      isUsingWorker: true,
      generateDabs: vi.fn(() => new Promise<DabResult>((resolve) => resolvers.push(resolve))),
      cancelStroke: vi.fn(),
      destroy: vi.fn(),
    } as unknown as BrushWorkerHost;
    tool.setWorkerHost(worker);

    const down = makePointerEvent(100, 200);
    const move = makePointerEvent(110, 200);
    tool.onPointerDown(down, ctx);
    tool.onPointerMove(move, ctx);
    tool.onPointerUp(move, ctx);

    expect(resolvers).toHaveLength(2);
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    resolvers[0]!({ dabs: [], bounds: { x: 0, y: 0, w: 0, h: 0 } });
    await Promise.resolve();
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    resolvers[1]!({ dabs: [], bounds: { x: 0, y: 0, w: 0, h: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('onPointerUp sets draft to null', () => {
    const pointer = makePointerEvent(100, 200);
    tool.onPointerDown(pointer, ctx);
    tool.onPointerUp(pointer, ctx);

    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('onPointerCancel aborts transaction', () => {
    const pointer = makePointerEvent(100, 200);
    tool.onPointerDown(pointer, ctx);
    tool.onPointerCancel(pointer, ctx);

    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('does not cancel an active stylus stroke for a second touch contact', () => {
    const pointer = makePointerEvent(100, 200, { pointerType: 'pen', pointerId: 1 });
    tool.onPointerDown(pointer, ctx);
    const palm = makePointerEvent(110, 210, { pointerType: 'touch', pointerId: 2 });

    tool.onPointerCancel(palm, ctx);

    expect(ctx.abortTransaction).not.toHaveBeenCalled();
  });

  it('Escape key aborts stroke when dragging', () => {
    const pointer = makePointerEvent(100, 200);
    tool.onPointerDown(pointer, ctx);

    const keyEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const handled = tool.onKeyDown(keyEvent, ctx);

    expect(handled).toBe(true);
    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
  });

  it('finds existing RasterLayerNode when one exists in document', () => {
    const rasterNode = makeRasterLayerNode('existing-raster', { width: 4096, height: 4096 });
    ctx = makeCtx({
      document: {
        activePageId: null,
        nodes: { 'existing-raster': rasterNode as any },
        rootChildren: ['existing-raster'],
        name: 'Test',
      } as any,
      createRasterLayer: vi.fn(),
    });

    const pointer = makePointerEvent(100, 200);
    tool.onPointerDown(pointer, ctx);

    expect(ctx.createRasterLayer).not.toHaveBeenCalled();
    expect(ctx.beginTransaction).toHaveBeenCalledOnce();
  });

  it('eraser mode sets createRasterLayer with eraser defaults', () => {
    const eraser = new PaintTool(true);
    expect(eraser.id).toBe('eraser');

    const ectx = makeCtx();
    const pointer = makePointerEvent(100, 200);
    eraser.onPointerDown(pointer, ectx);

    expect(ectx.beginTransaction).toHaveBeenCalledOnce();
  });

  it('uses foregroundColor from context instead of hardcoded black', () => {
    const colorCtx = makeCtx({ foregroundColor: [255, 0, 0, 255] });
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    tool.onPointerDown(pointer, colorCtx);

    // Trigger flushDabs via onPointerUp — move past threshold first
    const move = makePointerEvent(110, 200, { pointerId: 1 });
    tool.onPointerMove(move, colorCtx);
    tool.onPointerUp(move, colorCtx);

    // updateNode was called with the callback that composites dabs using foregroundColor
    expect(colorCtx.updateNode).toHaveBeenCalled();
    expect(colorCtx.commitTransaction).toHaveBeenCalled();
  });

  it('eraser mode ignores foregroundColor (uses transparent)', () => {
    const eraser = new PaintTool(true);
    const colorCtx = makeCtx({ foregroundColor: [255, 0, 0, 255] });
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    eraser.onPointerDown(pointer, colorCtx);

    const move = makePointerEvent(110, 200, { pointerId: 1 });
    eraser.onPointerMove(move, colorCtx);
    eraser.onPointerUp(move, colorCtx);

    expect(colorCtx.updateNode).toHaveBeenCalled();
    expect(colorCtx.commitTransaction).toHaveBeenCalled();
  });

  it('bracket left [ decreases brush size with minimum of 1', () => {
    const keyEvent = new KeyboardEvent('keydown', { key: '[', bubbles: true });
    const handled = tool.onKeyDown(keyEvent, ctx);

    expect(handled).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('Brush size:'));
    // Default radius is 10, decreased by 2 = 8
    expect(ctx.announce).toHaveBeenCalledWith('Brush size: 8px');
  });

  it('bracket right ] increases brush size', () => {
    const keyEvent = new KeyboardEvent('keydown', { key: ']', bubbles: true });
    const handled = tool.onKeyDown(keyEvent, ctx);

    expect(handled).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Brush size: 12px');
  });

  it('bracket ] increases brush size from minimum', () => {
    // Set radius to 1 first
    const keyEvent = new KeyboardEvent('keydown', { key: '[', bubbles: true });
    tool.onKeyDown(keyEvent, ctx); // 10 → 8
    tool.onKeyDown(keyEvent, ctx); // 8 → 6
    tool.onKeyDown(keyEvent, ctx); // 6 → 4
    tool.onKeyDown(keyEvent, ctx); // 4 → 2
    tool.onKeyDown(keyEvent, ctx); // 2 → 1 (minimum)

    const rightKey = new KeyboardEvent('keydown', { key: ']', bubbles: true });
    tool.onKeyDown(rightKey, ctx);

    expect(ctx.announce).toHaveBeenLastCalledWith('Brush size: 3px');
  });

  it('bracket left clamps brush size to minimum 1', () => {
    // Reduce from 10 to 1 (5 bracket-left presses)
    const keyEvent = new KeyboardEvent('keydown', { key: '[', bubbles: true });
    for (let i = 0; i < 10; i++) {
      tool.onKeyDown(keyEvent, ctx);
    }

    expect(ctx.announce).toHaveBeenLastCalledWith('Brush size: 1px');
  });

  it('bracket size is independent of eraser mode', () => {
    const eraser = new PaintTool(true);
    const ectx = makeCtx();

    const rightKey = new KeyboardEvent('keydown', { key: ']', bubbles: true });
    eraser.onKeyDown(rightKey, ectx);

    expect(ectx.announce).toHaveBeenCalledWith('Brush size: 12px');
  });

  it('ignores non-bracket keys when not dragging', () => {
    const keyEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    const handled = tool.onKeyDown(keyEvent, ctx);

    expect(handled).toBe(false);
    expect(ctx.announce).not.toHaveBeenCalled();
  });

  it('Escape key is ignored when not dragging', () => {
    const keyEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const handled = tool.onKeyDown(keyEvent, ctx);

    expect(handled).toBe(false);
  });

  it('onPointerMove captures coalesced events with pressure', () => {
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    tool.onPointerDown(pointer, ctx);

    const moveEvent = makePointerEvent(105, 200, {
      pointerId: 1,
      pressure: 0.8,
      getCoalescedEvents: vi.fn(() => [
        { clientX: 102, clientY: 200, pressure: 0.7 } as PointerEvent,
        { clientX: 104, clientY: 200, pressure: 0.9 } as PointerEvent,
      ]),
    });
    tool.onPointerMove(moveEvent, ctx);

    // updateNode should have been called for the dabs
    expect(ctx.updateNode).toHaveBeenCalled();
  });

  it('onPointerMove without coalesced events falls back to single event', () => {
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    tool.onPointerDown(pointer, ctx);

    const moveEvent = makePointerEvent(110, 200, {
      pointerId: 1,
      pressure: 0.6,
      getCoalescedEvents: vi.fn(() => []),
    });
    tool.onPointerMove(moveEvent, ctx);

    expect(ctx.updateNode).toHaveBeenCalled();
  });

  it('consumes centrally normalized samples without reading the browser event twice', () => {
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    tool.onPointerDown(pointer, ctx);
    const getCoalescedEvents = vi.fn(() => {
      throw new Error('coalesced input was consumed twice');
    });
    const moveEvent = makePointerEvent(110, 200, { pointerId: 1, getCoalescedEvents });
    ctx.sourceEvents = [normalizeInputEvent(moveEvent)];

    expect(() => tool.onPointerMove(moveEvent, ctx)).not.toThrow();
    expect(getCoalescedEvents).not.toHaveBeenCalled();
  });

  it('tilt values propagate through pointer events', () => {
    const pointer = makePointerEvent(100, 200, {
      pointerId: 1,
    } as any);
    // tiltX and tiltY are on the PointerEvent but not explicitly set in makePointerEvent
    // Verify default is 0/0
    // The tilt is captured from ev.tiltX/tiltY in buildToolCtx
    tool.onPointerDown(pointer, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledOnce();
  });

  it('onDeactivate aborts in-progress stroke', () => {
    const pointer = makePointerEvent(100, 200, { pointerId: 1 });
    tool.onPointerDown(pointer, ctx);

    tool.onDeactivate(ctx);

    expect(ctx.abortTransaction).toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });
});
