/**
 * Serializable scan executor — runs registered audit rules against a
 * JSON-serializable input without requiring DOM or renderer access.
 *
 * This module bridges the gap between the audit engine (which expects
 * a full AuditContext with Document) and the worker pool (which only
 * has serializable data). It re-runs rules from the engine registry
 * using the document carried in SerialisableScanInput.
 *
 * Usage:
 *   const result = await runAuditScan(input, { onProgress, signal });
 */

import { type AuditContext, type AuditRuleDef, getAllRules } from '@varve/scene';
import type { ScanProgress, ScanResult, SerialisableScanInput } from './auditScanTypes';

export interface ScanExecutorOptions {
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

/**
 * Run a full audit scan against a serializable input.
 *
 * Loads registered rules from the audit engine and runs each sequentially.
 * Supports cancellation between rules via AbortSignal and progress reporting.
 */
export async function runAuditScan(
  input: SerialisableScanInput,
  options?: ScanExecutorOptions,
): Promise<ScanResult> {
  const timings: Record<string, number> = {};
  const findings: ScanResult['findings'] = [];
  let failures = 0;
  const startTime = performance.now();
  const { signal, onProgress } = options ?? {};

  const rules = resolveRules(input.ruleIds);

  for (let i = 0; i < rules.length; i++) {
    if (signal?.aborted) {
      return {
        findings,
        timings,
        failures,
        revision: input.revision,
        aborted: true,
      };
    }

    const rule = rules[i]!;
    const start = performance.now();

    try {
      const ctx = buildContext(input);
      const ruleFindings = rule.run(ctx);
      findings.push(...ruleFindings);
    } catch (err) {
      console.error(`[audit-scan] Rule ${rule.id} failed:`, err);
      failures++;
    }

    timings[rule.id] = performance.now() - start;

    onProgress?.({
      completed: i + 1,
      total: rules.length,
      currentRule: rule.id,
      elapsed: performance.now() - startTime,
      estimatedRemaining:
        i < rules.length - 1
          ? ((performance.now() - startTime) / (i + 1)) * (rules.length - i - 1)
          : undefined,
    });

    // Yield to event loop between rules so cancellation/progress can be processed
    if (i < rules.length - 1) {
      await Promise.resolve();
    }
  }

  return {
    findings,
    timings,
    failures,
    revision: input.revision,
    aborted: false,
  };
}

/**
 * Resolve AuditRuleDef entries from the engine registry.
 * If ruleIds is empty, returns all registered rules.
 */
function resolveRules(ruleIds: string[]): AuditRuleDef[] {
  const allRules = getAllRules();
  if (ruleIds.length === 0) return allRules;
  const idSet = new Set(ruleIds);
  return allRules.filter((r) => idSet.has(r.id));
}

/**
 * Build a minimal AuditContext from a serializable input.
 * The document is carried as `unknown` in the input and cast to Document
 * here — the audit engine rules access it as Document.
 */
function buildContext(input: SerialisableScanInput): AuditContext {
  return {
    doc: input.document as AuditContext['doc'],
    workspaceMode: 'design',
    canvasMode: 'full',
    tool: 'select',
    selection: input.nodeIds,
    isPresenting: false,
  };
}
