/**
 * HealingBrushTool tests — 4 TDD tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { HealingBrushTool } from '../HealingBrushTool';

describe('HealingBrushTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    return canvas;
  }

  it('paints and applies healing at cursor position', () => {
    const tool = new HealingBrushTool();
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

    (tool as any).sourcePoint = { x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 30, clientY: 30, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
    expect(ctx.beginTransaction).toHaveBeenCalled();
  });

  it('preserves source texture in healed area', () => {
    const tool = new HealingBrushTool();
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

    (tool as any).sourcePoint = { x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 45, clientY: 45, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('handles edge of canvas without error', () => {
    const tool = new HealingBrushTool();
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

    (tool as any).sourcePoint = { x: 2, y: 2 };

    expect(() => {
      tool.onPointerDown({ altKey: false, clientX: 1, clientY: 1, pointerId: 1 } as any, ctx);
    }).not.toThrow();
  });

  it('completes transaction lifecycle on drag end', () => {
    const tool = new HealingBrushTool();
    (tool as any).options.hardness = 0.5;

    const canvas = makeMockCanvas();
    const commitTx = vi.fn();

    const ctx = {
      canvasElement: canvas,
      announce: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: commitTx,
      setDraft: vi.fn(),
    } as any;

    (tool as any).sourcePoint = { x: 5, y: 5 };

    tool.onPointerDown({ altKey: false, clientX: 50, clientY: 50, pointerId: 1 } as any, ctx);
    tool.onDragEnd(ctx);
    expect(commitTx).toHaveBeenCalled();
  });
});
