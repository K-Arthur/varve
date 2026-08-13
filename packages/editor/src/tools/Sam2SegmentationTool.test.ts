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
});

function mockCtx() {
  return {
    canvasToWorld: (x: number, y: number) => ({ x, y }),
    setPointerCapture: vi.fn(),
    announce: vi.fn(),
  } as unknown as import('./types').ToolContext;
}
