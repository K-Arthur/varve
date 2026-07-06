import { describe, expect, it } from 'vitest';
import {
  filterMaskByComponents,
  findConnectedComponents,
  maskFromImageData,
  maskToImageData,
} from '../maskOps';

describe('findConnectedComponents', () => {
  it('returns empty for all-background mask', () => {
    const mask = new Uint8Array(16);
    expect(findConnectedComponents(mask, 4, 4)).toEqual([]);
  });

  it('labels two disconnected blobs', () => {
    const mask = new Uint8Array(25);
    // Blob 1 at (0,0) and (1,0)
    mask[0] = 255;
    mask[1] = 255;
    // Blob 2 at (3,3)
    mask[3 * 5 + 3] = 255;

    const components = findConnectedComponents(mask, 5, 5);
    expect(components).toHaveLength(2);
    expect(components[0]?.pixelCount).toBe(2);
    expect(components[1]?.pixelCount).toBe(1);
    expect(components[0]?.bbox).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect(components[1]?.bbox).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });

  it('8-connects diagonal pixels into one component', () => {
    const mask = new Uint8Array(9);
    mask[0] = 255;
    mask[4] = 255;
    const components = findConnectedComponents(mask, 3, 3);
    expect(components).toHaveLength(1);
    expect(components[0]?.pixelCount).toBe(2);
  });

  it('filterMaskByComponents keeps only selected ids', () => {
    const mask = new Uint8Array(25);
    mask[0] = 200;
    mask[1] = 200;
    mask[3 * 5 + 3] = 200;

    const components = findConnectedComponents(mask, 5, 5);
    const largestId = components[0]?.id ?? 0;
    const filtered = filterMaskByComponents(mask, 5, 5, new Set([largestId]));
    expect(filtered[0]).toBe(200);
    expect(filtered[1]).toBe(200);
    expect(filtered[3 * 5 + 3]).toBe(0);
  });
});

describe('maskFromImageData / maskToImageData', () => {
  it('round-trips alpha channel', () => {
    const img = new ImageData(2, 2);
    img.data[0] = 128;
    img.data[4] = 64;
    const mask = maskFromImageData(img);
    expect(mask[0]).toBe(128);
    expect(mask[1]).toBe(64);
    const back = maskToImageData(mask, 2, 2);
    expect(back.data[0]).toBe(128);
    expect(back.data[4]).toBe(64);
  });
});
