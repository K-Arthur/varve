/**
 * Exact-cosine-search scale benchmark for the semantic similarity index.
 *
 * Answers "does Varve need an ANN index?" with measurements: exact scan
 * query latency and memory at realistic library scales (100 → 100k
 * images at the SigLIP dimension 768, fp32, normalized). If exact scan
 * stays comfortably interactive at the largest plausible local library,
 * ANN is deferred as unnecessary complexity.
 *
 * Run: pnpm bench (benchmark mode for .bench.ts files).
 */

import { bench, describe } from 'vitest';

const DIM = 768;

function randomVector(seed: number): Float32Array {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const v = new Float32Array(DIM);
  let sumSq = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = next() * 2 - 1;
    sumSq += v[i] * v[i];
  }
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

function buildLibrary(n: number): Float32Array {
  const lib = new Float32Array(n * DIM);
  for (let i = 0; i < n; i++) lib.set(randomVector(i + 1), i * DIM);
  return lib;
}

/** Exact top-10 cosine scan over a flat normalized matrix. */
function exactTopK(query: Float32Array, lib: Float32Array, n: number, k: number): number[] {
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const off = i * DIM;
    for (let d = 0; d < DIM; d++) dot += query[d]! * lib[off + d]!;
    scores[i] = dot;
  }
  // Selection: partial insertion sort for top-k (k << n).
  const indices = new Uint32Array(k);
  const vals = new Float32Array(k);
  for (let i = 0; i < n; i++) {
    const s = scores[i]!;
    let j = Math.min(k - 1, i);
    if (i >= k && s <= vals[k - 1]!) continue;
    while (j > 0 && s > vals[j - 1]!) {
      vals[j] = vals[j - 1]!;
      indices[j] = indices[j - 1]!;
      j--;
    }
    vals[j] = s;
    indices[j] = i;
  }
  return Array.from(indices);
}

const SIZES = [100, 1_000, 10_000, 50_000, 100_000];

describe('exact cosine scan (768-dim fp32, normalized)', () => {
  for (const size of SIZES) {
    const lib = buildLibrary(size);
    const query = randomVector(0xdeadbeef);
    bench(
      `top-10 exact scan, ${size.toLocaleString()} vectors (${((size * DIM * 4) / 1024 / 1024).toFixed(0)} MB)`,
      () => {
        exactTopK(query, lib, size, 10);
      },
      { time: 200, iterations: 20 },
    );
  }
});
