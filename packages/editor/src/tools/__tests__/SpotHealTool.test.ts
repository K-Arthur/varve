/**
 * SpotHealTool tests — 3 TDD tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { SpotHealTool } from '../SpotHealTool';

describe('SpotHealTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    return canvas;
  }

  it('heals a spot on click', () => {
    const tool = new SpotHealTool();
    const canvas = makeMockCanvas();

    const ctx = {
      canvasElement: canvas,
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      announce: vi.fn(),
    } as any;

    const result = tool.onPointerDown({ clientX: 19, clientY: 19, pointerId: 1 } as any, ctx);
    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Spot healed');
  });

  it('heals a small spot (radius 3)', () => {
    const tool = new SpotHealTool();
    tool.setOptions({ brushSize: 6, type: 'content-aware' });

    const canvas = makeMockCanvas();
    const ctx = {
      canvasElement: canvas,
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      announce: vi.fn(),
    } as any;

    const result = tool.onPointerDown({ clientX: 19, clientY: 19, pointerId: 1 } as any, ctx);
    expect(result.consumed).toBe(true);
  });

  it('handles edge of canvas gracefully', () => {
    const tool = new SpotHealTool();
    const canvas = makeMockCanvas();

    const ctx = {
      canvasElement: canvas,
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      announce: vi.fn(),
    } as any;

    expect(() => {
      tool.onPointerDown({ clientX: 1, clientY: 1, pointerId: 1 } as any, ctx);
    }).not.toThrow();
  });
});
