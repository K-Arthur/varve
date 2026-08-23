import { describe, expect, it } from 'vitest';
import { buildPerspectiveImageSvg, triAffine } from './perspectiveSvg';
import type { PerspectiveQuad } from '@varve/scene';

/** Parse an SVG `matrix(a b c d e f)` string into numeric coefficients. */
function parseMatrix(s: string): [number, number, number, number, number, number] {
  const m = /matrix\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/.exec(s);
  expect(m, `not a matrix string: ${s}`).toBeTruthy();
  if (!m) return [1, 0, 0, 1, 0, 0];
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  ];
}

function applyMatrix(
  M: readonly [number, number, number, number, number, number],
  p: { x: number; y: number },
): { x: number; y: number } {
  // u = a·x + c·y + e ; v = b·x + d·y + f
  return {
    x: M[0] * p.x + M[2] * p.y + M[4],
    y: M[1] * p.x + M[3] * p.y + M[5],
  };
}

const BOX = 100;

describe('triAffine', () => {
  it('is exact on its three defining correspondences', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 30 },
    ] as const;
    const dst = [
      { x: 10, y: 5 },
      { x: 90, y: 7 },
      { x: 14, y: 60 },
    ] as const;
    const M = parseMatrix(triAffine(src, dst));
    for (let i = 0; i < 3; i++) {
      const mapped = applyMatrix(M, src[i]!);
      expect(Math.abs(mapped.x - dst[i]!.x)).toBeLessThan(1e-4);
      expect(Math.abs(mapped.y - dst[i]!.y)).toBeLessThan(1e-4);
    }
  });

  it('reproduces a pure translation', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ] as const;
    const dst = [
      { x: 5, y: 7 },
      { x: 15, y: 7 },
      { x: 5, y: 17 },
    ] as const;
    const M = parseMatrix(triAffine(src, dst));
    expect(Math.abs(M[0] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(M[3] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(M[4] - 5)).toBeLessThan(1e-9);
    expect(Math.abs(M[5] - 7)).toBeLessThan(1e-9);
  });

  it('returns identity for a degenerate (collinear) triangle', () => {
    const col = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ] as const;
    expect(triAffine(col, col)).toBe('matrix(1 0 0 1 0 0)');
  });
});

