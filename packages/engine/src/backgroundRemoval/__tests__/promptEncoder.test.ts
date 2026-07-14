import { describe, expect, it } from 'vitest';
import type { BoundingBox, ClickPoint, SegmentationPrompt } from '../promptEncoder';
import { applyPrompts, encodeBoxPrompt, encodeClickPrompts } from '../promptEncoder';

/**
 * Helper: fill a single-channel mask by painting rectangles.
 * `fillRects` entries are { x, y, w, h } rectangles set to 255.
 */
function makeMask(
  w: number,
  h: number,
  fillRects: { x: number; y: number; w: number; h: number }[],
): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const r of fillRects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        m[y * w + x] = 255;
      }
    }
  }
  return m;
}

/**
 * Decode a mask into a human-friendly grid string for assertions:
 * '█' = FG (>=128), '·' = BG (<128).
 */
function _maskToGrid(mask: Uint8Array, w: number, h: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      row += (mask[y * w + x] ?? 0) >= 128 ? '█' : '·';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Count FG pixels (≥128) in a mask.
 */
function fgCount(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) >= 128) count++;
  }
  return count;
}

describe('encodeClickPrompts', () => {
  it('keeps only the component containing a positive click point', () => {
    // 10×10 mask with two 3×3 blobs: A at (0,0) and B at (7,7)
    const mask = makeMask(10, 10, [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 7, y: 7, w: 3, h: 3 },
    ]);
    expect(fgCount(mask)).toBe(18);

    const points: ClickPoint[] = [{ x: 8, y: 8, type: 'positive' }];
    const result = encodeClickPrompts(mask, 10, 10, points);
    // Should keep only Blob B (bottom-right)
    expect(fgCount(result)).toBe(9);
    // Blob A pixels should be gone
    expect(result[0]).toBe(0);
    // Blob B pixel should remain
    expect(result[8 * 10 + 8]).toBe(255);
  });

  it('removes the component containing a negative click point', () => {
    const mask = makeMask(10, 10, [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 7, y: 7, w: 3, h: 3 },
    ]);
    expect(fgCount(mask)).toBe(18);

    const points: ClickPoint[] = [{ x: 1, y: 1, type: 'negative' }];
    const result = encodeClickPrompts(mask, 10, 10, points);
    // Should remove Blob A (top-left), keep Blob B (bottom-right)
    expect(fgCount(result)).toBe(9);
    expect(result[1 * 10 + 1]).toBe(0);
    expect(result[8 * 10 + 8]).toBe(255);
  });

  it('handles multiple positive click points selecting the same component', () => {
    // Two separate 3×3 blobs
    const mask = makeMask(10, 10, [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 7, y: 7, w: 3, h: 3 },
    ]);

    const points: ClickPoint[] = [
      { x: 1, y: 1, type: 'positive' },
      { x: 1, y: 1, type: 'positive' }, // duplicate — should be idempotent
    ];
    const result = encodeClickPrompts(mask, 10, 10, points);
    expect(fgCount(result)).toBe(9);
    expect(result[0]).toBe(255);
    expect(result[8 * 10 + 8]).toBe(0);
  });

  it('handles multiple positive points selecting different components', () => {
    const mask = makeMask(12, 12, [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 8, y: 8, w: 3, h: 3 },
      { x: 0, y: 8, w: 3, h: 3 },
    ]);
    expect(fgCount(mask)).toBe(27);

    const points: ClickPoint[] = [
      { x: 1, y: 1, type: 'positive' }, // Blob A
      { x: 9, y: 9, type: 'positive' }, // Blob B
    ];
    const result = encodeClickPrompts(mask, 12, 12, points);
    // Should keep Blobs A and B, remove Blob C (at bottom-left)
    expect(fgCount(result)).toBe(18);
    expect(result[1 * 12 + 1]).toBe(255);
    expect(result[9 * 12 + 9]).toBe(255);
    // Blob C pixel
    const cIdx = 9 * 12 + 1;
    expect(result[cIdx]).toBe(0);
  });

  it('removes only the component at a negative click point, leaving others', () => {
    const mask = makeMask(12, 12, [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 8, y: 8, w: 3, h: 3 },
      { x: 0, y: 8, w: 3, h: 3 },
    ]);

    const points: ClickPoint[] = [
      { x: 1, y: 1, type: 'negative' }, // Remove Blob A
    ];
    const result = encodeClickPrompts(mask, 12, 12, points);
    // Should keep Blobs B and C, remove Blob A
    expect(fgCount(result)).toBe(18);
    expect(result[1 * 12 + 1]).toBe(0);
    expect(result[9 * 12 + 9]).toBe(255);
    expect(result[9 * 12 + 1]).toBe(255);
  });

  it('returns original mask when no click point hits FG', () => {
    const mask = makeMask(10, 10, [{ x: 0, y: 0, w: 3, h: 3 }]);

    // Click point outside image — no-op
    const points: ClickPoint[] = [
      { x: 999, y: 999, type: 'positive' },
      { x: -1, y: -1, type: 'negative' },
    ];
    const result = encodeClickPrompts(mask, 10, 10, points);
    // Should be identical since no click hit any pixel
    expect(result).toEqual(mask);
  });

  it('returns original mask when point lands on background', () => {
    const mask = makeMask(10, 10, [{ x: 0, y: 0, w: 3, h: 3 }]);

    // Click point in BG area
    const points: ClickPoint[] = [{ x: 9, y: 9, type: 'positive' }];
    const result = encodeClickPrompts(mask, 10, 10, points);
    // No component found at (9,9) — keep all FG
    expect(fgCount(result)).toBe(9);
    expect(result).toEqual(mask);
  });

  it('returns original mask with no foreground pixels', () => {
    const mask = new Uint8Array(100); // All zeros
    const points: ClickPoint[] = [{ x: 5, y: 5, type: 'positive' }];
    const result = encodeClickPrompts(mask, 10, 10, points);
    expect(result).toEqual(mask);
    expect(fgCount(result)).toBe(0);
  });

  it('returns original mask for empty points array', () => {
    const mask = makeMask(10, 10, [{ x: 0, y: 0, w: 3, h: 3 }]);
    const result = encodeClickPrompts(mask, 10, 10, []);
    expect(result).toEqual(mask);
  });

  it('handles degenerate (zero-size) input', () => {
    const mask = new Uint8Array(0);
    const result = encodeClickPrompts(mask, 0, 0, [{ x: 0, y: 0, type: 'positive' }]);
    expect(result).toEqual(mask);
  });

  it('removes component when negative click lands inside its area', () => {
    // Single blob
    const mask = makeMask(6, 6, [{ x: 1, y: 1, w: 4, h: 4 }]);
    expect(fgCount(mask)).toBe(16);

    const result = encodeClickPrompts(mask, 6, 6, [{ x: 3, y: 3, type: 'negative' }]);
    // Entire blob should be removed
    expect(fgCount(result)).toBe(0);
  });
});

