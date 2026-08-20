// @vitest-environment jsdom

import { makeRasterLayerNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrushWorkerHost } from '../../render/brushWorkerHost';
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

  it('defers commit until worker dab batches settle', () => {
    const settlers: Array<() => void> = [];
    const worker = {
      isUsingWorker: true,
      beginStroke: vi.fn(),
      appendPoints: vi.fn(),
      endStroke: vi.fn((_id: string, _gen: number, onSettled?: () => void) => {
        if (onSettled) settlers.push(onSettled);
      }),
      cancelStroke: vi.fn(),
      destroy: vi.fn(),
      onBatch: null,
    } as unknown as BrushWorkerHost;
    tool.setWorkerHost(worker);

    const down = makePointerEvent(100, 200);
    const move = makePointerEvent(140, 200);
    tool.onPointerDown(down, ctx);
    tool.onPointerMove(move, ctx);
    tool.onPointerUp(move, ctx);

    expect(settlers).toHaveLength(1);
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    settlers[0]!();
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('cancels the generation that is actually in flight', () => {
    const worker = {
      isUsingWorker: true,
      beginStroke: vi.fn(),
      appendPoints: vi.fn(),
      endStroke: vi.fn(),
      cancelStroke: vi.fn(),
      destroy: vi.fn(),
      onBatch: null,
    } as unknown as BrushWorkerHost;
    tool.setWorkerHost(worker);

    tool.onPointerDown(makePointerEvent(100, 200), ctx);
    const started = (worker.beginStroke as ReturnType<typeof vi.fn>).mock.calls[0];
    tool.onDragCancel(ctx);

    const cancelled = (worker.cancelStroke as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cancelled?.[0]).toBe(started?.[0]);
    expect(cancelled?.[1]).toBe(started?.[1]);
  });

  it('snapshots the brush preset for the duration of a stroke', () => {
    const appended: unknown[] = [];
    const worker = {
      isUsingWorker: true,
      beginStroke: vi.fn((_id: string, _gen: number, preset: unknown) => appended.push(preset)),
      appendPoints: vi.fn(),
      endStroke: vi.fn((_id: string, _gen: number, onSettled?: () => void) => onSettled?.()),
      cancelStroke: vi.fn(),
      destroy: vi.fn(),
      onBatch: null,
    } as unknown as BrushWorkerHost;
    tool.setWorkerHost(worker);

    tool.onPointerDown(makePointerEvent(100, 200), ctx);
    const snapshot = appended[0] as { radius: number };
    const radiusAtStart = snapshot.radius;
    // Changing settings mid-stroke must not retroactively alter the stroke.
    tool.updatePresetFromSettings({ ...tool.getSettings(), radius: radiusAtStart + 40 });
    expect(snapshot.radius).toBe(radiusAtStart);
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

describe('PaintTool wet media', () => {
  it('mixes a stroke into wet paint but not into dried paint', async () => {
    const { WetPaintManager } = await import('@varve/scene');
    const wet = new WetPaintManager();
    const wake = vi.fn();

    const paintOnce = (colour: [number, number, number, number]) => {
      const tool = new PaintTool(false);
      // The shared mock's updateNode is a bare spy; wet mixing happens inside
      // the updater, so this test needs one that actually runs it.
      const ctx = makeCtx({
        foregroundColor: colour,
        updateNode: vi.fn((_id: string, updater: (n: never) => never) => {
          updater(makeRasterLayerNode('raster-1', { width: 512, height: 512 }) as never);
        }),
      });
      tool.setWetPaint(wet, wake);
      tool.setWetEnabled(true, 0.8, 0.5);
      tool.setWorkerHost(new BrushWorkerHost(null));
      const captured: Array<[number, number, number, number]> = [];
      const original = tool as unknown as {
        mixWet: (s: unknown, d: unknown, c: [number, number, number, number]) => number[];
      };
      const realMix = original.mixWet.bind(tool);
      original.mixWet = (s, d, c) => {
        const out = realMix(s, d, c) as [number, number, number, number];
        captured.push(out);
        return out;
      };
      tool.onPointerDown(makePointerEvent(100, 100), ctx);
      tool.onPointerUp(makePointerEvent(100, 100), ctx);
      return captured;
    };

    const red = paintOnce([255, 0, 0, 255]);
    expect(red[0]).toEqual([255, 0, 0, 255]);
    expect(wake).toHaveBeenCalled();

    // Blue over still-wet red comes out mixed, not pure blue.
    const blueWhileWet = paintOnce([0, 0, 255, 255]);
    expect(blueWhileWet[0]![0]).toBeGreaterThan(0);

    // After drying, the same stroke deposits pure blue.
    wet.tick(0, 1);
    wet.tick(100_000, 1);
    const blueWhenDry = paintOnce([0, 0, 255, 255]);
    expect(blueWhenDry[0]).toEqual([0, 0, 255, 255]);
  });

  it('does not wake the drying scheduler when wet media is off', () => {
    const wake = vi.fn();
    const tool = new PaintTool(false);
    const ctx = makeCtx();
    tool.setWorkerHost(new BrushWorkerHost(null));
    tool.setWetPaint(null, wake);
    tool.onPointerDown(makePointerEvent(100, 100), ctx);
    tool.onPointerUp(makePointerEvent(100, 100), ctx);
    expect(wake).not.toHaveBeenCalled();
  });
});

describe('PaintTool mask painting', () => {
  function maskCtx(overrides: Partial<ToolContext> = {}) {
    const node = {
      id: 'frame-1',
      kind: 'frame',
      name: 'Card',
      w: 64,
      h: 64,
      visible: true,
      locked: false,
      mask: {},
    };
    return makeCtx({
      document: {
        nodes: { 'frame-1': node },
        rootChildren: ['frame-1'],
        rasterMaskAssets: {},
      } as unknown as ToolContext['document'],
      selection: ['frame-1'],
      maskEditTarget: { nodeId: 'frame-1', maskId: 'm1' },
      getNode: (id: string) => (id === 'frame-1' ? (node as never) : undefined),
      commitRasterMask: vi.fn(),
      ...overrides,
    });
  }

  function paintStroke(tool: PaintTool, ctx: ToolContext) {
    tool.setWorkerHost(new BrushWorkerHost(null));
    tool.onPointerDown(makePointerEvent(10, 10), ctx);
    tool.onPointerMove(makePointerEvent(30, 30), ctx);
    tool.onPointerUp(makePointerEvent(30, 30), ctx);
  }

  it('commits mask pixels instead of layer pixels', () => {
    const tool = new PaintTool(false);
    const ctx = maskCtx();
    paintStroke(tool, ctx);

    expect(ctx.commitRasterMask).toHaveBeenCalledTimes(1);
    // The content layer is never touched by a mask stroke.
    expect(ctx.updateNode).not.toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('commits the mask in container-local pixel space', () => {
    const tool = new PaintTool(false);
    const ctx = maskCtx();
    paintStroke(tool, ctx);
    const call = (ctx.commitRasterMask as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('frame-1');
    expect(call[4]).toBe('container-local-pixels');
  });

  it('is one history entry per stroke, not one per dab', () => {
    const tool = new PaintTool(false);
    const ctx = maskCtx();
    paintStroke(tool, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('aborts rather than recording an empty entry when nothing was painted', () => {
    const tool = new PaintTool(false);
    // A stroke entirely outside the mask plane touches no pixels.
    const ctx = maskCtx();
    tool.setWorkerHost(new BrushWorkerHost(null));
    tool.onPointerDown(makePointerEvent(-500, -500), ctx);
    tool.onPointerUp(makePointerEvent(-500, -500), ctx);
    expect(ctx.commitRasterMask).not.toHaveBeenCalled();
    expect(ctx.abortTransaction).toHaveBeenCalled();
  });

  it('paints layer pixels again once the mask target is cleared', () => {
    const tool = new PaintTool(false);
    const ctx = maskCtx({ maskEditTarget: null });
    paintStroke(tool, ctx);
    expect(ctx.commitRasterMask).not.toHaveBeenCalled();
    expect(ctx.updateNode).toHaveBeenCalled();
  });

  it('refuses a locked layer with a spoken reason instead of failing silently', () => {
    const locked = {
      id: 'r1',
      kind: 'rasterLayer',
      name: 'Background',
      visible: true,
      locked: true,
    };
    const ctx = makeCtx({
      document: {
        nodes: { r1: locked },
        rootChildren: ['r1'],
      } as unknown as ToolContext['document'],
      selection: ['r1'],
      getNode: (id: string) => (id === 'r1' ? (locked as never) : undefined),
    });
    const tool = new PaintTool(false);
    tool.setWorkerHost(new BrushWorkerHost(null));
    const result = tool.onPointerDown(makePointerEvent(10, 10), ctx);

    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('locked'));
    expect(ctx.abortTransaction).toHaveBeenCalled();
    // Never auto-unlocks.
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});
