/**
 * Shared benchmark utilities for render IR and replay timing.
 */

export interface BenchSample {
  p50: number;
  p95: number;
  min: number;
  max: number;
  count: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function summarize(samples: number[]): BenchSample {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    count: sorted.length,
  };
}

export function estimateIrBytes(ir: unknown): number {
  return new TextEncoder().encode(JSON.stringify(ir)).length;
}

export function warmUp(fn: () => void, iterations = 3): void {
  for (let i = 0; i < iterations; i++) fn();
}
