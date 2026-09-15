/**
 * Interaction trace panel — developer-facing waterfall for one captured
 * interaction, plus the frame-lifecycle and node-work counters behind it.
 *
 * Deliberately snapshot-driven rather than live: re-rendering this panel on
 * every pointer event would contaminate the very workload it measures. The
 * developer presses Refresh, which reads the completed rings once. Nothing
 * here animates, and the panel does no work at all until it is opened.
 *
 * Lives behind the Performance settings tab (an advanced surface), not in the
 * ordinary editor chrome.
 */
import { Button, Select } from '@varve/ui';
import { useCallback, useId, useMemo, useState } from 'react';
import { getNodeWorkSamples } from '../../canvas/perfRuntime';
import type { InteractionTrace } from '../../performance/interactionTrace';
import {
  getRecentInteractionTraces,
  isInteractionTracingEnabled,
} from '../../performance/interactionTrace';
import { getRegisteredWorkerHost } from '../../render/workerHost';

/** Rows rendered at once. Beyond this the list is windowed. */
const VISIBLE_SPAN_WINDOW = 60;

interface Snapshot {
  capturedAt: number;
  tracingEnabled: boolean;
  traces: InteractionTrace[];
  nodeWork: ReturnType<typeof getNodeWorkSamples> | null;
  frameLedger: ReturnType<
    NonNullable<ReturnType<typeof getRegisteredWorkerHost>>['getFrameLedgerState']
  > | null;
  clock: ReturnType<
    NonNullable<ReturnType<typeof getRegisteredWorkerHost>>['getClockCalibration']
  > | null;
}

function takeSnapshot(): Snapshot {
  const host = getRegisteredWorkerHost();
  return {
    capturedAt: Date.now(),
    tracingEnabled: isInteractionTracingEnabled(),
    traces: getRecentInteractionTraces(25),
    nodeWork: getNodeWorkSamples(30),
    frameLedger: host?.getFrameLedgerState() ?? null,
    clock: host?.getClockCalibration() ?? null,
  };
}

/** Evidence class of a span, so estimates are never shown as measurements. */
function spanEvidence(name: string, attributes: Record<string, unknown> | undefined): string {
  if (name === 'composite.estimated') return 'estimated';
  if (name === 'present.feedback') return 'measured (±8ms)';
  if (name === 'render.worker') {
    return attributes?.startPlacement === 'calibrated' ? 'calibrated' : 'uncalibrated';
  }
  return 'measured';
}

