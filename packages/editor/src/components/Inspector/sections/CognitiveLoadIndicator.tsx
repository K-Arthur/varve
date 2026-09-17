import type { Document, NodeId } from '@varve/scene';
import { Tooltip } from '@varve/ui';
import { useMemo } from 'react';
import {
  type CognitiveLoadReport,
  computeCognitiveLoad,
} from '../../../intelligence/cognitiveLoad';
import { DisclosureSection } from '../controls/DisclosureSection';

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

/**
 * Cognitive-load disclosure for the Insights panel.
 *
 * Returns nothing at all when the score is zero. Previously the section header
 * rendered regardless and opened onto an empty body — an "expanded section
 * with no content" dead end that the 2026-09-16 Insights review called out.
 */
export function CognitiveLoadSection({ document, nodeId }: CognitiveLoadIndicatorProps) {
  const report = useMemo(() => computeCognitiveLoad(document, nodeId), [document, nodeId]);
  if (report.score === 0) return null;
  return (
    <DisclosureSection title="Cognitive load" sectionId="cognitive-load">
      <CognitiveLoadReportView report={report} />
    </DisclosureSection>
  );
}

export function CognitiveLoadIndicator({ document, nodeId }: CognitiveLoadIndicatorProps) {
  const report = useMemo(() => computeCognitiveLoad(document, nodeId), [document, nodeId]);
  return <CognitiveLoadReportView report={report} />;
}

function CognitiveLoadReportView({ report }: { report: CognitiveLoadReport }) {
  if (report.score === 0) return null;

  return (
    <div className="insp-cognitive-load">
      <div className="insp-cognitive-load__bar">
        <div className="insp-cognitive-load__meter">
          <div
            className="insp-cognitive-load__fill"
            style={{
              width: `${Math.min(report.score, 100)}%`,
              background: LEVEL_COLORS[report.level] ?? 'var(--color-feedback-warning)',
            }}
          />
        </div>
        <Tooltip label={`Cognitive load: ${report.level} (${report.score}/100)`}>
          <span
            className="insp-cognitive-load__score"
            style={{ color: LEVEL_COLORS[report.level] ?? 'var(--color-text-muted)' }}
            role="img"
            aria-label={`Cognitive load: ${report.level} (${report.score}/100)`}
          >
            {report.score}
          </span>
        </Tooltip>
      </div>
      {report.suggestions.length > 0 && (
        <ul className="insp-cognitive-load__suggestions">
          {report.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
