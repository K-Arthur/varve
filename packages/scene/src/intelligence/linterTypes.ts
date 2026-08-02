/**
 * Design Linter — shared types for all linter rules.
 *
 * Every rule is a pure `(doc, opts?) => LinterIssue[]` function composed
 * by `runLinterScan`. Rules live in `linterScanner.ts`; this file defines
 * the contract and report types.
 */

import type { NodeId } from '../types';

/** Severity classification. */
export type LinterSeverity = 'error' | 'warning' | 'info' | 'suggestion';

/** Category grouping used in the panel and for dismissal rules. */
export type LinterCategory =
  | 'color'
  | 'typography'
  | 'effects'
  | 'layer-hygiene'
  | 'touch-target'
  | 'focus-order'
  | 'palette'
  | 'prototype'
  | 'governance'
  | 'performance';

/** Scope a rule applies to. */
export type LinterScope = 'document' | 'page' | 'selection' | 'prototype';

/** A named, previewable fix for a single rule issue. */
export interface LinterFix {
  /** Machine-readable fix ID (unique within the rule). */
  id: string;
  /** Human-readable label (e.g. "Select matching fills"). */
  label: string;
  /**
   * Pure function that transforms the document. Returns `null` when the
   * fix would have no effect (issue already resolved by other means).
   */
  apply: (doc: unknown) => unknown | null;
  /** Whether the fix has a side effect beyond the document (e.g. selection). */
  changesSelection?: boolean;
}

/** Canonical linter issue — the single issue type used across all rules. */
export interface LinterIssue {
  /** Globally unique rule identifier (e.g. "select-by-fill-color/v1"). */
  ruleId: string;
  /** Human-readable severity. */
  severity: LinterSeverity;
  /** Category for grouping in the panel. */
  category: LinterCategory;
  /** Affected node IDs (may be empty for document-level issues). */
  nodeIds: NodeId[];
  /** One-line explanation. */
  message: string;
  /** Longer explanation shown in the issue detail view. */
  detail?: string;
  /** Machine-readable evidence (e.g. contrast ratio, color difference). */
  evidence?: Record<string, unknown>;
  /** Available auto-fixes (empty when no automatic fix exists). */
  fixes: LinterFix[];
  /** True when the issue can be dismissed/suppressed. */
  dismissable: boolean;
  /** Version string — increment when rule logic changes meaningfully. */
  version: string;
  /** Performance cost hint for the scan scheduler. */
  cost?: 'cheap' | 'moderate' | 'expensive';
  /** Scope this rule operates in. */
  scope: LinterScope;
  /** Confidence in the finding (0-1). */
  confidence?: number;
}

export type LinterIssueGroup = Record<string, LinterIssue[]>;

/** Aggregated report from a linter scan. */
export interface LinterReport {
  issues: LinterIssue[];
  byRuleId: LinterIssueGroup;
  byCategory: LinterIssueGroup;
  bySeverity: LinterIssueGroup;
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
  totalSuggestions: number;
  scanDurationMs: number;
  /** Monotonic scan counter (for stale-state detection). */
  scanId: number;
}

/**
 * Persisted linter configuration stored on the Document.
 * Distinguishes global default values from project-specific overrides.
 */
export interface LinterConfig {
  /** Schema version for migration. */
  version: string;
  /** Rules that are explicitly enabled (empty = all enabled by default). */
  enabledRules?: string[];
  /** Rules that are explicitly disabled. */
  disabledRules?: string[];
  /** Per-rule severity overrides keyed by ruleId. */
  severityOverrides?: Record<string, LinterSeverity>;
  /** Node types to skip during scanning (e.g. ["path", "line"]). */
  ignoredNodeTypes?: string[];
  /** Explicitly suppressed finding keys (ruleId + nodeId combinations). */
  suppressedFindings?: string[];
  /** Minimum touch-target width in CSS px. Default 44. */
  touchTargetMinWidth?: number;
  /** Minimum touch-target height in CSS px. Default 44. */
  touchTargetMinHeight?: number;
  /** Optional minimum spacing between adjacent interactive targets (px). */
  touchTargetMinSpacing?: number;
  /** Non-text contrast threshold (3:1 per WCAG 2.1 SC 1.4.11). */
  nonTextContrastThreshold?: number;
  /** Source of each value for UI display. */
  origin?: {
    touchTargetMinWidth?: 'default' | 'global' | 'project';
    touchTargetMinHeight?: 'default' | 'global' | 'project';
    touchTargetMinSpacing?: 'default' | 'global' | 'project';
    nonTextContrastThreshold?: 'default' | 'global' | 'project';
  };
}

/** Standards-based defaults for linter configuration. */
export const DEFAULT_LINTER_CONFIG: LinterConfig = {
  version: '1',
  touchTargetMinWidth: 44,
  touchTargetMinHeight: 44,
  touchTargetMinSpacing: 8,
  nonTextContrastThreshold: 3,
  origin: {
    touchTargetMinWidth: 'default',
    touchTargetMinHeight: 'default',
    touchTargetMinSpacing: 'default',
    nonTextContrastThreshold: 'default',
  },
};

export function createDefaultLinterConfig(): LinterConfig {
  return { ...DEFAULT_LINTER_CONFIG, version: '1' };
}

/** Options passed to every rule during scanning. */
export interface LinterOptions {
  /** Color difference threshold for perceptual matching (ΔEOK). Default 2.3. */
  colorTolerance?: number;
  /** Minimum touch-target size in CSS px. Default 44. */
  touchTargetMinSize?: number;
  /** Font families available in the environment. */
  availableFonts?: Set<string>;
  /** Whether to run prototype-scoped rules. */
  checkPrototype?: boolean;
  /** Node IDs to restrict scanning to (selection-scoped). */
  scopeIds?: NodeId[];
  /** Page ID to restrict scanning to (page-scoped). */
  pageId?: string;
  /** Current camera viewport for off-canvas checks. */
  viewport?: { x: number; y: number; w: number; h: number };
  /** Non-text contrast threshold (WCAG 2.1 SC 1.4.11). Default 3. */
  nonTextContrastThreshold?: number;
}

export function buildReport(
  issues: LinterIssue[],
  scanId: number,
  scanDurationMs: number,
): LinterReport {
  const byRuleId: LinterIssueGroup = {};
  const byCategory: LinterIssueGroup = {};
  const bySeverity: LinterIssueGroup = {};

  for (const issue of issues) {
    const ruleBucket = byRuleId[issue.ruleId];
    if (ruleBucket) {
      ruleBucket.push(issue);
    } else {
      byRuleId[issue.ruleId] = [issue];
    }
    const categoryBucket = byCategory[issue.category];
    if (categoryBucket) {
      categoryBucket.push(issue);
    } else {
      byCategory[issue.category] = [issue];
    }
    const severityBucket = bySeverity[issue.severity];
    if (severityBucket) {
      severityBucket.push(issue);
    } else {
      bySeverity[issue.severity] = [issue];
    }
  }

  return {
    issues,
    byRuleId,
    byCategory,
    bySeverity,
    totalErrors: issues.filter((i) => i.severity === 'error').length,
    totalWarnings: issues.filter((i) => i.severity === 'warning').length,
    totalInfo: issues.filter((i) => i.severity === 'info').length,
    totalSuggestions: issues.filter((i) => i.severity === 'suggestion').length,
    scanDurationMs,
    scanId,
  };
}
