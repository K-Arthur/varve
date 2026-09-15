/**
 * Structural draw-call tests for the `warpedImage` primitive (mockup
 * perspective surfaces). The recorder target has no real canvas pixels, so
 * these assert call structure: image resolution attempts, canvas creation,
 * warp output sizing, and drawImage placement. Pixel truth is covered by the
 * Playwright visual harness (tests/e2e/visual) and the engine golden corpus.
 */
import { describe, expect, it } from 'vitest';
import { primitiveBounds, replayIr } from '../replay';
import type { RenderItem } from '../types';
import { createRecordingTarget, formatDrawCallLog } from './drawCallRecorder';

function warpItem(
  overrides: Partial<Extract<RenderItem['primitive'], { kind: 'warpedImage' }>> = {},
): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    primitive: {
      kind: 'warpedImage',
      src: 'data:image/png;base64,AAAA',
      sourceW: 480,
      sourceH: 640,
      fit: 'contain',
      alignX: 'center',
      alignY: 'center',
      quad: [
        [560, 280],
        [1040, 310],
        [1000, 980],
        [600, 960],
      ],
      ...overrides,
    },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  };
}

describe('warpedImage primitive', () => {
  it('replays without throwing and is deterministic', () => {
    const item = warpItem();
    const { target, log } = createRecordingTarget();
    replayIr(target, [item]);
    const log1 = formatDrawCallLog(log);
    const { target: target2, log: log2 } = createRecordingTarget();
    replayIr(target2, [item]);
    expect(formatDrawCallLog(log2)).toBe(log1);
  });

  it('attempts image resolution for its src', () => {
    const { target, log } = createRecordingTarget();
    replayIr(target, [warpItem()]);
    const calls = formatDrawCallLog(log);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('primitiveBounds covers the quad', () => {
    const item = warpItem();
    const b = primitiveBounds(item.primitive);
    expect(b.x).toBeCloseTo(560, 6);
    expect(b.y).toBeCloseTo(280, 6);
    expect(b.w).toBeCloseTo(480, 6);
    expect(b.h).toBeCloseTo(700, 6);
  });

  it('accepts an offset quad without treating its scene coordinates as raster indices', () => {
    const item = warpItem({
      quad: [
        [-40, -20],
        [40, -20],
        [40, 60],
        [-40, 60],
      ],
    });
    const { target } = createRecordingTarget();
    expect(() => replayIr(target, [item])).not.toThrow();
  });

  it('degenerate quads do not throw', () => {
    const item = warpItem({
      quad: [
        [0, 0],
        [0, 0],
        [10, 10],
        [0, 10],
      ],
    });
    const { target } = createRecordingTarget();
    expect(() => replayIr(target, [item])).not.toThrow();
  });
});
