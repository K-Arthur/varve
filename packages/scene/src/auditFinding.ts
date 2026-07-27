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

import type { WorkspaceMode } from '@strata/shared';
import type { FindingFingerprint } from './fingerprint';
import { hash128 } from './fingerprint';
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

/**
 * Which workspace modes this finding applies to. Empty = all workspaces.
 * Canonical definition lives in @strata/shared (the lowest layer both scene
 * and editor depend on) — re-exported here so existing `from './auditFinding'`
 * imports keep working. Do not redeclare this locally; it drifted out of sync
 * with editor's copy once before (missing 'codegen') and caused real
 * cross-package typecheck failures.
 */
export type { WorkspaceMode };

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
 * Canonical audit finding — the single type consumed by all UI surfaces.
 *
 * Every field is optional except ruleId, severity, category, message, and source.
 * The model is designed to be serializable (no functions) so findings can be
 * cached, compared, and stored.
 */
/**
 * Canonical audit finding — the single type consumed by all UI surfaces.
 *
 * Every field is optional except ruleId, severity, category, message, and source.
 * The model is designed to be serializable (no functions) so findings can be
 * cached, compared, and stored.
 *
 * Lifecycle notes:
 * - `findingId` is deterministic (ruleId + nodeId hash) so findings survive rescans.
 * - `stale` = true when document was modified after scan.
 * - `resolved` = true when the issue no longer exists in current document.
 * - `scanId` links findings to a particular scan run for staleness tracking.
 *
 * This type unifies what was previously two incompatible AuditFinding models
 * (one in @strata/scene and one in @strata/shared). Convert between them with
 * `sceneFindingToShared()` / `sharedFindingToScene()` from @strata/shared.
 */
export interface AuditFinding {
  /** Stable rule identifier (e.g. 'contrast/aa-fail', 'print/missing-bleed'). */
  ruleId: string;
  /** Rule schema version — bump when rule semantics change. */
  ruleVersion: number;
  /**
   * Stable fingerprint that survives re-scans, sessions, and doc reloads.
   * See fingerprint.ts for computation details.
   */
  fingerprint: FindingFingerprint;
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
  /** Affected node(s) — primary node for single-node findings. */
  nodeId?: NodeId;
  /** All affected nodes (may be empty for document-level findings). */
  nodeIds?: NodeId[];
  /** Affected page. */
  pageId?: string;
  /** Optional region on canvas (document-space coordinates). */
  region?: { x: number; y: number; w: number; h: number; pageId?: string };
  /** Optional interaction ID (prototype findings). */
  interactionId?: string;
  /** Optional component/style/variable name (governance findings). */
  targetName?: string;
  /** Machine-readable evidence (contrast ratio, DPI, anchor count, etc.). */
  evidence?: Record<string, unknown>;
  /** Reference to relevant standard (e.g. "WCAG 2.1 SC 1.4.3"). */
  standardReference?: string;
  /** URL to documentation about this issue. */
  documentationUrl?: string;
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
  /** Editor sub-modes where this finding is relevant. Empty = all. */
  applicableModes?: string[];
  /** Whether this finding blocks export/publishing. */
  blocking: boolean;
  /** Inspector section to open when navigating to this finding (e.g. 'fills', 'typography', 'layout'). */
  inspectorSection?: string;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  /** The document revision when this finding was generated. */
  revision?: number;
  /** Timestamp when this finding was generated (epoch ms). */
  generatedAt: number;
  /** Whether this finding is stale (document has changed since generation). */
  stale?: boolean;
  /** Whether this finding is resolved (issue no longer exists). */
  resolved?: boolean;
  /** Scan ID that produced this finding (for staleness detection). */
  scanId?: number;

  // ── Suppression ──────────────────────────────────────────────────────────
  /** Whether this finding can be suppressed by the user. */
  suppressionEligible?: boolean;
  /** Suppression scope. */
  suppressionScope?: 'finding' | 'node' | 'rule' | 'document';
  /** Suppression record if suppressed. */
  suppression?: {
    id: string;
    reason?: string;
    suppressedAt: number;
    expiresAt?: number;
    active: boolean;
  };

  // ── Forward-compat ───────────────────────────────────────────────────────
  /** Extra metadata not covered by other fields. Must be serializable. */
  metadata?: Record<string, unknown>;
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

/** Compute a basic fallback fingerprint from ruleId + nodeId. */
function fallbackFingerprint(ruleId: string, nodeId?: NodeId): FindingFingerprint {
  return hash128(`${ruleId}\0${nodeId ?? ''}`) as FindingFingerprint;
}

/** Create a canonical AuditFinding with sensible defaults. */
export function createFinding(params: {
  ruleId: string;
  category: FindingCategory;
  severity: AuditSeverity;
  message: string;
  nodeId?: NodeId;
  nodeIds?: NodeId[];
  pageId?: string;
  region?: { x: number; y: number; w: number; h: number; pageId?: string };
  interactionId?: string;
  targetName?: string;
  detail?: string;
  evidence?: Record<string, unknown>;
  standardReference?: string;
  documentationUrl?: string;
  recommendation?: string;
  autoFixAvailable?: boolean;
  fixes?: FindingFix[];
  source?: FindingSource;
  cost?: FindingCost;
  contextDependent?: boolean;
  workspaceApplicable?: WorkspaceMode[];
  applicableModes?: string[];
  blocking?: boolean;
  inspectorSection?: string;
  confidence?: number;
  revision?: number;
  ruleVersion?: number;
  fingerprint?: FindingFingerprint;
  stale?: boolean;
  resolved?: boolean;
  scanId?: number;
  suppressionEligible?: boolean;
  suppressionScope?: 'finding' | 'node' | 'rule' | 'document';
  suppression?: {
    id: string;
    reason?: string;
    suppressedAt: number;
    expiresAt?: number;
    active: boolean;
  };
  metadata?: Record<string, unknown>;
}): AuditFinding {
  return {
    ruleId: params.ruleId,
    ruleVersion: params.ruleVersion ?? 1,
    fingerprint: params.fingerprint ?? fallbackFingerprint(params.ruleId, params.nodeId),
    findingId: findingHash(params.ruleId, params.nodeId),
    category: params.category,
    severity: params.severity,
    confidence: params.confidence ?? 1.0,
    message: params.message,
    detail: params.detail,
    nodeId: params.nodeId,
    nodeIds: params.nodeIds ?? (params.nodeId ? [params.nodeId] : undefined),
    pageId: params.pageId,
    region: params.region,
    interactionId: params.interactionId,
    targetName: params.targetName,
    evidence: params.evidence,
    standardReference: params.standardReference,
    documentationUrl: params.documentationUrl,
    recommendation: params.recommendation,
    autoFixAvailable: params.autoFixAvailable ?? false,
    fixes: params.fixes,
    source: params.source ?? 'manual',
    cost: params.cost ?? 'cheap',
    contextDependent: params.contextDependent ?? false,
    workspaceApplicable: params.workspaceApplicable ?? [],
    applicableModes: params.applicableModes,
    blocking: params.blocking ?? false,
    inspectorSection: params.inspectorSection,
    revision: params.revision,
    generatedAt: Date.now(),
    stale: params.stale,
    resolved: params.resolved,
    scanId: params.scanId,
    suppressionEligible: params.suppressionEligible,
    suppressionScope: params.suppressionScope,
    suppression: params.suppression,
    metadata: params.metadata,
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
