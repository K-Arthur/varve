import type { AuditFinding } from './auditFinding';
import type { FindingFingerprint } from './fingerprint';
import type { NodeId } from './types';

export type SuppressionScopeKind = 'finding' | 'rule-on-node' | 'rule-on-page' | 'rule-on-document';

export interface SuppressionEntry {
  fingerprint: FindingFingerprint;
  ruleId: string;
  ruleVersion: number;
  scope: SuppressionScopeKind;
  subjectRef?: { kind: 'node' | 'page'; id: string };
  reason?: string;
  suppressedAt: number;
  suppressedBy?: string;
  expiresAt?: number;
}

export function createSuppressionKey(entry: SuppressionEntry): string {
  const ref = entry.subjectRef ? `${entry.subjectRef.kind}:${entry.subjectRef.id}` : '';
  return `${entry.fingerprint}::${entry.scope}::${ref}`;
}

export function entryMatchesScope(entry: SuppressionEntry, finding: AuditFinding): boolean {
  switch (entry.scope) {
    case 'finding':
      return entry.fingerprint === finding.fingerprint;
    case 'rule-on-node':
      return (
        entry.ruleId === finding.ruleId &&
        entry.subjectRef?.kind === 'node' &&
        !!finding.nodeId &&
        entry.subjectRef.id === finding.nodeId
      );
    case 'rule-on-page':
      return (
        entry.ruleId === finding.ruleId &&
        entry.subjectRef?.kind === 'page' &&
        !!finding.pageId &&
        entry.subjectRef.id === finding.pageId
      );
    case 'rule-on-document':
      return entry.ruleId === finding.ruleId;
  }
}

export function isSuppressed(
  finding: AuditFinding,
  suppressions: SuppressionEntry[],
  now: number = Date.now(),
): boolean {
  for (const entry of suppressions) {
    if (entry.expiresAt !== undefined && entry.expiresAt < now) continue;
    if (entry.ruleVersion !== finding.ruleVersion) continue;
    if (entry.ruleId !== finding.ruleId) continue;
    if (entryMatchesScope(entry, finding)) return true;
  }
  return false;
}

export function applySuppressions(
  findings: AuditFinding[],
  suppressions: SuppressionEntry[],
  now?: number,
): AuditFinding[] {
  return findings.filter((f) => !isSuppressed(f, suppressions, now));
}

export interface BuildSuppressionParams {
  fingerprint: FindingFingerprint;
  ruleId: string;
  ruleVersion: number;
  scope: SuppressionScopeKind;
  subjectRef?: { kind: 'node' | 'page'; id: string };
  reason?: string;
  suppressedAt?: number;
  expiresAt?: number;
}

export function buildSuppression(params: BuildSuppressionParams): SuppressionEntry {
  return {
    fingerprint: params.fingerprint,
    ruleId: params.ruleId,
    ruleVersion: params.ruleVersion,
    scope: params.scope,
    subjectRef: params.subjectRef,
    reason: params.reason,
    suppressedAt: params.suppressedAt ?? Date.now(),
    suppressedBy: undefined,
    expiresAt: params.expiresAt,
  };
}

export function deduplicateSuppressions(suppressions: SuppressionEntry[]): SuppressionEntry[] {
  const seen = new Map<string, SuppressionEntry>();
  for (const entry of suppressions) {
    const key = createSuppressionKey(entry);
    const existing = seen.get(key);
    if (!existing || entry.suppressedAt > existing.suppressedAt) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values());
}

export const MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE = 50;

export function mightCollapseSuppressions(
  suppressions: SuppressionEntry[],
  ruleId: string,
): boolean {
  const count = suppressions.filter((s) => s.ruleId === ruleId && s.scope === 'finding').length;
  return count >= MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE;
}

export function collapseFindingSuppressionsToRuleOnDocument(
  suppressions: SuppressionEntry[],
  ruleId: string,
): SuppressionEntry[] {
  const findingEntries = suppressions.filter((s) => s.ruleId === ruleId && s.scope === 'finding');
  if (findingEntries.length < MAX_UNBOUNDED_SUPPRESSIONS_PER_RULE) {
    return suppressions;
  }

  const collapsed = buildSuppression({
    fingerprint: findingEntries[0]!.fingerprint,
    ruleId,
    ruleVersion: findingEntries[0]!.ruleVersion,
    scope: 'rule-on-document',
    suppressedAt: Date.now(),
  });

  return [
    ...suppressions.filter((s) => !(s.ruleId === ruleId && s.scope === 'finding')),
    collapsed,
  ];
}

export interface OrphanCheckResult {
  orphans: SuppressionEntry[];
  valid: SuppressionEntry[];
}

export function checkOrphans(
  suppressions: SuppressionEntry[],
  activeNodeIds: Set<NodeId>,
  activePageIds: Set<string>,
): OrphanCheckResult {
  const orphans: SuppressionEntry[] = [];
  const valid: SuppressionEntry[] = [];

  for (const entry of suppressions) {
    const ref = entry.subjectRef;
    if (!ref) {
      valid.push(entry);
      continue;
    }
    if (ref.kind === 'node' && activeNodeIds.has(ref.id as NodeId)) {
      valid.push(entry);
    } else if (ref.kind === 'page' && activePageIds.has(ref.id)) {
      valid.push(entry);
    } else {
      orphans.push(entry);
    }
  }

  return { orphans, valid };
}

export interface VersionDriftResult {
  expired: SuppressionEntry[];
  current: SuppressionEntry[];
}

export function checkRuleVersionDrift(
  suppressions: SuppressionEntry[],
  ruleVersions: Record<string, number>,
): VersionDriftResult {
  const expired: SuppressionEntry[] = [];
  const current: SuppressionEntry[] = [];

  for (const entry of suppressions) {
    const currentVersion = ruleVersions[entry.ruleId];
    if (currentVersion !== undefined && entry.ruleVersion < currentVersion) {
      expired.push(entry);
    } else {
      current.push(entry);
    }
  }

  return { expired, current };
}

export const TOTAL_SUPPRESSION_CAP = 5000;

export function enforceCap(
  suppressions: SuppressionEntry[],
  cap: number = TOTAL_SUPPRESSION_CAP,
): { kept: SuppressionEntry[]; dropped: number } {
  if (suppressions.length <= cap) return { kept: suppressions, dropped: 0 };
  const sorted = [...suppressions].sort((a, b) => b.suppressedAt - a.suppressedAt);
  return { kept: sorted.slice(0, cap), dropped: sorted.length - cap };
}
