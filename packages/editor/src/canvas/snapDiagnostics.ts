/**
 * Snap performance diagnostics — bounded ring buffer, disabled by default.
 *
 * Tracks candidate counts at every stage of the snap pipeline so regressions
 * ("snapping suddenly scans the whole scene") are provable from counts rather
 * than subjective feel. Disabled unless explicitly enabled (dev handle /
 * `?perf=1`); recording a sample is a single flag check + object push.
 */

export interface SnapMetricsSample {
  /** performance.now() at record time. */
  ts: number;
  /** Total scene nodes (reference for candidate scaling). */
  sceneObjectCount: number;
  /** Nodes present in the broad-phase spatial index. */
  indexedCandidateCount: number;
  /** Nodes returned by the broad-phase spatial query for the search rect. */
  broadPhaseResultCount: number;
  /** Candidates surviving semantic filtering (selection/hidden exclusion). */
  semanticFilteredCount: number;
  /** Bounds handed to the fine-phase evaluator (k). */
  finePhaseEvalCount: number;
  /** Broad-phase query duration (ms). */
  queryDurationMs: number;
  /** Fine-phase evaluation duration (ms). */
  evalDurationMs: number;
  /** X/Y axis each produced a winning snap this sample. */
  winningX: boolean;
  winningY: boolean;
  /** True when broad-phase results exceeded the explosion threshold (set by recordSnapMetrics). */
  candidateExplosion?: boolean;
}

/** Beyond this many broad-phase results per pointer move, record an explosion. */
export const SNAP_CANDIDATE_EXPLOSION_THRESHOLD = 500;

const MAX_SNAP_SAMPLES = 120;
const snapRing: SnapMetricsSample[] = [];
let snapEnabled = false;

export function enableSnapMetrics(force?: boolean): void {
  snapEnabled = force === true;
  if (!snapEnabled) snapRing.length = 0;
}

export function isSnapMetricsEnabled(): boolean {
  return snapEnabled;
}

export function recordSnapMetrics(sample: SnapMetricsSample): void {
  if (!snapEnabled) return;
  snapRing.push({
    ...sample,
    candidateExplosion: sample.broadPhaseResultCount > SNAP_CANDIDATE_EXPLOSION_THRESHOLD,
  });
  if (snapRing.length > MAX_SNAP_SAMPLES) snapRing.shift();
}

export function getSnapMetrics(n = 10): SnapMetricsSample[] {
  return snapRing.slice(-n);
}

export function getSnapMetricsCount(): number {
  return snapRing.length;
}

export function resetSnapMetrics(): void {
  snapRing.length = 0;
}

/** Roll up a summary of recent samples: how candidates scale vs scene size. */
export function summarizeSnapMetrics(samples: SnapMetricsSample[]): {
  samples: number;
  avgBroadPhase: number;
  avgSemantic: number;
  avgFinePhase: number;
  avgEvalMs: number;
  maxFinePhase: number;
  explosions: number;
} {
  if (samples.length === 0) {
    return {
      samples: 0,
      avgBroadPhase: 0,
      avgSemantic: 0,
      avgFinePhase: 0,
      avgEvalMs: 0,
      maxFinePhase: 0,
      explosions: 0,
    };
  }
  let broad = 0;
  let semantic = 0;
  let fine = 0;
  let evalMs = 0;
  let maxFine = 0;
  let explosions = 0;
  for (const s of samples) {
    broad += s.broadPhaseResultCount;
    semantic += s.semanticFilteredCount;
    fine += s.finePhaseEvalCount;
    evalMs += s.evalDurationMs;
    if (s.finePhaseEvalCount > maxFine) maxFine = s.finePhaseEvalCount;
    if (s.candidateExplosion) explosions++;
  }
  const n = samples.length;
  return {
    samples: n,
    avgBroadPhase: broad / n,
    avgSemantic: semantic / n,
    avgFinePhase: fine / n,
    avgEvalMs: evalMs / n,
    maxFinePhase: maxFine,
    explosions,
  };
}
