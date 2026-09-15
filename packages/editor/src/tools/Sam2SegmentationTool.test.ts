import { describe, expect, it, vi } from 'vitest';
import { Sam2SegmentationTool } from './Sam2SegmentationTool';

describe('Sam2SegmentationTool', () => {
  it('has correct id', () => {
    const tool = new Sam2SegmentationTool();
    expect(tool.id).toBe('sam2Segment');
  });

  it('returns crosshair cursor', () => {
    const tool = new Sam2SegmentationTool();
    const spec = tool.cursor('idle');
    expect(spec.css).toBe('crosshair');
  });

  it('clears prompts on activate', () => {
    const tool = new Sam2SegmentationTool();
    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }),
      mockCtx(),
    );
    tool.onDragEnd(mockCtx());
    expect(tool.getPrompts().points.length).toBe(1);

    tool.onActivate(mockCtx());
    expect(tool.getPrompts().points.length).toBe(0);
  });

  it('adds foreground point on click', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);

    const { points } = tool.getPrompts();
    expect(points).toHaveLength(1);
    expect(points[0]!.label).toBe(1); // foreground
    expect(points[0]!.x).toBeCloseTo(50);
    expect(points[0]!.y).toBeCloseTo(50);
  });

  it('adds background point on shift+click', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', {
        clientX: 30,
        clientY: 40,
        button: 0,
        shiftKey: true,
      }),
      ctx,
    );
    tool.onDragEnd(ctx);

    const { points } = tool.getPrompts();
    expect(points).toHaveLength(1);
    expect(points[0]!.label).toBe(0); // background
  });

  it('uses the visible polarity setting while preserving shift as an override', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();
    tool.setPromptPolarity('exclude');

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 30, clientY: 40, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);
    expect(tool.getPrompts().points[0]!.label).toBe(0);

    tool.clearPrompts();
    tool.setPromptPolarity('include');
    tool.onPointerDown(
      new PointerEvent('pointerdown', {
        clientX: 30,
        clientY: 40,
        button: 0,
        shiftKey: true,
      }),
      ctx,
    );
    tool.onDragEnd(ctx);
    expect(tool.getPrompts().points[0]!.label).toBe(0);
  });

  it('accumulates multiple points', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);
    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, shiftKey: true }),
      ctx,
    );
    tool.onDragEnd(ctx);

    expect(tool.getPrompts().points).toHaveLength(2);
  });

  it('clears prompts via clearPrompts', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);
    expect(tool.getPrompts().points.length).toBe(1);

    tool.clearPrompts();
    expect(tool.getPrompts().points.length).toBe(0);
  });

  it('ignores non-left-click buttons', () => {
    const tool = new Sam2SegmentationTool();
    const result = tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 2 }),
      mockCtx(),
    );
    expect(result.consumed).toBe(false);
    expect(tool.getPrompts().points.length).toBe(0);
  });

  it('handles drag move for box creation', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );

    // Simulate drag move
    (tool as unknown as { drag: { currentCanvas: { x: number; y: number } } }).drag.currentCanvas =
      {
        x: 100,
        y: 100,
      };
    tool.onDragMove(ctx);

    const { box } = tool.getPrompts();
    expect(box).not.toBeNull();
    expect(box!.x2).toBeCloseTo(100);
    expect(box!.y2).toBeCloseTo(100);
  });

  it('uses a box prompt without injecting a point at the drag origin', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = mockCtx();
    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );
    (tool as unknown as { drag: { currentCanvas: { x: number; y: number } } }).drag.currentCanvas =
      {
        x: 100,
        y: 80,
      };
    tool.onDragMove(ctx);
    tool.onDragEnd(ctx);
    expect(tool.getPrompts().points).toHaveLength(0);
    expect(tool.getPrompts().box).toEqual({ x1: 10, y1: 10, x2: 100, y2: 80 });
  });

  it('creates a box with two taps and normalizes reverse corner order', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tool.setPromptMode('box');

    tap(tool, ctx, 100, 80);
    expect(ctx.objectSelectionSession?.status).toBe('drawing');
    expect(ctx.objectSelectionSession?.box).toBeNull();
    expect(ctx.objectSelectionSession?.draftBox).toEqual({
      x1: 100,
      y1: 80,
      x2: 100,
      y2: 80,
    });
    expect(ctx.applySam2Segmentation).not.toHaveBeenCalled();

    tap(tool, ctx, 20, 10);
    expect(tool.getPrompts().points).toHaveLength(0);
    expect(tool.getPrompts().box).toEqual({ x1: 20, y1: 10, x2: 100, y2: 80 });
    expect(ctx.objectSelectionSession?.box).toEqual({
      x1: 20,
      y1: 10,
      x2: 100,
      y2: 80,
    });
    expect(ctx.applySam2Segmentation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompts: { box: { x1: 20, y1: 10, x2: 100, y2: 80 } },
        operation: 'preview',
      }),
    );
  });

  it('keeps existing points when a later box prompt is drawn', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);
    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0 }),
      ctx,
    );
    (tool as unknown as { drag: { currentCanvas: { x: number; y: number } } }).drag.currentCanvas =
      {
        x: 100,
        y: 80,
      };
    tool.onDragMove(ctx);
    tool.onDragEnd(ctx);

    expect(ctx.objectSelectionSession?.points).toEqual([{ x: 10, y: 10, label: 1 }]);
    expect(ctx.objectSelectionSession?.box).toEqual({ x1: 20, y1: 20, x2: 100, y2: 80 });
  });

  it('cancels the transient session when the tool deactivates', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }),
      ctx,
    );
    tool.onDragEnd(ctx);

    tool.onDeactivate(ctx);

    expect(ctx.cancelSam2Segmentation).toHaveBeenCalledTimes(1);
    expect(tool.getPrompts()).toEqual({ points: [], box: null });
  });

  it('removes a specific prompt when its marker is tapped', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tap(tool, ctx, 10, 10);
    tap(tool, ctx, 100, 100);
    expect(tool.getPrompts().points).toHaveLength(2);

    tap(tool, ctx, 100, 100);

    expect(tool.getPrompts().points).toEqual([{ x: 10, y: 10, label: 1 }]);
    expect(ctx.applySam2Segmentation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompts: { points: [{ x: 10, y: 10, label: 1 }] },
        operation: 'preview',
      }),
    );
  });

  it('moves a specific prompt when its marker is dragged', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tap(tool, ctx, 10, 10);

    tool.onPointerDown(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 }),
      ctx,
    );
    tool.onPointerMove(
      new PointerEvent('pointermove', { clientX: 50, clientY: 60, button: 0, pointerId: 1 }),
      ctx,
    );
    tool.onPointerUp(
      new PointerEvent('pointerup', { clientX: 50, clientY: 60, button: 0, pointerId: 1 }),
      ctx,
    );

    expect(tool.getPrompts().points).toEqual([{ x: 50, y: 60, label: 1 }]);
    expect(ctx.announce).toHaveBeenCalledWith('Prompt moved');
    expect(ctx.applySam2Segmentation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompts: { points: [{ x: 50, y: 60, label: 1 }] },
        operation: 'preview',
      }),
    );
  });

  it('clears the session when the last prompt marker is tapped', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tap(tool, ctx, 40, 40);
    tap(tool, ctx, 44, 43);

    expect(tool.getPrompts().points).toHaveLength(0);
    expect(ctx.cancelSam2Segmentation).toHaveBeenCalled();
  });

  it('adds a point when the tap is outside the marker radius', () => {
    const tool = new Sam2SegmentationTool();
    const ctx = statefulMockCtx();
    tap(tool, ctx, 10, 10);
    tap(tool, ctx, 60, 60);

    expect(tool.getPrompts().points).toHaveLength(2);
  });
});

function mockCtx() {
  return {
    canvasToWorld: (x: number, y: number) => ({ x, y }),
    zoom: 1,
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    announce: vi.fn(),
  } as unknown as import('./types').ToolContext;
}

function tap(
  tool: Sam2SegmentationTool,
  ctx: import('./types').ToolContext,
  x: number,
  y: number,
): void {
  const event = { clientX: x, clientY: y, button: 0, pointerId: 1 };
  tool.onPointerDown(new PointerEvent('pointerdown', event), ctx);
  tool.onPointerUp(new PointerEvent('pointerup', event), ctx);
}

function statefulMockCtx() {
  const ctx = {
    ...mockCtx(),
    document: { id: 'doc-1' },
    selection: ['image-1'],
    objectSelectionSession: null,
    patchEditorState: vi.fn((patch: { objectSelectionSession?: unknown }) => {
      ctx.objectSelectionSession =
        patch.objectSelectionSession as typeof ctx.objectSelectionSession;
    }),
    applySam2Segmentation: vi.fn().mockResolvedValue(null),
    cancelSam2Segmentation: vi.fn(),
  } as unknown as import('./types').ToolContext & {
    objectSelectionSession: import('../context/types').ObjectSelectionSession | null;
  };
  return ctx;
}
