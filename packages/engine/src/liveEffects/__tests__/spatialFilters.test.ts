import { describe, expect, it } from 'vitest';
import { gaussianBlurSeparable } from '../../blur';
import { applyEdgeInk } from '../edgeInk';
import { applyMosaic } from '../mosaic';
import { applyMotionBlur } from '../motionBlur';
import { applySurfaceSmooth } from '../surfaceSmooth';

function fixture(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
): ImageData {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out.data.set(pixel(x, y), (y * width + x) * 4);
  return out;
}
function at(image: ImageData, x: number, y: number): number[] {
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
}

describe('Directional Blur', () => {
  const impulse = () =>
    fixture(21, 21, (x, y) => (x === 10 && y === 10 ? [240, 40, 20, 255] : [0, 0, 255, 0]));
  it('spreads an impulse horizontally, conserves coverage and excludes hidden RGB', () => {
    const out = applyMotionBlur(impulse(), { distance: 8, angle: 0 });
    expect(at(out, 7, 10)).toEqual([240, 40, 20, 30]);
    expect(at(out, 10, 9)).toEqual([0, 0, 0, 0]);
    let alpha = 0;
    for (let i = 3; i < out.data.length; i += 4) alpha += out.data[i]!;
    expect(Math.abs(alpha - 255)).toBeLessThanOrEqual(5);
  });
  it('rotates the authored direction with the object-to-raster mapping', () => {
    const out = applyMotionBlur(
      impulse(),
      { distance: 8, angle: 0 },
      { pixelToTreatment: [0, -1, 1, 0, 0, 0] },
    );
    expect(at(out, 10, 7)[3]).toBeGreaterThan(0);
    expect(at(out, 7, 10)[3]).toBe(0);
  });
  it('bypasses zero distance and bounds excessive work explicitly', () => {
    const source = impulse();
    expect(applyMotionBlur(source, { distance: 0, angle: 70 })).toBe(source);
    expect(() =>
      applyMotionBlur(source, { distance: 128, angle: 0 }, { pixelsPerUnit: 16 }),
    ).toThrow(/1024 raster pixels/);
  });
});

describe('Mosaic', () => {
  it('averages premultiplied colour and coverage without hidden-blue fringes', () => {
    const source = fixture(2, 2, (x, y) =>
      x === 0 && y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0],
    );
    const out = applyMosaic(source, { blockSize: 2, originX: 0, originY: 0 });
    expect(Array.from(out.data)).toEqual(Array(4).fill([255, 0, 0, 64]).flat());
  });
  it('honours the stable grid origin, including negative coordinates', () => {
    const source = fixture(4, 2, (x) => [x * 60, 0, 0, 255]);
    const out = applyMosaic(source, { blockSize: 2, originX: -1, originY: 0 });
    expect([at(out, 0, 0)[0], at(out, 1, 0)[0], at(out, 2, 0)[0], at(out, 3, 0)[0]]).toEqual([
      0, 90, 90, 180,
    ]);
  });
  it('is deterministic and does not mutate its input', () => {
    const source = fixture(4, 4, (x, y) => [x * 40, y * 40, 80, 128]);
    const before = source.data.slice();
    const params = { blockSize: 2, originX: 0, originY: 0 };
    expect(applyMosaic(source, params).data).toEqual(applyMosaic(source, params).data);
    expect(source.data).toEqual(before);
  });
});

describe('Surface Smoothing', () => {
  it('smooths low-amplitude texture but preserves a hard boundary better than Gaussian blur', () => {
    const source = fixture(20, 5, (x, y) => {
      const v = (x < 10 ? 40 : 210) + ((x + y) % 2 ? 6 : -6);
      return [v, v, v, 128];
    });
    const out = applySurfaceSmooth(source, { radius: 3, sensitivity: 24 });
    const gaussian = gaussianBlurSeparable(source, 3);
    expect(Math.abs(at(out, 3, 2)[0]! - at(out, 4, 2)[0]!)).toBeLessThan(6);
    expect(at(out, 10, 2)[0]! - at(out, 9, 2)[0]!).toBeGreaterThan(
      at(gaussian, 10, 2)[0]! - at(gaussian, 9, 2)[0]! + 80,
    );
    expect(at(out, 9, 2)[3]).toBe(128);
  });
  it('preserves a constant field and supports radius-zero identity', () => {
    const source = fixture(3, 3, () => [120, 80, 40, 128]);
    expect(applySurfaceSmooth(source, { radius: 3, sensitivity: 24 }).data).toEqual(source.data);
    expect(applySurfaceSmooth(source, { radius: 0, sensitivity: 24 })).toBe(source);
  });
});

const ink = {
  radius: 1,
  threshold: 0.1,
  softness: 0.1,
  foregroundColor: [20, 30, 40],
  backgroundColor: [250, 240, 230],
  transparentBackground: false,
};
describe('Edge Ink', () => {
  it('extracts a contour at a tonal step rather than raising contrast everywhere', () => {
    const source = fixture(6, 3, (x) => (x < 3 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const out = applyEdgeInk(source, ink);
    expect(at(out, 0, 1)).toEqual([250, 240, 230, 255]);
    expect(at(out, 2, 1)).toEqual([20, 30, 40, 255]);
    expect(at(out, 5, 1)).toEqual([250, 240, 230, 255]);
  });
  it('supports transparent paper and ignores hidden RGB', () => {
    const source = fixture(3, 3, () => [80, 80, 80, 255]);
    const out = applyEdgeInk(source, { ...ink, transparentBackground: true });
    expect(at(out, 1, 1)[3]).toBe(0);
    const hidden = fixture(3, 3, () => [255, 0, 0, 0]);
    expect(applyEdgeInk(hidden, ink)).toBe(hidden);
  });
});
