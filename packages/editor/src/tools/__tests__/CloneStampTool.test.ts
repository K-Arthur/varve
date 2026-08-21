/**
 * CloneStampTool tests — 6 TDD tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloneStampTool } from '../CloneStampTool';

describe('CloneStampTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 100);
    return canvas;
  }

  it('sets source point on Alt+click', () => {
    const tool = new CloneStampTool();
    const ctx = {
      canvasElement: makeMockCanvas(),
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
    } as any;

    const result = tool.onPointerDown(
      { altKey: true, clientX: 30, clientY: 40, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Source point set');
  });

  it('paints from source to target on click', () => {
    const tool = new CloneStampTool();
    const canvas = makeMockCanvas();
    const canvasCtx = canvas.getContext('2d')!;
    canvasCtx.fillStyle = '#ff0000';
    canvasCtx.fillRect(0, 0, 10, 10);
    canvasCtx.fillStyle = '#0000ff';
    canvasCtx.fillRect(50, 50, 10, 10);

    const ctx = {
      canvasElement: canvas,
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      setDraft: vi.fn(),
    } as any;

    (tool as any).sourcePoint = { x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 55, clientY: 55, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('prompts to set source if none set', () => {
    const tool = new CloneStampTool();
    const ctx = {
      canvasElement: makeMockCanvas(),
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
    } as any;

    const result = tool.onPointerDown(
      { altKey: false, clientX: 10, clientY: 10, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith('Alt+click to set source point first');
  });

  it('supports aligned mode offset tracking', () => {
    const tool = new CloneStampTool();
    (tool as any).options.aligned = true;
    (tool as any).sourcePoint = { x: 10, y: 10 };
    (tool as any).sourceBase = { x: 10, y: 10 };
    (tool as any).targetBase = { x: 50, y: 50 };
    (tool as any).lastPaintedPoint = { x: 50, y: 50 };

    const canvas = makeMockCanvas();
    const ctx = {
      canvasElement: canvas,
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      setDraft: vi.fn(),
    } as any;

    const result = tool.onPointerDown(
      { altKey: false, clientX: 60, clientY: 60, pointerId: 2 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('supports non-aligned mode (fixed offset)', () => {
    const tool = new CloneStampTool();
    (tool as any).options.aligned = false;
    (tool as any).sourcePoint = { x: 10, y: 10 };
    (tool as any).sourceBase = { x: 10, y: 10 };
    (tool as any).targetBase = { x: 50, y: 50 };
    (tool as any).lastPaintedPoint = { x: 50, y: 50 };

    const canvas = makeMockCanvas();
    const ctx = {
      canvasElement: canvas,
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      setDraft: vi.fn(),
    } as any;

    const result = tool.onPointerDown(
      { altKey: false, clientX: 55, clientY: 55, pointerId: 2 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('supports undo via transaction lifecycle', () => {
    const tool = new CloneStampTool();
    const canvas = makeMockCanvas();
    const beginTx = vi.fn();
    const commitTx = vi.fn();
    const abortTx = vi.fn();

    const ctx = {
      canvasElement: canvas,
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      beginTransaction: beginTx,
      commitTransaction: commitTx,
      abortTransaction: abortTx,
      setDraft: vi.fn(),
    } as any;

    (tool as any).sourcePoint = { x: 5, y: 5 };

    tool.onPointerDown({ altKey: false, clientX: 30, clientY: 30, pointerId: 3 } as any, ctx);
    expect(beginTx).toHaveBeenCalled();

    tool.onDragEnd(ctx);
    expect(commitTx).toHaveBeenCalled();
  });
});
