import { describe, expect, it } from 'vitest';
import { type AuditFinding, createFinding } from './auditFinding';
import type { FindingFingerprint } from './fingerprint';
import {
  applySuppressions,
  buildSuppression,
  checkOrphans,
  checkRuleVersionDrift,
  collapseFindingSuppressionsToRuleOnDocument,
  createSuppressionKey,
  deduplicateSuppressions,
  enforceCap,
  isSuppressed,
  MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE,
  mightCollapseSuppressions,
  type SuppressionEntry,
  TOTAL_SUPPRESSION_CAP,
} from './suppressions';
import type { NodeId } from './types';

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return createFinding({
    ruleId: 'test/rule',
    category: 'color',
    severity: 'warning',
    message: 'Test finding',
    nodeId: 'n1' as NodeId,
    pageId: 'p1',
    ...overrides,
  });
}

function makeSuppression(overrides: Partial<SuppressionEntry> = {}): SuppressionEntry {
  const f = makeFinding();
  return {
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    ruleVersion: f.ruleVersion,
    scope: 'finding',
    suppressedAt: 1000,
    ...overrides,
  };
}

describe('isSuppressed', () => {
  it('suppresses finding by exact fingerprint match', () => {
    const f = makeFinding();
    const s = makeSuppression();
    expect(isSuppressed(f, [s])).toBe(true);
  });

  it('does not suppress finding with different fingerprint', () => {
    const f1 = makeFinding({ ruleId: 'r1', nodeId: 'n1' as NodeId });
    const f2 = makeFinding({ ruleId: 'r2', nodeId: 'n2' as NodeId });
    const s = makeSuppression({ fingerprint: f1.fingerprint });
    expect(isSuppressed(f2, [s])).toBe(false);
  });

  it('returns false for empty suppressions', () => {
    expect(isSuppressed(makeFinding(), [])).toBe(false);
  });

  it('respects expiresAt', () => {
    const f = makeFinding();
    const s = makeSuppression({ expiresAt: 500 });
    expect(isSuppressed(f, [s], 1000)).toBe(false);
  });

  it('includes non-expired entries', () => {
    const f = makeFinding();
    const s = makeSuppression({ expiresAt: 2000 });
    expect(isSuppressed(f, [s], 1000)).toBe(true);
  });

  it('version drift: suppression is void if ruleVersion differs', () => {
    const f = makeFinding({ ruleVersion: 2 });
    const s = makeSuppression({ ruleVersion: 1 });
    expect(isSuppressed(f, [s])).toBe(false);
  });

  it('scope: rule-on-node suppresses matching node', () => {
    const f = makeFinding({ ruleId: 'r1', nodeId: 'n1' as NodeId });
    const s = makeSuppression({
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'rule-on-node',
      subjectRef: { kind: 'node', id: 'n1' as NodeId },
    });
    expect(isSuppressed(f, [s])).toBe(true);
  });

  it('scope: rule-on-node does not suppress different node', () => {
    const f = makeFinding({ ruleId: 'r1', nodeId: 'n2' as NodeId });
    const s = makeSuppression({
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'rule-on-node',
      subjectRef: { kind: 'node', id: 'n1' as NodeId },
    });
    expect(isSuppressed(f, [s])).toBe(false);
  });

  it('scope: rule-on-page suppresses matching page', () => {
    const f = makeFinding({ ruleId: 'r1', nodeId: 'n1' as NodeId, pageId: 'p1' });
    const s = makeSuppression({
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'rule-on-page',
      subjectRef: { kind: 'page', id: 'p1' },
    });
    expect(isSuppressed(f, [s])).toBe(true);
  });

  it('scope: rule-on-document suppresses all findings for rule', () => {
    const f = makeFinding({ ruleId: 'r1', nodeId: 'n999' as NodeId });
    const s = makeSuppression({
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'rule-on-document',
    });
    expect(isSuppressed(f, [s])).toBe(true);
  });

  it('scope: rule-on-document does not suppress different rule', () => {
    const f = makeFinding({ ruleId: 'r2' });
    const s = makeSuppression({
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'rule-on-document',
    });
    expect(isSuppressed(f, [s])).toBe(false);
  });
});

