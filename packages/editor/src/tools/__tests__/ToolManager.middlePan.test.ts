import { describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../ToolManager';
import type { GestureResult, Tool, ToolContext } from '../types';

/**
 * Middle-button (button 1) routing — the Figma/Illustrator contract that a
 * middle-drag pans the viewport regardless of the active tool.
 */

function fakePointer(options: {
  pointerId: number;
  button: number;
  clientX?: number;
  clientY?: number;
}): PointerEvent {
  return {
    pointerId: options.pointerId,
    button: options.button,
    buttons: options.button === -1 ? 0 : 1 << options.button,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    pointerType: 'mouse',
    pressure: 0,
  } as unknown as PointerEvent;
}

function makeCtx(): ToolContext {
  return { setPan: vi.fn(), announce: vi.fn() } as unknown as ToolContext;
}

function fakeTool(id: string, result: GestureResult = { consumed: true }): Tool {
  return {
    id,
    cursor: (state: 'idle' | 'hover' | 'drag' | 'resize' | 'rotate') => ({
      css: state === 'drag' ? 'grabbing' : 'crosshair',
    }),
    onPointerDown: vi.fn().mockReturnValue(result),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
  } as unknown as Tool;
}

function makeManager(activeId: string) {
  const tm = new ToolManager(activeId as never);
  const select = fakeTool('select');
  const hand = fakeTool('hand');
  tm.register('select', () => select);
  tm.register('hand', () => hand);
  return { tm, select, hand };
}

describe('ToolManager middle-button viewport pan', () => {
  it('routes a middle-button drag to the Hand tool while Select is active', () => {
    const { tm, select, hand } = makeManager('select');
    const ctx = makeCtx();
    const down = fakePointer({ pointerId: 7, button: 1 });

    const result = tm.handlePointerDown(down, ctx);
    expect(result.consumed).toBe(true);
    expect(hand.onPointerDown).toHaveBeenCalledWith(down, ctx);
    expect(select.onPointerDown).not.toHaveBeenCalled();

    const move = fakePointer({ pointerId: 7, button: -1, clientX: 30, clientY: 12 });
    tm.handlePointerMove(move, ctx);
    expect(hand.onPointerMove).toHaveBeenCalledWith(move, ctx);
    expect(select.onPointerMove).not.toHaveBeenCalled();

    const up = fakePointer({ pointerId: 7, button: -1 });
    tm.handlePointerUp(up, ctx);
    expect(hand.onPointerUp).toHaveBeenCalledWith(up, ctx);
    expect(select.onPointerUp).not.toHaveBeenCalled();

    // The temporary routing must not have switched the user's tool.
    expect(tm.activeTool.id).toBe('select');
  });

  it('does not steal button 1 when the Hand tool is already active', () => {
    const { tm, hand } = makeManager('hand');
    const down = fakePointer({ pointerId: 3, button: 1 });
    tm.handlePointerDown(down, makeCtx());
    expect(hand.onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('keeps the primary button with the active tool', () => {
    const { tm, select, hand } = makeManager('select');
    const down = fakePointer({ pointerId: 5, button: 0 });
    tm.handlePointerDown(down, makeCtx());
    expect(select.onPointerDown).toHaveBeenCalledWith(down, expect.anything());
    expect(hand.onPointerDown).not.toHaveBeenCalled();
  });

  it('falls back to the active tool when the Hand tool declines the contact', () => {
    const { tm, select, hand } = makeManager('select');
    (hand.onPointerDown as ReturnType<typeof vi.fn>).mockReturnValue({ consumed: false });
    const down = fakePointer({ pointerId: 9, button: 1 });
    tm.handlePointerDown(down, makeCtx());
    expect(select.onPointerDown).toHaveBeenCalledWith(down, expect.anything());
    // A declined contact must not leave a stale middle-pan owner behind.
    const move = fakePointer({ pointerId: 9, button: -1 });
    tm.handlePointerMove(move, makeCtx());
    expect(select.onPointerMove).toHaveBeenCalledWith(move, expect.anything());
  });

  it('cancels an in-progress middle pan and the active tool on pointercancel', () => {
    const { tm, select, hand } = makeManager('select');
    tm.handlePointerDown(fakePointer({ pointerId: 11, button: 1 }), makeCtx());
    tm.handlePointerCancel(fakePointer({ pointerId: 11, button: -1 }), makeCtx());
    expect(hand.onPointerCancel).toHaveBeenCalled();
    expect(select.onPointerCancel).toHaveBeenCalled();
    // Subsequent moves are no longer hijacked.
    const move = fakePointer({ pointerId: 11, button: -1 });
    tm.handlePointerMove(move, makeCtx());
    expect(hand.onPointerMove).not.toHaveBeenCalled();
    expect(select.onPointerMove).toHaveBeenCalledWith(move, expect.anything());
  });

  it('exposes the grabbing cursor while a middle pan is in progress', () => {
    const { tm } = makeManager('select');
    expect(tm.cursor).toBe('crosshair');
    tm.handlePointerDown(fakePointer({ pointerId: 13, button: 1 }), makeCtx());
    expect(tm.cursor).toBe('grabbing');
    tm.handlePointerUp(fakePointer({ pointerId: 13, button: -1 }), makeCtx());
    expect(tm.cursor).toBe('crosshair');
  });
});
