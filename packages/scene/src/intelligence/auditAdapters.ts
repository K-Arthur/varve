/**
 * Audit Adapters
 *
 * Adapters for converting legacy audit findings to the unified AuditFinding format.
 * Supports Scene Intelligence, Debt Scanner, Governance Rules, and Design Linter.
 *
 * @module auditAdapters
 */

import type {
  AuditCategory,
  AuditFinding,
  AuditSeverity,
  AuditScope as UnifiedAuditScope,
} from '@strata/shared';
import { generateFindingId, mapLegacySeverity } from '@strata/shared';
import type { AuditIssue as SceneAuditIssue } from './audit';
import type { DebtIssue } from './debtScanner';
import type { GovernanceIssue } from './governanceRules';
import type {
  LinterCategory as LinterCategoryType,
  LinterFix,
  LinterIssue,
  LinterScope as LinterScopeType,
  LinterSeverity,
} from './linterTypes';

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Adapter for converting legacy findings to unified findings.
 */
export interface AuditAdapter<T> {
  /** Convert from legacy finding to unified finding. */
  toUnified(legacy: T, doc: unknown, scanId: number): AuditFinding | null;

  /** Convert from unified finding back to legacy format (if needed). */
  fromLegacy?(unified: AuditFinding): T;
}

// ============================================================================
// Scene Intelligence Adapter
// ============================================================================

/**
 * Adapter for Scene Intelligence Audit findings.
 */
export const sceneIntelligenceAdapter: AuditAdapter<SceneAuditIssue> = {
  toUnified(legacy, doc, scanId) {
    const document = doc as { revision?: number };
    const documentRevision = document.revision || 0;

    const severity = mapLegacySeverity(legacy.severity);
    const category = mapSceneAuditCategory(legacy.type);
    const cost = 'cheap';
    const scope: UnifiedAuditScope = 'document';

    const findingId = generateFindingId(`contrast/${legacy.type}/v1`, legacy.nodeId, {});

    const fixCapability = legacy.autoFix ? 'automatic' : 'none';
    const fixes = legacy.autoFix
      ? [
          {
            id: 'auto-fix',
            label: 'Auto-fix',
            description: 'Automatically fix this issue',
            apply: legacy.autoFix as (doc: unknown) => unknown,
            changesSelection: false,
            previewable: true,
          },
        ]
      : [];

    return {
      findingId,
      ruleId: `contrast/${legacy.type}/v1`,
      ruleVersion: 'v1',
      severity,
      category,
      confidence: 1.0,
      nodeIds: [legacy.nodeId],
      message: legacy.message,
      fixCapability,
      fixes,
      applicableWorkspaces: [],
      applicableModes: [],
      applicableNodeKinds: ['text'],
      documentRevision,
      timestamp: Date.now(),
      stale: false,
      resolved: false,
      suppressionEligible: severity !== 'error',
      suppressionScope: 'finding',
      cost,
      scope,
      scanId,
    };
  },
};

function mapSceneAuditCategory(type: string): AuditCategory {
  if (type.includes('contrast')) return 'contrast';
  if (type.includes('accessibility')) return 'accessibility';
  return 'accessibility';
}

// ============================================================================
// Debt Scanner Adapter
// ============================================================================

