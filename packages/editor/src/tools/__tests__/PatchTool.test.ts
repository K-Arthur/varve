/**
 * PatchTool tests — 3 TDD tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { PatchTool } from '../PatchTool';

describe('PatchTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    return canvas;
  }

  it('selects a source region on first drag', () => {
    const tool = new PatchTool();
    const canvas = makeMockCanvas();
    tool.onActivate({} as any);

    const ctx = {
      canvasElement: canvas,
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      announce: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const downResult = tool.onPointerDown({ clientX: 10, clientY: 10, pointerId: 1 } as any, ctx);
    expect(downResult.consumed).toBe(true);

    const ne = { clientX: 30, clientY: 30, pointerId: 1 } as any;
    tool.onPointerMove(ne, ctx);

    tool.onPointerUp({ clientX: 30, clientY: 30, pointerId: 1 } as any, ctx);
    expect(ctx.announce).toHaveBeenCalledWith(
      expect.stringContaining('Source region selected'),
    );
  });

  it('moves patch to target and applies', () => {
    const tool = new PatchTool();
    const canvas = makeMockCanvas();

    const ctx = {
      canvasElement: canvas,
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      announce: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    tool.onActivate(ctx);
    tool.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1 } as any, ctx);
    tool.onPointerMove({ clientX: 15, clientY: 15, pointerId: 1 } as any, ctx);
    tool.onPointerUp({ clientX: 15, clientY: 15, pointerId: 1 } as any, ctx);

    expect((tool as any).patchState.phase).toBe('position');

    const clickResult = tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 2 } as any, ctx);
    expect(clickResult.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Patch applied');
  });

  it('cancels with Escape key during positioning', () => {
    const tool = new PatchTool();
    const ctx = {
      setDraft: vi.fn(),
      abortTransaction: vi.fn(),
      announce: vi.fn(),
    } as any;

    (tool as any).patchState = { phase: 'position', sourceRect: { x: 0, y: 0, w: 10, h: 10 } };

    const consumed = tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx);
    expect(consumed).toBe(true);
    expect((tool as any).patchState.phase).toBe('idle');
  });
});
