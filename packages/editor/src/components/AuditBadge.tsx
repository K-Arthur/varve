/**
 * AuditBadge — L1 passive status indicator for the status bar.
 *
 * Shows a subtle error/warning count for audit findings applicable to the
 * current workspace. Clicking opens the Review tab in the IntelligencePanel.
 *
 * This replaces the separate DebtBadge and LayoutScoreIndicator with a
 * single workspace-aware badge.
 *
 * Exposure level: L1 (Passive Status) — always visible when findings exist,
 * never forces attention, never opens panels automatically.
 */

import { getFontRegistry } from '@varve/engine';
import type { AuditContext } from '@varve/scene';
import { runQuickStatus } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../context';

/**
 * Trigger the audit tab in the inspector panel.
 * Uses the module-level bridge pattern (same as setToastHandler).
 */

export function AuditBadge() {
  const { state, setInspectorTab } = useEditor();
  const [status, setStatus] = useState<{
    errorCount: number;
    warningCount: number;
    hasBlocking: boolean;
  }>({
    errorCount: 0,
    warningCount: 0,
    hasBlocking: false,
  });

  // Quick status scan — runs only cheap immediate rules (< 20ms budget)
  const runQuickScan = useCallback(() => {
    const loadedFonts = (() => {
      try {
        const registry = getFontRegistry();
        return new Set(registry.families().filter((f) => registry.isAvailable(f)));
      } catch {
        return new Set<string>();
      }
    })();

    const ctx: AuditContext = {
      doc: state.document,
      workspaceMode: state.workspaceMode,
      canvasMode: state.canvasMode,
      tool: state.tool,
      selection: state.selection,
      pageId: state.currentPageId ?? undefined,
      availableFonts: loadedFonts,
      isPresenting: state.isPresenting,
    };

    const result = runQuickStatus(ctx);
    setStatus(result);
  }, [
    state.document,
    state.workspaceMode,
    state.canvasMode,
    state.tool,
    state.selection,
    state.currentPageId,
    state.isPresenting,
  ]);

  // Run on document change, debounced via idle callback
  useEffect(() => {
    const id =
      requestIdleCallback?.(runQuickScan, { timeout: 500 }) ??
      (setTimeout(runQuickScan, 300) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [runQuickScan]);

  const handleClick = useCallback(() => {
    setInspectorTab('audit', 'audit');
  }, [setInspectorTab]);

  // Don't render if no findings. The early return must stay after every
  // hook — a conditional hook call here previously threw React error #310
  // ("Rendered more hooks than during the previous render") the first time
  // a scan produced findings.
  if (status.errorCount === 0 && status.warningCount === 0) return null;

  const hasErrors = status.errorCount > 0;

  return (
    <Tooltip
      label={`${status.errorCount} error(s), ${status.warningCount} warning(s). Click to review.`}
    >
      <button
        type="button"
        className={`audit-badge audit-badge--${hasErrors ? 'error' : 'warning'}`}
        onClick={handleClick}
        aria-label={`Audit: ${status.errorCount} errors, ${status.warningCount} warnings`}
      >
        <Icon
          name={status.hasBlocking ? 'CircleX' : hasErrors ? 'TriangleAlert' : 'CircleAlert'}
          label={undefined}
          size="0.85em"
        />
        <span className="audit-badge__count">{status.errorCount + status.warningCount}</span>
      </button>
    </Tooltip>
  );
}
