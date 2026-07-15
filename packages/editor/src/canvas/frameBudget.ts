/**
 * Frame budget tracking for the canvas render pipeline.
 *
 * Reports whether we're likely to exceed the frame budget and tracks
 * per-phase timing for diagnostics. Uses bounded rolling metrics rather
 * than unbounded timing logs.
 *
 * Frame budgets are computed from the display refresh rate rather than
 * hard-coding only 16.67 ms. Falls back to 60 fps when unavailable.
 */

export interface PhaseTiming {
  cacheLookupMs: number;
  irBuildMs: number;
  cullingMs: number;
  textLayoutMs: number;
  imagePrepareMs: number;
  effectPrepareMs: number;
  drawSubmitMs: number;
}

export interface BudgetReport {
  elapsedMs: number;
  withinBudget: boolean;
  overByMs: number;
  phases: Partial<PhaseTiming>;
}

const ROLLING_WINDOW = 30;
const rollingTimings: number[] = [];

let displayRefreshRate = 60;
let frameBudgetMs = 16.67;

/** Initialise frame budget from display refresh rate. */
export function initFrameBudget(): void {
  if (typeof window !== 'undefined' && 'screen' in window) {
    const rate = window.screen.refreshRate ?? 60;
    displayRefreshRate = rate;
    frameBudgetMs = 1000 / rate;
  }
}

/** Current per-frame budget in ms (e.g. 16.67 for 60fps, 8.33 for 120fps). */
export function getFrameBudgetMs(): number {
  return frameBudgetMs;
}

export function getDisplayRefreshRate(): number {
  return displayRefreshRate;
}

export function startFrameTiming(): number {
  return performance.now();
}

export function endFrameTiming(start: number, phases?: Partial<PhaseTiming>): BudgetReport {
  const elapsed = performance.now() - start;
  rollingTimings.push(elapsed);
  if (rollingTimings.length > ROLLING_WINDOW) rollingTimings.shift();
  return {
    elapsedMs: elapsed,
    withinBudget: elapsed <= frameBudgetMs,
    overByMs: Math.max(0, elapsed - frameBudgetMs),
    phases: phases ?? {},
  };
}

/** Frame budget health based on rolling average. */
export function getFrameBudgetHealth(): 'good' | 'warning' | 'critical' {
  if (rollingTimings.length === 0) return 'good';
  const avg = rollingTimings.reduce((a, b) => a + b, 0) / rollingTimings.length;
  if (avg <= frameBudgetMs * 0.75) return 'good';
  if (avg <= frameBudgetMs) return 'warning';
  return 'critical';
}

/** Rolling average frame time in ms. */
export function getAverageFrameTime(): number {
  if (rollingTimings.length === 0) return 0;
  return rollingTimings.reduce((a, b) => a + b, 0) / rollingTimings.length;
}

/** Percentile frame time (e.g. p95) from the rolling window. */
export function getPercentileFrameTime(pct: number): number {
  if (rollingTimings.length === 0) return 0;
  const sorted = [...rollingTimings].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * (pct / 100)), sorted.length - 1);
  return sorted[idx] ?? 0;
}

/** Number of frames over budget in the rolling window. */
export function getOverBudgetCount(): number {
  return rollingTimings.filter((t) => t > frameBudgetMs).length;
}

/** Reset rolling timings. */
export function resetFrameTimings(): void {
  rollingTimings.length = 0;
}
