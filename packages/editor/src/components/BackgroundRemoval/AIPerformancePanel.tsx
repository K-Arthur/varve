/**
 * AIPerformancePanel — inference diagnostics for background removal.
 *
 * Shows active model, precision, execution provider, latency, and memory.
 * Never displays document contents or input images.
 *
 * Accessibility: APG disclosure pattern, keyboard navigable, screen-reader
 * friendly via aria-live for updates. respects prefers-reduced-motion.
 */

import type { InferenceDiagnosticEvent } from '@varve/engine';
import { getInferenceDiagnostics, subscribeInferenceDiagnostics } from '@varve/engine';
import { useEffect, useState } from 'react';
import './AIPerformancePanel.css';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function AIPerformancePanel() {
  const [diagnostics, setDiagnostics] = useState(() => getInferenceDiagnostics());

  useEffect(() => {
    return subscribeInferenceDiagnostics(setDiagnostics);
  }, []);

  const { events, coldStartMs, totalInferences } = diagnostics;
  const latestEvent = events[events.length - 1] satisfies InferenceDiagnosticEvent | undefined;

  return (
    <section className="ai-perf" aria-label="AI inference performance">
      <div className="ai-perf__header">
        <h3 className="ai-perf__title">AI Performance</h3>
        <span className="ai-perf__badge" role="status" aria-label={`${totalInferences} inferences`}>
          {totalInferences}
        </span>
      </div>

      {latestEvent ? (
        <dl className="ai-perf__grid">
          <div className="ai-perf__item">
            <dt>Model</dt>
            <dd>{latestEvent.modelId}</dd>
          </div>
          <div className="ai-perf__item">
            <dt>Precision</dt>
            <dd>
              <span
                className={`ai-perf__precision ai-perf__precision--${latestEvent.modelPrecision}`}
              >
                {latestEvent.modelPrecision.toUpperCase()}
              </span>
            </dd>
          </div>
          <div className="ai-perf__item">
            <dt>Provider</dt>
            <dd>{latestEvent.executionProvider}</dd>
          </div>
          <div className="ai-perf__item">
            <dt>Latency</dt>
            <dd>{formatDuration(latestEvent.processingTimeMs)}</dd>
          </div>
          <div className="ai-perf__item">
            <dt>Input size</dt>
            <dd>
              {latestEvent.inputWidth} x {latestEvent.inputHeight}
            </dd>
          </div>
          <div className="ai-perf__item">
            <dt>Preference</dt>
            <dd>{latestEvent.qualityPreference}</dd>
          </div>
        </dl>
      ) : (
        <p className="ai-perf__empty">No inferences recorded yet.</p>
      )}

      {latestEvent?.precisionFallback && (
        <p className="ai-perf__warning" role="status">
          {latestEvent.precisionFallbackReason ?? 'Fell back to FP32.'}
        </p>
      )}

      {coldStartMs !== null && (
        <p className="ai-perf__stat">Model load: {formatDuration(coldStartMs)}</p>
      )}

      {events.length > 1 && (
        <details className="ai-perf__history">
          <summary>Recent inferences ({events.length})</summary>
          <ul className="ai-perf__list">
            {events
              .slice()
              .reverse()
              .slice(0, 10)
              .map((e: import('@varve/engine').InferenceDiagnosticEvent) => (
                <li key={e.seq} className="ai-perf__list-item">
                  <span className="ai-perf__time">{formatTimestamp(e.timestamp)}</span>
                  <span className="ai-perf__model">{e.modelId}</span>
                  <span className={`ai-perf__tag ai-perf__tag--${e.modelPrecision}`}>
                    {e.modelPrecision.toUpperCase()}
                  </span>
                  <span className="ai-perf__latency">{formatDuration(e.processingTimeMs)}</span>
                  <span className="ai-perf__provider">{e.executionProvider}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
