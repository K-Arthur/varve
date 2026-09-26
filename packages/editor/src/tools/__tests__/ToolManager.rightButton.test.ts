import { describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../ToolManager';
import type { GestureResult, Tool, ToolContext } from '../types';

/**
 * Right-button (button 2) routing — the input-system behavior matrix reserves
 * right-click for context actions. A tool gesture must never start on it:
 * doing so let a right-click with a creation tool commit artwork, and the
 * state change from that commit immediately closed the canvas context menu
 * the same click was meant to open.
 */

function fakePointer(button: number): PointerEvent {
  return {
    pointerId: 1,
    button,
    buttons: button === -1 ? 0 : 1 << button,
    clientX: 10,
    clientY: 10,
    pointerType: 'mouse',
    pressure: 0,
  } as unknown as PointerEvent;
}

function makeCtx(): ToolContext {
  return {} as unknown as ToolContext;
}

function fakeTool(id: string): Tool {
  return {
    id,
    cursor: () => ({ css: 'crosshair' }),
    onPointerDown: vi.fn().mockReturnValue({ consumed: true } satisfies GestureResult),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
  } as unknown as Tool;
}

describe('ToolManager right-button routing', () => {
  it('does not route button 2 to the active tool', () => {
    const tm = new ToolManager('select' as never);
    const select = fakeTool('select');
    tm.register('select', () => select);

    const result = tm.handlePointerDown(fakePointer(2), makeCtx());

    expect(result).toEqual({ consumed: false });
    expect(select.onPointerDown).not.toHaveBeenCalled();
  });

  it('still routes the primary button to the active tool', () => {
    const tm = new ToolManager('select' as never);
    const select = fakeTool('select');
    tm.register('select', () => select);

    const result = tm.handlePointerDown(fakePointer(0), makeCtx());

    expect(result).toEqual({ consumed: true });
    expect(select.onPointerDown).toHaveBeenCalledOnce();
  });
});
