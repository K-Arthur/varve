/**
 * Paint pipeline profiling.
 *
 * Two rules shape this:
 *
 * 1. **Distributions, not averages.** A worker that lowers mean compute while
 *    adding 40ms of queue latency makes painting feel worse, and an average
 *    hides exactly that. Everything here reports p50/p95/p99/max.
 * 2. **Free when off.** Profiling the paint loop must never become the reason
 *    the paint loop is slow. In the default `off` mode every record call is a
 *    single boolean test with no allocation; ring buffers are allocated only
 *    when a mode that needs them is enabled.
 */

export type PaintProfilerMode = 'off' | 'counters' | 'detailed';

export interface PaintLatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface PaintProfileReport {
  mode: PaintProfilerMode;
  /** Input timestamp to the dabs for that input becoming available. */
  inputToDabs: PaintLatencySummary;
  /** Time spent generating dabs, wherever they were generated. */
  compute: PaintLatencySummary;
  /** Delay between dispatching a batch and its result arriving. */
  queueDelay: PaintLatencySummary;
  /** Time spent compositing dabs into tiles. */
  composite: PaintLatencySummary;
  counters: {
    strokes: number;
    batches: number;
    dabs: number;
    workerBatches: number;
    syncBatches: number;
    staleDropped: number;
    cancellations: number;
  };
}

const EMPTY_SUMMARY: PaintLatencySummary = { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };

/** Fixed-capacity ring so a long session cannot grow the profiler's memory. */
class Samples {
  private data: Float64Array;
  private index = 0;
  private filled = 0;

  constructor(capacity = 2048) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    this.data[this.index] = value;
    this.index = (this.index + 1) % this.data.length;
    if (this.filled < this.data.length) this.filled++;
  }

  summary(): PaintLatencySummary {
    if (this.filled === 0) return EMPTY_SUMMARY;
    const values = Array.from(this.data.subarray(0, this.filled)).sort((a, b) => a - b);
    const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))]!;
    let total = 0;
    for (const v of values) total += v;
    return {
      count: values.length,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: values[values.length - 1]!,
      mean: total / values.length,
    };
  }

  reset(): void {
    this.index = 0;
    this.filled = 0;
  }
}

export class PaintProfiler {
  private mode: PaintProfilerMode = 'off';
  private inputToDabs: Samples | null = null;
  private compute: Samples | null = null;
  private queueDelay: Samples | null = null;
  private composite: Samples | null = null;
  private counters = {
    strokes: 0,
    batches: 0,
    dabs: 0,
    workerBatches: 0,
    syncBatches: 0,
    staleDropped: 0,
    cancellations: 0,
  };

  get enabled(): boolean {
    return this.mode !== 'off';
  }

  getMode(): PaintProfilerMode {
    return this.mode;
  }

  setMode(mode: PaintProfilerMode): void {
    this.mode = mode;
    if (mode === 'detailed') {
      this.inputToDabs ??= new Samples();
      this.compute ??= new Samples();
      this.queueDelay ??= new Samples();
      this.composite ??= new Samples();
      return;
    }
    // Counters mode keeps tallies but drops the sample buffers, which are the
    // only part with meaningful memory cost.
    this.inputToDabs = null;
    this.compute = null;
    this.queueDelay = null;
    this.composite = null;
  }

  strokeStarted(): void {
    if (this.mode === 'off') return;
    this.counters.strokes++;
  }

  strokeCancelled(): void {
    if (this.mode === 'off') return;
    this.counters.cancellations++;
  }

  staleDropped(count = 1): void {
    if (this.mode === 'off') return;
    this.counters.staleDropped += count;
  }

  batchProduced(info: {
    dabs: number;
    source: 'worker' | 'sync';
    computeMs?: number;
    queueDelayMs?: number;
    inputToDabsMs?: number;
  }): void {
    if (this.mode === 'off') return;
    this.counters.batches++;
    this.counters.dabs += info.dabs;
    if (info.source === 'worker') this.counters.workerBatches++;
    else this.counters.syncBatches++;
    if (this.mode !== 'detailed') return;
    if (info.computeMs !== undefined) this.compute?.push(info.computeMs);
    if (info.queueDelayMs !== undefined) this.queueDelay?.push(info.queueDelayMs);
    if (info.inputToDabsMs !== undefined) this.inputToDabs?.push(info.inputToDabsMs);
  }

  compositeTook(ms: number): void {
    if (this.mode !== 'detailed') return;
    this.composite?.push(ms);
  }

  report(): PaintProfileReport {
    return {
      mode: this.mode,
      inputToDabs: this.inputToDabs?.summary() ?? EMPTY_SUMMARY,
      compute: this.compute?.summary() ?? EMPTY_SUMMARY,
      queueDelay: this.queueDelay?.summary() ?? EMPTY_SUMMARY,
      composite: this.composite?.summary() ?? EMPTY_SUMMARY,
      counters: { ...this.counters },
    };
  }

  reset(): void {
    this.inputToDabs?.reset();
    this.compute?.reset();
    this.queueDelay?.reset();
    this.composite?.reset();
    this.counters = {
      strokes: 0,
      batches: 0,
      dabs: 0,
      workerBatches: 0,
      syncBatches: 0,
      staleDropped: 0,
      cancellations: 0,
    };
  }
}

let globalProfiler: PaintProfiler | null = null;

export function getPaintProfiler(): PaintProfiler {
  if (!globalProfiler) globalProfiler = new PaintProfiler();
  return globalProfiler;
}

export function resetPaintProfiler(): void {
  globalProfiler = null;
}

/**
 * Should stroke generation go to the worker for this brush?
 *
 * Worker routing is not free — it costs a structured clone each way plus queue
 * latency — so it is only worth taking for brushes whose per-batch compute is
 * large enough to dominate that overhead. A small hard round is faster
 * synchronously, and routing it to a worker adds latency for no gain.
 */
export function shouldUseWorker(estimate: {
  radius: number;
  grainEnabled: boolean;
  symmetryBranches: number;
  spacing: number;
}): boolean {
  // Cost scales with dab area and dab count; symmetry multiplies both.
  const dabArea = Math.PI * estimate.radius * estimate.radius;
  const dabDensity = 1 / Math.max(0.01, estimate.spacing);
  const grainFactor = estimate.grainEnabled ? 2.5 : 1;
  const score = dabArea * dabDensity * grainFactor * Math.max(1, estimate.symmetryBranches);
  // Threshold chosen so a 10px hard round stays on the main thread while a
  // large textured or symmetric brush moves off it.
  return score > 20_000;
}