describe('applySuppressions', () => {
  it('filters suppressed findings from list', () => {
    const f1 = makeFinding({ ruleId: 'r1', nodeId: 'n1' as NodeId });
    const f2 = makeFinding({ ruleId: 'r2', nodeId: 'n2' as NodeId });
    const f3 = makeFinding({ ruleId: 'r1', nodeId: 'n3' as NodeId });
    const s = makeSuppression({
      fingerprint: f1.fingerprint,
      ruleId: 'r1',
      ruleVersion: f1.ruleVersion,
      scope: 'finding',
    });
    const result = applySuppressions([f1, f2, f3], [s]);
    expect(result).toHaveLength(2);
    expect(result).not.toContain(f1);
    expect(result).toContain(f2);
    expect(result).toContain(f3);
  });
});

describe('buildSuppression', () => {
  it('creates a suppression entry with timestamp', () => {
    const before = Date.now();
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      reason: 'Intentional',
    });
    expect(entry.fingerprint).toBe(f.fingerprint);
    expect(entry.ruleId).toBe(f.ruleId);
    expect(entry.ruleVersion).toBe(f.ruleVersion);
    expect(entry.scope).toBe('finding');
    expect(entry.reason).toBe('Intentional');
    expect(entry.suppressedAt).toBeGreaterThanOrEqual(before);
    expect(entry.suppressedBy).toBeUndefined();
    expect(entry.expiresAt).toBeUndefined();
  });

  it('includes optional expiresAt', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      expiresAt: 9999999999999,
    });
    expect(entry.expiresAt).toBe(9999999999999);
  });
});

describe('createSuppressionKey', () => {
  it('produces stable key for same entry', () => {
    const f = makeFinding();
    const a = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
    });
    const b = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
    });
    expect(createSuppressionKey(a)).toBe(createSuppressionKey(b));
  });

  it('different scope produces different key', () => {
    const f = makeFinding();
    const a = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
    });
    const b = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'rule-on-document',
    });
    expect(createSuppressionKey(a)).not.toBe(createSuppressionKey(b));
  });
});

describe('deduplicateSuppressions', () => {
  it('keeps last entry by suppressedAt', () => {
    const f = makeFinding();
    const older = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      suppressedAt: 100,
    });
    const newer = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      suppressedAt: 200,
    });
    const result = deduplicateSuppressions([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0]!.suppressedAt).toBe(200);
  });
});

describe('mightCollapseSuppressions / collapseFindingSuppressionsToRuleOnDocument', () => {
  it('returns true when approaching threshold', () => {
    const f = makeFinding({ ruleId: 'r1' });
    const entries: SuppressionEntry[] = [];
    for (let i = 0; i < MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE; i++) {
      entries.push(
        buildSuppression({
          fingerprint: f.fingerprint,
          ruleId: 'r1',
          ruleVersion: 1,
          scope: 'finding',
        }),
      );
    }
    expect(mightCollapseSuppressions(entries, 'r1')).toBe(true);
  });

  it('collapses many finding-scope entries to rule-on-document', () => {
    const f = makeFinding({ ruleId: 'r1' });
    const entries: SuppressionEntry[] = [];
    for (let i = 0; i < MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE; i++) {
      entries.push(
        buildSuppression({
          fingerprint: `${f.fingerprint}-${i}` as FindingFingerprint,
          ruleId: 'r1',
          ruleVersion: 1,
          scope: 'finding',
        }),
      );
    }
    const result = collapseFindingSuppressionsToRuleOnDocument(entries, 'r1');
    expect(result.length).toBeLessThan(entries.length);
    expect(result.some((s) => s.scope === 'rule-on-document')).toBe(true);
  });

  it('does not collapse below threshold', () => {
    const f = makeFinding({ ruleId: 'r1' });
    const entries = [
      buildSuppression({
        fingerprint: f.fingerprint,
        ruleId: 'r1',
        ruleVersion: 1,
        scope: 'finding',
      }),
    ];
    expect(collapseFindingSuppressionsToRuleOnDocument(entries, 'r1')).toBe(entries);
  });
});

