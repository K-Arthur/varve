/**
 * PreflightWarnings — the Print Mode preflight panel, surfaced as a badge in
 * the StatusBar. When preflight detects issues, the badge is color-coded by
 * highest severity (red=error, yellow=warning, gray=info). Clicking opens a
 * panel listing all issues grouped by severity, plus which check categories
 * were actually evaluated versus skipped for lack of external data (e.g. no
 * installed-font registry, no live text-layout measurements).
 *
 * Research basis: Adobe InDesign preflight panel, Enfocus PitStop inspection.
 */

import { getFontRegistry } from '@varve/engine';
import type { CombinedPreflightIssue, CombinedPreflightSeverity } from '@varve/scene';
import { runCombinedPreflight } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../context';

const SEVERITY_ORDER: CombinedPreflightSeverity[] = ['error', 'warning', 'info'];

interface GroupedIssues {
  severity: CombinedPreflightSeverity;
  label: string;
  issues: CombinedPreflightIssue[];
}

function severityColor(severity: CombinedPreflightSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger)';
    case 'warning':
      return 'var(--color-feedback-warning)';
    case 'info':
      return 'var(--color-text-muted)';
  }
}

function severityBg(severity: CombinedPreflightSeverity): string {
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
    return runCombinedPreflight(state.document, {
      availableFonts: getFontRegistry().availableFamilies(),
    });
  }, [state.document]);

  const hasIssues = result && result.errorCount + result.warningCount + result.infoCount > 0;

  const highestSeverity: CombinedPreflightSeverity | null = useMemo(() => {
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

  const unavailableChecks = useMemo(
    () => result?.checks.filter((c) => c.status === 'unavailable') ?? [],
    [result],
  );

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

  // Move focus into the panel when it opens so keyboard users can tab
  // through the findings and Escape closes it (non-modal popover, APG
  // "non-modal dialog" pattern). Without this, Escape lived on an invisible
  // backdrop that can never receive focus.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!result) return null;
  // Still surface the badge when checks are unavailable, even with zero
  // detected issues, so "0 issues" is never confused with "verified clean".
  if (!hasIssues && unavailableChecks.length === 0) return null;

  const ec = result.errorCount;
  const wc = result.warningCount;
  const ic = result.infoCount;
  const totalBadge = (ec + wc + ic).toString();
  const clean = !hasIssues;

  return (
    <div className="preflight-warnings" style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip
        label={
          clean
            ? `No issues found; ${unavailableChecks.length} check${unavailableChecks.length === 1 ? '' : 's'} could not be verified`
            : `${ec} errors, ${wc} warnings, ${ic} info`
        }
      >
        <button
          type="button"
          className="preflight-warnings__badge"
          onClick={handleToggle}
          aria-expanded={open}
          aria-label={
            clean
              ? `Preflight: no issues found; ${unavailableChecks.length} check${unavailableChecks.length === 1 ? '' : 's'} unavailable`
              : `Preflight: ${ec} errors, ${wc} warnings, ${ic} info`
          }
          style={{
            color: 'var(--color-text-secondary)',
          }}
        >
          <span
            style={{
              color: highestSeverity ? severityColor(highestSeverity) : 'var(--color-text-muted)',
              display: 'inline-flex',
            }}
          >
            <Icon name={clean ? 'FileCheck' : 'TriangleAlert'} size={12} />
          </span>
          {!clean && <span className="preflight-warnings__count">{totalBadge}</span>}
        </button>
      </Tooltip>

      {open && (
        <>
          <div
            className="preflight-warnings__backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
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
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
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
            {clean && (
              <div
                className="preflight-warnings__clean"
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                No issues found in the checks below.
              </div>
            )}
            {grouped.map((group) => (
              <div key={group.severity} className="preflight-warnings__group">
                <div
                  className="preflight-warnings__group-header"
                  style={{
                    // Severity conveyed by the dot + icon, not by the text
                    // color: warning text was 3.42:1 on light surfaces
                    // (WCAG 1.4.3 requires 4.5:1).
                    color: 'var(--color-text-primary)',
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
                {group.issues.map((issue) => (
                  <div
                    key={`${issue.source}-${issue.nodeId ?? 'doc'}-${issue.category}-${issue.message}`}
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
            {unavailableChecks.length > 0 && (
              <div
                className="preflight-warnings__unavailable"
                style={{
                  marginTop: 'var(--space-2)',
                  paddingTop: 'var(--space-2)',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  className="preflight-warnings__group-header"
                  style={{
                    color: 'var(--color-text-muted)',
                    fontWeight: 600,
                    fontSize: 'var(--font-size-sm)',
                    padding: 'var(--space-1) var(--space-2)',
                  }}
                >
                  Not verified ({unavailableChecks.length})
                </div>
                {unavailableChecks.map((check) => (
                  <div
                    key={check.id}
                    className="preflight-warnings__check"
                    style={{
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <span>{check.label}</span>
                    <span style={{ flexShrink: 0 }}>{check.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
