/**
 * Unified Audit Finding Model — single typed finding across all audit surfaces.
 *
 * Every audit source (debt scanner, linter, WCAG contrast, print preflight,
 * vector/raster audit, governance rules, codegen) converts its findings into
 * this canonical type. The editor UI consumes only AuditFinding.
 *
 * Design decisions:
 * - findingId is stable and deterministic (ruleId + nodeId hash) so findings
 *   survive reruns, navigation, suppression, and tests.
 * - confidence (0-1) is always numeric for programmatic filtering.
 * - severity has 4 levels: error (blocks output), warning (degraded),
 *   suggestion (objective improvement), advisory (subjective).
 * - workspaceApplicable controls which workspaces surface the finding.
 * - contextDependent marks findings that should not interrupt active editing.
 *
 * Research basis: WCAG 2.1 §1.4.3, §1.4.11; ISO 12647-2 (print preflight);
 * Sutherland-Hodgman (vector audit); RFC 9110 (HTTP status semantics for
 * severity mapping).
 */

import type { NodeId } from './types';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Severity of an audit finding — 4-level, consistent across all sources. */
export type AuditSeverity = 'error' | 'warning' | 'suggestion' | 'advisory';

/** High-level category for grouping in panel and overlay filtering. */
export type FindingCategory =
  | 'color'
  | 'typography'
  | 'layout'
  | 'accessibility'
  | 'vector'
  | 'raster'
  | 'effects'
  | 'layer-hygiene'
  | 'touch-target'
  | 'focus-order'
  | 'palette'
  | 'prototype'
  | 'governance'
  | 'performance'
  | 'print'
  | 'codegen'
  | 'export'
  | 'spacing'
  | 'structure';

/** Which workspace modes this finding applies to. Empty = all workspaces. */
export type WorkspaceMode = 'design' | 'print' | 'drawing' | 'image' | 'motion';

/** Performance cost hint for the scan scheduler. */
export type FindingCost = 'cheap' | 'moderate' | 'expensive';

/** The audit source that produced this finding. */
export type FindingSource =
  | 'debt-scanner'
  | 'linter'
  | 'wcag-contrast'
  | 'governance'
  | 'print-preflight'
  | 'typography-preflight'
  | 'vector-audit'
  | 'raster-audit'
  | 'layout-score'
  | 'codegen'
  | 'prototype'
  | 'spacing-harmonizer'
  | 'manual';

/** A fix that can be applied to resolve a finding. */
export interface FindingFix {
  /** Machine-readable fix ID. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Whether the fix has been verified safe for batch application. */
  safeForBatch?: boolean;
}

/**
 * Suppression entry — persisted per-document to hide intentional exceptions.
 * Suppressions match by findingId (exact), or by ruleId + optional nodeId
 * (pattern), or by ruleId alone (wildcard nodeId='*').
 */
export interface SuppressionEntry {
  /** Finding ID or pattern to suppress. */
  findingId: string;
  /** Optional rule-level pattern (suppresses all findings for this rule). */
  ruleId?: string;
  /** Optional node-level pattern. '*' means all nodes. */
  nodeId?: NodeId | '*';
  /** User-provided reason (optional). */
  reason?: string;
  /** Timestamp when suppression was created. */
  createdAt: number;
  /** Optional expiry timestamp. */
  expiresAt?: number;
}

/**
 * Canonical audit finding — the single type consumed by all UI surfaces.
 *
 * Every field is optional except ruleId, severity, category, message, and source.
 * The model is designed to be serializable (no functions) so findings can be
 * cached, compared, and stored.
 */
export interface AuditFinding {
  /** Stable rule identifier (e.g. 'contrast/aa-fail', 'print/missing-bleed'). */
  ruleId: string;
  /** Deterministic finding ID (hash of ruleId + nodeId). */
  findingId: string;
  /** High-level category for panel grouping and filtering. */
  category: FindingCategory;
  /** 4-level severity. */
  severity: AuditSeverity;
  /** Confidence in the finding (0-1). 1.0 = certain. */
  confidence: number;
  /** One-line user-facing explanation. */
  message: string;
  /** Longer explanation for detail views. */
  detail?: string;
  /** Affected node (undefined for document-level findings). */
  nodeId?: NodeId;
  /** Affected page. */
  pageId?: string;
  /** Machine-readable evidence (contrast ratio, DPI, anchor count, etc.). */
  evidence?: Record<string, unknown>;
  /** Recommended action text. */
  recommendation?: string;
  /** Whether an automatic fix is available. */
  autoFixAvailable: boolean;
  /** Available fixes (may be empty even when autoFixAvailable is true). */
  fixes?: FindingFix[];
  /** The audit source that produced this finding. */
  source: FindingSource;
  /** Performance cost for scan scheduling. */
  cost: FindingCost;
  /** Whether this finding is context-dependent (should not interrupt editing). */
  contextDependent: boolean;
  /** Which workspaces this finding applies to. Empty = all. */
  workspaceApplicable: WorkspaceMode[];
  /** Whether this finding blocks export/publishing. */
  blocking: boolean;
  /** The document revision when this finding was generated. */
  revision?: number;
  /** Timestamp when this finding was generated. */
  generatedAt: number;
}

