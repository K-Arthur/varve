/**
 * Drag threshold is a screen-space constant.
 *
 * Regression: the threshold used to be divided by zoom before being compared
 * against `clientX/Y` deltas, so the same hand movement behaved differently at
 * different zoom levels — ~50 CSS px of travel were required before anything
 * moved at 6% zoom (the canvas felt stuck), and 0.19 px of jitter started a
 * drag at 1600%. The pointer models the user's hand, which does not rescale
 * with the camera.
 */
import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { BaseTool } from '../BaseTool';
import type { CursorSpec, ToolContext, ToolId } from '../types';

class ProbeTool extends BaseTool {
  id = 'select' as ToolId;
  moves = 0;
  starts = 0;
  cursor(): CursorSpec {
    return { css: 'default' };
  }
  override onDragStart(): void {
    this.starts++;
  }
  override onDragMove(): void {
    this.moves++;
  }
  /** Expose the protected helpers the shape tools use for click-vs-drag. */
  belowThreshold(ctx: ToolContext): boolean {
    return this.isBelowThreshold(ctx);
  }
  pastThreshold(ctx: ToolContext): boolean {
    return this.checkDragThreshold(ctx);
  }
}

function makeCtx(zoom: number): ToolContext {
  return {
    document: createDocument('threshold'),
    selection: [],
    zoom,
    pan: { x: 0, y: 0 },
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx / zoom, y: cy / zoom })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx: dx / zoom, dy: dy / zoom })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as ToolContext;
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return { pointerId: 1, clientX: x, clientY: y, type } as unknown as PointerEvent;
}

/** Zoom levels spanning Varve's supported range. */
const ZOOMS = [0.01, 0.06, 0.17, 0.5, 1, 2, 4, 16, 64];

describe('BaseTool drag threshold', () => {
  it.each(ZOOMS)('does not start a drag for 2 CSS px of travel at zoom %s', (zoom) => {
    const tool = new ProbeTool();
    const ctx = makeCtx(zoom);
    tool.onPointerDown(pointer('pointerdown', 100, 100), ctx);
    tool.onPointerMove(pointer('pointermove', 102, 100), ctx);
    expect(tool.starts).toBe(0);
    expect(tool.moves).toBe(0);
    expect(tool.belowThreshold(ctx)).toBe(true);
    expect(tool.pastThreshold(ctx)).toBe(false);
  });

  it.each(ZOOMS)('starts a drag for 5 CSS px of travel at zoom %s', (zoom) => {
    const tool = new ProbeTool();
    const ctx = makeCtx(zoom);
    tool.onPointerDown(pointer('pointerdown', 100, 100), ctx);
    tool.onPointerMove(pointer('pointermove', 105, 100), ctx);
    expect(tool.starts).toBe(1);
    expect(tool.moves).toBe(1);
    expect(tool.belowThreshold(ctx)).toBe(false);
    expect(tool.pastThreshold(ctx)).toBe(true);
  });

  it('crosses the threshold at the same screen distance at every zoom', () => {
    // The exact crossing distance must not vary with the camera, or the same
    // gesture feels stuck when zoomed out and hair-triggered when zoomed in.
    const crossings = ZOOMS.map((zoom) => {
      const ctx = makeCtx(zoom);
      for (let travel = 1; travel <= 80; travel++) {
        const tool = new ProbeTool();
        tool.onPointerDown(pointer('pointerdown', 0, 0), ctx);
        tool.onPointerMove(pointer('pointermove', travel, 0), ctx);
        if (tool.starts === 1) return travel;
      }
      return -1;
    });
    expect(new Set(crossings).size).toBe(1);
    expect(crossings[0]).toBe(4);
  });
});
