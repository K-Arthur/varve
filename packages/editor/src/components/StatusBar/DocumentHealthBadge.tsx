/**
 * DocumentHealthBadge — the bottom bar's single document-health indicator.
 *
 * One badge answers one question ("is this document healthy?") for the three
 * scanners that used to render three adjacent badges:
 *
 *   - `runQuickStatus`  — the audit engine's cheap immediate rules
 *   - `runDebtScan`     — the design-debt scanner's 15 content checks
 *   - `computeLayoutScore` — the selected nodes' layout quality
 *
 * They are separate findings from separate rule sets, so the counts stay
 * separate in the tooltip and the accessible name; only the *face* is merged,
 * into the total error + warning count that the previous `AuditBadge` already
 * used. Info-level debt findings are reported in the tooltip and deliberately
 * excluded from the count — the badge has to stay a signal.
 *
 * All three scans run in ONE idle task on a settled document. The three
 * previous badges each owned an independent timer (200ms idle, 500ms idle,
 * 300ms settle) and re-walked the document on every edit, three times per
 * change, to draw three counts for one question.
 *
 * Exposure level: L1 (passive status) — always visible when findings exist,
 * never forces attention, never opens a panel by itself. Clicking opens the
 * Audit tab, which owns the audit / debt / layout sub-views.
 */

import { getFontRegistry } from '@varve/engine';
import { type AuditContext, type Document, runDebtScan, runQuickStatus } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { computeLayoutScore } from '../../intelligence/layoutScore';

/** Quiet time after the last edit before the badge re-scans. */
export const HEALTH_SCAN_SETTLE_MS = 300;

/**
 * The document once it has stopped changing for `delayMs`. The scans walk the
 * whole document; run per edit they cost several milliseconds on every frame of
 * a drag, for a status count nobody reads mid-gesture.
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

interface HealthSnapshot {
  auditErrors: number;
  auditWarnings: number;
  hasBlocking: boolean;
  debtErrors: number;
  debtWarnings: number;
  debtInfo: number;
  layoutScore: number;
}

const CLEAN: HealthSnapshot = {
  auditErrors: 0,
  auditWarnings: 0,
  hasBlocking: false,
  debtErrors: 0,
  debtWarnings: 0,
  debtInfo: 0,
  layoutScore: 100,
};

function totalFindings(snapshot: HealthSnapshot): number {
  return (
    snapshot.auditErrors + snapshot.auditWarnings + snapshot.debtErrors + snapshot.debtWarnings
  );
}

export function DocumentHealthBadge() {
  const { state, selectedNodes, setInspectorTab } = useEditor();
  const scannedDocument = useSettledDocument(state.document, HEALTH_SCAN_SETTLE_MS);
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(CLEAN);

  const selectionIds = selectedNodes()
    .map((node) => node.id)
    .join('\u0000');

  const runScan = useCallback(() => {
    const availableFonts = (() => {
      try {
        const registry = getFontRegistry();
        return new Set(registry.families().filter((family) => registry.isAvailable(family)));
      } catch {
        return new Set<string>();
      }
    })();

    // `runQuickStatus` filters rules it cannot evaluate without an installed
    // font registry, so an empty set downgrades rather than throws.
    const ctx: AuditContext = {
      doc: scannedDocument,
      workspaceMode: state.workspaceMode,
      canvasMode: state.canvasMode,
      tool: state.tool,
      selection: state.selection,
      pageId: state.currentPageId ?? undefined,
      availableFonts,
      isPresenting: state.isPresenting,
    };

    const audit = runQuickStatus(ctx);
    const debt = runDebtScan(scannedDocument, {
      availableFonts: getFontRegistry().availableFamilies(),
    });
    const ids = selectionIds.length > 0 ? selectionIds.split('\u0000') : [];

    setSnapshot({
      auditErrors: audit.errorCount,
      auditWarnings: audit.warningCount,
      hasBlocking: audit.hasBlocking,
      debtErrors: debt.totalErrors,
      debtWarnings: debt.totalWarnings,
      debtInfo: debt.totalInfo,
      layoutScore: computeLayoutScore(scannedDocument, ids).score,
    });
  }, [
    scannedDocument,
    selectionIds,
    state.workspaceMode,
    state.canvasMode,
    state.tool,
    state.selection,
    state.currentPageId,
    state.isPresenting,
  ]);

  useEffect(() => {
    const id =
      requestIdleCallback?.(runScan, { timeout: 500 }) ??
      (setTimeout(runScan, 400) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(id);
      } else clearTimeout(id);
    };
  }, [runScan]);

  const count = totalFindings(snapshot);
  // Zero findings is not "verified clean" — it is nothing to report. The badge
  // stays out of the row rather than occupying a permanent "0".
  if (count === 0) return null;

  const hasErrors = snapshot.auditErrors > 0 || snapshot.debtErrors > 0;
  const severityClass = hasErrors ? 'error' : 'warning';

  const detail = [
    `${snapshot.auditErrors} error(s), ${snapshot.auditWarnings} warning(s) in audit checks`,
    `${snapshot.debtErrors} error(s), ${snapshot.debtWarnings} warning(s) in design debt`,
    snapshot.debtInfo > 0 ? `${snapshot.debtInfo} info note(s)` : null,
    `Layout score ${snapshot.layoutScore}/100`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  // The visible count is errors + warnings only; info-level debt notes would
  // inflate it into noise, so they live in the detail and the accessible name.
  const infoSuffix = snapshot.debtInfo > 0 ? `, ${snapshot.debtInfo} info` : '';

  return (
    <Tooltip label={`Document health: ${detail}. Click to review.`}>
      <button
        type="button"
        className={`document-health-badge document-health-badge--${severityClass}`}
        onClick={() => setInspectorTab('audit', 'audit')}
        aria-label={`Document health: ${count} findings — ${snapshot.auditErrors} audit errors, ${snapshot.auditWarnings} audit warnings, ${snapshot.debtErrors} debt errors, ${snapshot.debtWarnings} debt warnings${infoSuffix}`}
      >
        <Icon
          name={
            snapshot.hasBlocking || hasErrors
              ? snapshot.hasBlocking
                ? 'CircleX'
                : 'TriangleAlert'
              : 'CircleAlert'
          }
          label={undefined}
          size="0.85em"
        />
        <span className="document-health-badge__count">{count}</span>
      </button>
    </Tooltip>
  );
}
