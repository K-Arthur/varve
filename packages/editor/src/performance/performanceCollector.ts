/**
 * Low-overhead bounded performance collector.
 *
 * Research basis: User Timing uses monotonic high-resolution timestamps;
 * this collector mirrors that model while keeping data local and bounded.
 */
import type {
  DurationSummary,
  MetricSample,
  PerformanceEnvironment,
  PerformanceTrace,
} from '@strata/shared';
import { appendBoundedMetric, createPerformanceTrace, summarizeDurations } from '@strata/shared';

export interface PerformanceCollector {
  start(
    name: string,
    phase?: string,
    attributes?: MetricSample['attributes'],
  ): (attributes?: MetricSample['attributes']) => void;
  record(sample: MetricSample): void;
  summary(name: string): DurationSummary;
  exportTrace(): PerformanceTrace;
  clear(): void;
  setEnabled(enabled: boolean): void;
}

export interface PerformanceCollectorOptions {
  environment: PerformanceEnvironment;
  capacity?: number;
  now?: () => number;
  createdAt?: () => string;
  traceId?: string;
  enabled?: boolean;
}

export function createPerformanceCollector(
  options: PerformanceCollectorOptions,
): PerformanceCollector {
  const capacity = Math.max(1, options.capacity ?? 2_000);
  const now = options.now ?? (() => performance.now());
  const createdAt = options.createdAt ?? (() => new Date().toISOString());
  let enabled = options.enabled ?? true;
  let trace = createPerformanceTrace({
    traceId: options.traceId ?? `local-${createdAt()}`,
    createdAt: createdAt(),
    environment: { ...options.environment },
  });

  const record = (sample: MetricSample) => {
    if (!enabled) return;
    appendBoundedMetric(trace.metrics, sample, capacity);
  };

  return {
    start(name, phase, attributes) {
      const startTimeMs = now();
      return (endAttributes) => {
        const endTimeMs = now();
        record({
          name,
          startTimeMs,
          durationMs: Math.max(0, endTimeMs - startTimeMs),
          phase,
          attributes: { ...attributes, ...endAttributes },
        });
      };
    },
    record,
    summary(name) {
      return summarizeDurations(
        trace.metrics.filter((sample) => sample.name === name).map((sample) => sample.durationMs),
      );
    },
    exportTrace() {
      return {
        ...trace,
        environment: { ...trace.environment },
        metrics: trace.metrics.map((sample) => ({
          ...sample,
          attributes: sample.attributes ? { ...sample.attributes } : undefined,
        })),
        errors: [...trace.errors],
      };
    },
    clear() {
      trace = createPerformanceTrace({
        traceId: options.traceId ?? `local-${createdAt()}`,
        createdAt: createdAt(),
        environment: { ...options.environment },
      });
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
    },
  };
}
