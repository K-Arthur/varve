export const FRAME_BUDGET_MS = 16;

export interface BudgetReport {
  elapsedMs: number;
  withinBudget: boolean;
  overByMs: number;
}

let previousFrameMs = 0;

export function startFrameTiming(): number {
  return performance.now();
}

export function endFrameTiming(start: number): BudgetReport {
  const elapsed = performance.now() - start;
  previousFrameMs = elapsed;
  return {
    elapsedMs: elapsed,
    withinBudget: elapsed <= FRAME_BUDGET_MS,
    overByMs: Math.max(0, elapsed - FRAME_BUDGET_MS),
  };
}

export function getPreviousFrameMs(): number {
  return previousFrameMs;
}
