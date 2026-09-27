/**
 * DebtBadge — status bar badge showing the total design debt issue count.
 *
 * Re-runs the debt scanner once the document has been unchanged for a moment
 * (see useSettledDocument).
 * Color-coded: red bg for errors, orange for warnings, blue for info-only.
 * Clicking calls context.setInspectorTab('audit', 'debt') to open the debt tab.
 *
 * Research basis: PreflightWarnings badge pattern (color + count + popover),
 * VS Code problem-count badge in the status bar.
 */

import { getFontRegistry } from '@varve/engine';
import { type Document, runDebtScan } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../context';

/** Quiet time after the last edit before the badge re-scans. */
export const DEBT_SCAN_SETTLE_MS = 300;

/**
 * The document once it has stopped changing for `delayMs`. The scan walks the
 * whole document; run per edit it cost several milliseconds on every frame of
 * a drag on a large file, for a status count nobody reads mid-gesture.
 */
function useSettledDocument(doc: Document, delayMs: number): Document {
  const [settled, setSettled] = useState(doc);
  useEffect(() => {
    if (settled === doc) return;
    const timer = setTimeout(() => setSettled(doc), delayMs);
    return () => clearTimeout(timer);
  }, [doc, settled, delayMs]);
  return settled;
}

export function DebtBadge() {
  const { state, setInspectorTab } = useEditor();
  const scannedDocument = useSettledDocument(state.document, DEBT_SCAN_SETTLE_MS);

  const report = useMemo(() => {
    if (!scannedDocument) return null;
    return runDebtScan(scannedDocument, {
      availableFonts: getFontRegistry().availableFamilies(),
    });
  }, [scannedDocument]);

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