export const debtScannerAdapter: AuditAdapter<DebtIssue> = {
  toUnified(legacy, doc, scanId) {
    const document = doc as { revision?: number };
    const documentRevision = document.revision || 0;

    const severity = mapLegacySeverity(legacy.severity);
    const category = mapDebtCategory(legacy.checkId);
    const cost = 'cheap';
    const scope: UnifiedAuditScope = 'document';

    const findingId = generateFindingId(
      `debt/${legacy.checkId}/v1`,
      legacy.nodeId || 'document',
      {},
    );

    const fixCapability = legacy.fixable ? 'automatic' : 'none';
    const fixes = legacy.autoFix
      ? [
          {
            id: 'auto-fix',
            label: 'Auto-fix',
            description: 'Automatically fix this issue',
            apply: legacy.autoFix as (doc: unknown) => unknown,
            changesSelection: false,
            previewable: true,
          },
        ]
      : [];

    return {
      findingId,
      ruleId: `debt/${legacy.checkId}/v1`,
      ruleVersion: 'v1',
      severity,
      category,
      confidence: 1.0,
      nodeIds: legacy.nodeId ? [legacy.nodeId] : [],
      message: legacy.message,
      fixCapability,
      fixes,
      applicableWorkspaces: [],
      applicableModes: [],
      applicableNodeKinds: [],
      documentRevision,
      timestamp: Date.now(),
      stale: false,
      resolved: false,
      suppressionEligible: severity !== 'error',
      suppressionScope: 'finding',
      cost,
      scope,
      scanId,
    };
  },
};

function mapDebtCategory(checkId: string): AuditCategory {
  if (checkId.includes('color')) return 'color';
  if (checkId.includes('spacing')) return 'spacing';
  if (checkId.includes('naming')) return 'governance';
  if (checkId.includes('font')) return 'typography';
  if (checkId.includes('style')) return 'governance';
  if (checkId.includes('component')) return 'governance';
  if (checkId.includes('contrast')) return 'contrast';
  if (checkId.includes('text')) return 'typography';
  if (checkId.includes('layer')) return 'layer-hygiene';
  if (checkId.includes('nesting')) return 'layout';
  if (checkId.includes('export')) return 'codegen';
  return 'governance';
}

// ============================================================================
// Governance Rules Adapter
// ============================================================================

export const governanceRulesAdapter: AuditAdapter<GovernanceIssue> = {
  toUnified(legacy, doc, scanId) {
    const document = doc as { revision?: number };
    const documentRevision = document.revision || 0;

    const severity = mapLegacySeverity(legacy.severity);
    const category = mapGovernanceCategory(legacy.ruleId);
    const cost = 'cheap';
    const scope: UnifiedAuditScope = 'document';

    const findingId = generateFindingId(
      `governance/${legacy.ruleId}/v1`,
      legacy.nodeId || 'document',
      {},
    );

    const fixCapability = legacy.autoFix ? 'automatic' : 'none';
    const fixes = legacy.autoFix
      ? [
          {
            id: 'auto-fix',
            label: 'Auto-fix',
            description: 'Automatically fix this issue',
            apply: legacy.autoFix as (doc: unknown) => unknown,
            changesSelection: false,
            previewable: true,
          },
        ]
      : [];

    return {
      findingId,
      ruleId: `governance/${legacy.ruleId}/v1`,
      ruleVersion: 'v1',
      severity,
      category,
      confidence: 1.0,
      nodeIds: legacy.nodeId ? [legacy.nodeId] : [],
      message: legacy.message,
      targetName: legacy.targetName,
      fixCapability,
      fixes,
      applicableWorkspaces: [],
      applicableModes: [],
      applicableNodeKinds: [],
      documentRevision,
      timestamp: Date.now(),
      stale: false,
      resolved: false,
      suppressionEligible: severity !== 'error',
      suppressionScope: 'finding',
      cost,
      scope,
      scanId,
    };
  },
};

function mapGovernanceCategory(ruleId: string): AuditCategory {
  if (ruleId.includes('color')) return 'color';
  if (ruleId.includes('spacing')) return 'spacing';
  if (ruleId.includes('naming')) return 'governance';
  if (ruleId.includes('orphan')) return 'governance';
  if (ruleId.includes('font')) return 'typography';
  return 'governance';
}

// ============================================================================
// Design Linter Adapter
// ============================================================================

