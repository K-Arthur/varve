/**
 * Conservative presentation-cadence estimator.
 *
 * The web platform does not expose a standard refresh-rate getter. A visible
 * requestAnimationFrame stream is the only signal available to the editor,
 * but its deltas include dropped frames when the page is busy. We therefore
 * use a low quantile of a bounded sample window and never expand the default
 * 60 Hz work window based on a slow (possibly janky) stream.
 */

export type FrameCadenceSource = 'fallback' | 'measured';

export interface FrameCadenceEstimate {
  intervalMs: number;
  refreshRate: number;
  source: FrameCadenceSource;
  samples: number;
}

export interface FrameCadenceEstimatorOptions {
  fallbackIntervalMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  sampleWindow?: number;
  stableSamples?: number;
}

const DEFAULT_FALLBACK_INTERVAL_MS = 1000 / 60;
const DEFAULT_MIN_INTERVAL_MS = 4;
const DEFAULT_MAX_INTERVAL_MS = 50;
const DEFAULT_SAMPLE_WINDOW = 60;
const DEFAULT_STABLE_SAMPLES = 12;
const LOW_QUANTILE = 0.2;
const CHANGE_THRESHOLD = 0.1;

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index] ?? 0;
}

export class FrameCadenceEstimator {
  private readonly fallbackIntervalMs: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly sampleWindow: number;
  private readonly stableSamples: number;
  private readonly intervals: number[] = [];
  private lastTimestamp: number | null = null;
  private pendingInterval: number | null = null;
  private pendingCount = 0;
  private estimate: FrameCadenceEstimate;

  constructor(options: FrameCadenceEstimatorOptions = {}) {
    this.fallbackIntervalMs = finitePositive(
      options.fallbackIntervalMs,
      DEFAULT_FALLBACK_INTERVAL_MS,
    );
    this.minIntervalMs = finitePositive(options.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);
    this.maxIntervalMs = Math.max(
      this.minIntervalMs,
      finitePositive(options.maxIntervalMs, DEFAULT_MAX_INTERVAL_MS),
    );
    this.sampleWindow = Math.max(
      4,
      Math.floor(finitePositive(options.sampleWindow, DEFAULT_SAMPLE_WINDOW)),
    );
    this.stableSamples = Math.max(
      1,
      Math.floor(finitePositive(options.stableSamples, DEFAULT_STABLE_SAMPLES)),
    );
    this.estimate = this.fallbackEstimate(0);
  }

  /** Record a visible rAF timestamp. Invalid/long gaps reset the sample run. */
  observe(timestampMs: number): FrameCadenceEstimate {
    if (!Number.isFinite(timestampMs)) return this.current();
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs;
      return this.current();
    }

    const delta = timestampMs - this.lastTimestamp;
    this.lastTimestamp = timestampMs;
    if (delta < this.minIntervalMs || delta > this.maxIntervalMs) {
      // A hidden-tab gap or a timestamp anomaly must not become a fake display
      // interval. Keep the already-established cadence but discard samples.
      if (delta > this.maxIntervalMs * 2) {
        this.resetSamples();
        this.estimate = this.fallbackEstimate(0);
      }
      return this.current();
    }

    this.intervals.push(delta);
    if (this.intervals.length > this.sampleWindow) this.intervals.shift();
    if (this.intervals.length < this.stableSamples) return this.current();

    const measured = quantile(this.intervals, LOW_QUANTILE);
    // A slow callback stream can only indicate dropped frames, not a slower
    // display. Work budgets may tighten for a faster measured cadence, but
    // never grow beyond the conservative fallback interval.
    const candidate = Math.min(this.fallbackIntervalMs, measured);
    const bounded = clamp(candidate, this.minIntervalMs, this.fallbackIntervalMs);
    const relativeChange = Math.abs(bounded - this.estimate.intervalMs) / this.estimate.intervalMs;
    if (relativeChange <= CHANGE_THRESHOLD) {
      this.pendingInterval = null;
      this.pendingCount = 0;
      if (this.estimate.source === 'fallback' && this.intervals.length >= this.stableSamples) {
        this.estimate = {
          intervalMs: this.estimate.intervalMs,
          refreshRate: 1000 / this.estimate.intervalMs,
          source: 'measured',
          samples: this.intervals.length,
        };
      } else {
        this.estimate = { ...this.estimate, samples: this.intervals.length };
      }
      return this.current();
    }

    if (this.pendingInterval !== null && Math.abs(this.pendingInterval - bounded) <= 0.25) {
      this.pendingCount += 1;
    } else {
      this.pendingInterval = bounded;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= this.stableSamples) {
      this.estimate = {
        intervalMs: bounded,
        refreshRate: 1000 / bounded,
        source: 'measured',
        samples: this.intervals.length,
      };
      this.pendingInterval = null;
      this.pendingCount = 0;
    }
    return this.current();
  }

  /** Reset after visibility loss/resume without retaining stale timestamps. */
  reset(): FrameCadenceEstimate {
    this.lastTimestamp = null;
    this.resetSamples();
    this.estimate = this.fallbackEstimate(0);
    return this.current();
  }

  current(): FrameCadenceEstimate {
    return { ...this.estimate };
  }

  private resetSamples(): void {
    this.intervals.length = 0;
    this.pendingInterval = null;
    this.pendingCount = 0;
  }

  private fallbackEstimate(samples: number): FrameCadenceEstimate {
    return {
      intervalMs: this.fallbackIntervalMs,
      refreshRate: 1000 / this.fallbackIntervalMs,
      source: 'fallback',
      samples,
    };
  }
}
