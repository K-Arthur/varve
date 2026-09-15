/**
 * Throttled, best-effort memory pressure signal for diagnostics and cache
 * policy. Browser memory APIs are optional and do not include every native,
 * WASM, or GPU allocation, so this is a conservative signal—not a total
 * memory meter and never a reason to discard document/history state.
 */

export type MeasuredMemoryPressure = 'normal' | 'elevated' | 'high' | 'critical';

export interface RuntimeMemorySample {
  usedHeapBytes: number;
  heapLimitBytes: number;
  observedAt: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
}

const SAMPLE_INTERVAL_MS = 2000;
let lastSample: RuntimeMemorySample | null = null;

/** Read Chromium's optional JS heap counters at most once per interval. */
export function readRuntimeMemorySample(now = performance.now()): RuntimeMemorySample | null {
  if (lastSample && now - lastSample.observedAt < SAMPLE_INTERVAL_MS) return lastSample;
  const memory =
    typeof performance === 'undefined' ? undefined : (performance as PerformanceWithMemory).memory;
  const used = memory?.usedJSHeapSize;
  const limit = memory?.jsHeapSizeLimit;
  if (
    typeof used !== 'number' ||
    typeof limit !== 'number' ||
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    used < 0 ||
    limit <= 0
  ) {
    lastSample = null;
    return null;
  }
  lastSample = { usedHeapBytes: used, heapLimitBytes: limit, observedAt: now };
  return lastSample;
}

export function resolveMeasuredMemoryPressure(now = performance.now()): MeasuredMemoryPressure {
  const sample = readRuntimeMemorySample(now);
  if (!sample) return 'normal';
  const ratio = sample.usedHeapBytes / sample.heapLimitBytes;
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.6) return 'elevated';
  return 'normal';
}

export function _setRuntimeMemorySampleForTesting(sample: RuntimeMemorySample | null): void {
  lastSample = sample;
}

export function _resetRuntimeMemorySample(): void {
  lastSample = null;
}
