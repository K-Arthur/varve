/**
 * Spike harness — simulates IR-replay vs pixel-push bandwidth ratio from ADR-0001.
 * Does not require Tauri; validates the architectural claim in-process.
 */
import { describe, expect, it } from 'vitest';
import { estimateIrBytes } from './benchUtils';

const SHAPE_COUNT = 600;
const CANVAS_W = 960;
const CANVAS_H = 600;

function mockIrPayload(shapeCount: number): unknown[] {
  const items = [];
  for (let i = 0; i < shapeCount; i++) {
    items.push({
      transform: [1, 0, 0, 1, (i % 30) * 20, Math.floor(i / 30) * 20],
      fill: [57, 208, 198, 255],
      primitive: { kind: 'rect', x: 0, y: 0, w: 16, h: 12 },
      opacity: 1,
      blendMode: 'normal',
    });
  }
  return items;
}

describe('spike harness (ADR-0001 transport)', () => {
  it('IR payload is much smaller than RGBA pixel buffer', () => {
    const irBytes = estimateIrBytes(mockIrPayload(SHAPE_COUNT));
    const pixelBytes = CANVAS_W * CANVAS_H * 4;
    expect(irBytes).toBeLessThan(pixelBytes / 10);
  });

  it('600-shape IR is under 200KB', () => {
    const irBytes = estimateIrBytes(mockIrPayload(SHAPE_COUNT));
    expect(irBytes).toBeLessThan(200_000);
  });

  it('pixel-push payload matches canvas RGBA size', () => {
    expect(CANVAS_W * CANVAS_H * 4).toBe(2_304_000);
  });
});
