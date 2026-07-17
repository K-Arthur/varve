/**
 * DebtBadge — status bar badge showing the total design debt issue count.
 *
 * Re-runs the debt scanner via useMemo whenever the document changes.
 * Color-coded: red bg for errors, orange for warnings, blue for info-only.
 * Clicking calls onSwitchToDebt (wired in StatusBar to switch panels).
 *
 * Research basis: PreflightWarnings badge pattern (color + count + popover),
 * VS Code problem-count badge in the status bar.
 */

import { getFontRegistry } from '@strata/engine';
import { runDebtScan } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useMemo } from 'react';
import { useEditor } from '../context';

interface DebtBadgeProps {
  onSwitchToDebt?: () => void;
}

export function DebtBadge({ onSwitchToDebt }: DebtBadgeProps) {
  const { state } = useEditor();

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
    bg = 'var(--color-feedback-danger-bg, rgba(220, 38, 38, 0.1))';
  } else if (wc > 0) {
    color = 'var(--color-feedback-warning)';
    bg = 'var(--color-feedback-warning-bg, rgba(234, 179, 8, 0.1))';
  } else {
    color = 'var(--color-feedback-info)';
    bg = 'var(--color-surface-sunken)';
  }

  return (
    <button
      type="button"
      className="debt-badge"
      onClick={onSwitchToDebt}
      style={{ color, background: bg }}
      title={`${ec} errors, ${wc} warnings, ${ic} info — click to view debt panel`}
      aria-label={`Design debt: ${ec} errors, ${wc} warnings, ${ic} info`}
    >
      <Icon name="FileWarning" size={12} />
      <span className="debt-badge__count">{total}</span>
    </button>
  );
}
