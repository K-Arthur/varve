/**
 * PreflightFindingsPanel — surfaces the shared export-preflight findings in the
 * export workflow (Strata export rebuild, M9).
 *
 * The panel is fed by {@link ExportService.runBatchPreflight} (the same shared
 * findings pipeline that drives plan normalization), so the UI and the executor
 * always agree on blocking errors vs advisory warnings. Color is never the only
 * status cue: every severity carries an icon plus a visible text label, and the
 * panel exposes counts through `role="status"` for assistive tech.
 *
 * This component renders findings only; it never mutates the document.
 */

import type { ExportFinding, ExportFindingSeverity } from '@varve/scene/export';
import { Icon } from '@varve/ui';
import { useMemo, useState } from 'react';

import './PreflightFindingsPanel.css';

export interface PreflightFindingsPanelProps {
  findings: ExportFinding[];
  /** Render the "no issues" state when the finding list is empty. */
  showClean?: boolean;
  /** Optional callback to apply a safe fix for a finding (must not be wired to
   * document mutation by default — preflight never mutates silently). */
  onApplyFix?: (finding: ExportFinding) => void;
}

const SEVERITY_ORDER: readonly ExportFindingSeverity[] = ['error', 'warning', 'info'];

interface SeverityMeta {
  icon: 'TriangleAlert' | 'CircleAlert' | 'Info';
  label: string;
  className: string;
}

function severityMeta(severity: ExportFindingSeverity): SeverityMeta {
  switch (severity) {
    case 'error':
      return { icon: 'TriangleAlert', label: 'Error', className: 'error' };
    case 'warning':
      return { icon: 'CircleAlert', label: 'Warning', className: 'warning' };
    case 'info':
      return { icon: 'Info', label: 'Info', className: 'info' };
  }
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Readable label for a deterministic preflight fix action, when one exists. */
function fixActionLabel(finding: ExportFinding): string | null {
  if (!finding.fixAction || finding.fixAction.type === 'none') return null;
  switch (finding.fixAction.type) {
    case 'flatten-raster':
      return 'Rasterize affected nodes';
    case 'outline-text':
      return 'Convert text to outlines';
    case 'convert-color-space':
      return 'Convert color space';
    case 'set-background':
      return 'Set background color';
  }
}

export function PreflightFindingsPanel({
  findings,
  showClean = false,
  onApplyFix,
}: PreflightFindingsPanelProps) {
  const [open, setOpen] = useState(true);

  const counts = useMemo(() => {
    const result: Record<ExportFindingSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of findings) result[finding.severity] += 1;
    return result;
  }, [findings]);

  const grouped = useMemo(
    () =>
      SEVERITY_ORDER.map((severity) => ({
        severity,
        findings: findings.filter((f) => f.severity === severity),
      })).filter((group) => group.findings.length > 0),
    [findings],
  );

  const total = findings.length;
  if (total === 0) {
    if (!showClean) return null;
    return (
      <section className="preflight-panel preflight-panel--clean" aria-label="Preflight">
        <p className="preflight-panel__clean" role="status">
          No preflight issues for the selected exports.
        </p>
      </section>
    );
  }

  const summaryParts: string[] = [];
  if (counts.error > 0) summaryParts.push(pluralize(counts.error, 'error'));
  if (counts.warning > 0) summaryParts.push(pluralize(counts.warning, 'warning'));
  if (counts.info > 0) summaryParts.push(pluralize(counts.info, 'info'));
  const summary = summaryParts.length > 0 ? summaryParts.join(' \u00b7 ') : 'No issues';

  return (
    <section
      className={`preflight-panel preflight-panel--has-issues${counts.error > 0 ? ' preflight-panel--blocked' : ''}`}
      aria-label="Export preflight"
    >
      <div className="preflight-panel__header">
        <button
          type="button"
          className="preflight-panel__toggle"
          aria-expanded={open}
          aria-controls="preflight-findings-list"
          onClick={() => setOpen((prev) => !prev)}
        >
          <Icon
            name="ChevronDown"
            size={14}
            label={undefined}
            className={`preflight-panel__chevron${open ? ' preflight-panel__chevron--open' : ''}`}
          />
          <span className="preflight-panel__summary">Preflight: {summary}</span>
        </button>
        {onApplyFix && (
          <span className="strata-visually-hidden" role="status">
            {summary}
          </span>
        )}
      </div>
      {open && (
        <ul className="preflight-panel__list" id="preflight-findings-list">
          {grouped.map((group) => {
            const meta = severityMeta(group.severity);
            return group.findings.map((finding) => {
              const fixLabel = fixActionLabel(finding);
              return (
                <li
                  key={finding.id}
                  className={`preflight-panel__finding preflight-panel__finding--${meta.className}`}
                >
                  <Icon
                    name={meta.icon}
                    size={14}
                    className={`preflight-panel__severity-icon preflight-panel__severity-icon--${meta.className}`}
                    label={undefined}
                  />
                  <div className="preflight-panel__finding-body">
                    <p className="preflight-panel__finding-title">
                      <span className="strata-visually-hidden">{meta.label}: </span>
                      {finding.title}
                    </p>
                    <p className="preflight-panel__finding-desc">{finding.description}</p>
                    <p className="preflight-panel__finding-code">{finding.code}</p>
                  </div>
                  {fixLabel && onApplyFix && (
                    <button
                      type="button"
                      className="preflight-panel__fix"
                      onClick={() => onApplyFix(finding)}
                    >
                      {fixLabel}
                    </button>
                  )}
                </li>
              );
            });
          })}
        </ul>
      )}
    </section>
  );
}
