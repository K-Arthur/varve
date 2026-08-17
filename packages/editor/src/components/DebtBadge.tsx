/**
 * DebtBadge — status bar badge showing the total design debt issue count.
 *
 * Re-runs the debt scanner via useMemo whenever the document changes.
 * Color-coded: red bg for errors, orange for warnings, blue for info-only.
 * Clicking calls context.setInspectorTab('audit', 'debt') to open the debt tab.
 *
 * Research basis: PreflightWarnings badge pattern (color + count + popover),
 * VS Code problem-count badge in the status bar.
 */

import { getFontRegistry } from '@varve/engine';
import { runDebtScan } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../context';

export function DebtBadge() {
  const { state, setInspectorTab } = useEditor();

  const report = useMemo(() => {
    if (!state.document) return null;
    return runDebtScan(state.document, {
      availableFonts: getFontRegistry().availableFamilies(),
    });
  }, [state.document]);

  if (!report || report.issues.length === 0) return null;

  const ec = report.totalErrors;
  const wc = report.totalWarnings;
  const ic = report.totalInfo;
  const total = ec + wc + ic;

  let color: string;
  let bg: string;
  if (ec > 0) {
    color = 'var(--color-feedback-danger)';
    bg = 'color-mix(in oklab, var(--color-feedback-danger) 12%, transparent)';
  } else if (wc > 0) {
    color = 'var(--color-feedback-warning)';
    bg = 'color-mix(in oklab, var(--color-feedback-warning) 16%, transparent)';
  } else {
    color = 'var(--color-feedback-info)';
    bg = 'var(--color-surface-sunken)';
  }

  return (
    <Tooltip label={`${ec} errors, ${wc} warnings, ${ic} info — click to view debt panel`}>
      <button
        type="button"
        className="debt-badge"
        onClick={() => setInspectorTab('audit', 'debt')}
        style={{ color, background: bg }}
        aria-label={`Design debt: ${ec} errors, ${wc} warnings, ${ic} info`}
      >
        <Icon name="TriangleAlert" size={12} />
        <span className="debt-badge__count">{total}</span>
      </button>
    </Tooltip>
  );
}