describe('buildPerspectiveImageSvg', () => {
  const identityQuad: PerspectiveQuad = [
    [0, 0],
    [BOX, 0],
    [BOX, BOX],
    [0, BOX],
  ];

  it('emits 2·gridSize² triangles with clip+image pairs', () => {
    const svg = buildPerspectiveImageSvg({
      href: 'img.png',
      w: BOX,
      h: BOX,
      quad: identityQuad,
      nodeId: 'n1',
      indent: '',
      minify: false,
      gridSize: 3,
    });
    expect(svg).not.toBeNull();
    const clips = (svg?.match(/<clipPath /g) ?? []).length;
    const images = (svg?.match(/<image /g) ?? []).length;
    expect(clips).toBe(18); // 3×3 cells × 2 triangles
    expect(images).toBe(18);
  });

  it('maps every triangle through its matrix exactly at its corners (identity quad)', () => {
    const svg = buildPerspectiveImageSvg({
      href: 'img.png',
      w: BOX,
      h: BOX,
      quad: identityQuad,
      nodeId: 'n1',
      indent: '',
      minify: false,
      gridSize: 4,
    });
    expect(svg).not.toBeNull();
    // For the identity quad, every per-triangle affine must be ~identity:
    // source grid == destination grid, so matrix ≈ translate-only zero.
    const matrices = svg?.match(/matrix\(([^)]+)\)/g) ?? [];
    expect(matrices.length).toBeGreaterThan(0);
    for (const raw of matrices) {
      const M = parseMatrix(raw);
      // Linear part ~identity, translation ~zero (identity sampling).
      expect(Math.abs(M[0] - 1)).toBeLessThan(1e-6);
      expect(Math.abs(M[1])).toBeLessThan(1e-6);
      expect(Math.abs(M[2])).toBeLessThan(1e-6);
      expect(Math.abs(M[3] - 1)).toBeLessThan(1e-6);
      expect(Math.abs(M[4])).toBeLessThan(1e-6);
      expect(Math.abs(M[5])).toBeLessThan(1e-6);
    }
  });

  it('warps corner triangles to the requested trapezoid corners', () => {
    const trap: PerspectiveQuad = [
      [10, 0],
      [90, 0],
      [120, 100],
      [-20, 100],
    ];
    const svg = buildPerspectiveImageSvg({
      href: 'img.png',
      w: BOX,
      h: BOX,
      quad: trap,
      nodeId: 'n2',
      indent: '',
      minify: false,
      gridSize: 1,
    });
    expect(svg).not.toBeNull();
    // Grid size 1 → cell (0,0) covers the whole box; triangle 'a' has source
    // corners (0,0),(w,0),(0,h) which must land on quad TL, TR, BL exactly.
    const first = parseMatrix((svg?.match(/matrix\(([^)]+)\)/g) ?? [''])[0] || 'matrix(1 0 0 1 0 0)');
    const checks: Array<[{ x: number; y: number }, readonly [number, number]]> = [
      [{ x: 0, y: 0 }, trap[0]],
      [{ x: BOX, y: 0 }, trap[1]],
      [{ x: 0, y: BOX }, trap[3]],
    ];
    for (const [src, want] of checks) {
      const got = applyMatrix(first, src);
      expect(Math.abs(got.x - want[0])).toBeLessThan(1e-3);
      expect(Math.abs(got.y - want[1])).toBeLessThan(1e-3);
    }
  });

  it('samples raw-image pixels through the inverse content transform', () => {
    // Rotation 0, no flips, drawRect == full box → raw px scales linearly.
    const svg = buildPerspectiveImageSvg({
      href: 'img.png',
      w: BOX,
      h: BOX,
      quad: identityQuad,
      nodeId: 'n3',
      indent: '',
      minify: false,
      gridSize: 2,
      placement: {
        fit: 'fill',
        sourceWidth: 200,
        sourceHeight: 200,
        bounds: { x: 0, y: 0, w: BOX, h: BOX },
        drawRect: { x: 0, y: 0, w: BOX, h: BOX },
        sourceRect: { x: 0, y: 0, w: 200, h: 200 },
        sampleDrawRect: { x: 0, y: 0, w: BOX, h: BOX },
        rotation: 0,
        flipH: false,
        flipV: false,
      },
      sourceWidth: 200,
      sourceHeight: 200,
    });
    expect(svg).not.toBeNull();
    // Node-local (50,50) samples raw px (100,100): the matrix maps RAW px
    // → node-local, so its linear part is drawRect.w/sourceWidth = 0.5.
    // With the identity quad every triangle shares that same uniform scale.
    const matrices = (svg?.match(/matrix\(([^)]+)\)/g) ?? []).map(parseMatrix);
    expect(matrices.length).toBe(8);
    for (const M of matrices) {
      expect(Math.abs(Math.abs(M[0]) - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(M[3]) - 0.5)).toBeLessThan(1e-6);
    }
  });

  it('returns null for a crossed (invalid) quad', () => {
    const crossed: PerspectiveQuad = [
      [0, 0],
      [BOX, BOX],
      [BOX, 0],
      [0, BOX],
    ];
    expect(
      buildPerspectiveImageSvg({
        href: 'img.png',
        w: BOX,
        h: BOX,
        quad: crossed,
        nodeId: 'n4',
        indent: '',
        minify: false,
      }),
    ).toBeNull();
  });

  it('returns null for an empty box', () => {
    expect(
      buildPerspectiveImageSvg({
        href: 'img.png',
        w: 0,
        h: 100,
        quad: identityQuad,
        nodeId: 'n5',
        indent: '',
        minify: false,
      }),
    ).toBeNull();
  });
});
