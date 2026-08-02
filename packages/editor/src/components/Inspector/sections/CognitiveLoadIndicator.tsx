import type { Document, NodeId } from '@strata/scene';
import { Tooltip } from '@strata/ui';
import { useMemo } from 'react';
import { computeCognitiveLoad } from '../../../intelligence/cognitiveLoad';

export interface CognitiveLoadIndicatorProps {
  document: Document;
  nodeId?: NodeId | null;
}

const LEVEL_COLORS: Record<string, string> = {
  low: 'var(--color-feedback-success)',
  moderate: 'var(--color-feedback-warning)',
  high: 'var(--color-feedback-danger)',
  critical: 'var(--color-feedback-danger)',
};

export function CognitiveLoadIndicator({ document, nodeId }: CognitiveLoadIndicatorProps) {
  const report = useMemo(() => computeCognitiveLoad(document, nodeId), [document, nodeId]);

  if (report.score === 0) return null;

  return (
    <div className="insp-cognitive-load" style={{ padding: '8px 0' }}>
      <div
        className="insp-cognitive-load__bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          className="insp-cognitive-load__meter"
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: 'var(--color-surface-sunken)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(report.score, 100)}%`,
              height: '100%',
              background: LEVEL_COLORS[report.level] ?? 'var(--color-feedback-warning)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <Tooltip label={`Cognitive load: ${report.level} (${report.score}/100)`}>
          <span
            className="insp-cognitive-load__score"
            style={{
              fontSize: '0.75em',
              fontWeight: 600,
              color: LEVEL_COLORS[report.level] ?? 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}
            role="img"
            aria-label={`Cognitive load: ${report.level} (${report.score}/100)`}
          >
            {report.score}
          </span>
        </Tooltip>
      </div>
      {report.suggestions.length > 0 && (
        <ul
          className="insp-cognitive-load__suggestions"
          style={{
            margin: '4px 0 0',
            padding: '0 0 0 16px',
            fontSize: '0.7em',
            color: 'var(--color-text-subtle)',
            listStyle: 'disc',
          }}
        >
          {report.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