describe('encodeBoxPrompt', () => {
  it('zeroes mask pixels outside the bounding box', () => {
    // Single 8×8 blob
    const mask = makeMask(20, 20, [{ x: 2, y: 2, w: 8, h: 8 }]);
    expect(fgCount(mask)).toBe(64);

    // Box that cuts through the blob
    const box: BoundingBox = { x: 0, y: 0, w: 10, h: 10 };
    const result = encodeBoxPrompt(mask, 20, 20, box);
    // FG pixels outside the 0-10 box are zeroed.
    // The blob had pixels from 2-10 in x and y.
    // With box covering 0-10, pixels at x=10 or y=10 are outside.
    // The blob is 2-9 in both axes, all within 0-9, so all stay.
    expect(fgCount(result)).toBe(64);
    // Blob pixel inside box
    expect(result[3 * 20 + 3]).toBe(255);
  });

  it('keeps only the largest connected component within the box', () => {
    // Three separate blobs: two inside a 10×10 box, one outside
    const mask = makeMask(20, 20, [
      { x: 1, y: 1, w: 3, h: 3 }, // 9 px, inside
      { x: 5, y: 5, w: 4, h: 4 }, // 16 px, inside (largest)
      { x: 15, y: 15, w: 2, h: 2 }, // 4 px, outside
    ]);
    expect(fgCount(mask)).toBe(29);

    const box: BoundingBox = { x: 0, y: 0, w: 10, h: 10 };
    const result = encodeBoxPrompt(mask, 20, 20, box);
    // Should keep only the largest in-box component (the 16px one)
    expect(fgCount(result)).toBe(16);
    // First blob should be gone
    expect(result[1 * 20 + 1]).toBe(0);
    // Largest blob should remain
    expect(result[6 * 20 + 6]).toBe(255);
  });

  it('returns original mask for a zero-size box', () => {
    const mask = makeMask(10, 10, [{ x: 2, y: 2, w: 3, h: 3 }]);
    const result = encodeBoxPrompt(mask, 10, 10, { x: 0, y: 0, w: 0, h: 0 });
    expect(result).toEqual(mask);
  });

  it('returns all-zero mask when box contains no FG', () => {
    const mask = makeMask(10, 10, [{ x: 8, y: 8, w: 2, h: 2 }]);
    const result = encodeBoxPrompt(mask, 10, 10, { x: 0, y: 0, w: 5, h: 5 });
    expect(fgCount(result)).toBe(0);
  });

  it('handles box that extends beyond image boundaries', () => {
    const mask = makeMask(8, 8, [{ x: 0, y: 0, w: 8, h: 8 }]);
    const result = encodeBoxPrompt(mask, 8, 8, { x: -2, y: -2, w: 12, h: 12 });
    // Box covers entire image
    expect(fgCount(result)).toBe(64);
  });

  it('is a no-op for zero-size image', () => {
    const mask = new Uint8Array(0);
    const result = encodeBoxPrompt(mask, 0, 0, { x: 0, y: 0, w: 10, h: 10 });
    expect(result).toEqual(mask);
  });
});

