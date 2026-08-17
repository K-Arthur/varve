/**
 * Audit Contextual Summary
 *
 * Provides contextual summaries for audit findings in inspector panels.
 * Shows relevant information based on the selected finding and context.
 *
 * @module AuditContextualSummary
 */

import type { AuditFinding } from '@varve/shared';
import { Icon } from '@varve/ui';
import './audit.css';

interface AuditContextualSummaryProps {
  /** Current finding */
  finding: AuditFinding | null;

  /** Related findings (for correlation) */
  relatedFindings?: AuditFinding[];

  /** On finding click */
  onFindingClick?: (finding: AuditFinding) => void;
}

/**
 * Audit contextual summary component.
 */
export function AuditContextualSummary({
  finding,
  relatedFindings = [],
  onFindingClick,
}: AuditContextualSummaryProps) {
  if (!finding) {
    return (
      <div className="audit-contextual-summary">
        <p className="audit-contextual-empty">Select a finding to see details</p>
      </div>
    );
  }

  return (
    <div className="audit-contextual-summary">
      {/* Severity badge */}
      <div className={`audit-contextual-severity audit-contextual-severity--${finding.severity}`}>
        <Icon name="X" size="0.8em" />
        <span>{capitalize(finding.severity)}</span>
      </div>

      {/* Category */}
      <div className="audit-contextual-category">
        <span className="audit-contextual-label">Category:</span>
        <span className="audit-contextual-value">{capitalize(finding.category)}</span>
      </div>

      {/* Rule ID */}
      <div className="audit-contextual-rule">
        <span className="audit-contextual-label">Rule:</span>
        <span className="audit-contextual-value">{finding.ruleId}</span>
      </div>

      {/* Message */}
      <div className="audit-contextual-message">
        <p>{finding.message}</p>
      </div>

      {/* Detail if available */}
      {finding.detail && (
        <div className="audit-contextual-detail">
          <p>{finding.detail}</p>
        </div>
      )}

      {/* Evidence if available */}
      {finding.evidence && Object.keys(finding.evidence).length > 0 && (
        <div className="audit-contextual-evidence">
          <h4>Evidence</h4>
          <ul>
            {Object.entries(finding.evidence).map(([key, value]) => (
              <li key={key}>
                <span className="audit-contextual-evidence-key">{key}:</span>
                <span className="audit-contextual-evidence-value">
                  {typeof value === 'number' ? value.toFixed(2) : String(value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Affected nodes */}
      {finding.nodeIds.length > 0 && (
        <div className="audit-contextual-nodes">
          <h4>Affected Nodes ({finding.nodeIds.length})</h4>
          <ul className="audit-contextual-node-list">
            {finding.nodeIds.slice(0, 5).map((nodeId) => (
              <li key={nodeId} className="audit-contextual-node">
                <code>{nodeId}</code>
              </li>
            ))}
            {finding.nodeIds.length > 5 && (
              <li className="audit-contextual-node-more">+{finding.nodeIds.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Fixes */}
      {finding.fixes.length > 0 && (
        <div className="audit-contextual-fixes">
          <h4>Available Fixes ({finding.fixes.length})</h4>
          <ul>
            {finding.fixes.map((fix) => (
              <li key={fix.id} className="audit-contextual-fix">
                <span className="audit-contextual-fix-label">{fix.label}</span>
                {fix.description && (
                  <span className="audit-contextual-fix-description">{fix.description}</span>
                )}
                {fix.previewable && (
                  <span className="audit-contextual-fix-previewable">
                    <Icon name="Eye" size="0.8em" />
                    Previewable
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Related findings */}
      {relatedFindings.length > 0 && (
        <div className="audit-contextual-related">
          <h4>Related Findings ({relatedFindings.length})</h4>
          <ul className="audit-contextual-related-list">
            {relatedFindings.slice(0, 3).map((related) => (
              <li key={related.findingId} className="audit-contextual-related-item">
                <button type="button" onClick={() => onFindingClick?.(related)}>
                  <span
                    className={`audit-contextual-related-severity audit-contextual-related-severity--${related.severity}`}
                  >
                    {capitalize(related.severity)}
                  </span>
                  <span className="audit-contextual-related-message">{related.message}</span>
                </button>
              </li>
            ))}
            {relatedFindings.length > 3 && (
              <li className="audit-contextual-related-more">
                +{relatedFindings.length - 3} more related findings
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Confidence */}
      {finding.confidence < 1.0 && (
        <div className="audit-contextual-confidence">
          <span className="audit-contextual-label">Confidence:</span>
          <span className="audit-contextual-value">{Math.round(finding.confidence * 100)}%</span>
        </div>
      )}

      {/* Timestamp */}
      <div className="audit-contextual-timestamp">
        <span className="audit-contextual-label">Detected:</span>
        <span className="audit-contextual-value">
          {new Date(finding.timestamp).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/**
 * Capitalize first letter.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