describe('checkOrphans', () => {
  it('detects orphaned node reference', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'rule-on-node',
      subjectRef: { kind: 'node', id: 'n_deleted' as NodeId },
    });
    const { orphans, valid } = checkOrphans([entry], new Set(['n1' as NodeId]), new Set(['p1']));
    expect(orphans).toHaveLength(1);
    expect(valid).toHaveLength(0);
  });

  it('non-orphan entries are valid', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
    });
    const { orphans, valid } = checkOrphans([entry], new Set(['n1' as NodeId]), new Set(['p1']));
    expect(orphans).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });

  it('entries without subjectRef are always valid', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'rule-on-document',
    });
    const { orphans, valid } = checkOrphans([entry], new Set(), new Set());
    expect(orphans).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });
});

describe('checkRuleVersionDrift', () => {
  it('detects expired suppressions after rule version bump', () => {
    const entry = buildSuppression({
      fingerprint: 'fp1' as FindingFingerprint,
      ruleId: 'r1',
      ruleVersion: 1,
      scope: 'finding',
    });
    const { expired, current } = checkRuleVersionDrift([entry], { r1: 2 });
    expect(expired).toHaveLength(1);
    expect(current).toHaveLength(0);
  });

  it('current-version suppressions are kept', () => {
    const entry = buildSuppression({
      fingerprint: 'fp1' as FindingFingerprint,
      ruleId: 'r1',
      ruleVersion: 2,
      scope: 'finding',
    });
    const { expired, current } = checkRuleVersionDrift([entry], { r1: 2 });
    expect(expired).toHaveLength(0);
    expect(current).toHaveLength(1);
  });

  it('unknown rules are treated as current', () => {
    const entry = buildSuppression({
      fingerprint: 'fp1' as FindingFingerprint,
      ruleId: 'r_unknown',
      ruleVersion: 1,
      scope: 'finding',
    });
    const { expired, current } = checkRuleVersionDrift([entry], {});
    expect(expired).toHaveLength(0);
    expect(current).toHaveLength(1);
  });
});

describe('enforceCap', () => {
  it('keeps newest entries when over cap', () => {
    const entries: SuppressionEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        buildSuppression({
          fingerprint: `fp${i}` as FindingFingerprint,
          ruleId: 'r1',
          ruleVersion: 1,
          scope: 'finding',
          suppressedAt: i * 100,
        }),
      );
    }
    const { kept, dropped } = enforceCap(entries, 5);
    expect(kept).toHaveLength(5);
    expect(dropped).toBe(5);
    expect(kept[0]!.suppressedAt).toBe(900);
    expect(kept[4]!.suppressedAt).toBe(500);
  });

  it('under cap keeps all', () => {
    const entries = [
      buildSuppression({
        fingerprint: 'fp1' as FindingFingerprint,
        ruleId: 'r1',
        ruleVersion: 1,
        scope: 'finding',
      }),
    ];
    const { kept, dropped } = enforceCap(entries, 5);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(0);
  });
});

describe('edge case: merge conflict keying', () => {
  it('deduplication by key enables union merge', () => {
    const f = makeFinding();
    const a = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      suppressedAt: 100,
    });
    const b = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
      suppressedAt: 200,
    });
    const merged = deduplicateSuppressions([a, b].flat());
    expect(merged).toHaveLength(1);
    expect(merged[0]!.suppressedAt).toBe(200);
  });
});

describe('edge case: backward compat — serialize preserves unknown fields', () => {
  it('round-trips through JSON', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'rule-on-node',
      subjectRef: { kind: 'node', id: 'n1' as NodeId },
      reason: 'Known issue, will fix later',
      expiresAt: 9999999999999,
    });
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json) as SuppressionEntry;
    expect(parsed.fingerprint).toBe(entry.fingerprint);
    expect(parsed.ruleId).toBe(entry.ruleId);
    expect(parsed.ruleVersion).toBe(entry.ruleVersion);
    expect(parsed.scope).toBe('rule-on-node');
    expect(parsed.subjectRef).toEqual({ kind: 'node', id: 'n1' });
    expect(parsed.reason).toBe('Known issue, will fix later');
    expect(parsed.expiresAt).toBe(9999999999999);
  });
});

describe('edge case: TOTAL_SUPPRESSION_CAP', () => {
  it('is set to 5000', () => {
    expect(TOTAL_SUPPRESSION_CAP).toBe(5000);
  });
});

describe('edge case: suppressBy omitted when no user identity', () => {
  it('buildSuppression does not set suppressedBy', () => {
    const f = makeFinding();
    const entry = buildSuppression({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      scope: 'finding',
    });
    expect(entry.suppressedBy).toBeUndefined();
  });
});
