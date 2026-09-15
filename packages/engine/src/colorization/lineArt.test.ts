import { describe, expect, it } from 'vitest';
import { lineArtColorize } from './lineArt';

function blank(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return new ImageData(data, width, height);
}

function setPixel(
  image: ImageData,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const index = (y * image.width + x) * 4;
  image.data[index] = rgba[0];
  image.data[index + 1] = rgba[1];
  image.data[index + 2] = rgba[2];
  image.data[index + 3] = rgba[3];
}

function setColumn(image: ImageData, x: number, rgba: [number, number, number, number]): void {
  for (let y = 0; y < image.height; y += 1) setPixel(image, x, y, rgba);
}

function pixel(image: ImageData, x: number, y: number): [number, number, number, number] {
  const index = (y * image.width + x) * 4;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
    image.data[index + 3] ?? 0,
  ];
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];

describe('lineArtColorize', () => {
  it('fills regions on both sides of a line and preserves the linework', () => {
    const source = blank(21, 11, WHITE);
    setColumn(source, 10, BLACK);
    const hints = blank(21, 11, CLEAR);
    setPixel(hints, 3, 5, RED);
    setPixel(hints, 17, 5, BLUE);

    const { image, stats } = lineArtColorize(source, hints, {
      lineThreshold: 0.5,
      gapClose: 0,
    });

    const left = pixel(image, 8, 5);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(60);
    expect(left[3]).toBe(255);

    const right = pixel(image, 12, 5);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(60);
    expect(right[3]).toBe(255);

    const line = pixel(image, 10, 5);
    expect(line[0]).toBeLessThan(60);
    expect(line[1]).toBeLessThan(60);
    expect(line[2]).toBeLessThan(60);
    expect(line[3]).toBe(255);

    expect(stats.seedCount).toBe(2);
    expect(stats.filledFraction).toBe(1);
    expect(stats.unassignedFraction).toBe(0);
  });

  it('leaves regions that no hint can reach transparent', () => {
    const source = blank(21, 11, WHITE);
    setColumn(source, 10, BLACK);
    const hints = blank(21, 11, CLEAR);
    setPixel(hints, 3, 5, RED);

    const { image, stats } = lineArtColorize(source, hints, {
      lineThreshold: 0.5,
      gapClose: 0,
    });

    expect(pixel(image, 3, 5)[0]).toBeGreaterThan(200);
    const unreachable = pixel(image, 15, 5);
    expect(unreachable[3]).toBe(0);
    expect(stats.filledFraction).toBeCloseTo(0.5, 1);
    expect(stats.unassignedFraction).toBeCloseTo(0.5, 1);
  });

  it('closes a one-pixel gap when gapClose is set', () => {
    const source = blank(21, 11, WHITE);
    setColumn(source, 10, BLACK);
    setPixel(source, 10, 5, WHITE);
    const hints = blank(21, 11, CLEAR);
    setPixel(hints, 3, 5, RED);

    const leaking = lineArtColorize(source, hints, { lineThreshold: 0.5, gapClose: 0 });
    expect(pixel(leaking.image, 12, 5)[0]).toBeGreaterThan(200);
    expect(pixel(leaking.image, 12, 5)[3]).toBe(255);

    const sealed = lineArtColorize(source, hints, { lineThreshold: 0.5, gapClose: 2 });
    expect(pixel(sealed.image, 12, 5)[3]).toBe(0);
  });

  it('keeps antialiased stroke edges darker than the fill', () => {
    const source = blank(11, 5, WHITE);
    setColumn(source, 5, BLACK);
    setColumn(source, 4, [64, 64, 64, 255]);
    setColumn(source, 6, [64, 64, 64, 255]);
    const hints = blank(11, 5, CLEAR);
    setPixel(hints, 1, 2, RED);
    setPixel(hints, 9, 2, BLUE);

    const { image } = lineArtColorize(source, hints, { lineThreshold: 0.5, gapClose: 0 });

    const edge = pixel(image, 4, 2);
    expect(edge[3]).toBe(255);
    expect(edge[0]).toBeGreaterThan(100);
    expect(edge[0]).toBeLessThan(210);
    const core = pixel(image, 5, 2);
    expect(core[0]).toBeLessThan(40);
  });

  it('samples hints supplied at a different resolution', () => {
    const source = blank(20, 20, WHITE);
    setColumn(source, 10, BLACK);
    const hints = blank(5, 5, CLEAR);
    setPixel(hints, 1, 2, RED);

    const { image, stats } = lineArtColorize(source, hints, {
      lineThreshold: 0.5,
      gapClose: 0,
    });

    expect(stats.seedCount).toBe(1);
    const filled = pixel(image, 5, 9);
    expect(filled[0]).toBeGreaterThan(200);
    expect(filled[3]).toBe(255);
    expect(pixel(image, 15, 9)[3]).toBe(0);
  });

  it('treats transparent paper as fillable, not as ink', () => {
    const source = blank(11, 5, CLEAR);
    setColumn(source, 5, BLACK);
    const hints = blank(11, 5, CLEAR);
    setPixel(hints, 1, 2, RED);

    const { image, stats } = lineArtColorize(source, hints, {
      lineThreshold: 0.5,
      gapClose: 0,
    });

    expect(stats.seedCount).toBe(1);
    expect(pixel(image, 1, 2)[0]).toBeGreaterThan(200);
    expect(pixel(image, 5, 2)).toEqual([0, 0, 0, 255]);
    expect(pixel(image, 9, 2)[3]).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    const source = blank(12, 6, WHITE);
    setColumn(source, 6, BLACK);
    const hints = blank(12, 6, CLEAR);
    setPixel(hints, 2, 3, RED);
    setPixel(hints, 9, 3, BLUE);

    const first = lineArtColorize(source, hints, { lineThreshold: 0.5, gapClose: 1 });
    const second = lineArtColorize(source, hints, { lineThreshold: 0.5, gapClose: 1 });
    expect(Array.from(first.image.data)).toEqual(Array.from(second.image.data));
    expect(first.stats).toEqual(second.stats);
  });

  it('rejects missing hints, invalid dimensions, and non-finite options', () => {
    const source = blank(4, 4, WHITE);
    expect(() => lineArtColorize(source, undefined)).toThrow('hint image');
    const invalidHints = { width: 0, height: 0, data: new Uint8ClampedArray(0) } as ImageData;
    expect(() => lineArtColorize(source, invalidHints)).toThrow('Hint image dimensions');
    const hints = blank(4, 4, CLEAR);
    setPixel(hints, 1, 1, RED);
    expect(() => lineArtColorize(source, hints, { lineThreshold: Number.NaN })).toThrow('finite');
    expect(() => lineArtColorize(source, hints, { gapClose: Number.POSITIVE_INFINITY })).toThrow(
      'finite',
    );
  });
});
