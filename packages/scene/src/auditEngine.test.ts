/**
 * TDD tests for the audit rule registry and engine.
 *
 * Tests: rule registration, workspace filtering, context applicability,
 * cache invalidation, report generation, and quick status.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditContext, AuditRuleDef } from './auditEngine';
import {
  clearRules,
  getAllRules,
  getRule,
  getRules,
  invalidateCache,
  invalidateNodes,
  isRuleApplicable,
  registerRule,
  ruleCount,
  runAudit,
  runQuickStatus,
} from './auditEngine';
import { createFinding } from './auditFinding';
import type { Document } from './document';
import { createDocument } from './document';
import type { NodeId } from './types';

function makeDoc(): Document {
  return createDocument();
}

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    doc: makeDoc(),
    workspaceMode: 'design',
    canvasMode: 'full',
    tool: 'select',
    selection: [],
    isPresenting: false,
    ...overrides,
  };
}

function makeRule(overrides: Partial<AuditRuleDef> = {}): AuditRuleDef {
  const id = overrides.id ?? 'test/rule-1';
  return {
    id,
    label: 'Test Rule',
    category: 'color',
    source: 'manual',
    defaultSeverity: 'warning',
    cost: 'cheap',
    stage: 'immediate',
    workspaces: [],
    nodeKinds: [],
    blocking: false,
    contextDependent: false,
    confidenceFloor: 0.5,
    suppressible: true,
    run: () => [
      createFinding({
        ruleId: id,
        category: 'color',
        severity: 'warning',
        message: 'Test finding',
        source: 'manual',
      }),
    ],
    ...overrides,
  };
}

describe('rule registration', () => {
  beforeEach(() => {
    clearRules();
  });

  it('registers and retrieves a rule', () => {
    registerRule(makeRule());
    expect(ruleCount()).toBe(1);
    expect(getRule('test/rule-1')).toBeDefined();
    expect(getRule('test/rule-1')?.label).toBe('Test Rule');
  });

  it('overwrites duplicate IDs', () => {
    registerRule(makeRule({ label: 'V1' }));
    registerRule(makeRule({ label: 'V2' }));
    expect(ruleCount()).toBe(1);
    expect(getRule('test/rule-1')?.label).toBe('V2');
  });

  it('returns all registered rules', () => {
    registerRule(makeRule({ id: 'a' }));
    registerRule(makeRule({ id: 'b' }));
    expect(getAllRules()).toHaveLength(2);
  });

  it('clears all rules', () => {
    registerRule(makeRule());
    clearRules();
    expect(ruleCount()).toBe(0);
  });
});

describe('rule filtering', () => {
  beforeEach(() => {
    clearRules();
  });

  it('filters by workspace mode', () => {
    registerRule(makeRule({ id: 'design-only', workspaces: ['design'] }));
    registerRule(makeRule({ id: 'print-only', workspaces: ['print'] }));
    registerRule(makeRule({ id: 'all-workspaces', workspaces: [] }));

    const designRules = getRules({ workspaceMode: 'design' });
    expect(designRules.map((r) => r.id)).toContain('design-only');
    expect(designRules.map((r) => r.id)).toContain('all-workspaces');
    expect(designRules.map((r) => r.id)).not.toContain('print-only');
  });

  it('filters by stage', () => {
    registerRule(makeRule({ id: 'imm', stage: 'immediate' }));
    registerRule(makeRule({ id: 'on-demand', stage: 'on-demand' }));

    const immediateRules = getRules({ stage: 'immediate' });
    expect(immediateRules).toHaveLength(1);
    expect(immediateRules[0]!.id).toBe('imm');
  });

  it('filters by cost', () => {
    registerRule(makeRule({ id: 'cheap', cost: 'cheap' }));
    registerRule(makeRule({ id: 'expensive', cost: 'expensive' }));

    const cheapRules = getRules({ cost: 'cheap' });
    expect(cheapRules).toHaveLength(1);
  });

  it('filters by source', () => {
    registerRule(makeRule({ id: 'debt', source: 'debt-scanner' }));
    registerRule(makeRule({ id: 'lint', source: 'linter' }));

    const debtRules = getRules({ source: 'debt-scanner' });
    expect(debtRules).toHaveLength(1);
  });

  it('filters by category', () => {
    registerRule(makeRule({ id: 'color', category: 'color' }));
    registerRule(makeRule({ id: 'typo', category: 'typography' }));

    const colorRules = getRules({ category: 'color' });
    expect(colorRules).toHaveLength(1);
  });
});

describe('context applicability', () => {
  it('applies rule with empty workspaces to any mode', () => {
    const rule = makeRule({ workspaces: [] });
    expect(isRuleApplicable(rule, makeCtx({ workspaceMode: 'design' }))).toBe(true);
    expect(isRuleApplicable(rule, makeCtx({ workspaceMode: 'print' }))).toBe(true);
  });

  it('rejects rule for non-matching workspace', () => {
    const rule = makeRule({ workspaces: ['design'] });
    expect(isRuleApplicable(rule, makeCtx({ workspaceMode: 'print' }))).toBe(false);
  });

  it('skips non-preflight rules during presentation', () => {
    const rule = makeRule({ stage: 'immediate' });
    expect(isRuleApplicable(rule, makeCtx({ isPresenting: true }))).toBe(false);
  });

  it('allows preflight rules during presentation', () => {
    const rule = makeRule({ stage: 'preflight' });
    expect(isRuleApplicable(rule, makeCtx({ isPresenting: true }))).toBe(true);
  });

  it('skips expensive rules in outline canvas mode', () => {
    const rule = makeRule({ cost: 'expensive' });
    expect(isRuleApplicable(rule, makeCtx({ canvasMode: 'outline' }))).toBe(false);
  });

  it('allows cheap rules in outline canvas mode', () => {
    const rule = makeRule({ cost: 'cheap' });
    expect(isRuleApplicable(rule, makeCtx({ canvasMode: 'outline' }))).toBe(true);
  });
});

describe('audit engine', () => {
  beforeEach(() => {
    clearRules();
  });

  it('runs all applicable rules and returns findings', () => {
    registerRule(makeRule({ id: 'r1' }));
    registerRule(makeRule({ id: 'r2' }));

    const report = runAudit(makeCtx());
    expect(report.findings).toHaveLength(2);
    expect(report.ruleResults).toHaveLength(2);
    expect(report.summary.totalFindings).toBe(2);
  });

  it('skips non-applicable rules', () => {
    registerRule(makeRule({ id: 'design-only', workspaces: ['design'] }));
    registerRule(makeRule({ id: 'print-only', workspaces: ['print'] }));

    const report = runAudit(makeCtx({ workspaceMode: 'design' }));
    expect(report.ruleResults).toHaveLength(1);
    expect(report.ruleResults[0]!.ruleId).toBe('design-only');
  });

  it('filters by stage', () => {
    registerRule(makeRule({ id: 'imm', stage: 'immediate' }));
    registerRule(makeRule({ id: 'od', stage: 'on-demand' }));

    const report = runAudit(makeCtx(), { stages: ['immediate'] });
    expect(report.ruleResults).toHaveLength(1);
  });

  it('filters by ruleIds', () => {
    registerRule(makeRule({ id: 'r1' }));
    registerRule(makeRule({ id: 'r2' }));

    const report = runAudit(makeCtx(), { ruleIds: ['r1'] });
    expect(report.ruleResults).toHaveLength(1);
  });

  it('respects confidence floor', () => {
    registerRule(
      makeRule({
        id: 'low-conf',
        confidenceFloor: 0.8,
        run: () => [
          createFinding({
            ruleId: 'low-conf',
            category: 'color',
            severity: 'warning',
            message: 'Low confidence',
            confidence: 0.5,
            source: 'manual',
          }),
          createFinding({
            ruleId: 'low-conf',
            category: 'color',
            severity: 'warning',
            message: 'High confidence',
            confidence: 0.9,
            source: 'manual',
          }),
        ],
      }),
    );

    const report = runAudit(makeCtx());
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.message).toBe('High confidence');
  });

  it('sorts rules by cost (cheap first)', () => {
    registerRule(makeRule({ id: 'exp', cost: 'expensive' }));
    registerRule(makeRule({ id: 'cheap', cost: 'cheap' }));
    registerRule(makeRule({ id: 'mod', cost: 'moderate' }));

    const report = runAudit(makeCtx());
    expect(report.ruleResults.map((r) => r.ruleId)).toEqual(['cheap', 'mod', 'exp']);
  });

  it('handles rule failures gracefully', () => {
    registerRule(
      makeRule({
        id: 'failing',
        run: () => {
          throw new Error('rule crashed');
        },
      }),
    );
    registerRule(makeRule({ id: 'ok' }));

    const report = runAudit(makeCtx());
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.ruleId).toBe('ok');
  });

  it('increments scan ID monotonically', () => {
    registerRule(makeRule());
    const r1 = runAudit(makeCtx());
    const r2 = runAudit(makeCtx());
    expect(r2.scanId).toBeGreaterThan(r1.scanId);
  });

  it('reports workspace mode and tool in the report', () => {
    registerRule(makeRule());
    const report = runAudit(makeCtx({ workspaceMode: 'print', tool: 'select' }));
    expect(report.workspaceMode).toBe('print');
    expect(report.tool).toBe('select');
  });
});

describe('cache', () => {
  beforeEach(() => {
    clearRules();
    invalidateCache();
  });

  it('returns cached results for same rule + revision + selection', () => {
    let callCount = 0;
    registerRule(
      makeRule({
        id: 'cached',
        run: () => {
          callCount++;
          return [
            createFinding({
              ruleId: 'cached',
              category: 'color',
              severity: 'advisory',
              message: 'cached',
              source: 'manual',
            }),
          ];
        },
      }),
    );

    runAudit(makeCtx());
    runAudit(makeCtx());
    expect(callCount).toBe(1);
  });

  it('re-runs when force=true', () => {
    let callCount = 0;
    registerRule(
      makeRule({
        id: 'forced',
        run: () => {
          callCount++;
          return [];
        },
      }),
    );

    runAudit(makeCtx());
    runAudit(makeCtx(), { force: true });
    expect(callCount).toBe(2);
  });

  it('invalidates all cache entries', () => {
    let callCount = 0;
    registerRule(
      makeRule({
        id: 'inv',
        run: () => {
          callCount++;
          return [];
        },
      }),
    );

    runAudit(makeCtx());
    invalidateCache();
    runAudit(makeCtx());
    expect(callCount).toBe(2);
  });

  it('invalidates entries containing specific node IDs', () => {
    let callCount = 0;
    registerRule(
      makeRule({
        id: 'node-inv',
        run: () => {
          callCount++;
          return [
            createFinding({
              ruleId: 'node-inv',
              category: 'color',
              severity: 'advisory',
              message: 'found',
              nodeId: 'target-node' as NodeId,
              source: 'manual',
            }),
          ];
        },
      }),
    );

    runAudit(makeCtx());
    expect(callCount).toBe(1);
    invalidateNodes(['target-node' as NodeId]);
    runAudit(makeCtx());
    expect(callCount).toBe(2);
  });
});

describe('quick status', () => {
  beforeEach(() => {
    clearRules();
  });

  it('counts errors and warnings from cheap immediate rules', () => {
    registerRule(
      makeRule({
        id: 'err-rule',
        cost: 'cheap',
        stage: 'immediate',
        run: () => [
          createFinding({
            ruleId: 'err-rule',
            category: 'color',
            severity: 'error',
            message: 'Error',
            blocking: true,
            source: 'manual',
          }),
        ],
      }),
    );
    registerRule(
      makeRule({
        id: 'warn-rule',
        cost: 'cheap',
        stage: 'immediate',
        run: () => [
          createFinding({
            ruleId: 'warn-rule',
            category: 'color',
            severity: 'warning',
            message: 'Warning',
            source: 'manual',
          }),
        ],
      }),
    );
    registerRule(
      makeRule({
        id: 'expensive-rule',
        cost: 'expensive',
        stage: 'immediate',
        run: () => [
          createFinding({
            ruleId: 'expensive-rule',
            category: 'color',
            severity: 'error',
            message: 'Should be skipped',
            source: 'manual',
          }),
        ],
      }),
    );

    const status = runQuickStatus(makeCtx());
    expect(status.errorCount).toBe(1);
    expect(status.warningCount).toBe(1);
    expect(status.hasBlocking).toBe(true);
  });

  it('returns zeros when no rules match', () => {
    registerRule(makeRule({ workspaces: ['print'] }));
    const status = runQuickStatus(makeCtx({ workspaceMode: 'design' }));
    expect(status.errorCount).toBe(0);
    expect(status.warningCount).toBe(0);
    expect(status.hasBlocking).toBe(false);
  });
});
