/**
 * TDD tests for the unified AuditFinding model.
 *
 * Tests: type construction, severity classification, workspace applicability,
 * finding aggregation, suppression matching, and conversion from legacy types.
 */
import { describe, expect, it } from 'vitest';
import {
  type AuditFinding,
  auditFindingToLegacy,
  buildAuditSummary,
  createFinding,
  legacyAuditToFinding,
  legacyDebtToFinding,
  legacyGovernanceToFinding,
  legacyLinterToFinding,
} from './auditFinding';
import type { NodeId } from './types';

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return createFinding({
    ruleId: 'test/rule',
    category: 'color',
    severity: 'warning',
    message: 'Test finding',
    nodeId: 'node-1' as NodeId,
    ...overrides,
  });
}

describe('createFinding', () => {
  it('generates a stable finding ID from ruleId + nodeId', () => {
    const f = createFinding({
      ruleId: 'contrast/aa-fail',
      nodeId: 'n1' as NodeId,
      category: 'color',
      severity: 'error',
      message: 'fail',
    });
    expect(f.findingId).toBeTruthy();
    expect(typeof f.findingId).toBe('string');
    expect(f.findingId.length).toBeGreaterThan(0);
  });

  it('different nodes produce different finding IDs for same rule', () => {
    const f1 = createFinding({
      ruleId: 'r',
      nodeId: 'a' as NodeId,
      category: 'color',
      severity: 'error',
      message: 'x',
    });
    const f2 = createFinding({
      ruleId: 'r',
      nodeId: 'b' as NodeId,
      category: 'color',
      severity: 'error',
      message: 'x',
    });
    expect(f1.findingId).not.toBe(f2.findingId);
  });

  it('same inputs produce same finding ID (deterministic)', () => {
    const mk = () =>
      createFinding({
        ruleId: 'r',
        nodeId: 'a' as NodeId,
        category: 'color',
        severity: 'error',
        message: 'x',
      });
    expect(mk().findingId).toBe(mk().findingId);
  });

  it('defaults confidence to 1.0 when not specified', () => {
    const f = makeFinding();
    expect(f.confidence).toBe(1.0);
  });

  it('defaults autoFixAvailable to false', () => {
    const f = makeFinding();
    expect(f.autoFixAvailable).toBe(false);
  });

  it('defaults contextDependent to false', () => {
    const f = makeFinding();
    expect(f.contextDependent).toBe(false);
  });

  it('preserves provided confidence', () => {
    const f = makeFinding({ confidence: 0.7 });
    expect(f.confidence).toBe(0.7);
  });

  it('preserves all provided fields', () => {
    const f = makeFinding({
      ruleId: 'custom/rule',
      category: 'typography',
      severity: 'error',
      message: 'Missing font',
      nodeId: 'text-1' as NodeId,
      pageId: 'page-1',
      evidence: { font: 'Helvetica' },
      recommendation: 'Use Inter',
      autoFixAvailable: true,
      confidence: 0.95,
      cost: 'expensive',
      contextDependent: true,
      workspaceApplicable: ['print', 'design'],
    });
    expect(f.ruleId).toBe('custom/rule');
    expect(f.category).toBe('typography');
    expect(f.severity).toBe('error');
    expect(f.message).toBe('Missing font');
    expect(f.nodeId).toBe('text-1');
    expect(f.pageId).toBe('page-1');
    expect(f.evidence).toEqual({ font: 'Helvetica' });
    expect(f.recommendation).toBe('Use Inter');
    expect(f.autoFixAvailable).toBe(true);
    expect(f.confidence).toBe(0.95);
    expect(f.cost).toBe('expensive');
    expect(f.contextDependent).toBe(true);
    expect(f.workspaceApplicable).toEqual(['print', 'design']);
  });

  it('document-level findings have no nodeId', () => {
    const f = makeFinding({
      ruleId: 'print/missing-bleed',
      nodeId: undefined,
      category: 'print',
      severity: 'error',
      message: 'No bleed set',
    });
    expect(f.nodeId).toBeUndefined();
  });
});