describe('applyPrompts (combined)', () => {
  it('applies box first, then clicks', () => {
    // Three blobs
    const mask = makeMask(20, 20, [
      { x: 1, y: 1, w: 3, h: 3 }, // 9 px
      { x: 10, y: 10, w: 4, h: 4 }, // 16 px
      { x: 1, y: 10, w: 3, h: 3 }, // 9 px
    ]);
    expect(fgCount(mask)).toBe(34);

    // Box constraints to left 12 columns; Blob B (at x=10..13) partially inside
    const prompts: SegmentationPrompt[] = [
      { kind: 'box', box: { x: 0, y: 0, w: 12, h: 20 } },
      // After box: Blob A and C are fully inside, Blob B partially cropped
      // Large-in-box is Blob C (9px) or Blob-B-partial... let's trace:
      // Blob A: (1,1)-(3,3) = 9px, Blob B partial: x=10,11, y=10,11,12,13 = 8px, Blob C: 9px
      // After box: largest in-box is 9px (A or C)
      // Then click on Blob A
      { kind: 'click', point: { x: 2, y: 2, type: 'positive' } },
    ];
    const result = applyPrompts(mask, 20, 20, prompts);
    // Box keeps largest (9px), then positive click on (2,2) keeps that blob
    expect(fgCount(result)).toBe(9);
    expect(result[2 * 20 + 2]).toBe(255);
  });

  it('box prompt + negative click removes the selected blob', () => {
    // Box keeps the largest in-box component, then negative click
    // removes that component — resulting in 0 FG.
    const mask = makeMask(20, 20, [
      { x: 1, y: 1, w: 4, h: 4 }, // 16 px
      { x: 1, y: 10, w: 3, h: 3 }, // 9 px
    ]);

    const prompts: SegmentationPrompt[] = [
      { kind: 'box', box: { x: 0, y: 0, w: 10, h: 20 } },
      // After box: both blobs inside box, largest = 16px blob, smaller is removed
      // Then negative click on the largest blob removes it
      { kind: 'click', point: { x: 3, y: 3, type: 'negative' } },
    ];
    const result = applyPrompts(mask, 20, 20, prompts);
    // Box kept the 16px blob (largest), then negative click removed it
    expect(fgCount(result)).toBe(0);
  });

  it('returns original mask for empty prompts', () => {
    const mask = makeMask(10, 10, [{ x: 2, y: 2, w: 3, h: 3 }]);
    const result = applyPrompts(mask, 10, 10, []);
    expect(result).toEqual(mask);
  });

  it('processes positive clicks before negative clicks', () => {
    // Three blobs
    const mask = makeMask(20, 20, [
      { x: 1, y: 1, w: 3, h: 3 }, // blob A
      { x: 10, y: 1, w: 3, h: 3 }, // blob B
      { x: 1, y: 10, w: 3, h: 3 }, // blob C
    ]);

    // Positive click on A and B, negative click on B
    // Result: keep A only (B was positively selected, then negatively removed)
    const prompts: SegmentationPrompt[] = [
      { kind: 'click', point: { x: 2, y: 2, type: 'positive' } },
      { kind: 'click', point: { x: 11, y: 2, type: 'positive' } },
      { kind: 'click', point: { x: 11, y: 2, type: 'negative' } },
    ];
    const result = applyPrompts(mask, 20, 20, prompts);
    expect(fgCount(result)).toBe(9);
    expect(result[2 * 20 + 2]).toBe(255);
    expect(result[2 * 20 + 11]).toBe(0);
    expect(result[12 * 20 + 2]).toBe(0);
  });
});
