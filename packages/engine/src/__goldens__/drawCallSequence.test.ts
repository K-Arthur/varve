/**
 * Structural (draw-call-sequence) regression tests — the fast, non-pixel
 * complement to the Playwright visual harness under tests/e2e/visual/.
 * See drawCallRecorder.ts for why this exists instead of the jsdom-hash
 * approach in goldenReplay.test.ts (jsdom's canvas doesn't rasterize real
 * pixels — verified directly: getImageData after a real fillRect() returns
 * an all-zero buffer in this repo's jsdom setup).
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from '../replay';
import type { RenderItem } from '../types';
import { createRecordingTarget, formatDrawCallLog } from './drawCallRecorder';

function recordReplay(items: RenderItem[]): string {
  const { target, log } = createRecordingTarget();
  replayIr(target, items);
  return formatDrawCallLog(log);
}

describe('draw-call sequence goldens', () => {
  it('solid rect: stable, non-empty draw-call sequence', () => {
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
    const log1 = recordReplay(items);
    const log2 = recordReplay(items);
    expect(log1).toBe(log2);
    expect(log1.length).toBeGreaterThan(0);
    expect(log1).toContain('fillRect');
  });

  it('blend mode is reflected as a globalCompositeOperation set, not silently dropped', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 220, g: 40, b: 40, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'multiply',
        strokes: [],
        effects: [],
      },
    ];
    const log = recordReplay(items);
    // This is the exact class of bug found uncaught by the pixel harness's
    // sibling audit (docs/quality/test-reality.md bug #6, blend mode
    // hardcoded to 'normal') — a structural assertion catches it directly.
    expect(log).toContain('set globalCompositeOperation = "multiply"');
  });

  it('paint order is reflected as call order, not just call presence', () => {
    const red: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 220, g: 40, b: 40, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      opacity: 1,
      blendMode: 'normal',
      strokes: [],
      effects: [],
    };
    const blue: RenderItem = {
      ...red,
      fill: { space: 'rgb', r: 40, g: 60, b: 220, a: 255 },
      transform: [1, 0, 0, 1, 20, 0],
    };
    const forward = recordReplay([red, blue]);
    const reversed = recordReplay([blue, red]);
    // Same two items, different order, MUST produce a different sequence —
    // this is exactly what the pixel harness's paint-order fixture checks
    // visually; this is the same check structurally, and much cheaper.
    expect(forward).not.toBe(reversed);
  });

  it('a dropped transform call is a detectable structural regression', () => {
    const items: RenderItem[] = [
      {
        transform: [2, 0, 0, 2, 50, 50],
        fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];
    const log = recordReplay(items);
    expect(log).toContain('call transform(2, 0, 0, 2, 50, 50)');
  });
});
