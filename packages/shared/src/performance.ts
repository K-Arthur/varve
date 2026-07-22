/**
 * Portable performance telemetry contracts.
 *
 * Research basis: W3C Performance Timeline and User Timing use a monotonic
 * time origin for in-session measurements. Wall-clock time is retained only
 * as trace metadata so different runtime clocks are never mixed.
 */

export const PERFORMANCE_TRACE_SCHEMA_VERSION = 1 as const;

export type PerformanceProfile = 'automatic' | 'battery-saver' | 'balanced' | 'high-performance';
export type RenderRevision = number;

export interface MetricSample {
  name: string;
  startTimeMs: number;
  durationMs: number;
  phase?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface CapabilitySupport {
  supported: boolean;
  reason?: string;
}

export interface RuntimeCapabilities {
  offscreenCanvas: CapabilitySupport;
  workerAnimationFrame: CapabilitySupport;
  coalescedPointerEvents: CapabilitySupport;
  predictedPointerEvents: CapabilitySupport;
  eventTiming: CapabilitySupport;
  webgl: CapabilitySupport;
  webgpu: CapabilitySupport;
  contextLossRecovery: CapabilitySupport;
}

export interface MemoryBudget {
  totalBytes: number;
  cacheBytes: number;
  backgroundTaskBytes: number;
  decodedImageBytes: number;
}

export interface PerformanceEnvironment {
  runtime: 'tauri' | 'browser' | 'test';
  backend: string;
  os: string;
  webview?: string;
  browser?: string;
  gpu?: string;
  devicePixelRatio: number;
  refreshIntervalMs?: number;
  powerProfile?: string;
  memoryLimitBytes?: number;
  capabilities?: RuntimeCapabilities;
}

export interface PerformanceTrace {
  schemaVersion: typeof PERFORMANCE_TRACE_SCHEMA_VERSION;
  traceId: string;
  createdAt: string;
  environment: PerformanceEnvironment;
  metrics: MetricSample[];
  errors: string[];
}

export interface DurationSummary {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface BenchmarkResult {
  schemaVersion: typeof PERFORMANCE_TRACE_SCHEMA_VERSION;
  workload: string;
  workloadVersion: number;
  fixtureChecksum: string;
  gitSha: string;
  buildMode: 'development' | 'production';
  environment: PerformanceEnvironment;
  summary: DurationSummary;
  rawSamplesMs: number[];
  peakMemoryBytes?: number;
  retainedMemoryBytes?: number;
  cache?: { hits: number; misses: number; evictions: number; bytes: number };
  errors: string[];
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const bounded = Math.max(0, Math.min(1, quantile));
  const index = Math.min(sorted.length - 1, Math.ceil(bounded * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarizeDurations(values: readonly number[]): DurationSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

export function appendBoundedMetric(
  target: MetricSample[],
  sample: MetricSample,
  capacity: number,
): void {
  if (!Number.isFinite(sample.startTimeMs) || !Number.isFinite(sample.durationMs)) return;
  if (sample.startTimeMs < 0 || sample.durationMs < 0 || capacity <= 0) return;
  target.push(sample);
  if (target.length > capacity) target.splice(0, target.length - capacity);
}

export function createPerformanceTrace(input: {
  traceId: string;
  createdAt: string;
  environment: PerformanceEnvironment;
}): PerformanceTrace {
  return {
    schemaVersion: PERFORMANCE_TRACE_SCHEMA_VERSION,
    traceId: input.traceId,
    createdAt: input.createdAt,
    environment: input.environment,
    metrics: [],
    errors: [],
  };
}

export function validatePerformanceTrace(trace: PerformanceTrace): string[] {
  const errors: string[] = [];
  if (trace.schemaVersion !== PERFORMANCE_TRACE_SCHEMA_VERSION) {
    errors.push('unsupported performance trace schema version');
  }
  if (!trace.traceId) errors.push('traceId is required');
  let previousStart = -1;
  for (const sample of trace.metrics) {
    if (
      !Number.isFinite(sample.startTimeMs) ||
      !Number.isFinite(sample.durationMs) ||
      sample.startTimeMs < 0 ||
      sample.durationMs < 0
    ) {
      errors.push('metrics must contain finite non-negative timing values');
      break;
    }
    if (sample.startTimeMs < previousStart) {
      errors.push('metrics must be monotonic by startTimeMs');
      break;
    }
    previousStart = sample.startTimeMs;
  }
  return errors;
}

export function nextRenderRevision(current: RenderRevision): RenderRevision {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) return 1;
  return current + 1;
}
