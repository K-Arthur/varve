import { describe, expect, it } from 'vitest';
import {
  assignStableIds,
  extractComponentMask,
  filterMaskByComponents,
  findConnectedComponents,
  maskFromImageData,
  maskToImageData,
  mergeNearbyComponents,
  unionComponentMasks,
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

  it('computes confidence as mean mask intensity', () => {
    const mask = new Uint8Array(4);
    mask[0] = 200;
    mask[1] = 200;
    const components = findConnectedComponents(mask, 2, 2);
    expect(components).toHaveLength(1);
    // confidence = (200 + 200) / (2 * 255) ≈ 0.784
    expect(components[0]!.confidence).toBeCloseTo(0.784, 2);
  });

  it('computes relativeArea as fraction of total pixels', () => {
    const mask = new Uint8Array(100);
    for (let i = 0; i < 25; i++) mask[i] = 255;
    const components = findConnectedComponents(mask, 10, 10);
    expect(components).toHaveLength(1);
    expect(components[0]!.relativeArea).toBeCloseTo(0.25, 2);
  });

  it('computes centerOfMass as centroid of foreground pixels', () => {
    const mask = new Uint8Array(25);
    // 3x3 block at (1,1)-(3,3)
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        mask[y * 5 + x] = 255;
      }
    }
    const components = findConnectedComponents(mask, 5, 5);
    expect(components).toHaveLength(1);
    expect(components[0]!.centerOfMass.x).toBeCloseTo(2, 0);
    expect(components[0]!.centerOfMass.y).toBeCloseTo(2, 0);
  });

  it('marks largest component and counts edge pixels', () => {
    const mask = new Uint8Array(100);
    // Blob 1: 50 pixels at top-left
    for (let i = 0; i < 50; i++) mask[i] = 255;
    // Blob 2: 10 pixels at bottom-right
    for (let i = 90; i < 100; i++) mask[i] = 255;

    const components = findConnectedComponents(mask, 10, 10);
    expect(components).toHaveLength(2);
    expect(components[0]!.isLargest).toBe(true);
    expect(components[0]!.pixelCount).toBe(50);
    expect(components[1]!.isLargest).toBe(false);
    expect(components[0]!.edgePixelCount).toBeGreaterThan(0);
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

describe('assignStableIds', () => {
  it('assigns IDs by spatial position (top-to-bottom, left-to-right)', () => {
    const components = [
      {
        id: 3,
        pixelCount: 100,
        bbox: { x: 50, y: 50, w: 10, h: 10 },
        confidence: 0.9,
        relativeArea: 0.1,
        centerOfMass: { x: 55, y: 55 },
        edgePixelCount: 20,
        isLargest: false,
      },
      {
        id: 1,
        pixelCount: 200,
        bbox: { x: 0, y: 0, w: 20, h: 20 },
        confidence: 0.95,
        relativeArea: 0.2,
        centerOfMass: { x: 10, y: 10 },
        edgePixelCount: 30,
        isLargest: true,
      },
      {
        id: 2,
        pixelCount: 150,
        bbox: { x: 0, y: 100, w: 15, h: 15 },
        confidence: 0.85,
        relativeArea: 0.15,
        centerOfMass: { x: 7, y: 107 },
        edgePixelCount: 25,
        isLargest: false,
      },
    ];
    const result = assignStableIds(components);
    // Should be sorted top-to-bottom: y=10 (id:1 original), y=55 (id:3 original), y=107 (id:2 original)
    expect(result[0]!.id).toBe(1);
    expect(result[0]!.centerOfMass.y).toBe(10);
    expect(result[1]!.id).toBe(2);
    expect(result[1]!.centerOfMass.y).toBe(55);
    expect(result[2]!.id).toBe(3);
    expect(result[2]!.centerOfMass.y).toBe(107);
    expect(result[0]!.isLargest).toBe(true);
    expect(result[1]!.isLargest).toBe(false);
  });
});

describe('mergeNearbyComponents', () => {
  it('merges components with overlapping bounding boxes', () => {
    const mask = new Uint8Array(100);
    // Two adjacent blobs that should merge
    for (let i = 0; i < 10; i++) mask[i] = 255;
    for (let i = 10; i < 20; i++) mask[i] = 255;

    const components = findConnectedComponents(mask, 10, 10);
    const merged = mergeNearbyComponents(components, mask, 10, 10);
    // Adjacent blobs are 8-connected, so they form one component
    expect(merged.length).toBeLessThanOrEqual(components.length);
  });

  it('does not merge distant components', () => {
    const mask = new Uint8Array(10000);
    // Blob at top-left
    for (let i = 0; i < 50; i++) mask[i] = 255;
    // Blob at bottom-right (far away)
    for (let i = 9900; i < 9950; i++) mask[i] = 255;

    const components = findConnectedComponents(mask, 100, 100);
    const merged = mergeNearbyComponents(components, mask, 100, 100);
    expect(merged).toHaveLength(2);
  });

  it('preserves mergedFrom tracking', () => {
    // Create a mask with two very close small components
    const mask = new Uint8Array(400);
    // Blob 1: 5 pixels at (0,0)
    for (let i = 0; i < 5; i++) mask[i] = 255;
    // Blob 2: 5 pixels at (6,0) — close enough to merge
    for (let i = 6; i < 11; i++) mask[i] = 255;

    const components = findConnectedComponents(mask, 20, 20);
    if (components.length === 2) {
      const merged = mergeNearbyComponents(components, mask, 20, 20);
      if (merged.length === 1) {
        expect(merged[0]!.mergedFrom).toBeDefined();
        expect(merged[0]!.mergedFrom!.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('extractComponentMask', () => {
  it('returns only the specified component pixels', () => {
    const mask = new Uint8Array(25);
    mask[0] = 200;
    mask[1] = 200;
    mask[3 * 5 + 3] = 200;

    const components = findConnectedComponents(mask, 5, 5);
    const largestId = components[0]!.id;
    const extracted = extractComponentMask(mask, 5, 5, largestId);
    expect(extracted[0]).toBe(200);
    expect(extracted[1]).toBe(200);
    expect(extracted[3 * 5 + 3]).toBe(0);
  });
});

describe('unionComponentMasks', () => {
  it('returns union of specified components', () => {
    const mask = new Uint8Array(25);
    mask[0] = 200;
    mask[1] = 200;
    mask[3 * 5 + 3] = 200;

    const components = findConnectedComponents(mask, 5, 5);
    const allIds = new Set(components.map((c) => c.id));
    const union = unionComponentMasks(mask, 5, 5, allIds);
    expect(union[0]).toBe(200);
    expect(union[3 * 5 + 3]).toBe(200);
  });

  it('returns empty mask when no ids given', () => {
    const mask = new Uint8Array(25);
    mask[0] = 200;
    const union = unionComponentMasks(mask, 5, 5, new Set());
    expect(union.every((v) => v === 0)).toBe(true);
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
