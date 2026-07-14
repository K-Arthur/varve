import {
  FRAME_BUDGET_MS,
  endFrameTiming,
  getPreviousFrameMs,
  startFrameTiming,
} from '../frameBudget';
import { describe, expect, it } from 'vitest';

describe('frameBudget', () => {
  it('getPreviousFrameMs returns 0 initially', () => {
    expect(getPreviousFrameMs()).toBe(0);
  });

  it('FRAME_BUDGET_MS is 16', () => {
    expect(FRAME_BUDGET_MS).toBe(16);
  });

  it('startFrameTiming returns a timestamp', () => {
    const start = startFrameTiming();
    expect(typeof start).toBe('number');
    expect(start).toBeGreaterThan(0);
  });

  it('endFrameTiming returns a BudgetReport', () => {
    const start = startFrameTiming();
    const report = endFrameTiming(start);
    expect(report).toHaveProperty('elapsedMs');
    expect(report).toHaveProperty('withinBudget');
    expect(report).toHaveProperty('overByMs');
    expect(typeof report.elapsedMs).toBe('number');
    expect(typeof report.withinBudget).toBe('boolean');
    expect(typeof report.overByMs).toBe('number');
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(report.overByMs).toBeGreaterThanOrEqual(0);
  });

  it('endFrameTiming reports withinBudget for very fast operations', () => {
    const start = startFrameTiming();
    const report = endFrameTiming(start);
    expect(report.withinBudget).toBe(true);
    expect(report.overByMs).toBe(0);
  });

  it('getPreviousFrameMs returns the last elapsed time', () => {
    const start = startFrameTiming();
    endFrameTiming(start);
    const prev = getPreviousFrameMs();
    expect(prev).toBeGreaterThanOrEqual(0);
    expect(typeof prev).toBe('number');
  });
});