/**
 * Aggregated summary of audit findings for status display and filtering.
 */
export interface AuditSummary {
  totalFindings: number;
  totalErrors: number;
  totalWarnings: number;
  totalSuggestions: number;
  totalAdvisories: number;
  byCategory: Record<string, AuditFinding[]>;
  bySeverity: Record<string, AuditFinding[]>;
  bySource: Record<string, AuditFinding[]>;
  hasErrors: boolean;
  hasBlocking: boolean;
  highestSeverity: AuditSeverity | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Simple FNV-1a-inspired hash for generating stable finding IDs.
 * Uses only the ruleId + nodeId (or '' for document-level) as input.
 */
function findingHash(ruleId: string, nodeId?: NodeId): string {
  const input = `${ruleId}::${nodeId ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Create a canonical AuditFinding with sensible defaults. */
export function createFinding(params: {
  ruleId: string;
  category: FindingCategory;
  severity: AuditSeverity;
  message: string;
  nodeId?: NodeId;
  pageId?: string;
  detail?: string;
  evidence?: Record<string, unknown>;
  recommendation?: string;
  autoFixAvailable?: boolean;
  fixes?: FindingFix[];
  source?: FindingSource;
  cost?: FindingCost;
  contextDependent?: boolean;
  workspaceApplicable?: WorkspaceMode[];
  blocking?: boolean;
  confidence?: number;
  revision?: number;
}): AuditFinding {
  return {
    ruleId: params.ruleId,
    findingId: findingHash(params.ruleId, params.nodeId),
    category: params.category,
    severity: params.severity,
    confidence: params.confidence ?? 1.0,
    message: params.message,
    detail: params.detail,
    nodeId: params.nodeId,
    pageId: params.pageId,
    evidence: params.evidence,
    recommendation: params.recommendation,
    autoFixAvailable: params.autoFixAvailable ?? false,
    fixes: params.fixes,
    source: params.source ?? 'manual',
    cost: params.cost ?? 'cheap',
    contextDependent: params.contextDependent ?? false,
    workspaceApplicable: params.workspaceApplicable ?? [],
    blocking: params.blocking ?? false,
    revision: params.revision,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Summary aggregation
// ---------------------------------------------------------------------------

/** Build an AuditSummary from a list of findings. */
export function buildAuditSummary(findings: AuditFinding[]): AuditSummary {
  const byCategory: Record<string, AuditFinding[]> = {};
  const bySeverity: Record<string, AuditFinding[]> = {};
  const bySource: Record<string, AuditFinding[]> = {};

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalSuggestions = 0;
  let totalAdvisories = 0;

  const severityOrder: AuditSeverity[] = ['error', 'warning', 'suggestion', 'advisory'];
  let highestIdx = -1;

  for (const f of findings) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category]!.push(f);
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity]!.push(f);
    if (!bySource[f.source]) bySource[f.source] = [];
    bySource[f.source]!.push(f);

    switch (f.severity) {
      case 'error':
        totalErrors++;
        break;
      case 'warning':
        totalWarnings++;
        break;
      case 'suggestion':
        totalSuggestions++;
        break;
      case 'advisory':
        totalAdvisories++;
        break;
    }

    const idx = severityOrder.indexOf(f.severity);
    if (idx > highestIdx) highestIdx = idx;
  }

  return {
    totalFindings: findings.length,
    totalErrors,
    totalWarnings,
    totalSuggestions,
    totalAdvisories,
    byCategory,
    bySeverity,
    bySource,
    hasErrors: totalErrors > 0,
    hasBlocking: findings.some((f) => f.blocking && f.severity === 'error'),
    highestSeverity: highestIdx >= 0 ? severityOrder[highestIdx] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Suppression matching
// ---------------------------------------------------------------------------

/**
 * Check whether a finding is suppressed by any of the given suppression entries.
 * Matching rules:
 *   1. Exact findingId match
 *   2. ruleId + nodeId match (nodeId='*' matches all)
 *   3. ruleId-only match (no nodeId in suppression entry)
 */
export function isSuppressed(
  finding: AuditFinding,
  suppressions: SuppressionEntry[],
  now: number = Date.now(),
): boolean {
  for (const s of suppressions) {
    if (s.expiresAt && s.expiresAt < now) continue;

    if (s.findingId === finding.findingId) return true;

    if (s.ruleId === finding.ruleId) {
      if (!s.nodeId) return true;
      if (s.nodeId === '*') return true;
      if (finding.nodeId && s.nodeId === finding.nodeId) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Legacy type converters
// ---------------------------------------------------------------------------

/** Convert a legacy AuditIssue (scene/intelligence/audit.ts) to AuditFinding. */
export function legacyAuditToFinding(issue: {
  nodeId: NodeId;
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}): AuditFinding {
  const sev: AuditSeverity = issue.severity === 'info' ? 'advisory' : issue.severity;
  return createFinding({
    ruleId: issue.type,
    category: 'color',
    severity: sev,
    message: issue.message,
    nodeId: issue.nodeId,
    source: 'wcag-contrast',
    cost: 'moderate',
    contextDependent: true,
    workspaceApplicable: [],
    confidence: 0.9,
  });
}

/** Convert a legacy DebtIssue (scene/intelligence/debtScanner.ts) to AuditFinding. */
export function legacyDebtToFinding(issue: {
  checkId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
  fixable: boolean;
}): AuditFinding {
  const sev: AuditSeverity = issue.severity === 'info' ? 'advisory' : issue.severity;

  const categoryMap: Record<string, FindingCategory> = {
    'untokenized-colors': 'color',
    'inline-spacing': 'spacing',
    'naming-violations': 'governance',
    'orphan-styles': 'governance',
    'unused-components': 'governance',
    'missing-fonts': 'typography',
    'duplicate-styles': 'governance',
    'inconsistent-radius': 'layout',
    'hardcoded-font-sizes': 'typography',
    'mixed-color-spaces': 'color',
    'low-contrast': 'accessibility',
    'overset-text': 'typography',
    'unnamed-layers': 'layer-hygiene',
    'excessive-nesting': 'structure',
    'missing-export-presets': 'export',
  };

  return createFinding({
    ruleId: issue.checkId,
    category: categoryMap[issue.checkId] ?? 'governance',
    severity: sev,
    message: issue.message,
    nodeId: issue.nodeId,
    autoFixAvailable: issue.fixable,
    source: 'debt-scanner',
    cost: 'cheap',
    contextDependent: true,
    workspaceApplicable: [],
  });
}

/** Convert a legacy GovernanceIssue (scene/intelligence/governanceRules.ts) to AuditFinding. */
export function legacyGovernanceToFinding(issue: {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: NodeId;
}): AuditFinding {
  const sev: AuditSeverity = issue.severity === 'info' ? 'advisory' : issue.severity;

  const categoryMap: Record<string, FindingCategory> = {
    'token-color': 'color',
    'spacing-token': 'spacing',
    naming: 'governance',
    orphan: 'governance',
    font: 'typography',
  };

  return createFinding({
    ruleId: issue.ruleId,
    category: categoryMap[issue.ruleId] ?? 'governance',
    severity: sev,
    message: issue.message,
    nodeId: issue.nodeId,
    source: 'governance',
    cost: 'cheap',
    contextDependent: true,
    workspaceApplicable: [],
  });
}

/** Convert a legacy LinterIssue (scene/intelligence/linterTypes.ts) to AuditFinding. */
export function legacyLinterToFinding(issue: {
  ruleId: string;
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  category: string;
  nodeIds: NodeId[];
  message: string;
  confidence?: number;
}): AuditFinding {
  const sev: AuditSeverity = issue.severity === 'info' ? 'advisory' : issue.severity;

  const categoryMap: Record<string, FindingCategory> = {
    color: 'color',
    typography: 'typography',
    effects: 'effects',
    'layer-hygiene': 'layer-hygiene',
    'touch-target': 'touch-target',
    'focus-order': 'focus-order',
    palette: 'palette',
    prototype: 'prototype',
    governance: 'governance',
    performance: 'performance',
  };

  return createFinding({
    ruleId: issue.ruleId,
    category: (categoryMap[issue.category] as FindingCategory) ?? 'layer-hygiene',
    severity: sev,
    message: issue.message,
    nodeId: issue.nodeIds?.[0],
    confidence: issue.confidence ?? 1.0,
    source: 'linter',
    cost: 'moderate',
    contextDependent: false,
    workspaceApplicable: [],
  });
}

/** Convert a unified AuditFinding back to a simplified legacy-compatible shape. */
export function auditFindingToLegacy(finding: AuditFinding): {
  findingId: string;
  ruleId: string;
  severity: AuditSeverity;
  message: string;
  category: FindingCategory;
  source: FindingSource;
} {
  return {
    findingId: finding.findingId,
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    category: finding.category,
    source: finding.source,
  };
}