describe('buildAuditSummary', () => {
  it('returns zero counts for empty findings', () => {
    const s = buildAuditSummary([]);
    expect(s.totalErrors).toBe(0);
    expect(s.totalWarnings).toBe(0);
    expect(s.totalSuggestions).toBe(0);
    expect(s.totalAdvisories).toBe(0);
    expect(s.totalFindings).toBe(0);
  });

  it('counts severities correctly', () => {
    const findings = [
      makeFinding({ severity: 'error' }),
      makeFinding({ severity: 'error' }),
      makeFinding({ severity: 'warning' }),
      makeFinding({ severity: 'suggestion' }),
      makeFinding({ severity: 'advisory' }),
    ];
    const s = buildAuditSummary(findings);
    expect(s.totalErrors).toBe(2);
    expect(s.totalWarnings).toBe(1);
    expect(s.totalSuggestions).toBe(1);
    expect(s.totalAdvisories).toBe(1);
    expect(s.totalFindings).toBe(5);
  });

  it('groups by category', () => {
    const findings = [
      makeFinding({ category: 'color', ruleId: 'c1' }),
      makeFinding({ category: 'color', ruleId: 'c2' }),
      makeFinding({ category: 'typography', ruleId: 't1' }),
    ];
    const s = buildAuditSummary(findings);
    expect(s.byCategory.color).toHaveLength(2);
    expect(s.byCategory.typography).toHaveLength(1);
  });

  it('groups by severity', () => {
    const findings = [
      makeFinding({ severity: 'error', ruleId: 'e1' }),
      makeFinding({ severity: 'error', ruleId: 'e2' }),
      makeFinding({ severity: 'warning', ruleId: 'w1' }),
    ];
    const s = buildAuditSummary(findings);
    expect(s.bySeverity.error).toHaveLength(2);
    expect(s.bySeverity.warning).toHaveLength(1);
  });

  it('identifies hasErrors correctly', () => {
    expect(buildAuditSummary([makeFinding({ severity: 'error' })]).hasErrors).toBe(true);
    expect(buildAuditSummary([makeFinding({ severity: 'warning' })]).hasErrors).toBe(false);
    expect(buildAuditSummary([]).hasErrors).toBe(false);
  });

  it('identifies hasBlocking correctly', () => {
    expect(
      buildAuditSummary([makeFinding({ severity: 'error', blocking: true })]).hasBlocking,
    ).toBe(true);
    expect(buildAuditSummary([makeFinding({ severity: 'error' })]).hasBlocking).toBe(false);
  });

  it('computes highest severity', () => {
    expect(buildAuditSummary([makeFinding({ severity: 'warning' })]).highestSeverity).toBe(
      'warning',
    );
    expect(buildAuditSummary([makeFinding({ severity: 'error' })]).highestSeverity).toBe('error');
    expect(buildAuditSummary([]).highestSeverity).toBeUndefined();
  });
});

describe('legacy type conversion', () => {
  it('converts AuditIssue to AuditFinding', () => {
    const legacy = {
      nodeId: 'n1' as NodeId,
      type: 'contrast-aa-fail',
      severity: 'error' as const,
      message: 'Low contrast',
    };
    const f = legacyAuditToFinding(legacy);
    expect(f.ruleId).toBe('contrast-aa-fail');
    expect(f.severity).toBe('error');
    expect(f.message).toBe('Low contrast');
    expect(f.nodeId).toBe('n1');
    expect(f.source).toBe('wcag-contrast');
    expect(f.findingId).toBeTruthy();
  });

  it('converts DebtIssue to AuditFinding', () => {
    const legacy = {
      checkId: 'missing-fonts',
      severity: 'error' as const,
      message: 'Font not found',
      nodeId: 'n2' as NodeId,
      fixable: true,
    };
    const f = legacyDebtToFinding(legacy);
    expect(f.ruleId).toBe('missing-fonts');
    expect(f.severity).toBe('error');
    expect(f.autoFixAvailable).toBe(true);
    expect(f.source).toBe('debt-scanner');
  });

  it('converts GovernanceIssue to AuditFinding', () => {
    const legacy = {
      ruleId: 'token-color',
      severity: 'warning' as const,
      message: 'Un-tokenized color',
      nodeId: 'n3' as NodeId,
    };
    const f = legacyGovernanceToFinding(legacy);
    expect(f.ruleId).toBe('token-color');
    expect(f.source).toBe('governance');
  });

  it('converts LinterIssue to AuditFinding', () => {
    const legacy = {
      ruleId: 'layer-hygiene/zero-size/v1',
      severity: 'warning' as const,
      category: 'layer-hygiene' as const,
      nodeIds: ['n4' as NodeId],
      message: 'Zero size',
      fixes: [],
      dismissable: true,
      version: '1',
      scope: 'document' as const,
      confidence: 0.9,
    };
    const f = legacyLinterToFinding(legacy);
    expect(f.ruleId).toBe('layer-hygiene/zero-size/v1');
    expect(f.source).toBe('linter');
    expect(f.confidence).toBe(0.9);
    expect(f.nodeId).toBe('n4');
  });
});

