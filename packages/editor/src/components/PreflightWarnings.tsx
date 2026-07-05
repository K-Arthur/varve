/**
 * PreflightWarnings — warning badge in the StatusBar that shows preflight issues.
 *
 * When preflight detects issues, a badge appears in the status bar color-coded
 * by highest severity (red=error, yellow=warning, gray=info). Clicking opens
 * a small panel listing all issues, grouped by severity.
 *
 * Research basis: Adobe InDesign preflight panel, Enfocus PitStop inspection.
 */

import type { PrintPreflightIssue, PrintPreflightSeverity } from '@strata/scene';
import { runPrintPreflight } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../context';

const SEVERITY_ORDER: PrintPreflightSeverity[] = ['error', 'warning', 'info'];

interface GroupedIssues {
  severity: PrintPreflightSeverity;
  label: string;
  issues: PrintPreflightIssue[];
}

function severityColor(severity: PrintPreflightSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger)';
    case 'warning':
      return 'var(--color-feedback-warning)';
    case 'info':
      return 'var(--color-text-muted)';
  }
}

function severityBg(severity: PrintPreflightSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger-bg, rgba(220, 38, 38, 0.1))';
    case 'warning':
      return 'var(--color-feedback-warning-bg, rgba(234, 179, 8, 0.1))';
    case 'info':
      return 'var(--color-bg-tertiary, rgba(128, 128, 128, 0.08))';
  }
}

export function PreflightWarnings() {
  const { state, revealSelection } = useEditor();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    if (!state.document) return null;
    return runPrintPreflight(state.document);
  }, [state.document]);

  const hasIssues = result && result.errorCount + result.warningCount + result.infoCount > 0;

  const highestSeverity: PrintPreflightSeverity | null = useMemo(() => {
    if (!result || !hasIssues) return null;
    for (const s of SEVERITY_ORDER) {
      if (result.issues.some((i) => i.severity === s)) return s;
    }
    return null;
  }, [result, hasIssues]);

  const grouped: GroupedIssues[] = useMemo(() => {
    if (!result || !hasIssues) return [];
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      label: severity.charAt(0).toUpperCase() + severity.slice(1),
      issues: result.issues.filter((i) => i.severity === severity),
    })).filter((g) => g.issues.length > 0);
  }, [result, hasIssues]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      revealSelection({ nodeId });
      setOpen(false);
    },
    [revealSelection],
  );

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  if (!result || !hasIssues) return null;

  const ec = result.errorCount;
  const wc = result.warningCount;
  const ic = result.infoCount;
  const totalBadge = (ec + wc + ic).toString();

  return (
    <div className="preflight-warnings" style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="preflight-warnings__badge"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={`Preflight: ${ec} errors, ${wc} warnings, ${ic} info`}
        style={{
          color: highestSeverity ? severityColor(highestSeverity) : undefined,
        }}
        title={`${ec} errors, ${wc} warnings, ${ic} info`}
      >
        <Icon name="FileWarning" size={12} />
        <span className="preflight-warnings__count">{totalBadge}</span>
      </button>

      {open && (
        <>
          <div
            className="preflight-warnings__backdrop"
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
            }}
          />
          <div
            ref={panelRef}
            className="preflight-warnings__panel"
            role="dialog"
            aria-label="Preflight issues"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 4px)',
              left: 0,
              zIndex: 1000,
              background: 'var(--color-bg-raised)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              minWidth: 280,
              maxWidth: 360,
              maxHeight: 320,
              overflowY: 'auto',
              padding: 'var(--space-2)',
            }}
          >
            {grouped.map((group) => (
              <div key={group.severity} className="preflight-warnings__group">
                <div
                  className="preflight-warnings__group-header"
                  style={{
                    color: severityColor(group.severity),
                    fontWeight: 600,
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: 'var(--space-1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: severityColor(group.severity),
                    }}
                  />
                  {group.label} ({group.issues.length})
                </div>
                {group.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className="preflight-warnings__issue"
                    style={{
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: 'var(--font-size-xs)',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: 2,
                      background: severityBg(group.severity),
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-1)',
                    }}
                  >
                    <span style={{ flex: 1, lineHeight: 1.4 }}>{issue.message}</span>
                    {issue.nodeId && (
                      <button
                        type="button"
                        className="preflight-warnings__select-btn"
                        onClick={() => handleSelectNode(issue.nodeId!)}
                        style={{
                          flexShrink: 0,
                          fontSize: 'var(--font-size-xs)',
                          padding: '1px 4px',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-bg-default)',
                          cursor: 'pointer',
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                        aria-label={`Select node ${issue.nodeId}`}
                      >
                        Select
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
