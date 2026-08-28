import { translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { createAreaSelection } from './areaSelection';
import {
  commitFloatingSelection,
  floatingTransformedSelection,
  liftSelectedPixels,
  sampleFloatingAt,
} from './floatingRasterSelection';

function image(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = x * 19 + y;
      pixels[i + 1] = y * 23 + x;
      pixels[i + 2] = 180;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function rectangle(x: number, y: number, w: number, h: number, feather = 0) {
  return createAreaSelection({
    kind: 'rectangle',
    x,
    y,
    w,
    h,
    feather,
    antialias: false,
  })!;
}

describe('floating raster selection', () => {
  it('lifts only the selected contribution and keeps source coordinates local', () => {
    const source = image(12, 10);
    const floating = liftSelectedPixels(rectangle(3, 2, 4, 3), source, 12, 10, 0, 0);
    expect(floating).not.toBeNull();
    expect(floating!.sourceRect).toEqual({ x: 3, y: 2, w: 4, h: 3 });
    expect(floating!.sourcePixels).toHaveLength(4 * 3 * 4);
    expect(sampleFloatingAt(floating!, 3.5, 2.5)[3]).toBeCloseTo(1);
    expect(sampleFloatingAt(floating!, 1.5, 1.5)[3]).toBe(0);
  });

  it('preserves every zero-coverage source pixel byte-for-byte after a move', () => {
    const source = image(16, 12);
    const before = new Uint8ClampedArray(source);
    const floating = liftSelectedPixels(rectangle(3, 2, 4, 3), source, 16, 12, 0, 0)!;
    floating.transform = translate(5, 2);
    const result = commitFloatingSelection(floating, source)!;

    for (let y = 0; y < 12; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const selected = x >= 3 && x < 7 && y >= 2 && y < 5;
        const destination = x >= 8 && x < 12 && y >= 4 && y < 7;
        if (selected || destination) continue;
        const offset = (y * 16 + x) * 4;
        expect(result.compositedPixels.slice(offset, offset + 4)).toEqual(
          before.slice(offset, offset + 4),
        );
      }
    }
  });

  it('splits partial-coverage edge contribution rather than cutting it fully', () => {
    const source = image(12, 12);
    const floating = liftSelectedPixels(rectangle(3.5, 3.5, 4, 4), source, 12, 12, 0, 0)!;
    const partialIndex = floating.coverageMask.findIndex((value) => value > 0 && value < 255);
    expect(partialIndex).toBeGreaterThanOrEqual(0);
    floating.transform = translate(3, 0);
    const result = commitFloatingSelection(floating, source)!;
    const x = floating.sourceRect.x + (partialIndex % floating.sourceWidth);
    const y = floating.sourceRect.y + Math.floor(partialIndex / floating.sourceWidth);
    const offset = (y * 12 + x) * 4;
    expect(result.compositedPixels[offset + 3]).toBeGreaterThan(0);
    expect(result.compositedPixels[offset + 3]).toBeLessThan(255);
  });

  it('keeps the target unchanged for copy semantics outside the destination', () => {
    const source = image(12, 12);
    const before = new Uint8ClampedArray(source);
    const floating = liftSelectedPixels(rectangle(1, 1, 3, 3), source, 12, 12, 0, 0, {
      isMove: false,
    })!;
    floating.transform = translate(5, 0);
    const result = commitFloatingSelection(floating, source)!;
    for (let y = 1; y < 4; y += 1) {
      for (let x = 1; x < 4; x += 1) {
        const offset = (y * 12 + x) * 4;
        expect(result.compositedPixels.slice(offset, offset + 4)).toEqual(
          before.slice(offset, offset + 4),
        );
      }
    }
  });

  it('maps document-space selections through a transformed image target', () => {
    const source = image(16, 16);
    const sourceToDocument: [number, number, number, number, number, number] = [
      2, 0, 0, 2, 100, 40,
    ];
    const floating = liftSelectedPixels(rectangle(104, 44, 8, 8), source, 16, 16, 0, 0, {
      sourceToDocument,
    });
    expect(floating).not.toBeNull();
    expect(floating!.sourceRect).toEqual({ x: 2, y: 2, w: 4, h: 4 });
  });

  it('moves the lifted selection boundary with the floating pixels', () => {
    const floating = liftSelectedPixels(rectangle(2, 2, 3, 3), image(12, 12), 12, 12, 0, 0)!;
    floating.transform = translate(4, 1);
    const moved = floatingTransformedSelection(floating)!;
    expect(sampleFloatingAt(floating, 6.5, 3.5)[3]).toBeCloseTo(1);
    expect(moved.generation).toBeGreaterThanOrEqual(floating.originalSelection.generation);
  });
});
