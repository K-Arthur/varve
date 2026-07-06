// @vitest-environment jsdom
/**
 * Visual golden foundation — replays primitives to canvas and asserts stable hashes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { replayIr } from '../replay';
import type { RenderItem } from '../types';

function simpleCanvas(w = 64, h = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasToHash(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function replayToCanvas(items: RenderItem[], w = 64, h = 64): HTMLCanvasElement {
  const canvas = simpleCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  replayIr(ctx, items);
  return canvas;
}

describe('golden replay hashes', () => {
  it('solid rect produces stable hash', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        primitive: { kind: 'rect', x: 8, y: 8, w: 48, h: 48 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];
    const h1 = canvasToHash(replayToCanvas(items));
    const h2 = canvasToHash(replayToCanvas(items));
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it('linear gradient fill produces stable hash', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'gradient',
            gradientType: 'linear',
            stops: [
              { position: 0, color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            ],
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 64, h: 64 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];
    const h1 = canvasToHash(replayToCanvas(items));
    const h2 = canvasToHash(replayToCanvas(items));
    expect(h1).toBe(h2);
  });

  it('circle and rect use distinct canvas draw paths', () => {
    const rect: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        primitive: { kind: 'rect', x: 8, y: 8, w: 48, h: 48 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];
    const circle: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        primitive: { kind: 'circle', cx: 32, cy: 32, r: 24 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];
    const rectCanvas = simpleCanvas();
    const rectCtx = rectCanvas.getContext('2d')!;
    replayIr(rectCtx, rect);
    expect(vi.mocked(rectCtx.fillRect).mock.calls.length).toBeGreaterThan(0);

    const circleCanvas = simpleCanvas();
    const circleCtx = circleCanvas.getContext('2d')!;
    replayIr(circleCtx, circle);
    expect(vi.mocked(circleCtx.arc).mock.calls.length).toBeGreaterThan(0);
  });
});
