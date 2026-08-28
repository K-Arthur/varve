import { beforeEach, describe, expect, it } from 'vitest';
import {
  endFrameTiming,
  getAverageFrameTime,
  getFrameBudgetHealth,
  getFrameBudgetMs,
  getFrameBudgetSummary,
  getFrameWorkBudgetMs,
  getOverBudgetCount,
  getPercentileFrameTime,
  initFrameBudget,
  resetFrameTimings,
  startFrameTiming,
} from '../frameBudget';

describe('frameBudget', () => {
  beforeEach(() => {
    resetFrameTimings();
  });

  it('reports within budget for fast operations', () => {
    const start = startFrameTiming();
    const report = endFrameTiming(start);
    expect(report.withinBudget).toBe(true);
    expect(report.overByMs).toBe(0);
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports phases when provided', () => {
    const start = startFrameTiming();
    const report = endFrameTiming(start, {
      cacheLookupMs: 0.5,
      irBuildMs: 2.0,
      drawSubmitMs: 1.0,
    });
    expect(report.phases.cacheLookupMs).toBe(0.5);
    expect(report.phases.irBuildMs).toBe(2.0);
  });

  it('getFrameBudgetHealth returns valid state', () => {
    const health = getFrameBudgetHealth();
    expect(['good', 'warning', 'critical']).toContain(health);
  });

  it('accumulates rolling timings for average', () => {
    // Fast frames
    for (let i = 0; i < 5; i++) {
      const start = startFrameTiming();
      endFrameTiming(start);
    }
    const avg = getAverageFrameTime();
    expect(avg).toBeGreaterThanOrEqual(0);
  });

  it('getPercentileFrameTime returns valid percentile', () => {
    const p50 = getPercentileFrameTime(50);
    const p95 = getPercentileFrameTime(95);
    expect(p95).toBeGreaterThanOrEqual(p50);
  });

  it('getFrameBudgetMs returns positive value', () => {
    expect(getFrameBudgetMs()).toBeGreaterThan(0);
  });

  it('initFrameBudget runs without error', () => {
    initFrameBudget();
    expect(getFrameBudgetMs()).toBeGreaterThan(0);
  });

  it('getOverBudgetCount returns number of over-budget frames', () => {
    expect(getOverBudgetCount()).toBeGreaterThanOrEqual(0);
  });

  it('derives interaction, authoritative, and background budgets from the display interval', () => {
    const interval = getFrameBudgetMs();

    expect(getFrameWorkBudgetMs('interaction')).toBeCloseTo(interval * 0.5);
    expect(getFrameWorkBudgetMs('authoritative')).toBeCloseTo(interval * 0.9);
    expect(getFrameWorkBudgetMs('background')).toBeCloseTo(interval * 0.25);
  });

  it('keeps bounded diagnostics separately for each work class', () => {
    const interaction = endFrameTiming(startFrameTiming(), undefined, 'interaction');
    const authoritative = endFrameTiming(startFrameTiming(), undefined, 'authoritative');
    const background = endFrameTiming(startFrameTiming(), undefined, 'background');
    const summary = getFrameBudgetSummary();

    expect(interaction.workClass).toBe('interaction');
    expect(authoritative.workClass).toBe('authoritative');
    expect(background.workClass).toBe('background');
    expect(summary.classes.interaction.samples).toBe(1);
    expect(summary.classes.authoritative.samples).toBe(1);
    expect(summary.classes.background.samples).toBe(1);
  });
});
