import { describe, expect, it, vi } from 'vitest';
import type { Point2D } from './lassoGeometry';
import { LassoGesture } from './lassoGesture';
import type { SelectionOperation } from './selectionOperations';
import type { ToolContext } from './types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    setDraft: vi.fn(),
    worldToCanvas: (x: number, y: number) => ({ x, y }),
    announce: vi.fn(),
    lastPointerEvent: null,
    ...overrides,
  } as unknown as ToolContext;
}

function pointer(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY, shiftKey: false, altKey: false } as PointerEvent;
}

function key(k: string): KeyboardEvent {
  return { key: k, repeat: false, preventDefault() {} } as KeyboardEvent;
}

function makeGesture(onEscapeIdle?: (ctx: ToolContext) => boolean): {
  gesture: LassoGesture;
  commits: Array<{ points: Point2D[]; operation: SelectionOperation }>;
} {
  const commits: Array<{ points: Point2D[]; operation: SelectionOperation }> = [];
  const gesture = new LassoGesture({
    labelPrefix: 'Lasso',
    onEscapeIdle,
    commit: (points, operation) => commits.push({ points, operation }),
  });
  return { gesture, commits };
}

describe('LassoGesture (shared engine)', () => {
  it('accumulates freehand points and commits a polygon on drag end', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setOperation('replace');
    gesture.onDragStart(ctx, { x: 0, y: 0 });
    gesture.onDragMove(ctx, { x: 10, y: 0 }, null);
    gesture.onDragMove(ctx, { x: 20, y: 0 }, null);
    gesture.onDragMove(ctx, { x: 30, y: 0 }, null);
    gesture.onDragMove(ctx, { x: 40, y: 5 }, null);
    gesture.onDragEnd(ctx);

    expect(commits).toHaveLength(1);
    expect(commits[0]!.points).toHaveLength(5);
    expect(commits[0]!.operation).toBe('replace');
  });

  it('does not commit when fewer than three points are captured', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setOperation('replace');
    gesture.onDragStart(ctx, { x: 0, y: 0 });
    gesture.onDragMove(ctx, { x: 10, y: 0 }, null);
    gesture.onDragEnd(ctx);

    expect(commits).toHaveLength(0);
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('simplifies closely spaced freehand points before committing', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setOperation('replace');
    gesture.onDragStart(ctx, { x: 0, y: 0 });
    // Many points within 2px of each other should collapse to few.
    for (let i = 1; i <= 20; i += 1) {
      gesture.onDragMove(ctx, { x: i * 0.3, y: 0 }, null);
    }
    gesture.onDragMove(ctx, { x: 30, y: 0 }, null);
    gesture.onDragEnd(ctx);

    expect(commits).toHaveLength(1);
    expect(commits[0]!.points.length).toBeGreaterThanOrEqual(3);
    // Strictly fewer than the 22 sampled points thanks to distance simplification.
    expect(commits[0]!.points.length).toBeLessThan(10);
  });

  it('closes a polygonal lasso by clicking near the first point', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setMode('polygonal');
    gesture.setOperation('add');
    gesture.onPointerDown(pointer(0, 0), ctx, { x: 0, y: 0 });
    gesture.onPointerDown(pointer(100, 0), ctx, { x: 100, y: 0 });
    gesture.onPointerDown(pointer(100, 100), ctx, { x: 100, y: 100 });
    // Near the first point (0,0): within CLOSE_TOLERANCE_PX.
    gesture.onPointerDown(pointer(1, 1), ctx, { x: 1, y: 1 });

    expect(commits).toHaveLength(1);
    expect(commits[0]!.points).toHaveLength(3);
    expect(commits[0]!.operation).toBe('add');
  });

  it('commits a polygonal lasso on Enter', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setMode('polygonal');
    gesture.setOperation('replace');
    gesture.onPointerDown(pointer(0, 0), ctx, { x: 0, y: 0 });
    gesture.onPointerDown(pointer(100, 0), ctx, { x: 100, y: 0 });
    gesture.onPointerDown(pointer(100, 100), ctx, { x: 100, y: 100 });
    expect(gesture.onKeyDown(key('Enter'), ctx)).toBe(true);

    expect(commits).toHaveLength(1);
    expect(commits[0]!.points).toHaveLength(3);
  });

  it('removes the last point with Backspace and clears on empty', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setMode('polygonal');
    gesture.onPointerDown(pointer(0, 0), ctx, { x: 0, y: 0 });
    gesture.onPointerDown(pointer(100, 0), ctx, { x: 100, y: 0 });
    gesture.onPointerDown(pointer(100, 100), ctx, { x: 100, y: 100 });
    expect(gesture.isPlacing()).toBe(true);

    expect(gesture.onKeyDown(key('Backspace'), ctx)).toBe(true);
    expect(gesture.onKeyDown(key('Backspace'), ctx)).toBe(true);
    // One point remains; another backspace empties and returns to idle.
    expect(gesture.onKeyDown(key('Backspace'), ctx)).toBe(true);
    expect(gesture.isIdle()).toBe(true);
    expect(commits).toHaveLength(0);
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('cancels an in-progress polygonal placement with Escape', () => {
    const { gesture, commits } = makeGesture();
    const ctx = makeCtx();
    gesture.setMode('polygonal');
    gesture.onPointerDown(pointer(0, 0), ctx, { x: 0, y: 0 });
    gesture.onPointerDown(pointer(100, 0), ctx, { x: 100, y: 0 });
    expect(gesture.onKeyDown(key('Escape'), ctx)).toBe(true);
    expect(gesture.isIdle()).toBe(true);
    expect(commits).toHaveLength(0);
  });

  it('delegates idle Escape to the onEscapeIdle callback', () => {
    const onEscapeIdle = vi.fn(() => true);
    const { gesture } = makeGesture(onEscapeIdle);
    const ctx = makeCtx();
    expect(gesture.onKeyDown(key('Escape'), ctx)).toBe(true);
    expect(onEscapeIdle).toHaveBeenCalledWith(ctx);
  });

  it('clears the draft on cancel', () => {
    const { gesture } = makeGesture();
    const ctx = makeCtx();
    gesture.setOperation('replace');
    gesture.onDragStart(ctx, { x: 0, y: 0 });
    gesture.onDragMove(ctx, { x: 10, y: 0 }, null);
    gesture.onDragCancel(ctx);
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });
});
