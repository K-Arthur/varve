/**
 * Raster-layer reconstruction measurement.
 *
 * `paintRasterLayer` rebuilds a full layer-sized intermediate surface from
 * every tile on every replay, even when a single tile changed and even when
 * most of the layer is off-view. Whether that is a real bottleneck depends on
 * layer size, tile count and repaint frequency — none of which can be argued
 * from the shape of the code.
 *
 * This module records what the path actually costs so the decision to change
 * a per-node hot path is backed by measurements. It is a measurement-only
 * change: the sink is null by default and the reconstruction behaviour is
 * untouched.
 */

export interface RasterReplaySample {
  /** Layer dimensions in pixels. */
  width: number;
  height: number;
  /** Tiles present on the layer. */
  totalTiles: number;
  /** Tiles actually read and composited into the intermediate. */
  compositedTiles: number;
  /** Bytes of the full-layer intermediate surface (width * height * 4). */
  intermediateBytes: number;
  /** Time spent allocating the intermediate surface. */
  surfaceMs: number;
  /** Time spent decoding and putting tiles into it. */
  tileReplayMs: number;
  /** Time spent drawing the intermediate to the target. */
  drawMs: number;
  /** Total reconstruction time. */
  totalMs: number;
}

export type RasterReplaySink = (sample: RasterReplaySample) => void;

let sink: RasterReplaySink | null = null;

/**
 * Install a sink to begin measuring. Passing null disables measurement and
 * restores the untraced path, which performs no timing calls at all.
 */
export function setRasterReplaySink(next: RasterReplaySink | null): void {
  sink = next;
}

export function isRasterReplayMeasured(): boolean {
  return sink !== null;
}

/** Internal: emit a sample. No-op (and never allocates) when unmeasured. */
export function emitRasterReplaySample(sample: RasterReplaySample): void {
  sink?.(sample);
}

/**
 * Bounded collector for reconstruction samples, with the aggregates the
 * decision gate needs.
 */
export class RasterReplayRecorder {
  static readonly MAX_SAMPLES = 240;
  private readonly samples: RasterReplaySample[] = [];

  readonly sink: RasterReplaySink = (sample) => {
    this.samples.push(sample);
    if (this.samples.length > RasterReplayRecorder.MAX_SAMPLES) this.samples.shift();
  };

  get all(): readonly RasterReplaySample[] {
    return this.samples;
  }

  reset(): void {
    this.samples.length = 0;
  }

  /**
   * Aggregates for the trigger evaluation. `tileUtilization` is the share of
   * composited tiles that a dirty-region-aware path would still have needed:
   * a low value means most of the reconstruction work is wasted.
   */
  summary(): {
    count: number;
    totalReconstructionMs: number;
    p50TotalMs: number;
    p95TotalMs: number;
    maxIntermediateBytes: number;
    avgTilesPerReplay: number;
    avgTileReplayShare: number;
  } | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].map((s) => s.totalMs).sort((a, b) => a - b);
    const percentile = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ??
      0;
    const total = this.samples.reduce((sum, s) => sum + s.totalMs, 0);
    return {
      count: this.samples.length,
      totalReconstructionMs: total,
      p50TotalMs: percentile(50),
      p95TotalMs: percentile(95),
      maxIntermediateBytes: Math.max(...this.samples.map((s) => s.intermediateBytes)),
      avgTilesPerReplay:
        this.samples.reduce((sum, s) => sum + s.compositedTiles, 0) / this.samples.length,
      avgTileReplayShare:
        total > 0 ? this.samples.reduce((sum, s) => sum + s.tileReplayMs, 0) / total : 0,
    };
  }
}

/**
 * The measured trigger for replacing full-layer reconstruction with a
 * dirty-tile or visible-tile path.
 *
 * Thresholds are derived from the budgets already in force rather than copied
 * from elsewhere: the frame budget is one 60Hz interval, and the worker bitmap
 * budget's constrained tier is 32 MiB, so a single intermediate consuming a
 * quarter of that is disproportionate.
 */
export interface RasterTriggerInput {
  /** p95 reconstruction time for the workload, in milliseconds. */
  p95ReconstructionMs: number;
  /** Share of `render.worker` (or main-thread replay) spent reconstructing. */
  shareOfRenderTime: number;
  /** Share of composited tiles that intersect the dirty region. */
  dirtyTileShare: number;
  /** Largest intermediate surface allocated, in bytes. */
  maxIntermediateBytes: number;
  /** Frame budget for the platform class, in milliseconds. */
  frameBudgetMs: number;
}

export interface RasterTriggerResult {
  met: boolean;
  reasons: string[];
}

/** A quarter of the 32 MiB constrained-tier worker bitmap budget. */
export const INTERMEDIATE_BYTES_THRESHOLD = 8 * 1024 * 1024;
/** Reconstruction owning a fifth of render time is material. */
export const RENDER_SHARE_THRESHOLD = 0.2;
/** Below this, most composited tiles were not needed for the dirty region. */
export const DIRTY_TILE_SHARE_THRESHOLD = 0.25;

export function evaluateRasterTrigger(input: RasterTriggerInput): RasterTriggerResult {
  const reasons: string[] = [];
  if (input.p95ReconstructionMs > input.frameBudgetMs) {
    reasons.push(
      `p95 reconstruction ${input.p95ReconstructionMs.toFixed(2)}ms exceeds the ${input.frameBudgetMs.toFixed(1)}ms frame budget`,
    );
  }
  if (input.shareOfRenderTime > RENDER_SHARE_THRESHOLD) {
    reasons.push(
      `reconstruction is ${(input.shareOfRenderTime * 100).toFixed(1)}% of render time (threshold ${RENDER_SHARE_THRESHOLD * 100}%)`,
    );
  }
  if (
    input.dirtyTileShare < DIRTY_TILE_SHARE_THRESHOLD &&
    input.p95ReconstructionMs > input.frameBudgetMs / 2
  ) {
    // A low dirty-tile share only matters if reconstruction is expensive
    // enough to be worth avoiding; on a cheap layer it is not evidence.
    reasons.push(
      `only ${(input.dirtyTileShare * 100).toFixed(1)}% of composited tiles intersect the dirty region`,
    );
  }
  if (input.maxIntermediateBytes > INTERMEDIATE_BYTES_THRESHOLD) {
    reasons.push(
      `intermediate surface reaches ${(input.maxIntermediateBytes / (1024 * 1024)).toFixed(1)} MiB (threshold ${INTERMEDIATE_BYTES_THRESHOLD / (1024 * 1024)} MiB)`,
    );
  }
  return { met: reasons.length > 0, reasons };
}
