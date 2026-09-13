// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { PenConstructionDraft } from '../tools/types';
import { drawPenConstructionPreview } from './penConstructionPreview';

function makeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    setLineDash: vi.fn(),
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('drawPenConstructionPreview', () => {
  it('traces the same cubic control points as a committed path', () => {
    const ctx = makeContext();
    const draft: PenConstructionDraft = {
      kind: 'bezier-path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: { x: 20, y: 0 } },
        { x: 100, y: 100, handleIn: { x: -10, y: -20 }, handleOut: null },
      ],
      activePointIndex: 1,
      pointer: null,
      closedPreview: false,
      isDragging: false,
    };

    drawPenConstructionPreview(ctx, draft, 1, '#00a99d');

    expect(ctx.bezierCurveTo).toHaveBeenCalledWith(20, 0, 90, 80, 100, 100);
  });

  it('draws a separate future preview and the close affordance', () => {
    const ctx = makeContext();
    const draft: PenConstructionDraft = {
      kind: 'bezier-path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 0, handleIn: null, handleOut: null },
      ],
      activePointIndex: 1,
      pointer: { x: 0, y: 0 },
      closedPreview: true,
      isDragging: false,
    };

    drawPenConstructionPreview(ctx, draft, 2, '#00a99d');

    expect(ctx.lineTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 4.5, 0, Math.PI * 2);
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
  });
});