export const linterScannerAdapter: AuditAdapter<LinterIssue> = {
  toUnified(legacy, doc, scanId) {
    const document = doc as { revision?: number };
    const documentRevision = document.revision || 0;

    const severity = mapLinterSeverity(legacy.severity);
    const category = mapLinterCategory(legacy.category);
    const scope = mapLinterScope(legacy.scope);
    const cost = legacy.cost === 'expensive' ? 'expensive' : 'cheap';

    const findingId = generateFindingId(
      `linter/${legacy.ruleId}/v1`,
      legacy.nodeIds[0] || 'document',
      {},
    );

    const fixCapability = legacy.fixes.length > 0 ? 'automatic' : 'none';
    const fixes = legacy.fixes.map((fix: LinterFix) => ({
      id: fix.id,
      label: fix.label,
      apply: fix.apply as (doc: unknown) => unknown,
      changesSelection: false,
      previewable: true,
    }));

    return {
      findingId,
      ruleId: `linter/${legacy.ruleId}/v1`,
      ruleVersion: 'v1',
      severity,
      category,
      confidence: legacy.confidence || 1.0,
      nodeIds: legacy.nodeIds,
      message: legacy.message,
      detail: legacy.detail,
      evidence: legacy.evidence,
      fixCapability,
      fixes,
      applicableWorkspaces: [],
      applicableModes: [],
      applicableNodeKinds: [],
      documentRevision,
      timestamp: Date.now(),
      stale: false,
      resolved: false,
      suppressionEligible: legacy.dismissable && severity !== 'error',
      suppressionScope: 'finding',
      cost,
      scope,
      scanId,
    };
  },
};

function mapLinterSeverity(severity: LinterSeverity): AuditSeverity {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'suggestion';
    case 'suggestion':
      return 'advisory';
    default:
      return 'suggestion';
  }
}

function mapLinterCategory(category: LinterCategoryType): AuditCategory {
  switch (category) {
    case 'layer-hygiene':
      return 'layer-hygiene';
    case 'touch-target':
      return 'touch-target';
    case 'focus-order':
      return 'focus-order';
    case 'color':
      return 'color';
    case 'typography':
      return 'typography';
    case 'palette':
      return 'color';
    case 'prototype':
      return 'prototype';
    case 'governance':
      return 'governance';
    case 'performance':
      return 'performance';
    case 'effects':
      return 'accessibility';
    default:
      return 'accessibility';
  }
}

function mapLinterScope(scope: LinterScopeType): UnifiedAuditScope {
  switch (scope) {
    case 'document':
      return 'document';
    case 'page':
      return 'page';
    case 'selection':
      return 'selection';
    default:
      return 'document';
  }
}

// ============================================================================
// Batch Adapter
// ============================================================================

export function adaptFindings<T>(
  legacyFindings: T[],
  adapter: AuditAdapter<T>,
  doc: unknown,
  scanId: number,
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const legacy of legacyFindings) {
    const unified = adapter.toUnified(legacy, doc, scanId);
    if (unified) {
      findings.push(unified);
    }
  }

  return findings;
}

export function adaptAllFindings(
  findings: {
    scene?: SceneAuditIssue[];
    debt?: DebtIssue[];
    governance?: GovernanceIssue[];
    linter?: LinterIssue[];
  },
  doc: unknown,
  scanId: number,
): AuditFinding[] {
  const unifiedFindings: AuditFinding[] = [];

  if (findings.scene) {
    unifiedFindings.push(...adaptFindings(findings.scene, sceneIntelligenceAdapter, doc, scanId));
  }

  if (findings.debt) {
    unifiedFindings.push(...adaptFindings(findings.debt, debtScannerAdapter, doc, scanId));
  }

  if (findings.governance) {
    unifiedFindings.push(
      ...adaptFindings(findings.governance, governanceRulesAdapter, doc, scanId),
    );
  }

  if (findings.linter) {
    unifiedFindings.push(...adaptFindings(findings.linter, linterScannerAdapter, doc, scanId));
  }

  return unifiedFindings;
}
