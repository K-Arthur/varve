/**
 * Frame budget tracking for the canvas render pipeline.
 *
 * Reports whether we're likely to exceed the frame budget and tracks
 * per-phase timing for diagnostics. Uses bounded rolling metrics rather
 * than unbounded timing logs.
 *
 * Frame budgets are updated by the shared visible-rAF cadence estimator. A
 * conservative 60 Hz interval is used until a stable measured cadence is
 * available; a slow callback stream never expands the work window.
 */

import type { FrameCadenceEstimate } from '../performance/frameCadence';

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
  workClass: FrameWorkClass;
  budgetMs: number;
  withinBudget: boolean;
  overByMs: number;
  phases: Partial<PhaseTiming>;
}

export type FrameWorkClass = 'interaction' | 'authoritative' | 'background';

export interface FrameWorkBudgetSummary {
  budgetMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  overBudgetCount: number;
  samples: number;
}

export interface FrameBudgetSummary {
  displayRefreshRate: number;
  intervalMs: number;
  cadenceSource: FrameCadenceEstimate['source'];
  cadenceSamples: number;
  classes: Record<FrameWorkClass, FrameWorkBudgetSummary>;
}

const ROLLING_WINDOW = 30;
const rollingTimings: number[] = [];
const classTimings: Record<FrameWorkClass, number[]> = {
  interaction: [],
  authoritative: [],
  background: [],
};
const CLASS_BUDGET_MULTIPLIERS: Record<FrameWorkClass, number> = {
  interaction: 0.5,
  authoritative: 0.9,
  background: 0.25,
};

let displayRefreshRate = 60;
let frameBudgetMs = 1000 / 60;
let cadenceSource: FrameCadenceEstimate['source'] = 'fallback';
let cadenceSamples = 0;

/** Initialise frame budget to the conservative fallback interval. */
export function initFrameBudget(): void {
  displayRefreshRate = 60;
  frameBudgetMs = 1000 / 60;
  cadenceSource = 'fallback';
  cadenceSamples = 0;
}

/** Apply a cadence from the shared runtime estimator. */
export function updateFrameCadence(estimate: FrameCadenceEstimate): void {
  if (!Number.isFinite(estimate.intervalMs) || estimate.intervalMs <= 0) return;
  frameBudgetMs = estimate.intervalMs;
  displayRefreshRate = 1000 / estimate.intervalMs;
  cadenceSource = estimate.source;
  cadenceSamples = Math.max(0, Math.floor(estimate.samples));
}

/** Current per-frame budget in ms (e.g. 16.67 for 60fps, 8.33 for 120fps). */
export function getFrameBudgetMs(): number {
  return frameBudgetMs;
}

/** Budget for a declared unit of frame work, derived from the display interval. */
export function getFrameWorkBudgetMs(workClass: FrameWorkClass): number {
  return frameBudgetMs * CLASS_BUDGET_MULTIPLIERS[workClass];
}

export function getDisplayRefreshRate(): number {
  return displayRefreshRate;
}

export function startFrameTiming(): number {
  return performance.now();
}

export function endFrameTiming(
  start: number,
  phases?: Partial<PhaseTiming>,
  workClass: FrameWorkClass = 'authoritative',
): BudgetReport {
  const elapsed = performance.now() - start;
  rollingTimings.push(elapsed);
  if (rollingTimings.length > ROLLING_WINDOW) rollingTimings.shift();
  const timings = classTimings[workClass];
  timings.push(elapsed);
  if (timings.length > ROLLING_WINDOW) timings.shift();
  const budgetMs = getFrameWorkBudgetMs(workClass);
  return {
    elapsedMs: elapsed,
    workClass,
    budgetMs,
    withinBudget: elapsed <= budgetMs,
    overByMs: Math.max(0, elapsed - budgetMs),
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

function percentile(timings: readonly number[], pct: number): number {
  if (timings.length === 0) return 0;
  const sorted = [...timings].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * (pct / 100)), sorted.length - 1);
  return sorted[idx] ?? 0;
}

function summarizeWorkClass(workClass: FrameWorkClass): FrameWorkBudgetSummary {
  const timings = classTimings[workClass];
  const budgetMs = getFrameWorkBudgetMs(workClass);
  return {
    budgetMs,
    averageMs:
      timings.length === 0
        ? 0
        : timings.reduce((total, timing) => total + timing, 0) / timings.length,
    p50Ms: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    p99Ms: percentile(timings, 99),
    overBudgetCount: timings.filter((timing) => timing > budgetMs).length,
    samples: timings.length,
  };
}

/** Bounded per-class diagnostics for the performance handle and benchmark probes. */
export function getFrameBudgetSummary(): FrameBudgetSummary {
  return {
    displayRefreshRate,
    intervalMs: frameBudgetMs,
    cadenceSource,
    cadenceSamples,
    classes: {
      interaction: summarizeWorkClass('interaction'),
      authoritative: summarizeWorkClass('authoritative'),
      background: summarizeWorkClass('background'),
    },
  };
}

/** Reset rolling timings. */
export function resetFrameTimings(): void {
  rollingTimings.length = 0;
  for (const timings of Object.values(classTimings)) timings.length = 0;
}
