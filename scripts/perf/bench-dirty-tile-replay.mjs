#!/usr/bin/env node
/**
 * Before/after for dirty-tile raster replay.
 *
 * Compares rebuilding a layer's whole intermediate from every tile against
 * re-uploading only the tiles a brush dab actually changed (4 tiles), using
 * the same typed-array traffic model as bench-raster-reconstruction.mjs.
 *
 * Same caveat as that benchmark: this models memory traffic in Node and is a
 * lower bound on in-browser cost, not an estimate of it. It is the *ratio*
 * that matters here — both arms pay the same per-tile cost, so the speedup is
 * the tile-count ratio the optimization removes.
 *
 * Usage: node scripts/perf/bench-dirty-tile-replay.mjs
 */
import { performance } from 'node:perf_hooks';

const TILE = 128;

function rebuildAll(cols, rows) {
  const w = cols * TILE,
    h = rows * TILE;
  const surface = new Uint8ClampedArray(w * h * 4);
  const t0 = performance.now();
  for (let col = 0; col < cols; col++)
    for (let row = 0; row < rows; row++) {
      const img = new Uint8ClampedArray(TILE * TILE * 4);
      for (let y = 0; y < TILE; y++)
        surface.set(
          img.subarray(y * TILE * 4, (y + 1) * TILE * 4),
          ((row * TILE + y) * w + col * TILE) * 4,
        );
    }
  return performance.now() - t0;
}
function uploadDirty(cols, rows, dirtyTiles, surface) {
  const w = cols * TILE;
  const t0 = performance.now();
  for (let i = 0; i < dirtyTiles; i++) {
    const col = i % cols,
      row = Math.floor(i / cols) % rows;
    const img = new Uint8ClampedArray(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++)
      surface.set(
        img.subarray(y * TILE * 4, (y + 1) * TILE * 4),
        ((row * TILE + y) * w + col * TILE) * 4,
      );
  }
  return performance.now() - t0;
}
const cases = [
  [4, 4, '512²'],
  [8, 8, '1024²'],
  [16, 16, '2048²'],
  [32, 32, '4096²'],
  [64, 64, '8192²'],
];
const N = 12,
  WARM = 3;
const p = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)];
};
console.log('| Layer | Tiles | full rebuild p95 | 4-dirty-tile p95 | speedup |');
console.log('|---|---:|---:|---:|---:|');
for (const [cols, rows, label] of cases) {
  const w = cols * TILE,
    h = rows * TILE;
  const surface = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < WARM; i++) {
    rebuildAll(cols, rows);
    uploadDirty(cols, rows, 4, surface);
  }
  const full = [],
    dirty = [];
  for (let i = 0; i < N; i++) {
    full.push(rebuildAll(cols, rows));
    dirty.push(uploadDirty(cols, rows, 4, surface));
  }
  const fp = p(full, 95),
    dp = p(dirty, 95);
  console.log(
    `| ${label} | ${cols * rows} | ${fp.toFixed(2)} ms | ${dp.toFixed(3)} ms | ${(fp / Math.max(dp, 1e-6)).toFixed(0)}x |`,
  );
}