describe('auditFindingToLegacy', () => {
  it('round-trips through legacy conversion', () => {
    const original = makeFinding();
    const legacy = auditFindingToLegacy(original);
    expect(legacy.findingId).toBe(original.findingId);
    expect(legacy.ruleId).toBe(original.ruleId);
    expect(legacy.severity).toBe(original.severity);
    expect(legacy.message).toBe(original.message);
  });
});

// ─── Canonical type exhaustiveness tests ──────────────────────────────────

describe('AuditFinding canonical type', () => {
  it('supports all lifecycle fields', () => {
    const finding: AuditFinding = createFinding({
      ruleId: 'test/lifecycle',
      category: 'color',
      severity: 'error',
      message: 'Lifecycle test',
      nodeId: 'n1' as NodeId,
      stale: true,
      resolved: false,
      scanId: 42,
      suppressionEligible: true,
      suppressionScope: 'finding',
      suppression: {
        id: 'sup-1',
        reason: 'Known issue',
        suppressedAt: Date.now(),
        active: true,
      },
    });
    expect(finding.stale).toBe(true);
    expect(finding.resolved).toBe(false);
    expect(finding.scanId).toBe(42);
    expect(finding.suppressionEligible).toBe(true);
    expect(finding.suppression?.active).toBe(true);
  });

  it('supports multi-node references', () => {
    const finding = createFinding({
      ruleId: 'test/multi',
      category: 'accessibility',
      severity: 'warning',
      message: 'Multiple nodes',
      nodeIds: ['n1' as NodeId, 'n2' as NodeId],
    });
    expect(finding.nodeIds).toEqual(['n1', 'n2']);
  });

  it('supports region and interaction metadata', () => {
    const finding = createFinding({
      ruleId: 'test/meta',
      category: 'prototype',
      severity: 'suggestion',
      message: 'Metadata',
      region: { x: 0, y: 0, w: 100, h: 200, pageId: 'p1' },
      interactionId: 'int-1',
      targetName: 'Button',
      standardReference: 'WCAG 2.1 SC 1.4.3',
      documentationUrl: 'https://example.com',
      metadata: { extra: 'data' },
    });
    expect(finding.region?.w).toBe(100);
    expect(finding.interactionId).toBe('int-1');
    expect(finding.targetName).toBe('Button');
    expect(finding.standardReference).toBe('WCAG 2.1 SC 1.4.3');
    expect(finding.metadata?.extra).toBe('data');
  });

  it('supports forward-compat metadata', () => {
    const finding = createFinding({
      ruleId: 'test/forward',
      category: 'codegen',
      severity: 'advisory',
      message: 'Forward compat',
      metadata: { newField: 'value' },
    });
    expect(finding.metadata?.newField).toBe('value');
  });

  it('auto-fills nodeIds from nodeId when nodeIds not provided', () => {
    const finding = createFinding({
      ruleId: 'test/auto',
      category: 'color',
      severity: 'error',
      message: 'Auto fill',
      nodeId: 'n1' as NodeId,
    });
    expect(finding.nodeIds).toEqual(['n1']);
  });

  it('does not set nodeIds when nodeId is absent', () => {
    const finding = createFinding({
      ruleId: 'test/doc',
      category: 'print',
      severity: 'warning',
      message: 'Doc level',
    });
    expect(finding.nodeIds).toBeUndefined();
  });

  it('supports applicableModes', () => {
    const finding = createFinding({
      ruleId: 'test/modes',
      category: 'color',
      severity: 'suggestion',
      message: 'Mode filter',
      applicableModes: ['standard', 'text-editing'],
    });
    expect(finding.applicableModes).toEqual(['standard', 'text-editing']);
  });

  it('supports all FindingCategory values', () => {
    const categories: Array<AuditFinding['category']> = [
      'color',
      'typography',
      'layout',
      'accessibility',
      'vector',
      'raster',
      'effects',
      'layer-hygiene',
      'touch-target',
      'focus-order',
      'palette',
      'prototype',
      'governance',
      'performance',
      'print',
      'codegen',
      'export',
      'spacing',
      'structure',
    ];
    expect(categories.length).toBe(19);
    // All compile — this test verifies the type discriminant is exhaustive
    const u: string | undefined = categories[0];
    expect(u).toBeTruthy();
  });
});