export function InteractionTracePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const headingId = useId();
  const statusId = useId();

  const refresh = useCallback(() => {
    const next = takeSnapshot();
    setSnapshot(next);
    setSelectedId(next.traces[next.traces.length - 1]?.id ?? null);
  }, []);

  const selected = useMemo(
    () => snapshot?.traces.find((t) => t.id === selectedId) ?? null,
    [snapshot, selectedId],
  );

  // The waterfall is laid out against the interaction's own start, so spans
  // from different clock domains stay comparable within one trace.
  const waterfall = useMemo(() => {
    if (!selected) return [];
    const spans = selected.spans.slice(0, VISIBLE_SPAN_WINDOW);
    const end = Math.max(selected.endedAt, selected.startedAt + selected.totalMs, 1);
    const span = Math.max(1, end - selected.startedAt);
    return spans.map((s) => ({
      ...s,
      // Keyed by the span's own identity rather than its index: the snapshot
      // is immutable, but a content key keeps rows stable if the window or
      // selection changes underneath.
      key: `${s.name}@${s.startTimeMs.toFixed(4)}`,
      offsetPct: Math.max(0, Math.min(100, ((s.startTimeMs - selected.startedAt) / span) * 100)),
      widthPct: Math.max(0.5, Math.min(100, (s.durationMs / span) * 100)),
      evidence: spanEvidence(s.name, s.attributes),
    }));
  }, [selected]);

  const copyTrace = useCallback(async () => {
    if (!selected) return;
    // Export carries spans and bounded attributes only — never scene content.
    const payload = {
      schemaVersion: selected.schemaVersion,
      sessionId: selected.sessionId,
      id: selected.id,
      kind: selected.kind,
      totalMs: selected.totalMs,
      busyMs: selected.busyMs,
      pointerToPresentMs: selected.pointerToPresentMs,
      droppedSpanCount: selected.droppedSpanCount,
      droppedFrameCount: selected.droppedFrameCount,
      spans: selected.spans,
      frames: selected.frames,
      clock: snapshot?.clock ?? null,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (non-secure context) — nothing to recover from.
    }
  }, [selected, snapshot]);

  const ratios = snapshot?.nodeWork?.latestRatios ?? null;

  const traceOptions = useMemo(
    () =>
      (snapshot?.traces ?? []).map((trace) => ({
        value: String(trace.id),
        label: `#${trace.id} ${trace.kind} — ${trace.totalMs.toFixed(1)} ms${
          trace.slow ? ' (slow)' : ''
        }`,
      })),
    [snapshot],
  );

  return (
    <section aria-labelledby={headingId} className="interaction-trace">
      <h3 className="settings-section__title" id={headingId}>
        Interaction traces
      </h3>
      <p className="settings-hint">
        Captures one gesture from pointer input through render and presentation evidence. Reads a
        completed snapshot on demand — it does not update while you interact, so it cannot distort
        what it measures. Enable capture by loading the app with <code>?perf=1</code>.
      </p>

      <div className="interaction-trace__actions">
        <Button variant="secondary" size="sm" onClick={refresh}>
          Refresh snapshot
        </Button>
        <Button variant="ghost" size="sm" onClick={copyTrace} disabled={!selected}>
          {copied ? 'Copied' : 'Copy trace'}
        </Button>
      </div>

      <p className="settings-hint" id={statusId} role="status">
        {!snapshot
          ? 'No snapshot taken yet.'
          : !snapshot.tracingEnabled
            ? 'Tracing is disabled. Reload with ?perf=1 to capture interactions.'
            : `${snapshot.traces.length} interaction(s) captured at ${new Date(snapshot.capturedAt).toLocaleTimeString()}.`}
      </p>

      {snapshot && snapshot.traces.length > 0 && (
        <div className="settings-field-row">
          <span className="settings-field-row__label">Interaction</span>
          <Select
            label="Interaction"
            options={traceOptions}
            value={selectedId != null ? String(selectedId) : ''}
            onChange={(v) => setSelectedId(Number(v))}
            placeholder="Select interaction..."
          />
        </div>
      )}

      {selected && (
        <>
          <table className="interaction-trace__table">
            <caption className="interaction-trace__caption">
              Span waterfall for interaction #{selected.id}. Bar position and width are relative to
              the gesture duration.
            </caption>
            <thead>
              <tr>
                <th scope="col">Span</th>
                <th scope="col">Start</th>
                <th scope="col">Duration</th>
                <th scope="col">Evidence</th>
                <th scope="col">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {waterfall.map((span) => (
                <tr key={span.key}>
                  <th scope="row">{span.name}</th>
                  <td>{(span.startTimeMs - selected.startedAt).toFixed(1)} ms</td>
                  <td>{span.durationMs.toFixed(2)} ms</td>
                  <td>{span.evidence}</td>
                  <td>
                    {/* The bar is decorative; the numeric columns carry the
                        same information for screen readers and high contrast. */}
                    <span className="interaction-trace__track" aria-hidden="true">
                      <span
                        className={`interaction-trace__bar interaction-trace__bar--${span.evidence.startsWith('estimated') ? 'estimated' : 'measured'}`}
                        style={{ marginLeft: `${span.offsetPct}%`, width: `${span.widthPct}%` }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.spans.length > VISIBLE_SPAN_WINDOW && (
            <p className="settings-hint">
              Showing the first {VISIBLE_SPAN_WINDOW} of {selected.spans.length} spans.
              {selected.droppedSpanCount > 0 &&
                ` ${selected.droppedSpanCount} further span(s) were dropped by the retention cap.`}
            </p>
          )}
        </>
      )}

      {snapshot?.clock && (
        <p className="settings-hint">
          Worker clock offset {snapshot.clock.offsetMs.toFixed(2)} ms, uncertainty ±
          {snapshot.clock.uncertaintyMs.toFixed(2)} ms (best round trip{' '}
          {snapshot.clock.rttMs.toFixed(2)} ms, calibration generation {snapshot.clock.generation}).
          Cross-thread ordering closer than the uncertainty is not evidence.
        </p>
      )}

      {snapshot?.frameLedger && (
        <div className="performance-settings__stats">
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Frames created / presented</span>
            <span className="performance-settings__stat-value">
              {snapshot.frameLedger.created} / {snapshot.frameLedger.presented}
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Stale / replaced</span>
            <span className="performance-settings__stat-value">
              {snapshot.frameLedger.stale} / {snapshot.frameLedger.replaced}
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Duplicate close attempts</span>
            <span className="performance-settings__stat-value">
              {snapshot.frameLedger.duplicateCloseAttempts}
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Resident / peak bytes</span>
            <span className="performance-settings__stat-value">
              {(snapshot.frameLedger.residentBytes / 1024).toFixed(0)} KB /{' '}
              {(snapshot.frameLedger.peakResidentBytes / 1024).toFixed(0)} KB
            </span>
          </div>
        </div>
      )}

      {ratios && (
        <div className="performance-settings__stats">
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Repainted share of scene</span>
            <span className="performance-settings__stat-value">
              {(ratios.repaintRatio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Tested per candidate</span>
            <span className="performance-settings__stat-value">
              {ratios.testedPerCandidate.toFixed(2)}
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">
              Repaints a dirty query could skip
            </span>
            <span className="performance-settings__stat-value">
              {(ratios.lostPruningRatio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="performance-settings__stat">
            <span className="performance-settings__stat-label">Pre-merge dirty rectangles</span>
            <span className="performance-settings__stat-value">
              {snapshot?.nodeWork?.dirtyRects?.rects.length ?? 0}
              {snapshot?.nodeWork?.dirtyRects?.truncated
                ? ` (+${snapshot.nodeWork.dirtyRects.truncated} truncated)`
                : ''}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
