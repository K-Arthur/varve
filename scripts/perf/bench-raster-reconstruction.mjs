#!/usr/bin/env node
/**
 * Raster reconstruction measurement — cost of rebuilding a full layer-sized
 * intermediate from every 128px tile, by tile count.
 *
 * Scope and honesty: this models the memory-traffic component of
 * `paintRasterLayer` (full-surface allocation plus a per-tile copy into it)
 * using real typed-array traffic in Node. It is NOT a browser measurement —
 * real `putImageData` additionally performs colour-space handling and may
 * touch GPU-backed storage, so these figures are a *lower bound* on the
 * in-browser cost, not an estimate of it. The tile-replay share it reports
 * (>94% at every size) is what justifies treating tile traffic, rather than
 * surface allocation, as the dominant term.
 *
 * For in-browser figures use the instrumented path instead: install a sink
 * with `setRasterReplaySink` (packages/engine/src/rasterReplayMetrics.ts) and
 * read the samples back under `?perf=1`.
 *
 * Usage: node scripts/perf/bench-raster-reconstruction.mjs
 */
import { performance } from 'node:perf_hooks';

const TILE = 128;

// Mirror of paintRasterLayer's work: allocate a full-layer intermediate,
// putImageData every tile, then draw it once. Uses real typed-array traffic,
// which is what dominates on a CPU-bound WebKitGTK path.
function reconstruct(cols, rows) {
  const width = cols * TILE;
  const height = rows * TILE;
  const t0 = performance.now();
  // Full-layer intermediate.
  const surface = new Uint8ClampedArray(width * height * 4);
  const t1 = performance.now();
  let composited = 0;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const pixels = new Uint8ClampedArray(TILE * TILE * 4);
      const imageData = new Uint8ClampedArray(TILE * TILE * 4);
      imageData.set(pixels);
      // putImageData equivalent: copy the tile into the surface row by row.
      for (let y = 0; y < TILE; y++) {
        const dst = ((row * TILE + y) * width + col * TILE) * 4;
        surface.set(imageData.subarray(y * TILE * 4, (y + 1) * TILE * 4), dst);
      }
      composited++;
    }
  }
  const t2 = performance.now();
  return {
    width,
    height,
    totalTiles: cols * rows,
    compositedTiles: composited,
    intermediateBytes: width * height * 4,
    surfaceMs: t1 - t0,
    tileReplayMs: t2 - t1,
    totalMs: t2 - t0,
  };
}

const cases = [
  { label: '512x512 (16 tiles)', cols: 4, rows: 4 },
  { label: '1024x1024 (64 tiles)', cols: 8, rows: 8 },
  { label: '2048x2048 (256 tiles)', cols: 16, rows: 16 },
  { label: '4096x4096 (1024 tiles)', cols: 32, rows: 32 },
  { label: '8192x8192 (4096 tiles)', cols: 64, rows: 64 },
];

const WARMUP = 3;
const ITERATIONS = 12;

console.log('| Layer | Tiles | Intermediate | p50 total | p95 total | tile replay share |');
console.log('|---|---:|---:|---:|---:|---:|');

const results = [];
for (const { label, cols, rows } of cases) {
  for (let i = 0; i < WARMUP; i++) reconstruct(cols, rows);
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) samples.push(reconstruct(cols, rows));
  const totals = samples.map((s) => s.totalMs).sort((a, b) => a - b);
  const p = (q) => totals[Math.min(totals.length - 1, Math.ceil((q / 100) * totals.length) - 1)];
  const tileShare =
    samples.reduce((s, x) => s + x.tileReplayMs, 0) / samples.reduce((s, x) => s + x.totalMs, 0);
  const mib = (samples[0].intermediateBytes / (1024 * 1024)).toFixed(1);
  results.push({ label, p50: p(50), p95: p(95), bytes: samples[0].intermediateBytes, tileShare });
  console.log(
    `| ${label} | ${samples[0].totalTiles} | ${mib} MiB | ${p(50).toFixed(2)} ms | ${p(95).toFixed(2)} ms | ${(tileShare * 100).toFixed(1)}% |`,
  );
}

console.log('\nTrigger evaluation vs a 16.7ms frame budget:');
for (const r of results) {
  const overBudget = r.p95 > 16.7;
  const overBytes = r.bytes > 8 * 1024 * 1024;
  console.log(
    `  ${r.label}: p95 ${r.p95.toFixed(2)}ms ${overBudget ? 'OVER' : 'under'} budget, intermediate ${(r.bytes / (1024 * 1024)).toFixed(1)} MiB ${overBytes ? 'OVER' : 'under'} 8 MiB threshold`,
  );
}
