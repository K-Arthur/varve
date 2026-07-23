/**
 * ContextualAuditSummary — L2 contextual audit summary for inspector panels.
 *
 * Shows concise, relevant findings near the affected controls. For example:
 * - TypographySection shows "Missing font" warnings
 * - FillSection shows "Low contrast" warnings
 * - PositionSizeSection shows layout issues
 *
 * This component is lightweight — it reads from a pre-computed findings map
 * and renders only summary chips, not the full audit UI.
 *
 * Exposure level: L2 (Contextual Summary) — shown only when directly relevant,
 * never opens panels automatically, provides a link to the full finding.
 */

import type { AuditFinding } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useMemo } from 'react';
import { setInspectorTabHandler, useEditor } from '../context';

export interface ContextualAuditSummaryProps {
  /** Node ID to show findings for. */
  nodeId?: string;
  /** Categories to filter to (e.g. ['typography'] for TypographySection). */
  categories?: string[];
  /** Maximum findings to show inline. */
  maxVisible?: number;
}

/**
 * Renders a compact audit summary for a specific node and categories.
 * If there are findings, shows a chip with the count and a link to the
 * full audit review tab.
 */
export function ContextualAuditSummary({
  nodeId,
  categories,
  maxVisible = 3,
}: ContextualAuditSummaryProps) {
  const { state } = useEditor();

  // Read pre-computed findings from the audit engine cache
  // This avoids re-running expensive audits just for contextual display
  const relevantFindings = useMemo(() => {
    if (!nodeId) return [];

    // Access the document-level findings cache if available
    const findingsCache = (state as Record<string, unknown>).__auditFindings as
      | AuditFinding[]
      | undefined;

    if (!findingsCache) return [];

    return findingsCache.filter((f) => {
      if (f.nodeId !== nodeId) return false;
      if (categories && categories.length > 0) {
        if (!categories.includes(f.category)) return false;
      }
      return true;
    });
  }, [state, nodeId, categories]);

  if (relevantFindings.length === 0) return null;

  const errorFindings = relevantFindings.filter((f) => f.severity === 'error');
  const warningFindings = relevantFindings.filter((f) => f.severity === 'warning');
  const otherFindings = relevantFindings.filter(
    (f) => f.severity !== 'error' && f.severity !== 'warning',
  );

  const visibleFindings = [
    ...errorFindings.slice(0, maxVisible),
    ...warningFindings.slice(0, maxVisible - errorFindings.length),
    ...otherFindings.slice(0, maxVisible - errorFindings.length - warningFindings.length),
  ];

  const remaining = relevantFindings.length - visibleFindings.length;

  const handleOpenAudit = () => {
    setInspectorTabHandler?.({ tab: 'audit', subTab: 'review' });
  };

  return (
    <div
      className="contextual-audit-summary"
      role="status"
      aria-label={`${relevantFindings.length} audit finding(s)`}
    >
      {visibleFindings.map((finding) => (
        <span
          key={finding.findingId}
          className={`contextual-audit-chip contextual-audit-chip--${finding.severity}`}
          title={finding.message}
        >
          <Icon
            name={
              finding.severity === 'error'
                ? 'CircleX'
                : finding.severity === 'warning'
                  ? 'TriangleAlert'
                  : 'Info'
            }
            label={undefined}
            size="0.75em"
          />
          <span className="contextual-audit-chip__text">{finding.message}</span>
        </span>
      ))}
      {remaining > 0 && (
        <button
          type="button"
          className="contextual-audit-more"
          onClick={handleOpenAudit}
          title={`View ${remaining} more finding(s) in audit panel`}
        >
          +{remaining} more
        </button>
      )}
      {relevantFindings.length <= maxVisible && relevantFindings.length > 0 && (
        <button
          type="button"
          className="contextual-audit-link"
          onClick={handleOpenAudit}
          title="Open audit review"
        >
          <Icon name="ExternalLink" label={undefined} size="0.7em" />
        </button>
      )}
    </div>
  );
}
