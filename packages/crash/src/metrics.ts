/**
 * Local reporter-health metrics (Phase 19).
 *
 * Tracked on-device only and surfaced in Privacy & Diagnostics. These are
 * operational measurements of the reporting system itself — they are NEVER
 * transmitted and never become undeclared telemetry.
 */

export interface CrashMetricsState {
  captureCount: number;
  captureFailedCount: number;
  persistenceFailures: number;
  redactionFailures: number;
  queueCorruptionCount: number;
  uploadSuccessCount: number;
  uploadRetryCount: number;
  uploadFailureCount: number;
  totalPayloadBytes: number;
  payloadCount: number;
  dialogCompletionCount: number;
  recoverySuccessCount: number;
  safeModeRecoveryCount: number;
  reporterCrashes: number;
}

export const EMPTY_METRICS: CrashMetricsState = {
  captureCount: 0,
  captureFailedCount: 0,
  persistenceFailures: 0,
  redactionFailures: 0,
  queueCorruptionCount: 0,
  uploadSuccessCount: 0,
  uploadRetryCount: 0,
  uploadFailureCount: 0,
  totalPayloadBytes: 0,
  payloadCount: 0,
  dialogCompletionCount: 0,
  recoverySuccessCount: 0,
  safeModeRecoveryCount: 0,
  reporterCrashes: 0,
};

export type CrashMetricEvent = keyof CrashMetricsState;

export interface CrashMetrics {
  record(event: CrashMetricEvent, amount?: number): void;
  snapshot(): CrashMetricsState;
  reset(): void;
}

const METRICS_KEY = 'varve:crash-metrics';

export class LocalCrashMetrics implements CrashMetrics {
  private state: CrashMetricsState;

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.state = this.load();
  }

  private load(): CrashMetricsState {
    try {
      const raw = this.storage.getItem(METRICS_KEY);
      if (!raw) return { ...EMPTY_METRICS };
      const parsed = JSON.parse(raw) as Partial<CrashMetricsState>;
      return { ...EMPTY_METRICS, ...parsed };
    } catch {
      return { ...EMPTY_METRICS };
    }
  }

  record(event: CrashMetricEvent, amount = 1): void {
    this.state = { ...this.state, [event]: this.state[event] + amount };
    try {
      this.storage.setItem(METRICS_KEY, JSON.stringify(this.state));
    } catch {
      // Storage unavailable — metrics stay in memory for the session.
    }
  }

  snapshot(): CrashMetricsState {
    return { ...this.state };
  }

  reset(): void {
    this.state = { ...EMPTY_METRICS };
    try {
      this.storage.removeItem(METRICS_KEY);
    } catch {
      // ignore
    }
  }
}
