import { beforeEach, describe, expect, it } from 'vitest';
import {
  enableSnapMetrics,
  getSnapMetrics,
  getSnapMetricsCount,
  isSnapMetricsEnabled,
  recordSnapMetrics,
  resetSnapMetrics,
  summarizeSnapMetrics,
} from '../snapDiagnostics';

function sample(overrides: Record<string, number> = {}) {
  return {
    ts: performance.now(),
    sceneObjectCount: 10_000,
    indexedCandidateCount: 10_000,
    broadPhaseResultCount: 24,
    semanticFilteredCount: 12,
    finePhaseEvalCount: 12,
    queryDurationMs: 0.01,
    evalDurationMs: 0.3,
    winningX: true,
    winningY: false,
    ...overrides,
  };
}

describe('snapDiagnostics', () => {
  beforeEach(() => {
    enableSnapMetrics(false);
    resetSnapMetrics();
  });

  it('is disabled by default and drops samples', () => {
    expect(isSnapMetricsEnabled()).toBe(false);
    recordSnapMetrics(sample());
    expect(getSnapMetricsCount()).toBe(0);
  });

  it('records only while enabled and clears on disable', () => {
    enableSnapMetrics(true);
    recordSnapMetrics(sample());
    recordSnapMetrics(sample());
    expect(getSnapMetricsCount()).toBe(2);
    enableSnapMetrics(false);
    expect(getSnapMetricsCount()).toBe(0);
  });

  it('keeps a bounded ring buffer', () => {
    enableSnapMetrics(true);
    for (let i = 0; i < 300; i++) recordSnapMetrics(sample());
    expect(getSnapMetricsCount()).toBe(120);
    const recent = getSnapMetrics(5);
    expect(recent.length).toBe(5);
  });

  it('flags candidate explosions', () => {
    enableSnapMetrics(true);
    recordSnapMetrics(sample({ broadPhaseResultCount: 600 }));
    expect(getSnapMetrics(1)[0]?.candidateExplosion).toBe(true);
  });

  it('summarizes candidate scaling and durations', () => {
    enableSnapMetrics(true);
    recordSnapMetrics(
      sample({ broadPhaseResultCount: 20, finePhaseEvalCount: 20, evalDurationMs: 0.5 }),
    );
    recordSnapMetrics(
      sample({ broadPhaseResultCount: 40, finePhaseEvalCount: 40, evalDurationMs: 1.5 }),
    );
    const summary = summarizeSnapMetrics(getSnapMetrics(2));
    expect(summary.samples).toBe(2);
    expect(summary.avgBroadPhase).toBe(30);
    expect(summary.avgFinePhase).toBe(30);
    expect(summary.avgEvalMs).toBe(1);
    expect(summary.maxFinePhase).toBe(40);
    expect(summary.explosions).toBe(0);
  });

  it('returns an empty summary for no samples', () => {
    const summary = summarizeSnapMetrics([]);
    expect(summary.samples).toBe(0);
    expect(summary.maxFinePhase).toBe(0);
  });
});
