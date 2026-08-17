/**
 * Audit Utility Panel
 *
 * Collapsible utility panel for audit findings following the hybrid approach.
 * Provides filtering, navigation, and profile switching for audit results.
 *
 * @module AuditUtilityPanel
 */

import type { AuditFinding, AuditSeverity } from '@varve/shared';
import { Icon } from '@varve/ui';
import { useState } from 'react';
import './audit.css';

interface AuditUtilityPanelProps {
  /** Current findings */
  findings: AuditFinding[];

  /** Whether panel is visible */
  visible: boolean;

  /** Whether panel is collapsed */
  collapsed: boolean;

  /** On visibility toggle */
  onToggleVisibility: () => void;

  /** On collapse toggle */
  onToggleCollapse: () => void;

  /** On finding click */
  onFindingClick: (finding: AuditFinding) => void;

  /** On fix click */
  onFixClick: (finding: AuditFinding, fixId: string) => void;

  /** On suppress click */
  onSuppressClick: (finding: AuditFinding) => void;
}

/**
 * Audit utility panel component.
 */
export function AuditUtilityPanel({
  findings,
  visible,
  collapsed,
  onToggleVisibility,
  onToggleCollapse,
  onFindingClick,
  onFixClick,
  onSuppressClick,
}: AuditUtilityPanelProps) {
  const [selectedSeverity, setSelectedSeverity] = useState<AuditSeverity | 'all'>('all');

  // Filter findings
  const filteredFindings = findings.filter((finding) => {
    if (selectedSeverity !== 'all' && finding.severity !== selectedSeverity) {
      return false;
    }
    return true;
  });

  // Count by severity
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const suggestionCount = findings.filter((f) => f.severity === 'suggestion').length;

  if (!visible) {
    return null;
  }

  return (
    <div className="audit-utility-panel">
      {/* Header */}
      <div className="audit-panel-header">
        <div className="audit-panel-title">
          <Icon name="Lightbulb" size="1em" />
          <span>Audit</span>
          <span className="audit-panel-count">({filteredFindings.length})</span>
        </div>
        <div className="audit-panel-controls">
          <button
            type="button"
            className="audit-panel-button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <Icon name={collapsed ? 'ChevronRight' : 'ChevronDown'} size="1em" />
          </button>
          <button
            type="button"
            className="audit-panel-button"
            onClick={onToggleVisibility}
            aria-label="Close panel"
          >
            <Icon name="X" size="1em" />
          </button>
        </div>
      </div>

      {/* Collapsed state */}
      {collapsed && (
        <div className="audit-panel-collapsed">
          <div className="audit-panel-summary">
            <span className="audit-panel-summary-item error">{errorCount} errors</span>
            <span className="audit-panel-summary-item warning">{warningCount} warnings</span>
            <span className="audit-panel-summary-item suggestion">
              {suggestionCount} suggestions
            </span>
          </div>
        </div>
      )}

      {/* Expanded state */}
      {!collapsed && (
        <div className="audit-panel-content">
          {/* Severity filter */}
          <div className="audit-panel-filter">
            <span className="audit-panel-filter-label">Severity:</span>
            <div className="audit-panel-filter-options">
              <button
                type="button"
                className={`audit-filter-chip ${selectedSeverity === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedSeverity('all')}
              >
                All ({findings.length})
              </button>
              <button
                type="button"
                className={`audit-filter-chip ${selectedSeverity === 'error' ? 'active' : ''}`}
                onClick={() => setSelectedSeverity('error')}
              >
                Errors ({errorCount})
              </button>
              <button
                type="button"
                className={`audit-filter-chip ${selectedSeverity === 'warning' ? 'active' : ''}`}
                onClick={() => setSelectedSeverity('warning')}
              >
                Warnings ({warningCount})
              </button>
              <button
                type="button"
                className={`audit-filter-chip ${selectedSeverity === 'suggestion' ? 'active' : ''}`}
                onClick={() => setSelectedSeverity('suggestion')}
              >
                Suggestions ({suggestionCount})
              </button>
            </div>
          </div>

          {/* Findings list */}
          <div className="audit-panel-findings">
            {filteredFindings.length === 0 ? (
              <div className="audit-panel-empty">
                <Icon name="Lightbulb" size="2em" />
                <p>No findings match your filters</p>
              </div>
            ) : (
              filteredFindings.map((finding) => (
                <button
                  type="button"
                  key={finding.findingId}
                  className={`audit-finding audit-finding--${finding.severity}`}
                  onClick={() => onFindingClick(finding)}
                >
                  <span className="audit-finding-header">
                    <Icon name="X" size="1em" />
                    <span className="audit-finding-message">{finding.message}</span>
                  </span>

                  {finding.fixes.length > 0 && (
                    <span className="audit-finding-actions">
                      {finding.fixes.map((fix) => (
                        <button
                          type="button"
                          key={fix.id}
                          className="audit-finding-fix"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFixClick(finding, fix.id);
                          }}
                        >
                          {fix.label}
                        </button>
                      ))}
                    </span>
                  )}

                  {finding.suppressionEligible && (
                    <button
                      type="button"
                      className="audit-finding-suppress"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSuppressClick(finding);
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
