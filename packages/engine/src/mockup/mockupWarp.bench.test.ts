/**
 * Mockup warp performance benchmarks — the first baseline for the mockup
 * warp family (2026-09-25; no warp benchmark existed before this file).
 *
 * Measures the pure per-pixel CPU warps (`warpImageToQuad` projective and
 * `warpImageToMesh` bilinear envelope) at 512/1024/2048 px sources. These
 * run on the main-thread structural path whenever a mockup frame bakes, so
 * a regression here is directly visible as interaction latency on mockup
 * documents. Gates are deliberately generous wall-clock bounds (best-of-3,
 * JIT warmup absorbed): they catch order-of-magnitude regressions without
 * tripping on a loaded shared machine.
 */
import { describe, expect, it } from 'vitest';
import type { Quad } from './homography';
import { isMeshGridValid, type MockupMeshGrid, warpImageToMesh } from './meshWarp';
import { warpImageToQuad } from './quadWarp';

function sourcePixels(size: number): Uint8ClampedArray {
  const src = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = ((x >> 3) + (y >> 3)) % 2 === 0 ? 235 : 30;
      src[i] = v;
      src[i + 1] = (v * 7) % 256;
      src[i + 2] = (v * 3) % 256;
      src[i + 3] = 255;
    }
  }
  return src;
}

function tiltedQuad(size: number): Quad {
  const skew = size * 0.08;
  return [
    { x: skew, y: 0 },
    { x: size, y: skew },
    { x: size - skew, y: size },
    { x: 0, y: size - skew },
  ];
}

function wavyGrid(cells: number, size: number): MockupMeshGrid {
  const vertices: MockupMeshGrid['vertices'] = [];
  for (let r = 0; r <= cells; r++) {
    const row: MockupMeshGrid['vertices'][number] = [];
    for (let c = 0; c <= cells; c++) {
      const phase = (c / cells) * Math.PI * 2;
      row.push({
        x: (c / cells) * size,
        y: (r / cells) * size + Math.sin(phase) * size * 0.04,
      });
    }
    vertices.push(row);
  }
  return { cols: cells, rows: cells, vertices };
}

function bestOf3(run: () => void): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('mockup warp bench', () => {
  it('warpImageToQuad at 512/1024/2048 px stays within bounded wall-clock', () => {
    const quad512 = tiltedQuad(512);
    const quad1024 = tiltedQuad(1024);
    const quad2048 = tiltedQuad(2048);
    const src512 = sourcePixels(512);
    const src1024 = sourcePixels(1024);
    const src2048 = sourcePixels(2048);

    const ms512 = bestOf3(() => void warpImageToQuad(src512, 512, 512, quad512, 512, 512));
    const ms1024 = bestOf3(() => void warpImageToQuad(src1024, 1024, 1024, quad1024, 1024, 1024));
    const ms2048 = bestOf3(() => void warpImageToQuad(src2048, 2048, 2048, quad2048, 2048, 2048));
    console.log(
      `warpImageToQuad ms: 512=${ms512.toFixed(1)} 1024=${ms1024.toFixed(1)} 2048=${ms2048.toFixed(1)}`,
    );
    expect(ms512).toBeLessThan(400);
    expect(ms1024).toBeLessThan(900);
    expect(ms2048).toBeLessThan(3200);
  });

  it('warpImageToMesh at 512/1024/2048 px stays within bounded wall-clock', () => {
    const grid512 = wavyGrid(4, 512);
    const grid1024 = wavyGrid(4, 1024);
    const grid2048 = wavyGrid(4, 2048);
    expect(isMeshGridValid(grid2048)).toBe(true);
    const src512 = sourcePixels(512);
    const src1024 = sourcePixels(1024);
    const src2048 = sourcePixels(2048);

    const ms512 = bestOf3(() => void warpImageToMesh(src512, 512, 512, grid512, 512, 512));
    const ms1024 = bestOf3(() => void warpImageToMesh(src1024, 1024, 1024, grid1024, 1024, 1024));
    const ms2048 = bestOf3(() => void warpImageToMesh(src2048, 2048, 2048, grid2048, 2048, 2048));
    console.log(
      `warpImageToMesh ms: 512=${ms512.toFixed(1)} 1024=${ms1024.toFixed(1)} 2048=${ms2048.toFixed(1)}`,
    );
    expect(ms512).toBeLessThan(600);
    expect(ms1024).toBeLessThan(1400);
    expect(ms2048).toBeLessThan(4800);
  });
});
