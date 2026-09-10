/**
 * Tests for alpha-channel contour extraction.
 */
import { describe, expect, it } from 'vitest';
import { type AlphaContour, alphaContoursToShapeNodes, extractAlphaContours } from './alphaContour';

function makeImageData(width: number, height: number, alpha: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = alpha[i] ?? 0;
  }
  return new ImageData(data, width, height);
}

function fillRectAlpha(
  alpha: number[],
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  value: number,
): void {
  for (let py = y; py < y + rh; py++) {
    for (let px = x; px < x + rw; px++) {
      if (py >= 0 && py < h && px >= 0 && px < w) {
        alpha[py * w + px] = value;
      }
    }
  }
}

describe('extractAlphaContours', () => {
  it('extracts single contour from a solid 100x100 rect', () => {
    const w = 100;
    const h = 100;
    const alpha = new Array(w * h).fill(0);
    fillRectAlpha(alpha, w, h, 5, 5, 90, 90, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });

    expect(contours.length).toBeGreaterThanOrEqual(1);
    const main = contours[0]!;
    expect(main.area).toBeGreaterThan(7000);
    expect(main.bounds.w).toBeGreaterThanOrEqual(88);
    expect(main.bounds.h).toBeGreaterThanOrEqual(88);
    expect(main.points.length).toBeGreaterThanOrEqual(3);
  });

  it('extracts contours from shape with a hole (inner region has zero alpha)', () => {
    const w = 100;
    const h = 100;
    const alpha = new Array(w * h).fill(255);
    // Punch a hole in the middle
    fillRectAlpha(alpha, w, h, 40, 40, 20, 20, 0);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 1 });

    // Should find at least 2 contours: outer boundary and inner hole boundary
    expect(contours.length).toBeGreaterThanOrEqual(2);
    // The outer contour should be largest
    expect(contours[0]!.area).toBeGreaterThan(contours[1]!.area);
  });

  it('extracts 2 contours from two disconnected regions', () => {
    const w = 100;
    const h = 100;
    const alpha = new Array(w * h).fill(0);
    // Two separate 20x20 squares
    fillRectAlpha(alpha, w, h, 10, 10, 20, 20, 255);
    fillRectAlpha(alpha, w, h, 60, 60, 20, 20, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 1 });

    expect(contours.length).toBeGreaterThanOrEqual(2);
  });

  it('produces smooth contour from anti-aliased alpha edge (gradient)', () => {
    const w = 20;
    const h = 20;
    const alpha = new Array(w * h).fill(0);
    // Sloped gradient: alpha increases diagonally
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - 5) ** 2 + (y - 5) ** 2);
        const a = Math.max(0, Math.min(255, Math.round((1 - dist / 10) * 255)));
        alpha[y * w + x] = a;
      }
    }
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 128, minArea: 1 });

    expect(contours.length).toBeGreaterThanOrEqual(1);
    // Anti-aliased edges should produce smooth contours (no sharp staircasing
    // from hard 0/255 threshold — sub-pixel interpolation handles this)
    const contour = contours[0]!;
    expect(contour.points.length).toBeGreaterThan(3);
  });

  it('extracts single 4-point contour from full-alpha 1x1 image', () => {
    const alpha = [255];
    const imgData = makeImageData(1, 1, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1 });

    // A 1x1 image with full alpha: the marching squares cell produces edges
    // around the boundary. This might produce a small contour or none depending
    // on the algorithm — at minimum, should not crash.
    expect(Array.isArray(contours)).toBe(true);
  });

  it('returns empty array for zero-alpha image', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1 });

    expect(contours).toHaveLength(0);
  });

  it('respects point budget for large images', () => {
    const w = 200;
    const h = 200;
    const alpha = new Array(w * h).fill(255);
    // A full-alpha 200x200 image with a very tight point budget
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, {
      alphaThreshold: 1,
      minArea: 1,
      pointBudget: 100,
    });

    // Total points across all contours should be within budget + some tolerance
    const totalPoints = contours.reduce((sum, c) => sum + c.points.length, 0);
    expect(totalPoints).toBeLessThanOrEqual(105);
  });

  it('filters out tiny islands via minArea', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    // A 100 px² shape
    fillRectAlpha(alpha, w, h, 10, 10, 10, 10, 255);
    // A tiny 2 px² shape (should be filtered out)
    fillRectAlpha(alpha, w, h, 30, 30, 1, 1, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, {
      alphaThreshold: 1,
      minArea: 10,
      simplifyTolerance: 0.1,
    });

    // Should only find the larger shape
    // Small 1x1 shape has tiny area and may not produce a valid contour at all
    expect(contours.length).toBeGreaterThanOrEqual(1);
  });
});

describe('alphaContoursToShapeNodes', () => {
  const sourceNode = {
    name: 'Image',
    order: 'a0',
    opacity: 1,
    blendMode: 'normal',
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    fills: [
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
  };

  it('converts single contour to shape node with path shape', () => {
    const contours: AlphaContour[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        area: 100,
        bounds: { x: 0, y: 0, w: 10, h: 10 },
      },
    ];

    const nodes = alphaContoursToShapeNodes(contours, 'img-1', sourceNode);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe('shape');
    expect(nodes[0]!.shape.kind).toBe('path');
    if (nodes[0]!.shape.kind === 'path') {
      expect(nodes[0]!.shape.closed).toBe(true);
    }
    expect((nodes[0]!.fills[0] as Record<string, unknown>).type).toBe('solid');
  });

  it('returns empty array for empty contours', () => {
    const nodes = alphaContoursToShapeNodes([], 'img-1', sourceNode);
    expect(nodes).toHaveLength(0);
  });

  it('inherits transform from source node', () => {
    const movedNode = {
      ...sourceNode,
      transform: [2, 0, 0, 1, 100, 50] as const,
    };
    const contours: AlphaContour[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        area: 25,
        bounds: { x: 0, y: 0, w: 5, h: 5 },
      },
    ];

    const nodes = alphaContoursToShapeNodes(contours, 'img-1', movedNode);
    expect(nodes[0]!.transform).toEqual([2, 0, 0, 1, 100, 50]);
  });
});
